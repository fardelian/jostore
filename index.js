'use strict'

const DATA_BLOCK_SIZE_BYTES = 1000

const path = require('path')
const fs = require('fs')

const mkdirp = require('mkdirp')

const storeDirMap = {}
const objCacheByKey = {}
const proxyObjMap = new WeakMap()

const emptyArr = []
const emptyObj = {}

class Store {
  constructor(storeDirectory, version) {
    this._opsCounter = 0
    this.t0 = Date.now()
    process.on('exit', (code) => {
      try {
        if (this.rawFd) {
          fs.fsyncSync(this.rawFd)
          fs.closeSync(this.rawFd)
        }
        const ms = Date.now() - this.t0
        console.error(`${code} ${code ? 'ERROR' : 'OK'}, after ${this._opsCounter} ops in ${ms} ms (~ ${Math.round(this._opsCounter / ms * 1000 * 1e2) / 1e2} ops/sec, ${Math.round(ms / this._opsCounter * 1e2) / 1e2} ms/op) @ ${this._nextBlock()}`)
      } catch (ex) {
        this._log(ex)
      }
    })

    this.storeDirectory = storeDirectory
    this.versionFilePath = path.resolve(storeDirectory, 'version')
    this._openDataFile()

    this.version = (version | 0) || this._nextBlock()

    let rootData = this.read(0, this.version)
    if (!rootData) {
      rootData = {
        type: 'object',
        properties: {
          root: 0
        }
      }
      this.write(0, rootData)
    }

    this.root = this._rootFromData(rootData)
  }

  read(key, version) {
    let existingVersions = this.readDataBlock(key)
    if (!existingVersions) {
      return
    }

    let correctVersion
    if (version !== null) {
      for (let i = existingVersions.length - 1; i >= 0; i--) {
        if (existingVersions[i] <= version) {
          correctVersion = existingVersions[i]
          break
        }
      }
    } else {
      correctVersion = existingVersions[existingVersions.length - 1]
    }

    if (!correctVersion) {
      return
    }

    return this.readDataBlock(correctVersion)
  }

  write(key, value) {
    const nextVersionIndex = this._nextBlock()

    this.writeDataBlock(nextVersionIndex, value)

    let versions
    try {
      versions = this.readDataBlock(key) || []
    } catch (ex) {
      versions = []
    }
    versions.push(nextVersionIndex)
    this.writeDataBlock(key, versions)
  }

  readDataBlock(blockIndex) {
    const position = blockIndex * DATA_BLOCK_SIZE_BYTES

    const buffer = new Buffer(DATA_BLOCK_SIZE_BYTES)
    const readBytes = fs.readSync(this.rawFd, buffer, 0, DATA_BLOCK_SIZE_BYTES, position)
    this._log(`Read ${position}; ${readBytes} "${buffer}"`)

    if (readBytes !== DATA_BLOCK_SIZE_BYTES) {
      return
    }

    const json = buffer.toString().replace(/\x00+/g, '')
    if (!json) {
      return
    }
    return JSON.parse(json).data
  }

  writeDataBlock(blockIndex, data) {
    let json = JSON.stringify({data: data})
    while (json.length < DATA_BLOCK_SIZE_BYTES) {
      json = `${json} `
    }

    const position = blockIndex * DATA_BLOCK_SIZE_BYTES

    let empty
    while (fs.statSync(path.resolve(`${this.storeDirectory}`, 'data')).size < position) {
      if (!empty) {
        empty = ' '.repeat(DATA_BLOCK_SIZE_BYTES)
      }
      fs.writeSync(this.rawFd, empty, position)
    }

    this._log(`Write ${position}: ${json.length} "${json}"`)
    fs.writeSync(this.rawFd, json, position)
  }

  _openDataFile() {
    mkdirp.sync(this.storeDirectory)

    const rawFilePath = path.resolve(this.storeDirectory, 'data')
    try {
      this.rawFd = fs.openSync(rawFilePath, 'r+')
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex
      }
      this.rawFd = fs.openSync(rawFilePath, 'w+')
    }
  }

  _rootFromData(rootData) {
    const obj = {
      key: 0,
      store: this,
      data: rootData
    }

    const root = new Proxy(obj, ProxyHandler)
    obj.proxy = root

    objCacheByKey[0] = root
    proxyObjMap.set(root, obj)

    root.root = root
    return root.root
  }

  _nextBlock() {
    let lastId
    try {
      lastId = fs.readFileSync(this.versionFilePath) | 0
    } catch (ex) {
      lastId = 0
    }
    fs.writeFileSync(this.versionFilePath, ++lastId)
    return lastId
  }

  _log(...args) {
    // console.error.apply(this, args)
  }
}

class ProxyHandler {
  static get(obj, name) {
    obj.store._opsCounter++

    if (!obj.data.properties.hasOwnProperty(name)) {
      return (obj.data.type === 'array') ? emptyArr[name] : emptyObj[name]
    }

    if (obj.data.type === 'array' && name === 'length') {
      return obj.data.properties.length
    }

    const propKey = obj.data.properties[name]
    if (propKey === null) {
      return null // TODO
    }

    const existingProxy = objCacheByKey[propKey]
    if (existingProxy) {
      return existingProxy
    }

    const data = obj.store.read(propKey, obj.store.version)
    if (!data) {
      return
    }

    let response
    switch (data.type) {
      case 'number':
      case 'boolean':
      case 'string':
      case 'undefined':
        return objCacheByKey[propKey] = data.value

      case 'array':
      case 'object':
        let newObj
        if (data.type === 'array') {
          newObj = []
        } else {
          newObj = {}
        }

        Object.assign(newObj, {
          key: propKey,
          store: obj.store,
          data: data
        })

        const proxy = new Proxy(newObj, ProxyHandler)
        newObj.proxy = proxy

        objCacheByKey[propKey] = proxy
        proxyObjMap.set(proxy, newObj)

        return proxy

      default:
        throw new ReferenceError(`Can't get object type "${data.type}" for key "${propKey}"`)
    }
  }

  static set(obj, name, value) {
    obj.store._opsCounter++

    if (obj.data.type === 'array' && name === 'length') {
      /* Store array length separately because obj.root.properties doesn't always serialize trailing undefined indices */
      obj.data.properties.length = value // obj.data.properties is array
      obj.store.write(obj.key, obj.data)
      return true
    }

    if (value === null) {
      obj.data.properties[name] = null
      obj.store.write(obj.key, obj.data)
      return true
    }

    const existingProxyForValue = typeof value === 'object' && proxyObjMap.get(value)
    if (existingProxyForValue) {
      if (obj.data.properties[name] !== existingProxyForValue.key) {
        obj.data.properties[name] = existingProxyForValue.key
        obj.store.write(obj.key, obj.data)
      }
      return true
    }

    const propKey = obj.store._nextBlock()

    const type = typeof value
    let data = {
      type: type
    }
    switch (type) {
      case 'number':
      case 'boolean':
      case 'string':
      case 'undefined':
        objCacheByKey[propKey] = data.value = value
        break

      case 'object':
        if (Array.isArray(value)) {
          data.type = 'array'
          data.properties = []
        } else {
          data.properties = {}
        }
        break

      default:
        throw new ReferenceError(`Can't set object type "${type}" for value "${JSON.stringify(value)}" in object with key "${obj.key}"`)
    }

    obj.store.write(propKey, data)

    if (type === 'object' || type === 'array') {
      const newObj = {
        key: propKey,
        data: data,
        store: obj.store
      }
      const proxy = new Proxy(newObj, ProxyHandler)
      newObj.proxy = proxy

      objCacheByKey[propKey] = proxy
      proxyObjMap.set(proxy, newObj)

      Object
        .keys(value)
        .forEach((k) => {
          proxy[k] = value[k]
          value[k] = proxy[k]
        })
    }

    obj.data.properties[name] = propKey

    obj.store.write(obj.key, obj.data)

    return true
  }

  static has(obj, name) {
    obj.store._opsCounter++
    return obj.data.properties.hasOwnProperty(name)
  }

  static deleteProperty(obj, name) {
    obj.store._opsCounter++
    delete obj.data.properties[name]
    obj.store.write(obj.key, obj.data)
    return true
  }

  static ownKeys(obj) {
    obj.store._opsCounter++
    return Object.getOwnPropertyNames(obj.data.properties)
  }

  static getOwnPropertyDescriptor(obj, name) {
    obj.store._opsCounter++
    const originalDescriptor = Object.getOwnPropertyDescriptor(obj.data.properties, name)
    return originalDescriptor && Object.assign(
        originalDescriptor,
        {value: ProxyHandler.get(obj, name)}
      )
  }
}

module.exports = function (storeDirectory, version = null) {
  if (!storeDirectory) {
    throw new Error('Invalid store file system path')
  }

  if (typeof storeDirectory === 'object') {
    const proxyObj = proxyObjMap.get(storeDirectory)
    return proxyObj && proxyObj.store
  }

  const safeStoreDirectory = path.resolve(storeDirectory)
  const existingStore = storeDirMap[safeStoreDirectory]
  if (existingStore) {
    return existingStore.root
  } else {
    mkdirp.sync(safeStoreDirectory)

    const newStore = new Store(storeDirectory, version)
    storeDirMap[safeStoreDirectory] = newStore

    return newStore.root
  }
}
