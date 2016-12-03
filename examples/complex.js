'use strict'

const storePath = require('path').resolve(__dirname, 'example-data-dir')
const root = require('../../jostore')(storePath)

function log(text, data) {
  // console.log(text, data)
}

const COUNT = 10
for (let i = 0; i < COUNT; i++) {
  // console._log(`>${COUNT - i}`)

  log('root.deep', JSON.stringify(root.deep))
  root.deep = {
    nested: {
      structure: 999999
    }
  }
  log('root.deep', JSON.stringify(root.deep))

  log('root.counter', root.counter)
  root.counter = (root.counter | 0) + 1
  log('root.counter', root.counter)

  if (!root.subObject) {
    root.subObject = {}
  }
  root.subObject.counter2 = (root.subObject.counter2 | 0) + 2
  if (root.subObject.recursive) {
    delete root.subObject.recursive
  }
  log('JSON.stringify(root.subObject)', JSON.stringify(root.subObject))
  root.subObject.recursive = root.subObject
  log('root.subObject.recursive.counter2', root.subObject.recursive.counter2)

  if (!root.list) {
    root.list = []
    root.list[2] = 15
  }
  root.list[2]++

  log('root.list.length', root.list.length)
  root.list.length = 4
  log('root.list.length', root.list.length)

  log('JSON.stringify(root.list)', JSON.stringify(root.list))

  log('ownPropertyNames => ', Object.getOwnPropertyNames(root.list))
  log('keys => ', Object.keys(root.list))

  for (const k in Object.keys(root.list)) {
    log(`${k} => ${root.list[k]}`)
  }

  root.boolean = !root.boolean
  log('root.boolean', root.boolean)

  root['null'] = null
  log("root['null']", root['null'])
  log("typeof root['null']", typeof root['null'])
  delete root['null']
  log("root['null']", root['null'])

  root.someObjectToDelete = {someKey: true}
  log('root.someObjectToDelete', JSON.stringify(root.someObjectToDelete))
  delete root.someObjectToDelete

  log("root.hasOwnProperty('list')", root.hasOwnProperty('list'))
}

process.exit(0)
