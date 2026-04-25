import * as path from 'path';
import * as fs from 'fs';

const DATA_BLOCK_SIZE_BYTES = 1000;

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
    rawFd: number | undefined;
    storeDirectory: string;
    versionFilePath: string;
    version: number;
    root: object;

    constructor(storeDirectory: string, version: number | null) {
        process.on('exit', (code: number) => {
            try {
                if (this.rawFd !== undefined) {
                    fs.fsyncSync(this.rawFd);
                    fs.closeSync(this.rawFd);
                }
                const ms = Date.now() - this.t0;
                console.error(`${code} ${code ? 'ERROR' : 'OK'}, after ${this._opsCounter} ops in ${ms} ms (~ ${Math.round(this._opsCounter / ms * 1000 * 1e2) / 1e2} ops/sec, ${Math.round(ms / this._opsCounter * 1e2) / 1e2} ms/op) @ ${this._nextBlock()}`);
            } catch (ex) {
                console.error(ex);
            }
        });

        this.storeDirectory = storeDirectory;
        this.versionFilePath = path.resolve(storeDirectory, 'version');
        this._openDataFile();

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
    }

    read(key: number, version: number): BlockData | undefined {
        const existingVersions = this.readDataBlock(key);
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

        const result = this.readDataBlock(correctVersion);
        if (!result || isVersionsBlock(result)) {
            return undefined;
        }
        return result;
    }

    write(key: number, value: BlockData): void {
        const nextVersionIndex = this._nextBlock();

        this.writeDataBlock(nextVersionIndex, value);

        let versions: VersionsBlock;
        try {
            const existing = this.readDataBlock(key);
            versions = existing && isVersionsBlock(existing) ? existing : [];
        } catch {
            versions = [];
        }
        versions.push(nextVersionIndex);
        this.writeDataBlock(key, versions);
    }

    readDataBlock(blockIndex: number): StoredBlock | undefined {
        if (this.rawFd === undefined) {
            throw new Error('Data file is not open');
        }

        const position = blockIndex * DATA_BLOCK_SIZE_BYTES;

        const buffer = Buffer.alloc(DATA_BLOCK_SIZE_BYTES);
        const readBytes = fs.readSync(this.rawFd, buffer, 0, DATA_BLOCK_SIZE_BYTES, position);

        if (readBytes !== DATA_BLOCK_SIZE_BYTES) {
            return undefined;
        }

        // Padding/uninitialised regions of the data file are zero bytes; strip
        // them before parsing so JSON.parse sees only the real payload.
        // eslint-disable-next-line no-control-regex
        const json = buffer.toString().replace(/\x00+/g, '');
        if (!json) {
            return undefined;
        }
        const parsed = JSON.parse(json) as { data: StoredBlock };
        return parsed.data;
    }

    writeDataBlock(blockIndex: number, data: StoredBlock): void {
        if (this.rawFd === undefined) {
            throw new Error('Data file is not open');
        }

        let json = JSON.stringify({ data });
        while (json.length < DATA_BLOCK_SIZE_BYTES) {
            json = `${json} `;
        }

        const position = blockIndex * DATA_BLOCK_SIZE_BYTES;

        let empty: string | undefined;
        while (fs.statSync(path.resolve(this.storeDirectory, 'data')).size < position) {
            empty ??= ' '.repeat(DATA_BLOCK_SIZE_BYTES);
            fs.writeSync(this.rawFd, empty, position);
        }

        fs.writeSync(this.rawFd, json, position);
    }

    _openDataFile(): void {
        fs.mkdirSync(this.storeDirectory, { recursive: true });

        const rawFilePath = path.resolve(this.storeDirectory, 'data');
        try {
            this.rawFd = fs.openSync(rawFilePath, 'r+');
        } catch (ex) {
            if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw ex;
            }
            this.rawFd = fs.openSync(rawFilePath, 'w+');
        }
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
        return Object.assign(originalDescriptor, {
            value: ProxyHandler.get?.(obj, name, obj.proxy ?? obj) as unknown,
        });
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

export default jostore;
