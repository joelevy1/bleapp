/**
 * Pure helpers for WatchConnectivity application context (iPhone → Watch).
 * Mirrors tank math from App.js for display % and gallons.
 */

const TANK_KEYS = ['Port', 'Starboard', 'Mid', 'Forward'];

function getTankTotalPulses(tankName, flowValues, tankConfig) {
  const tank = tankConfig.find((t) => t.name === tankName);
  if (!tank) return 0;
  return tank.pumps.reduce((sum, idx) => sum + (flowValues[idx] || 0), 0);
}

/** Physical fill 0–100 for color bands (green/yellow/red). */
function fillPercentForColor(tankName, flowValues, tankMaxValues, tankConfig) {
  const maxP = tankMaxValues[tankName.toLowerCase()];
  if (!maxP) return 0;
  const total = getTankTotalPulses(tankName, flowValues, tankConfig);
  return Math.min(100, Math.max(0, Math.round((total / maxP) * 100)));
}

/** Same semantics as App getTankPercentDisplay (fill vs drain UI). */
function getTankPercentDisplay(tankName, flowValues, tankMaxValues, tankFillModes, tankConfig) {
  const maxP = tankMaxValues[tankName.toLowerCase()];
  if (!maxP) return 0;
  const total = getTankTotalPulses(tankName, flowValues, tankConfig);
  const fill = Math.min(1, total / maxP);
  const drain = !tankFillModes[tankName];
  const pct = drain ? Math.round((1 - fill) * 100) : Math.round(fill * 100);
  return Math.min(100, Math.max(0, pct));
}

function convertValue(pulses, unitMode, pulsesPerGallon, poundsPerGallon) {
  if (unitMode === 'counter') return String(Math.round(pulses));
  const gallons = pulses / pulsesPerGallon;
  if (unitMode === 'gallons') return gallons.toFixed(1);
  return (gallons * poundsPerGallon).toFixed(1);
}

function formatPumpDisplay(
  pumpIdx,
  tankName,
  flowValues,
  tankMaxValues,
  tankFillModes,
  unitMode,
  pulsesPerGallon,
  poundsPerGallon,
  tankConfig,
) {
  const pulses = flowValues[pumpIdx] || 0;
  const maxP = tankMaxValues[tankName.toLowerCase()];
  const totalTank = getTankTotalPulses(tankName, flowValues, tankConfig);
  const drain = !tankFillModes[tankName];
  let displayPulses = pulses;
  if (drain && maxP) {
    const remaining = Math.max(0, maxP - totalTank);
    if (totalTank <= 0) {
      displayPulses = remaining / 2;
    } else {
      displayPulses = (remaining * pulses) / totalTank;
    }
  }
  return convertValue(displayPulses, unitMode, pulsesPerGallon, poundsPerGallon);
}

/** Total tank “display” gallons (sum of pump pulses → one number). */
function tankGallonsRaw(tankName, flowValues, tankConfig, pulsesPerGallon) {
  const pulses = getTankTotalPulses(tankName, flowValues, tankConfig);
  return pulses / pulsesPerGallon;
}

/**
 * @param {object} d - state snapshot from App
 * @returns {Record<string, string | number | boolean>}
 */
export function buildWatchContext(d) {
  const {
    isConnected,
    connectionMode,
    signalStrength,
    flowValues,
    tankMaxValues,
    tankFillModes,
    isFillMode,
    unitMode,
    pulsesPerGallon,
    poundsPerGallon,
    TANK_CONFIG,
  } = d;

  const flow = flowValues || new Array(8).fill(0);
  const tankNames = TANK_KEYS;

  const portPct = getTankPercentDisplay('Port', flow, tankMaxValues, tankFillModes, TANK_CONFIG);
  const stbdPct = getTankPercentDisplay('Starboard', flow, tankMaxValues, tankFillModes, TANK_CONFIG);
  const midPct = getTankPercentDisplay('Mid', flow, tankMaxValues, tankFillModes, TANK_CONFIG);
  const fwdPct = getTankPercentDisplay('Forward', flow, tankMaxValues, tankFillModes, TANK_CONFIG);

  const portFill = fillPercentForColor('Port', flow, tankMaxValues, TANK_CONFIG);
  const stbdFill = fillPercentForColor('Starboard', flow, tankMaxValues, TANK_CONFIG);
  const midFill = fillPercentForColor('Mid', flow, tankMaxValues, TANK_CONFIG);
  const fwdFill = fillPercentForColor('Forward', flow, tankMaxValues, TANK_CONFIG);

  const totalPulses = flow.reduce((a, b) => a + b, 0);
  const totalMax = tankNames.reduce((s, n) => s + (tankMaxValues[n.toLowerCase()] || 0), 0);
  const totalGalRaw =
    isFillMode ? totalPulses / pulsesPerGallon : Math.max(0, totalMax - totalPulses) / pulsesPerGallon;

  const unitLabel = unitMode === 'counter' ? 'cnt' : unitMode === 'gallons' ? 'gal' : 'lbs';

  return {
    v: 1,
    t: Date.now(),
    connected: !!isConnected,
    conn: connectionMode || '',
    signal: typeof signalStrength === 'number' ? signalStrength : 0,
    unit: unitMode || 'gallons',
    unitLabel,
    globalFill: !!isFillMode,
    portPct,
    stbdPct,
    midPct,
    fwdPct,
    portFill,
    stbdFill,
    midFill,
    fwdFill,
    portG: tankGallonsRaw('Port', flow, TANK_CONFIG, pulsesPerGallon),
    stbdG: tankGallonsRaw('Starboard', flow, TANK_CONFIG, pulsesPerGallon),
    midG: tankGallonsRaw('Mid', flow, TANK_CONFIG, pulsesPerGallon),
    fwdG: tankGallonsRaw('Forward', flow, TANK_CONFIG, pulsesPerGallon),
    totalG: totalGalRaw,
    portDisp: convertValue(getTankTotalPulses('Port', flow, TANK_CONFIG), unitMode, pulsesPerGallon, poundsPerGallon),
    stbdDisp: convertValue(
      getTankTotalPulses('Starboard', flow, TANK_CONFIG),
      unitMode,
      pulsesPerGallon,
      poundsPerGallon,
    ),
    midDisp: convertValue(getTankTotalPulses('Mid', flow, TANK_CONFIG), unitMode, pulsesPerGallon, poundsPerGallon),
    fwdDisp: convertValue(getTankTotalPulses('Forward', flow, TANK_CONFIG), unitMode, pulsesPerGallon, poundsPerGallon),
    totalDisp: convertValue(
      isFillMode ? totalPulses : Math.max(0, totalMax - totalPulses),
      unitMode,
      pulsesPerGallon,
      poundsPerGallon,
    ),
    fillPort: !!tankFillModes.Port,
    fillStbd: !!tankFillModes.Starboard,
    fillMid: !!tankFillModes.Mid,
    fillFwd: !!tankFillModes.Forward,
    portTop: formatPumpDisplay(1, 'Port', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    portBtm: formatPumpDisplay(2, 'Port', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    stbdTop: formatPumpDisplay(0, 'Starboard', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    stbdBtm: formatPumpDisplay(3, 'Starboard', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    midTop: formatPumpDisplay(4, 'Mid', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    midBtm: formatPumpDisplay(5, 'Mid', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    fwdTop: formatPumpDisplay(6, 'Forward', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
    fwdBtm: formatPumpDisplay(7, 'Forward', flow, tankMaxValues, tankFillModes, unitMode, pulsesPerGallon, poundsPerGallon, TANK_CONFIG),
  };
}
