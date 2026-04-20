import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { buildWatchContext } from './watchPayload';

const SYNC_MS = 2500;
const ACTIVATION_SETTLE_MS = 2000;

/** WCSession requires JSON-serializable plist types; drop NaN/undefined. */
function sanitizeWatchPlist(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === 'number') {
      out[k] = Number.isFinite(v) ? v : 0;
    } else if (typeof v === 'boolean' || typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Pushes ballast state to Apple Watch via application context and handles quick commands.
 * Watch app must be added in Xcode (see WATCH_XCODE_SETUP.md).
 *
 * Important: do not static-import @plevo/expo-watch-connectivity — loading that native module
 * at bundle evaluation time can crash the app on launch; load it only after mount.
 */
export function useWatchSync(deps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;

    let cancelled = false;
    let intervalId = null;
    let messageSub = null;
    let settleTimeout = null;

    (async () => {
      let WatchConnectivity;
      try {
        ({ WatchConnectivity } = await import('@plevo/expo-watch-connectivity'));
      } catch (e) {
        console.warn('[Watch] module load failed', e);
        return;
      }
      if (cancelled) return;

      try {
        if (!WatchConnectivity.isSupported) return;
        await WatchConnectivity.activate();
      } catch (e) {
        console.warn('[Watch] activate failed', e);
      }
      if (cancelled) return;

      messageSub = WatchConnectivity.addMessageListener((event) => {
        const { message, replyId } = event;
        const action = message && message.action;
        const cur = depsRef.current;
        try {
          if (action === 'resetAll') cur.onResetAll?.();
          else if (action === 'toggleFillDrain') cur.onToggleFillDrain?.();
          else if (action === 'disconnect') cur.onDisconnect?.();
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

      const push = () => {
        try {
          const ctx = sanitizeWatchPlist(buildWatchContext(depsRef.current));
          WatchConnectivity.updateApplicationContext(ctx).catch(() => {});
        } catch (_) {
          /* ignore */
        }
      };

      // Session activation completes asynchronously; first push after activate() often fails if immediate.
      settleTimeout = setTimeout(() => {
        if (cancelled) return;
        push();
        intervalId = setInterval(push, SYNC_MS);
      }, ACTIVATION_SETTLE_MS);
    })();

    return () => {
      cancelled = true;
      if (settleTimeout) clearTimeout(settleTimeout);
      if (intervalId) clearInterval(intervalId);
      if (messageSub) messageSub.remove();
    };
  }, []);
}
