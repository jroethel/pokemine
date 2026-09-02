// Global live-event broadcast (issue #19): a process-wide log of generation events,
// decoupled from any single request. Anyone can subscribe (the browser's toggleable
// console panel, a terminal tailer) and gets recent history replayed on connect.
const { EventEmitter } = require('events');

const HISTORY_MAX = 50;
const bus = new EventEmitter();
bus.setMaxListeners(50);
const buffer = [];

function emit(kind, text) {
  const entry = { kind, text, ts: Date.now() };
  buffer.push(entry);
  if (buffer.length > HISTORY_MAX) buffer.shift();
  bus.emit('log', entry);
}

function subscribe(fn) {
  bus.on('log', fn);
  return () => bus.off('log', fn);
}

module.exports = { emit, subscribe, history: () => buffer.slice() };
