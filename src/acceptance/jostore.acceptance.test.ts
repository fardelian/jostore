import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import { faker } from '@faker-js/faker';
import { MockFs } from '../mocks/fs.mock';

// Mock node:fs BEFORE importing jostore so its `import * as fs from 'fs'`
// resolves to our in-memory implementation. This satisfies the "tests must
// use mocks, never real side effects" rule.
const mockFs = new MockFs();
jest.unstable_mockModule('fs', () => mockFs);

let jostore: typeof import('../lib/jostore').default;
let _resetCaches: typeof import('../lib/jostore')._resetCaches;
let _runAllExitCleanups: typeof import('../lib/jostore')._runAllExitCleanups;
let getStore: typeof import('../lib/jostore').getStore;

beforeAll(async () => {
    ({ default: jostore, _resetCaches, _runAllExitCleanups, getStore } = await import('../lib/jostore'));
});

beforeEach(() => {
    mockFs.reset();
    _resetCaches();
});

function uniqueDir(): string {
    return `/store-${faker.string.uuid()}`;
}

describe('jostore (acceptance)', () => {
    describe('basic scalar persistence', () => {
        it('returns undefined for unset properties', () => {
            const root = jostore<any>(uniqueDir());
            expect(root.foo).toBeUndefined();
        });

        it('round-trips a number across an in-process restart', () => {
            const dir = uniqueDir();
            jostore<any>(dir).counter = 42;

            _resetCaches();

            expect(jostore<any>(dir).counter).toBe(42);
        });

        it('round-trips a string across an in-process restart', () => {
            const dir = uniqueDir();
            const value = faker.lorem.word();
            jostore<any>(dir).name = value;

            _resetCaches();

            expect(jostore<any>(dir).name).toBe(value);
        });

        it('toggles a boolean (complex.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            expect(root.flag).toBeUndefined();
            root.flag = !root.flag;
            expect(root.flag).toBe(true);
            root.flag = !root.flag;
            expect(root.flag).toBe(false);
        });

        it('increments a counter across two restarts (simple.ts pattern)', () => {
            const dir = uniqueDir();

            const r1 = jostore<any>(dir);
            expect(r1.counter | 0).toBe(0);
            r1.counter = (r1.counter | 0) + 1;
            expect(r1.counter).toBe(1);

            _resetCaches();
            const r2 = jostore<any>(dir);
            r2.counter = (r2.counter | 0) + 1;
            expect(r2.counter).toBe(2);

            _resetCaches();
            expect(jostore<any>(dir).counter).toBe(2);
        });
    });

    describe('null and delete', () => {
        it('stores null distinctly from undefined', () => {
            const root = jostore<any>(uniqueDir());
            root.x = null;
            expect(root.x).toBeNull();
        });

        it('deletes a top-level property', () => {
            const root = jostore<any>(uniqueDir());
            root.gone = 'will be removed';
            expect(root.gone).toBe('will be removed');
            delete root.gone;
            expect(root.gone).toBeUndefined();
        });

        it('persists a nested deletion across a restart', () => {
            const dir = uniqueDir();
            const r1 = jostore<any>(dir);
            r1.nested = { a: 1, b: 2 };
            delete r1.nested.a;
            expect(r1.nested.a).toBeUndefined();
            expect(r1.nested.b).toBe(2);

            _resetCaches();
            const r2 = jostore<any>(dir);
            expect(r2.nested.a).toBeUndefined();
            expect(r2.nested.b).toBe(2);
        });
    });

    describe('arrays', () => {
        it('creates an empty array and reports length 0', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [];
            expect(root.list.length).toBe(0);
        });

        it('persists an array of numbers across a restart', () => {
            const dir = uniqueDir();
            const initial = [1.1, 2.2, 3.3];
            jostore<any>(dir).list = initial;

            _resetCaches();
            const r2 = jostore<any>(dir);
            expect(r2.list.length).toBe(3);
            expect(r2.list[0]).toBe(initial[0]);
            expect(r2.list[1]).toBe(initial[1]);
            expect(r2.list[2]).toBe(initial[2]);
        });

        it('aliased properties refer to the same underlying array (simple.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [10];
            root.listRef = root.list;
            expect(root.listRef).toBe(root.list);

            root.list.push(20);
            expect(root.listRef.length).toBe(2);
            expect(root.list.length).toBe(2);
        });

        it('reduce on an aliased reference sees the same elements', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [1, 2, 3, 4];
            root.listRef = root.list;
            const sum = (root.listRef as number[]).reduce((acc, n) => acc + n, 0);
            expect(sum).toBe(10);
        });

        it('supports indexed assignment past current length and increment (complex.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [];
            root.list[2] = 15;
            expect(root.list[2]).toBe(15);
            root.list[2]++;
            expect(root.list[2]).toBe(16);
        });

        it('supports truncation via .length (complex.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [1, 2, 3, 4, 5, 6];
            root.list.length = 3;
            expect(root.list.length).toBe(3);
        });

        it('Object.keys on an array proxy returns numeric indices (regression: previously crashed on length descriptor)', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [10, 20, 30];
            // Before the getOwnPropertyDescriptor fix this threw a TypeError
            // about a non-configurable `length` descriptor.
            expect(Object.keys(root.list)).toEqual(['0', '1', '2']);
        });
    });

    describe('nested objects', () => {
        it('persists a deeply nested structure across a restart (complex.ts pattern)', () => {
            const dir = uniqueDir();
            jostore<any>(dir).deep = { nested: { structure: 999999 } };

            _resetCaches();
            expect(jostore<any>(dir).deep.nested.structure).toBe(999999);
        });

        it('lazy-creates a sub-object via ??= (complex.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            expect(root.subObject).toBeUndefined();

            root.subObject ??= {};
            root.subObject.counter2 = (root.subObject.counter2 ?? 0) + 2;
            expect(root.subObject.counter2).toBe(2);

            root.subObject.counter2 = (root.subObject.counter2 ?? 0) + 2;
            expect(root.subObject.counter2).toBe(4);
        });

        it('supports recursive object references (complex.ts pattern)', () => {
            const root = jostore<any>(uniqueDir());
            root.subObject = { counter2: 7 };
            root.subObject.recursive = root.subObject;

            expect(root.subObject.recursive.counter2).toBe(7);
            expect(root.subObject.recursive.recursive.counter2).toBe(7);
        });

        it('Object.keys on an object proxy returns its own keys', () => {
            const root = jostore<any>(uniqueDir());
            root.thing = { a: 1, b: 2, c: 3 };
            expect(Object.keys(root.thing).sort()).toEqual(['a', 'b', 'c']);
        });

        it('hasOwnProperty reports true for set keys and false for missing ones', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [];
            expect(Object.prototype.hasOwnProperty.call(root, 'list')).toBe(true);
            expect(Object.prototype.hasOwnProperty.call(root, 'missing')).toBe(false);
        });
    });

    describe('store identity', () => {
        it('returns the same proxy for the same directory within a process', () => {
            const dir = uniqueDir();
            expect(jostore<any>(dir)).toBe(jostore<any>(dir));
        });

        it('exposes root.root pointing back to root', () => {
            const root = jostore<any>(uniqueDir());
            expect(root.root).toBe(root);
        });

        it('getStore() returns the underlying Store for a proxy', () => {
            const root = jostore<any>(uniqueDir());
            const store = getStore(root);
            expect(store).toBeDefined();
            expect(store?.root).toBe(root);
        });

        it('getStore() returns undefined for a plain non-proxy object', () => {
            expect(getStore({})).toBeUndefined();
        });
    });

    describe('symbol-keyed access (proxy traps reject symbols)', () => {
        it('throws on assigning to a symbol key (proxy.set returns false in strict mode)', () => {
            const root = jostore<any>(uniqueDir());
            const sym = Symbol('s');
            expect(() => {
                root[sym] = 1;
            }).toThrow(TypeError);
        });

        it('reports false from Reflect.deleteProperty for a symbol key (deleteProperty trap rejects symbols)', () => {
            const root = jostore<any>(uniqueDir());
            const sym = Symbol('s');
            expect(Reflect.deleteProperty(root, sym)).toBe(false);
        });

        it('returns undefined when reading an unknown symbol key on a non-array', () => {
            const root = jostore<any>(uniqueDir());
            expect(root[Symbol('s')]).toBeUndefined();
        });

        it('returns undefined when reading a symbol key on an array proxy', () => {
            const root = jostore<any>(uniqueDir());
            root.list = [1, 2, 3];
            expect(root.list[Symbol('s')]).toBeUndefined();
        });
    });

    describe('rejected value types', () => {
        it('throws ReferenceError when assigning a function value', () => {
            const root = jostore<any>(uniqueDir());
            expect(() => {
                root.fn = () => 1;
            }).toThrow(ReferenceError);
        });
    });

    describe('exit cleanup', () => {
        it('runs the per-store cleanup hook without throwing on a freshly opened store', () => {
            const root = jostore<any>(uniqueDir());
            const store = getStore(root);
            expect(store).toBeDefined();

            // Suppress the human-readable stats line the cleanup logs to stderr.
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                expect(() => {
                    store?._runExitCleanup(0);
                }).not.toThrow();
                expect(errSpy).toHaveBeenCalled();
            } finally {
                errSpy.mockRestore();
            }
        });

        it('drives cleanup for every open store via the shared module-level handler', () => {
            jostore<any>(uniqueDir());
            jostore<any>(uniqueDir());
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                _runAllExitCleanups(0);
                expect(errSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
            } finally {
                errSpy.mockRestore();
            }
        });

        it('logs (does not crash) when cleanup hits an fs error mid-shutdown', () => {
            const root = jostore<any>(uniqueDir());
            const store = getStore(root);
            expect(store).toBeDefined();

            // _runExitCleanup still calls _nextBlock, which writes the version
            // file. A failing writeFileSync exercises the outer catch.
            mockFs.nextWriteFileSyncError = new Error('boom');
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                expect(() => {
                    store?._runExitCleanup(1);
                }).not.toThrow();
                expect(errSpy).toHaveBeenCalled();
            } finally {
                errSpy.mockRestore();
            }
        });
    });

    describe('readFileSync error handling', () => {
        it('propagates non-ENOENT errors from readFileSync during construction', () => {
            const err = new Error('EACCES') as NodeJS.ErrnoException;
            err.code = 'EACCES';
            mockFs.nextReadFileSyncError = err;
            // Pass an explicit version to skip _nextBlock's version-file read
            // (which silently swallows all errors). The next read is _readKey(0)
            // — its catch only swallows ENOENT, so EACCES propagates.
            expect(() => jostore<any>(uniqueDir(), 1)).toThrow(/EACCES/);
        });
    });

    describe('defensive read paths', () => {
        it('returns undefined when asked for a version older than every stored entry', () => {
            // Block 0's version list always contains entries from construction,
            // each ≥ 1. Reading at version 0 falls off the end of the loop.
            const root = jostore<any>(uniqueDir());
            const store = getStore(root);
            expect(store?.read(0, 0)).toBeUndefined();
        });

        it('returns undefined when a version pointer leads to a missing block', () => {
            const dir = uniqueDir();
            const root = jostore<any>(dir);
            const store = getStore(root);
            // Overwrite block 0's version list to point at a block that
            // was never written (forces _readKey to return undefined inside
            // read() after correctVersion is set).
            mockFs.files.set(`${dir}/0000`, Buffer.from('[999]'));
            expect(store?.read(0, 9999)).toBeUndefined();
        });

        it('returns undefined from the get trap when a property points at a missing block', () => {
            const dir = uniqueDir();
            // Hand-craft a store on disk where root's `foo` points at a key
            // that doesn't exist. Opening with version=1 skips _nextBlock so
            // the version counter stays at 1 and the rootData read picks up
            // our crafted snapshot.
            mockFs.files.set(`${dir}/version`, Buffer.from('1'));
            mockFs.files.set(`${dir}/0000`, Buffer.from('[1]'));
            mockFs.files.set(`${dir}/0001`, Buffer.from(JSON.stringify({
                type: 'object',
                properties: { root: 0, foo: 999 },
            })));
            const root = jostore<any>(dir, 1);
            expect(root.foo).toBeUndefined();
        });

        it('opens a store whose root snapshot is an array (covers the array branch in the constructor)', () => {
            const dir = uniqueDir();
            mockFs.files.set(`${dir}/version`, Buffer.from('1'));
            mockFs.files.set(`${dir}/0000`, Buffer.from('[1]'));
            mockFs.files.set(`${dir}/0001`, Buffer.from(JSON.stringify({
                type: 'array',
                properties: [],
            })));
            expect(() => jostore<any>(dir, 1)).not.toThrow();
        });
    });
});
