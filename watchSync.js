import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { buildWatchContext } from './watchPayload';

/** Enabled for iOS builds that include the WatchKit companion target. */
const WATCH_ENABLED = true;

const SYNC_MS = 1500;
const PUSH_MIN_INTERVAL_MS = 350;
const ACTIVATION_POLL_MS = 250;
const ACTIVATION_MAX_WAIT_MS = 15000;

let imperativePush = null;

/** Call from BLE/WiFi handlers so the watch updates even when JS timers are throttled. */
export function pushWatchContextNow() {
  imperativePush?.();
}

/** WCSession requires JSON-serializable plist types; drop NaN/undefined. */
function sanitizeWatchPlist(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === 'number') {
      out[k] = Number.isFinite(v) ? v : 0;
    } else if (typeof v === 'boolean') {
      out[k] = v ? 1 : 0;
    } else if (typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

async function waitForWatchSessionActivated(WatchConnectivity, cancelledRef) {
  const deadline = Date.now() + ACTIVATION_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (cancelledRef.current) return false;
    try {
      const st = WatchConnectivity.sessionState;
      if (st?.activationState === 'activated') return true;
    } catch (_) {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, ACTIVATION_POLL_MS));
  }
  return false;
}

async function deliverWatchContext(WatchConnectivity, ctx) {
  await WatchConnectivity.updateApplicationContext(ctx);
  try {
    WatchConnectivity.transferUserInfo(ctx);
  } catch (_) {
    /* queued transfer unavailable */
  }
  try {
    const st = WatchConnectivity.sessionState;
    if (st.isReachable) {
      WatchConnectivity.sendMessage(ctx).catch(() => {});
    }
  } catch (_) {
    /* not reachable — application context / userInfo still apply */
  }
}

/**
 * Pushes ballast state to Apple Watch via application context and handles quick commands.
 * Watch app must be added in Xcode (see WATCH_XCODE_SETUP.md).
 *
 * Important: do not static-import @plevo/expo-watch-connectivity — load it only after mount.
 */
export function useWatchSync(deps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const watchRef = useRef({ push: null, WatchConnectivity: null });
  const cancelledRef = useRef(false);
  const lastPushAtRef = useRef(0);
  const warnedNotInstalledRef = useRef(false);

  useEffect(() => {
    if (!WATCH_ENABLED || Platform.OS !== 'ios') return undefined;

    cancelledRef.current = false;
    let intervalId = null;
    let messageSub = null;
    let activationSub = null;
    let sessionSub = null;
    let appStateSub = null;

    (async () => {
      let WatchConnectivity;
      try {
        ({ WatchConnectivity } = await import('@plevo/expo-watch-connectivity'));
      } catch (e) {
        console.warn('[Watch] module load failed — is ExpoWatchConnectivity in the iOS build?', e);
        return;
      }
      if (cancelledRef.current) return;

      try {
        if (!WatchConnectivity.isSupported) {
          console.warn('[Watch] not supported on this device');
          return;
        }
        await WatchConnectivity.activate();
      } catch (e) {
        console.warn('[Watch] activate failed', e);
        return;
      }
      if (cancelledRef.current) return;

      watchRef.current.WatchConnectivity = WatchConnectivity;

      const push = async (force = false) => {
        if (cancelledRef.current) return;
        const now = Date.now();
        if (!force && now - lastPushAtRef.current < PUSH_MIN_INTERVAL_MS) return;
        lastPushAtRef.current = now;

        try {
          const st = WatchConnectivity.sessionState;
          if (!st.isWatchAppInstalled) {
            if (!warnedNotInstalledRef.current) {
              warnedNotInstalledRef.current = true;
              console.warn(
                '[Watch] isWatchAppInstalled=false — still pushing context (iOS can report false briefly).',
              );
            }
          }
          if (st.activationState !== 'activated') {
            const ok = await waitForWatchSessionActivated(WatchConnectivity, cancelledRef);
            if (!ok) {
              console.warn('[Watch] WCSession not activated yet — skip push');
              return;
            }
          }
          const ctx = sanitizeWatchPlist(buildWatchContext(depsRef.current));
          await deliverWatchContext(WatchConnectivity, ctx);
        } catch (e) {
          console.warn('[Watch] push failed', e);
        }
      };

      watchRef.current.push = () => {
        push(true);
      };
      imperativePush = () => {
        push(true);
      };

      messageSub = WatchConnectivity.addMessageListener((event) => {
        const { message, replyId } = event;
        const action = message && message.action;
        const tank = message && message.tank;
        const unit = message && message.unit;
        const cur = depsRef.current;
        try {
          if (action === 'resetAll') cur.onResetAll?.();
          else if (action === 'toggleFillDrain') cur.onToggleFillDrain?.();
          else if (action === 'disconnect') cur.onDisconnect?.();
          else if (action === 'setUnit' && unit) cur.onSetUnit?.(unit);
          else if (action === 'resetTank' && tank) cur.onResetTank?.(tank);
          else if (action === 'toggleTankFillDrain' && tank) cur.onToggleTankFillDrain?.(tank);
        } catch (err) {
          console.warn('[Watch] command', err);
        }
        if (replyId) {
          try {
            WatchConnectivity.replyToMessage(replyId, { ok: true });
          } catch (_) {
            /* ignore */
          }
        }
      });

      activationSub = WatchConnectivity.addActivationListener(({ activationState }) => {
        if (activationState === 'activated') push(true);
      });

      sessionSub = WatchConnectivity.addSessionStateListener(() => {
        push(true);
      });

      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active' || state === 'background') push(true);
      });

      const ready = await waitForWatchSessionActivated(WatchConnectivity, cancelledRef);
      if (cancelledRef.current) return;
      if (ready) await push(true);
      intervalId = setInterval(() => {
        push(false);
      }, SYNC_MS);
    })();

    return () => {
      cancelledRef.current = true;
      if (imperativePush) imperativePush = null;
      watchRef.current.push = null;
      watchRef.current.WatchConnectivity = null;
      if (intervalId) clearInterval(intervalId);
      if (messageSub) messageSub.remove();
      if (activationSub) activationSub.remove();
      if (sessionSub) sessionSub.remove();
      if (appStateSub) appStateSub.remove();
    };
  }, []);

  const { isConnected, connectionMode, unitMode, isFillMode, flowValues, tankFillModes, signalStrength } =
    deps;
  const flowSig = Array.isArray(flowValues) ? flowValues.join(',') : '';
  const tankSig = tankFillModes
    ? `${tankFillModes.Port}|${tankFillModes.Starboard}|${tankFillModes.Mid}|${tankFillModes.Forward}`
    : '';

  useEffect(() => {
    if (!WATCH_ENABLED || Platform.OS !== 'ios') return;
    watchRef.current.push?.();
  }, [isConnected, connectionMode, unitMode, isFillMode, flowSig, tankSig, signalStrength]);
}
