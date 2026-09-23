const { AsyncLocalStorage } = require('node:async_hooks');
const mongoose = require('mongoose');
const storage = new AsyncLocalStorage();
const schemas = new Map();

function register(connection) {
  for (const [name, schema] of schemas) {
    if (!connection.models[name]) connection.model(name, schema);
  }
}

function tenantModel(name, schema) {
  schemas.set(name, schema);
  const base = mongoose.models[name] || mongoose.model(name, schema);
  const resolve = () => {
    const connection = storage.getStore()?.connection;
    if (!connection) return base;
    register(connection);
    return connection.models[name];
  };
  // Resolve at invocation time, never when a controller module is loaded.
  return new Proxy(function () {}, {
    get(_target, key) {
      const model = resolve();
      const value = Reflect.get(model, key, model);
      return typeof value === 'function' && key !== 'prototype' ? value.bind(model) : value;
    },
    construct(_target, args) { return Reflect.construct(resolve(), args); },
    apply(_target, _this, args) { return Reflect.construct(resolve(), args); },
  });
}

module.exports = { storage, register, tenantModel,
  connection: () => storage.getStore()?.connection || mongoose.connection };
