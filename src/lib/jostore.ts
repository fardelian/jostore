import * as path from 'path';
import * as fs from 'fs';

type ScalarType = 'number' | 'boolean' | 'string' | 'undefined';

interface ScalarBlock {
    type: ScalarType;
    value: number | boolean | string | undefined;
}

interface ObjectBlock {
    type: 'object';
    properties: Record<string, number | null>;
}

interface ArrayBlock {
    type: 'array';
    properties: (number | null)[];
}

type CompoundBlock = ObjectBlock | ArrayBlock;
type BlockData = ScalarBlock | CompoundBlock;
type VersionsBlock = number[];
type StoredBlock = BlockData | VersionsBlock;

interface ProxyTarget {
    key: number;
    store: Store;
    data: CompoundBlock;
    proxy?: object;
}

export type JostoreRoot = Record<string, unknown>;

const storeDirMap: Record<string, Store | undefined> = {};
const objCacheByKey: Record<number, unknown> = {};
const proxyObjMap = new WeakMap<object, ProxyTarget>();

// Single shared exit listener so each Store doesn't add its own (which would
// hit Node's MaxListeners warning after ~10 stores).
const openStores = new Set<Store>();

/** Module-level exit cleanup, exported so tests can drive it directly. */
export function _runAllExitCleanups(code: number): void {
    for (const store of openStores) {
        store._runExitCleanup(code);
    }
    openStores.clear();
}
process.on('exit', _runAllExitCleanups);

const emptyArr: unknown[] = [];
const emptyObj: Record<string, unknown> = {};

function hasOwn(obj: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function isVersionsBlock(value: StoredBlock): value is VersionsBlock {
    return Array.isArray(value);
}

class Store {
    _opsCounter = 0;
    t0 = Date.now();
    storeDirectory: string;
    versionFilePath: string;
    version: number;
    root: object;

    constructor(storeDirectory: string, version: number | null) {
        this.storeDirectory = storeDirectory;
        this.versionFilePath = path.resolve(storeDirectory, 'version');
        fs.mkdirSync(this.storeDirectory, { recursive: true });

        this.version = (version ?? 0) || this._nextBlock();

        const initial = this.read(0, this.version);
        let rootData: CompoundBlock;
        if (initial && (initial.type === 'object' || initial.type === 'array')) {
            rootData = initial;
        } else {
            rootData = {
                type: 'object',
                properties: {
                    root: 0,
                },
            };
            this.write(0, rootData);
        }

        this.root = this._rootFromData(rootData);
        openStores.add(this);
    }

    _runExitCleanup(code: number): void {
        // `_nextBlock` still touches the version file, so a shutdown-time fs
        // error remains possible even though we no longer keep an open fd.
        try {
            const ms = Date.now() - this.t0;
            console.error(`${code} ${code ? 'ERROR' : 'OK'}, after ${this._opsCounter} ops in ${ms} ms (~ ${Math.round(this._opsCounter / ms * 1000 * 1e2) / 1e2} ops/sec, ${Math.round(ms / this._opsCounter * 1e2) / 1e2} ms/op) @ ${this._nextBlock()}`);
        } catch (ex) {
            console.error(ex);
        }
    }

    read(key: number, version: number): BlockData | undefined {
        const existingVersions = this._readKey(key);
        if (!existingVersions || !isVersionsBlock(existingVersions)) {
            return undefined;
        }

        let correctVersion: number | undefined;
        for (let i = existingVersions.length - 1; i >= 0; i--) {
            const candidate = existingVersions[i];
            if (candidate <= version) {
                correctVersion = candidate;
                break;
            }
        }

        if (correctVersion === undefined) {
            return undefined;
        }

        const result = this._readKey(correctVersion);
        if (!result || isVersionsBlock(result)) {
            return undefined;
        }
        return result;
    }

    write(key: number, value: BlockData): void {
        const nextVersionIndex = this._nextBlock();

        this._writeKey(nextVersionIndex, value);

        const existing = this._readKey(key);
        const versions: VersionsBlock = existing && isVersionsBlock(existing) ? existing : [];
        versions.push(nextVersionIndex);
        this._writeKey(key, versions);
    }

    /**
     * On-disk file path for a given key. The basename is the key left-padded
     * with zeros to at least 4 digits (so a fresh store sorts naturally in
     * `ls`); larger keys simply use more digits.
     */
    _keyFilePath(key: number): string {
        return path.resolve(this.storeDirectory, String(key).padStart(4, '0'));
    }

    /** Read and parse a key's JSON file; returns `undefined` if it doesn't exist. */
    _readKey(key: number): StoredBlock | undefined {
        let json: string;
        try {
            json = fs.readFileSync(this._keyFilePath(key), 'utf8');
        } catch (ex) {
            if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw ex;
            }
            return undefined;
        }
        return JSON.parse(json) as StoredBlock;
    }

    /** Write `value` as pretty-printed JSON for `key` so the file is browsable. */
    _writeKey(key: number, value: StoredBlock): void {
        fs.writeFileSync(this._keyFilePath(key), JSON.stringify(value, null, 2));
    }

    _rootFromData(rootData: CompoundBlock): object {
        const obj: ProxyTarget = {
            key: 0,
            store: this,
            data: rootData,
        };

        const root = new Proxy(obj, ProxyHandler) as unknown as Record<string, unknown>;
        obj.proxy = root;

        objCacheByKey[0] = root;
        proxyObjMap.set(root, obj);

        root.root = root;
        return root;
    }

    _nextBlock(): number {
        let lastId: number;
        try {
            lastId = Number(fs.readFileSync(this.versionFilePath).toString()) | 0;
        } catch {
            lastId = 0;
        }
        fs.writeFileSync(this.versionFilePath, String(++lastId));
        return lastId;
    }
}

const ProxyHandler: ProxyHandler<ProxyTarget> = {
    get(obj, name) {
        obj.store._opsCounter++;

        if (typeof name === 'symbol' || !hasOwn(obj.data.properties, name)) {
            if (obj.data.type === 'array') {
                return (emptyArr as unknown as Record<PropertyKey, unknown>)[name];
            }
            return typeof name === 'symbol' ? undefined : emptyObj[name];
        }

        if (obj.data.type === 'array' && name === 'length') {
            return obj.data.properties.length;
        }

        const propKey = (obj.data.properties as Record<string, number | null>)[name];
        if (propKey === null) {
            return null;
        }

        const existingProxy = objCacheByKey[propKey];
        if (existingProxy !== undefined) {
            return existingProxy;
        }

        const data = obj.store.read(propKey, obj.store.version);
        if (!data) {
            return undefined;
        }

        switch (data.type) {
            case 'number':
            case 'boolean':
            case 'string':
            case 'undefined':
                objCacheByKey[propKey] = data.value;
                return data.value;

            case 'array':
            case 'object': {
                const newObj: ProxyTarget = {
                    key: propKey,
                    store: obj.store,
                    data,
                };

                const proxy = new Proxy(newObj, ProxyHandler) as unknown as object;
                newObj.proxy = proxy;

                objCacheByKey[propKey] = proxy;
                proxyObjMap.set(proxy, newObj);

                return proxy;
            }
        }
    },

    set(obj, name, value: unknown) {
        obj.store._opsCounter++;

        if (typeof name === 'symbol') {
            return false;
        }

        if (obj.data.type === 'array' && name === 'length') {
            // Store array length separately because obj.data.properties doesn't always
            // serialize trailing undefined indices.
            (obj.data.properties as { length: number }).length = value as number;
            obj.store.write(obj.key, obj.data);
            return true;
        }

        const props = obj.data.properties as Record<string, number | null>;

        if (value === null) {
            props[name] = null;
            obj.store.write(obj.key, obj.data);
            return true;
        }

        const existingProxyForValue = typeof value === 'object'
            ? proxyObjMap.get(value)
            : undefined;
        if (existingProxyForValue) {
            if (props[name] !== existingProxyForValue.key) {
                props[name] = existingProxyForValue.key;
                obj.store.write(obj.key, obj.data);
            }
            return true;
        }

        const propKey = obj.store._nextBlock();

        const type = typeof value;
        let data: BlockData;
        switch (type) {
            case 'number':
            case 'boolean':
            case 'string':
            case 'undefined':
                objCacheByKey[propKey] = value;
                data = {
                    type,
                    value: value as number | boolean | string | undefined,
                };
                break;

            case 'object':
                if (Array.isArray(value)) {
                    data = { type: 'array', properties: [] };
                } else {
                    data = { type: 'object', properties: {} };
                }
                break;

            default:
                throw new ReferenceError(`Can't set object type "${type}" for value "${JSON.stringify(value)}" in object with key "${obj.key}"`);
        }

        obj.store.write(propKey, data);

        if (data.type === 'object' || data.type === 'array') {
            const newObj: ProxyTarget = {
                key: propKey,
                data,
                store: obj.store,
            };
            const proxy = new Proxy(newObj, ProxyHandler) as unknown as Record<string, unknown>;
            newObj.proxy = proxy;

            objCacheByKey[propKey] = proxy;
            proxyObjMap.set(proxy, newObj);

            const sourceObj = value as Record<string, unknown>;
            for (const k of Object.keys(sourceObj)) {
                proxy[k] = sourceObj[k];
                sourceObj[k] = proxy[k];
            }
        }

        props[name] = propKey;

        obj.store.write(obj.key, obj.data);

        return true;
    },

    has(obj, name) {
        obj.store._opsCounter++;
        return hasOwn(obj.data.properties, name);
    },

    deleteProperty(obj, name) {
        obj.store._opsCounter++;
        if (typeof name === 'symbol') {
            return false;
        }
        Reflect.deleteProperty(obj.data.properties, name);
        obj.store.write(obj.key, obj.data);
        return true;
    },

    ownKeys(obj) {
        obj.store._opsCounter++;
        return Object.getOwnPropertyNames(obj.data.properties);
    },

    getOwnPropertyDescriptor(obj, name) {
        obj.store._opsCounter++;
        const originalDescriptor = Object.getOwnPropertyDescriptor(obj.data.properties, name);
        if (!originalDescriptor) {
            return undefined;
        }
        // Force configurable/writable: the proxy target is a ProxyTarget that
        // doesn't carry these properties, so reporting them as non-configurable
        // (e.g. an array's `length`) violates the Proxy invariant and crashes
        // `Object.keys`. `enumerable` is preserved so it still skips `length`.
        return {
            value: ProxyHandler.get?.(obj, name, obj.proxy ?? obj) as unknown,
            writable: true,
            enumerable: originalDescriptor.enumerable,
            configurable: true,
        };
    },
};

// The generic `T` exists to let callers pin the proxy's apparent type to their
// own schema; it appears only in the return position by design.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function jostore<T extends object = JostoreRoot>(
    storeDirectory: string,
    version: number | null = null,
): T {
    const safeStoreDirectory = path.resolve(storeDirectory);
    const existingStore = storeDirMap[safeStoreDirectory];
    if (existingStore) {
        return existingStore.root as T;
    }

    fs.mkdirSync(safeStoreDirectory, { recursive: true });

    const newStore = new Store(storeDirectory, version);
    storeDirMap[safeStoreDirectory] = newStore;

    return newStore.root as T;
}

export function getStore(proxy: object): Store | undefined {
    return proxyObjMap.get(proxy)?.store;
}

/**
 * Test-only: drop the in-process caches so the next `jostore(dir)` call
 * re-reads the directory from the underlying fs instead of returning the
 * cached proxy. Used by acceptance tests to simulate a process restart
 * while the on-disk state is preserved by the mocked fs.
 */
export function _resetCaches(): void {
    for (const key of Object.keys(storeDirMap)) {
        Reflect.deleteProperty(storeDirMap, key);
    }
    for (const key of Object.keys(objCacheByKey)) {
        Reflect.deleteProperty(objCacheByKey, key);
    }
    openStores.clear();
    // proxyObjMap is a WeakMap; entries are released when their proxies are.
}

export default jostore;
