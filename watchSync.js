import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { WatchConnectivity } from '@plevo/expo-watch-connectivity';
import { buildWatchContext } from './watchPayload';

const SYNC_MS = 2500;

/**
 * Pushes ballast state to Apple Watch via application context and handles quick commands.
 * Watch app must be added in Xcode (see WATCH_XCODE_SETUP.md).
 */
export function useWatchSync(deps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;

    let intervalId = null;
    let messageSub = null;

    const run = async () => {
      try {
        if (!WatchConnectivity.isSupported) return;
        await WatchConnectivity.activate();
      } catch (e) {
        console.warn('[Watch] activate failed', e);
      }

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
          const ctx = buildWatchContext(depsRef.current);
          WatchConnectivity.updateApplicationContext(ctx).catch(() => {});
        } catch (_) {
          /* ignore */
        }
      };

      push();
      intervalId = setInterval(push, SYNC_MS);
    };

    run();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (messageSub) messageSub.remove();
    };
  }, []);
}
