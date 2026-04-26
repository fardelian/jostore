# ABOUT

JavaScript Object Store ("**jostore**") was **written for educational purposes**. This project both is under continuous development and completely abandoned at the same time. Heisenberg would be proud.

It is an attempt at creating a [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) class that makes live transparent database operations as JavaScript Objects are updated by the client. It should support multiple clients and &mdash; with some very small changes &mdash; it could theoretically even support multiple **jostore** servers accessing the same data file simultaneously.

```ts
root.project = {
    name: 'jostore',
    author: {
        name: 'Florin Ardelian',
        email: 'f.ardelian@gmail.com',
    },
    year: 2016,                      // no Date() support :(
    convertedToTypescriptIn: 2026,
    externalDependencies: [],        // mkdirp dropped — uses native fs.mkdirSync({ recursive: true })
}
```

# LAYOUT

```
src/
├── lib/
│   └── jostore.ts          # the library (was the old root index.js)
├── examples/
│   ├── simple.ts           # `npm run start-simple`
│   └── complex.ts          # `npm run start-complex`
├── mocks/
│   └── fs.mock.ts          # in-memory `fs` for tests
└── acceptance/
    └── jostore.acceptance.test.ts
```

# DEVELOPMENT

If you're curious enough to dig into the code, you should expect to find some "shortcuts" taken to speed up development while maintaining a canonical interface. Some may not even be immediately apparent, but will effect after a while, so you should be aware of them.

The `jostore` module exports a function that receives a file system directory path. The directory may or may not exist. You should choose an empty or a new directory, because `jostore` will create two files in it: `data` and `version`. The `data` file is split in blocks of `DATA_BLOCK_SIZE_BYTES` (defaults to 1,000 bytes) and each block contains information about a store object (versions, immediate values, pointers to other objects). The `version` file contains an integer that is incremented every time a write operation is performed on the store. The value of the version also happens to represent the number of blocks in `data`. Block `0` (the first block) contains version information about the `root` object.

When a store is initialized, the `root` version information is read from the first block in the data file, the location of the `root` object is identified (based on its last version) and the `root` object is read from its corresponding data block. A version block is simply an array that points to other blocks. For example, version data `[ 15, 20 ]` means that the object has two versions (15 and 20) and that each of those versions is stored in the corresponding data block (15 and 20). Because the store's `version` is global, there is no need to worry about conflicts (with one minor exception which can be easily fixed, as explained below).

An object's data block is a JSON with a `type` field and, depending on its type, other fields that describe the object's immediate value or properties.

For example:

```json
{
    "type": "object",
    "properties": { "prop1": 20, "prop2": 25, "prop3": 100 }
}
```

The `type` field can be:

- `"object"` - The data block contains a simple user object. Besides the `type` field, it will also contain a `properties` field that will be an object with the keys representing the keys of the user object and the values pointing to the data blocks containing the versions of those fields (see the above example).
- `"array"` - The data block contains an array. Besides the `type` field, it will also contain a `properties` field that will be an array with the values pointing to the version blocks of the array items (like the `object` type, but `properties` is an array).
- `"number"` - The data block contains a `Number` immediate value. Besides the `type` field, it will also contain a `value` field that has the value set to the actual number.
- `"boolean"` - See above, but Boolean.
- `"string"` - See above, but String.
- `"undefined"` - I don't know. I don't think it works yet (never tested), but I do think `undefined` should NOT be supported, so this type will probably be removed.

Just for fun, the `root` object (returned by `jostore()`) has a `root` property that points to itself. The main point of the exercise was to show that recursive objects can be serialized. I mean, if they can be stored in memory, what made you think they could not be serialized on disk?

If you make any changes, you will probably have to delete any existing store directories because the algorithms are quite unforgiving.

# HOW TO

Call the `jostore` function with the relative or absolute path to where the store's objects will be saved on disk:

```ts
import jostore from 'jostore'; // or '../lib/jostore' from inside this repo

const root = jostore('/mount/infinite-storage/my-jostore');
root.counter = (root.counter ?? 0) + 1;
```

You can pin the proxy to your own schema with the generic parameter:

```ts
import jostore, { JostoreRoot } from '../lib/jostore';

interface MySchema extends JostoreRoot {
    counter?: number;
    list?: number[];
}

const root = jostore<MySchema>('/path/to/store');
```

If you'd rather skip the schema and have everything be `any` (closer to the dynamic-JS feel of the original), do this — and add the eslint opt-out comment because `no-explicit-any` is the gatekeeper here:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const root = jostore<any>('/path/to/store');
```

To retrieve the underlying `Store` for a proxy, use the `getStore` named export:

```ts
import jostore, { getStore } from '../lib/jostore';

const root = jostore('/path/to/store');
const store = getStore(root); // → the Store instance, or undefined if you pass a non-proxy
```

# TRICKS AND PITFALLS

- Only `Object`, `Array`, `Number`, `Boolean`, `String`, and `null` are supported. `undefined` should probably never work. Adding support for other serializable objects (e.g. `Date`) should be straightforward even for a novice developer. Functions and BigInts throw on assignment.

- If an object's properties are updated too many times, things will break. The versions are stored in a JSON array in a single data block, so if that array's JSON string is greater than `DATA_BLOCK_SIZE_BYTES` data will be lost. This should be easy to fix (allocate as many blocks as needed) but does not fall within the scope of this exercise, so good luck fixing it.

- Each property change generates a **new** version but the database will still contain the entire history, so the version is simply added to the list of existing versions for that object.

- Remember that each change adds another `DATA_BLOCK_SIZE_BYTES` to the data file. This means that 1,000,000 changes will cause at least 1 GB of data to be written to disk.

- If things break, delete your data directory and try again.

- Concurrent servers are not supported because of the way access to the `version` file is handled (ie, not). Theoretically, adding support for concurrent servers could be done by adding a locking mechanism for `version` (for both writing and reading).

- Object versioning is messed up. I don't mean to say it's broken, I mean to say it can have weird side effects. Explaining the negative implications of the current versioning system would take more than a couple of paragraphs, so I won't explain them here (too simple to explain, too much to write).

- Assigning JavaScript objects to store object fields will result in assigning a `Proxy` that wraps the original objects!! This means that the following code will not work as expected:

```ts
const foo = { bar: 123 };
root.prop = { foo: foo };
foo.bar = 234;

console.log(foo.bar);                  // → 234
console.log(root.prop.foo.bar);        // expected: 234. actual: 123
console.log(root.prop.foo === foo);    // → false
```

# EXAMPLES

## Basic example

```ts
import * as path from 'path';
import jostore from '../lib/jostore';

const storeDirectory = path.resolve(__dirname, 'example-data-dir');
const root = jostore(storeDirectory);

root.counter = (root.counter ?? 0) + 1;
console.log(`Counter: ${root.counter}`);

process.exit();
```

Run with:

```sh
npm run start-simple
```

If you don't understand what it does, run it a couple of times — the counter persists across invocations.

## More complex operations

Arrays are fully supported, as are circular object references:

```ts
const root = jostore(storeDirectory);

root.list = [10];
root.sameList = root.list;        // same Proxy reference
root.sameList.push(20);

console.log(root.list.length);    // → 2

for (const k of Object.keys(root.list)) {
    console.log(`${k} => ${root.list[Number(k)]}`);
}
```

Recursive references work too:

```ts
root.subObject = { counter: 7 };
root.subObject.recursive = root.subObject;
console.log(root.subObject.recursive.counter); // → 7
```

If you want to retrieve the `Store` of a proxy object, use the `getStore` named export:

```ts
import jostore, { getStore } from '../lib/jostore';

const root = jostore(storeDirectory);
root.some = { deep: { object: {} } };

const actualStore = getStore(root);
const sameActualStore = getStore(root.some.deep.object);

console.log(actualStore === sameActualStore); // → true
console.log(actualStore?.storeDirectory === path.resolve(storeDirectory)); // → true
```

Stores in the same directory are identical within a process:

```ts
const r1 = jostore(storeDirectory);
const r2 = jostore(storeDirectory);

console.log(r1 === r2); // → true
```

A second `npm run start-complex` reads back everything from the previous run.

# TESTS

Acceptance tests live under [`src/acceptance/`](src/acceptance/) and use a custom in-memory `fs` mock ([`src/mocks/fs.mock.ts`](src/mocks/fs.mock.ts)) so they never touch the real filesystem. They cover the behaviours demonstrated by `simple.ts` and `complex.ts`: scalar persistence, null + delete, arrays (including the `Object.keys(arrayProxy)` regression that used to crash on the `length` descriptor), nested objects, recursive references, store identity, symbol-keyed access, rejected value types, and exit cleanup.

```sh
npm run test               # full test suite
npm run test:acceptance    # acceptance tests only
npm run test:coverage      # with coverage report under .coverage/
npm run typecheck          # tsc --noEmit
npm run lint               # eslint .
```

# COPYRIGHT

Florin Ardelian <f.ardelian@gmail.com>

Unlicensed ("proprietary").
