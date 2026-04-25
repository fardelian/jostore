import * as path from 'path';
import jostore, { JostoreRoot } from '../index';

interface SubObject {
    counter2?: number;
    recursive?: SubObject;
}

interface ComplexSchema extends JostoreRoot {
    deep?: { nested: { structure: number } };
    counter?: number;
    subObject?: SubObject;
    list?: number[];
    boolean?: boolean;
    null?: null;
    someObjectToDelete?: { someKey: boolean };
}

const storePath = path.resolve(__dirname, 'example-data-dir');
const root = jostore<ComplexSchema>(storePath);

const COUNT = 10;
for (let i = 0; i < COUNT; i++) {
    root.deep = {
        nested: {
            structure: 999999,
        },
    };

    root.counter = (root.counter ?? 0) + 1;

    root.subObject ??= {};
    root.subObject.counter2 = (root.subObject.counter2 ?? 0) + 2;
    if (root.subObject.recursive) {
        delete root.subObject.recursive;
    }
    root.subObject.recursive = root.subObject;

    if (!root.list) {
        root.list = [];
        root.list[2] = 15;
    }
    root.list[2]++;

    root.list.length = 4;

    Object.getOwnPropertyNames(root.list);
    Object.keys(root.list);

    for (const k of Object.keys(root.list)) {
        void root.list[Number(k)];
    }

    root.boolean = !root.boolean;

    root.null = null;
    delete root.null;

    root.someObjectToDelete = { someKey: true };
    delete root.someObjectToDelete;

    Object.prototype.hasOwnProperty.call(root, 'list');
}

process.exit(0);
