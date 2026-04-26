import * as path from 'path';
import jostore, { JostoreRoot } from '../lib/jostore';

interface SimpleSchema extends JostoreRoot {
    counter?: number;
    list?: number[];
    listRef2?: number[];
}

const storeDirectory = path.resolve(__dirname, 'example-data-dir');
const root = jostore<SimpleSchema>(storeDirectory);

console.log(`Old counter: ${root.counter ?? 0}`);
root.counter = (root.counter ?? 0) + 1;
console.log(`New counter: ${root.counter}`);

if (!root.list) {
    console.log('Creating list');
    root.list = [Math.random()];
}

root.listRef2 = root.list; // same JS reference
console.log(`Length of listRef2 before: ${root.list.length}`);

root.list.push(Math.random());
console.log(`Length of listRef2 after: ${root.list.length}`);

const sum = root.listRef2.reduce((acc, item) => acc + item, 0);
console.log(`Average from listRef2: ${sum} / ${root.listRef2.length} = ${sum / root.list.length}`);

process.exit();
