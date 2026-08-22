'use strict';

const { EventEmitter } = require('node:events');

/**
 * Tiny in-process pub/sub used to push live updates to SSE clients.
 * Single-process by design; if this ever needs to scale horizontally,
 * swap this module for Redis pub/sub and nothing else has to change.
 */
class Bus extends EventEmitter {}

const bus = new Bus();
// Admin dashboards + every open voting page can subscribe at once.
bus.setMaxListeners(0);

const channel = (dilemmaId) => `dilemma:${dilemmaId}`;

function publish(dilemmaId, payload) {
  bus.emit(channel(dilemmaId), payload);
  bus.emit('dilemma:*', { dilemmaId, ...payload });
}

function subscribe(dilemmaId, listener) {
  const name = channel(dilemmaId);
  bus.on(name, listener);
  return () => bus.off(name, listener);
}

function subscribeAll(listener) {
  bus.on('dilemma:*', listener);
  return () => bus.off('dilemma:*', listener);
}

module.exports = { publish, subscribe, subscribeAll };
