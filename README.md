# ABOUT

JavaScript Object Store ("**jostore**") was **written for educational purposes**. This project both is under continuous development and completely abandoned at the same time. Heisenberg would be proud.

It is an attempt at creating a [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) class that makes live transparent database operations as JavaScript Objects are updated by the client. It should support multiple clients and &mdash; with some very small changes &mdash; it could theoretically even support multiple **jostore** servers accessing the same data file simultaneously.

    root.project = {
        name: 'jostore',
        author: {
            name: 'Florin Ardelian',
            email: 'f.ardelian@gmail.com'
        },
        year: 2016, // no Date() support :(
        externalDependencies: [ 'mkdirp' ]
    }

**Warning:** I'm not sure `null` values are properly supported. They were in some previous version, but that code has been "refactored" and "improved" and "fixed" and "fixed again" and "dammit I hope it's fixed now" so many times that the `null` suppor was probably lost along the way.

# DEVELOPMENT

If you're curious enough to dig into the code, you should expect to find some "shortcuts" taken to speed up development while maintaining a canonical interface. Some may not even be immediately apparent, but will effect after a while, so you should be aware of them.

The `jostore` module exports a function that receives exactly one parameter. In normal circumstances, that paraneter should be a file system directory that may or may not exist. You should choose an empty or a new directory, because `jostore` will create two files in it: `/data` and `/version`. The `/data` file is split in blocks of `DATA_BLOCK_SIZE_BYTES` (defaults to 1,000 bytes) and each block contains information about a store object (versions, immediate values, pointers to other objects). The `/version` file contains an integer that is incremented every time a write operation is performed on the store. The value of the version also happens to represent the number of blocks in `/data`. Block `0` (the first block) contains version information about the `root` object.

When a store is initialized, the `root` version information is read from the first block in the data file, the location of the `root` object is identified (based on its last version) and the `root` object is read from its corresponding data block. A version block is simply an array that points to other blocks. For example, version data `[ 15, 20 ]` means that the object has two versions (15 and 20) and that each of those versions is stored in the corresponding data block (15 and 20). Because the store's `version` is global, there is no need to worry about conflicts (with one minor exception which can be easily fixed, as explained below).

An object's data block is a JSON with a `type` field and, depending on its type, other fields that describe the object's immediate value or properties.

For example:

    {
        type: 'object',
        properties: { prop1: 20, prop2: 25, prop3: 100 }
    }

The `type` field can be `"object"`, `"array"`, `"number"`, `"boolean"`, `"string"`, `"undefined"`

The `type` field can be:

- `"object"` - The data block contains a simple user object. Besides the `type` field, it will also contain a `properties` field that will be an object with the keys representing the keys of the user object and the values pointing to the data blocks containing the versions of those fields (see the above example).
- `"array"` - The data block contains an array. Besides the `type` field, it will also contain a `properties` field that will be an array with the values pointing to the version blocks of the array items (like the `object` type, but `properties` is an array).
- `"number"` - The data block contains a `Number` immediate value. Besides the `type` field, it will also contain a `value` field that has the value set to the actual number.
- `"boolean"` - See above, but Boolean.
- `"string"` - See above, but String.
- `"undefined"` - I don't know. I don't think it works yet (never tested), but I do think `undefined` should NOT be supported, so this type will probably be removed.

Just for fun, the `root` object (returned by `jostore()`) has a `root` property that points to its self (the `root` object). The main point of the exercise was to show that recursive objects can be serialized. I mean, if they can be stored in memory, what made you think they could not be serialized and on disk?

If you make any changes, you will probably have to delete any existing store directories because the algorithms are quite unforgiving.

# HOW TO

To retrieve a store's `root` property, call the `jostore` function and give it the relative or absolute path to where the store's objects will be saved on disk. Example: `jostore('/mount/infinite-storage/my-jostore')`.

To retrieve an object's store, call `jostore` giving it the object as argument. This will return the Proxy's corresponding `Store`. I could have tested this [feature](https://en.wikipedia.org/wiki/Scope_creep) in the time I took to write this sentence, but I have never tested it because I don't see why anyone would ever need to use it.

# TRICKS AND PITFALLS

- Only Object, Array, Number, Boolean and String are "officially" supported. Null might work. Undefined should probably never work. Adding support for other serializable objects (eg, Date) should be straightforward even for a novice developer.

- If an object's properties are updated too many times, thing will break. The versions are stored in a JSON array in a single data block, so if that array's JSON string is greater than `DATA_BLOCK_SIZE_BYTES` data will be lost. This should be asy to fix (allocate as many blocks as needed) but does not fall within the scope of this exercise, so good luck fixing it.

- Each property change generates a **new** version but the database will still contain the entire history, so the version is simply added to the list of existing versions for that object.

- Remember that each change adds another `DATA_BLOCK_SIZE_BYTES` to the data file. This means that 1,000,000 changes will cause at least 1 GB of data to be written to disk.

- If things break, delete your data directory and try again.

- Concurrent servers are not supported because of the way access to the `/version` file is handled (ie, not). Theoretically, adding support for concurrent servers could be done by adding a locking mechanism for `/version` (for both writing and reading).

- Object versioning is messed up. I don't mean to say it's broken, I mean to say it can have weird side effects. Explaining the negative implications of the current versioning system would take more than a couple of paragraphs, so I won't explain them here (too simple to explain, too much to write).

- Assigning JavaScript objects to store object fields will result in assigning a `Proxy` that wraps the original objects!! This means that the following code will not work as expected:


    const foo = {
        bar: 123
    }
    root.prop = {
        foo: foo
    }
    foo.bar = 234
    
    console.log(foo.bar) // Output: 234
    console.log(root.prop.foo.bar) // Expected output: 234, Actual output: 123
    console.log(root.prop.foo === foo) // Output: false

# EXAMPLES

## Basic example

The following example should work out of the box:

    'use strict'

    const storeDirectory = require('path').resolve(__dirname, 'example-data-dir')
    const jostore = require('../../jostore')
    const data = jostore(storeDirectory)

    data.counter = (data.counter | 0) + 1
    console.log(`Counter: ${data.counter}`)

    process.exit()

If you don't understand what it does, run it a couple of times.

## More complex operations

Arrays are fully supported as are circular object references. This will work:

    const data = jostore(storeDirectory)

    data.list = [ 10 ]
    data.sameList = data.list
    data.sameList.push(20)

    console.log(data.list.length) // Output: 2

    for (const k in data.list) {
        console.log(`{$k} => ${data.list[k]}`)
    }

    process.exit()

If you want to retrieve the store of a Proxy object, give it as argument to the `store` module export. Normally, you shouldn't need to do anything like this, but just in case you want to do it here's an example:

    const data = jostore(storeDirectory)
    data.some = { deep: { object: {} } }

    const actualStore = jostore(data)
    const sameActualStore = jostore(data.some.deep.object)

    console.log(actualStore === sameActualStore) // Output: true
    console.log(actualStore.storeDirectory === path.resolve(storeDirectory)) // Output: true

Stores in the same directory are identical:

    const data1 = jostore(storeDirectory)
    const data2 = jostore(storeDirectory)

    console.log(data1 === data2) // Output: true
    console.log(jostore(data1) === jostore(data2)) // Output: true

# TESTS

LOL

# COPYRIGHT

Florin Ardelian <f.ardelian@gmail.com>

Unlicensed ("proprietary").
