import assert from 'node:assert/strict';
import { buildWatchContext } from '../watchPayload.js';

const TANK_CONFIG = [
  { name: 'Port', pumps: [1, 2], color: 'White/Green' },
  { name: 'Starboard', pumps: [0, 3], color: 'White/Green' },
  { name: 'Mid', pumps: [4, 5], color: 'Blue/Blue' },
  { name: 'Forward', pumps: [6, 7], color: 'Yellow/Yellow' },
];

function baseDeps(overrides = {}) {
  return {
    isConnected: true,
    connectionMode: 'ble',
    signalStrength: -55,
    flowValues: [10, 100, 100, 10, 50, 50, 20, 20],
    tankMaxValues: { port: 200, starboard: 200, mid: 100, forward: 40 },
    tankFillModes: { Port: true, Starboard: true, Mid: true, Forward: true },
    isFillMode: true,
    unitMode: 'gallons',
    pulsesPerGallon: 100,
    poundsPerGallon: 8.34,
    TANK_CONFIG,
    ...overrides,
  };
}

const ctx = buildWatchContext(baseDeps());
assert.equal(ctx.connected, true);
assert.equal(ctx.unit, 'gallons');
assert.equal(ctx.portDisp, '2.0');

const onePump = buildWatchContext(baseDeps({ flowValues: [0, 0, 150, 0, 0, 0, 0, 0] }));
assert.equal(onePump.portDisp, '1.5');

const off = buildWatchContext(baseDeps({ isConnected: false }));
assert.equal(off.connected, false);

console.log('watchPayload tests passed');
