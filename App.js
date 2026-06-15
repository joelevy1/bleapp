import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Buffer } from 'buffer';
import { pushWatchContextNow, useWatchSync } from './watchSync';

global.Buffer = Buffer;

/** iOS 26: numeric fontWeight → UIFont.fontNamesForFamilyName / TSplicedFont path can fault in ShadowQueue (see device .ips). */
const FW500 = Platform.OS === 'ios' ? {} : { fontWeight: '500' };
const FW600 = Platform.OS === 'ios' ? {} : { fontWeight: '600' };

const DEVICE_NAME = 'Ballast Monitor';

/** iOS often leaves `name` null in scan; `localName` may still be set. */
function bleDeviceLabel(dev) {
  const n = dev?.name || dev?.localName;
  return n != null ? String(n).trim() : '';
}

function isBallastBleDevice(dev) {
  return bleDeviceLabel(dev) === DEVICE_NAME;
}

/** Scan filtered by SERVICE_UUID may match before iOS fills in `name`. */
function isBallastBleCandidate(dev) {
  if (!dev) return false;
  if (isBallastBleDevice(dev)) return true;
  const uuids = dev.serviceUUIDs;
  if (Array.isArray(uuids)) {
    return uuids.some((id) => String(id).toLowerCase() === SERVICE_UUID);
  }
  return false;
}

function waitForBluetoothPoweredOn(mgr, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error('Bluetooth initialization timed out'));
    }, timeoutMs);
    const subscription = mgr.onStateChange((state) => {
      if (state === 'PoweredOn') {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      } else if (state === 'Unsupported' || state === 'Unauthorized') {
        clearTimeout(timer);
        subscription.remove();
        reject(new Error('Bluetooth is not available'));
      }
    }, true);
  });
}
/** Environmental Sensing (custom flow/control/file transfer on Pico). */
const SERVICE_UUID = '0000181a-0000-1000-8000-00805f9b34fb';
/** Standard Device Information — Firmware Revision (0x2A26) is normally registered here, not under 0x181A. */
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const FLOW_CHAR_UUID = '00002a6e-0000-1000-8000-00805f9b34fb';
const CONTROL_CHAR_UUID = '00002a6f-0000-1000-8000-00805f9b34fb';
const VERSION_CHAR_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const FILE_TRANSFER_UUID = '00002a6d-0000-1000-8000-00805f9b34fb';
const FILE_CONTROL_UUID = '00002a6c-0000-1000-8000-00805f9b34fb';

const GITHUB_COMMITS_URL = 'https://api.github.com/repos/joelevy1/ballast/commits/main';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/joelevy1/ballast/main';
const OTA_FILES = [
  'main.py',
  'main_wifi.py',
  'ble_service.py',
  'config.py',
  'flow_meters.py',
  'ble_advertising.py',
];
/** Optional tiny manifest on `main` in the ballast repo — fast compare without downloading full sources. */
const FIRMWARE_MANIFEST_URL = `${GITHUB_RAW_BASE}/firmware_versions.json`;

const APP_VERSION =
  Constants.expoConfig?.version ?? Constants.manifest2?.extra?.expoClient?.version ?? '1.0.0';

const STORAGE = {
  WIFI_IP: 'ballast_wifi_ip',
  UNIT_MODE: 'ballast_unit_mode',
  PULSES_PER_GAL: 'ballast_pulses_per_gal',
  POUNDS_PER_GAL: 'ballast_pounds_per_gal',
  TANK_MAX: 'ballast_tank_max',
};

const TANK_NAMES = ['Port', 'Starboard', 'Mid', 'Forward'];

/** Calibrated from empty→overflow fill session (sum of both pumps per tank at full). */
const DEFAULT_TANK_MAX = {
  port: 9940,
  starboard: 9958,
  mid: 11087,
  forward: 8764,
};
const LEGACY_DEFAULT_TANK_MAX = {
  port: 10000,
  starboard: 10000,
  mid: 10000,
  forward: 5000,
};

function tankMaxMatchesLegacyDefaults(o) {
  if (!o || typeof o !== 'object') return false;
  return TANK_NAMES.every((n) => {
    const k = n.toLowerCase();
    return Number(o[k]) === LEGACY_DEFAULT_TANK_MAX[k];
  });
}

/** Matches main_wifi.py MIN_FLOW_RATE (gallons/min) for single-pump alerts. */
const MIN_FLOW_RATE_GPM = 0.1;

function normalizeWifiBase(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  return s.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Manifest shape (commit to ballast repo as firmware_versions.json):
 * - `{ "release": "4-19-2026-v1.3" }` — same label used for every row, or
 * - `{ "files": { "main.py": "…", … } }` — per-file strings (optional `release` fallback).
 */
function manifestIsUsable(m) {
  if (!m || typeof m !== 'object') return false;
  if (String(m.release ?? m.bundle_version ?? '').trim()) return true;
  if (m.files && typeof m.files === 'object') {
    return OTA_FILES.some((fn) => m.files[fn] != null && String(m.files[fn]).trim());
  }
  return false;
}

/** Pico firmware labels (e.g. 4-18-2026-v1.2) — not git SHAs. */
function normalizeFirmwareLabel(s) {
  const t = String(s ?? '')
    .replace(/\0/g, '')
    .trim();
  const m = t.match(/\d{1,2}-\d{1,2}-\d{4}-v[\d.]+/i);
  return m ? m[0] : t;
}

/** Pico firmware labels (e.g. 4-18-2026-v1.2) — not git SHAs. */
function rowStatusDeviceVsRef(deviceLine, ref) {
  if (!deviceLine || !ref) return 'unknown';
  const dl = normalizeFirmwareLabel(deviceLine);
  const refS = normalizeFirmwareLabel(ref);
  if (!dl || !refS) return 'unknown';
  if (dl === refS) return 'ok';
  if (dl.includes(refS) || refS.includes(dl)) return 'ok';
  return 'stale';
}

/** Same refs as Compare file versions — used by Check for updates. */
function manifestFileStatuses(deviceLine, manifest) {
  if (!manifestIsUsable(manifest)) return null;
  const fallbackRelease = String(manifest.release ?? manifest.bundle_version ?? '')
    .replace(/\0/g, '')
    .trim();
  return OTA_FILES.map((fn) => {
    let ref = '';
    if (manifest.files && typeof manifest.files === 'object' && manifest.files[fn] != null) {
      ref = String(manifest.files[fn]).replace(/\0/g, '').trim();
    } else {
      ref = fallbackRelease;
    }
    return rowStatusDeviceVsRef(deviceLine, ref);
  });
}

function parseTankMaxDraft(draft, fallback) {
  const next = { ...fallback };
  for (const name of TANK_NAMES) {
    const key = name.toLowerCase();
    const raw = draft?.[key];
    if (raw === undefined || raw === '') continue;
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) next[key] = n;
  }
  return next;
}

/** Open app from Pushover / Safari with Pico IP (see ballast main_wifi notify_wifi_ip). */
function parseWifiDeepLink(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  try {
    if (/^ballastmonitor:\/\//i.test(u) || /^com\.joelevy\.ballastmonitor:\/\//i.test(u)) {
      const afterScheme = u.replace(/^[^:]+:\/\//i, '');
      const qIdx = afterScheme.indexOf('?');
      const pathPart = qIdx >= 0 ? afterScheme.slice(0, qIdx) : afterScheme;
      const query = qIdx >= 0 ? afterScheme.slice(qIdx + 1) : '';
      if (query) {
        for (const part of query.split('&')) {
          const [k, v] = part.split('=');
          if (k === 'ip' && v) return normalizeWifiBase(decodeURIComponent(v));
        }
      }
      const fromPath = pathPart.replace(/^wifi\/?/i, '').split('/')[0];
      return normalizeWifiBase(fromPath);
    }
    const httpMatch = u.match(/^https?:\/\/([^/?#]+)/i);
    if (httpMatch) return normalizeWifiBase(httpMatch[1]);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u)) return u;
  } catch (_) {
    /* ignore */
  }
  return '';
}

async function fetchFirmwareManifest() {
  try {
    const mRes = await fetchWithTimeout(FIRMWARE_MANIFEST_URL, {}, 8000);
    if (!mRes.ok) return null;
    return await mRes.json();
  } catch (_) {
    return null;
  }
}

function firmwareNeedsUpdate(deviceVer, manifest) {
  const local = String(deviceVer ?? '')
    .replace(/\0/g, '')
    .trim();
  if (!local) return false;

  const fileStatuses = manifestFileStatuses(local, manifest);
  if (fileStatuses) {
    if (fileStatuses.every((s) => s === 'ok')) return false;
    if (fileStatuses.some((s) => s === 'stale')) return true;
  }

  const release = String(manifest?.release ?? manifest?.bundle_version ?? '').trim();
  if (!release) return false;
  return rowStatusDeviceVsRef(local, release) === 'stale';
}

/** Avoids multi‑minute hangs when the saved IP is wrong or the Pico is unreachable (not a BLE limitation). */
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** ble-plx gives Base64; Pico sends UTF-8 (e.g. 4-18-2026-v1.2). */
function decodeBleCharacteristicUtf8(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  try {
    const buf = Buffer.from(s, 'base64');
    const out = buf.toString('utf-8').replace(/\0/g, '').trim();
    if (out.length > 0) return out;
  } catch (_) {
    /* fall through */
  }
  if (/^[\w.\-:\s/]+$/.test(s) && s.length < 80) return s.replace(/\0/g, '').trim();
  return '';
}

async function readBleFirmwareRevision(device) {
  const tryOnce = async (serviceUuid) => {
    let ch = await device.readCharacteristicForService(serviceUuid, VERSION_CHAR_UUID);
    let raw = ch?.value;
    let text = decodeBleCharacteristicUtf8(raw);
    if (!text && ch && typeof ch.read === 'function') {
      try {
        ch = await ch.read();
        raw = ch?.value;
        text = decodeBleCharacteristicUtf8(raw);
      } catch (_) {
        /* ignore */
      }
    }
    return text;
  };

  // 0x2A26 is the standard Firmware Revision characteristic; it usually lives under Device Information (0x180A).
  const services = [DEVICE_INFO_SERVICE_UUID, SERVICE_UUID];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
    for (const svc of services) {
      try {
        const text = await tryOnce(svc);
        if (text) return text;
      } catch (_) {
        /* try next service / attempt */
      }
    }
  }
  return '';
}

export default function App() {
  // Do not create BleManager on the first cold start. After that: optional delayed passive scan on home (RSSI only),
  // or when the user taps "Connect to Boat (BLE)".
  const [bleManager, setBleManager] = useState(null);
  const bleManagerRef = useRef(null);

  const ensureBleManager = useCallback(async () => {
    if (bleManagerRef.current) return bleManagerRef.current;
    const { BleManager } = await import('react-native-ble-plx');
    const mgr = new BleManager();
    bleManagerRef.current = mgr;
    setBleManager(mgr);
    return mgr;
  }, []);

  useEffect(() => {
    return () => {
      if (bleManagerRef.current) {
        void bleManagerRef.current.destroy();
        bleManagerRef.current = null;
      }
    };
  }, []);
  const [connectionMode, setConnectionMode] = useState(null);
  const [device, setDevice] = useState(null);
  const [scannedDevice, setScannedDevice] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [flowValues, setFlowValues] = useState(new Array(8).fill(0));
  const [isFillMode, setIsFillMode] = useState(true);
  const [unitMode, setUnitMode] = useState('gallons');
  const [pulsesPerGallon, setPulsesPerGallon] = useState(450);
  const [poundsPerGallon, setPoundsPerGallon] = useState(8.34);
  const [picoVersion, setPicoVersion] = useState('');
  const [settingsVersionLoading, setSettingsVersionLoading] = useState(false);
  const [signalStrength, setSignalStrength] = useState(null);
  const [tankMaxValues, setTankMaxValues] = useState(DEFAULT_TANK_MAX);
  const [tankFillModes, setTankFillModes] = useState({
    Port: true,
    Starboard: true,
    Mid: true,
    Forward: true,
  });
  const [currentScreen, setCurrentScreen] = useState('home');
  const [wifiIpInput, setWifiIpInput] = useState('');
  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [wifiBase, setWifiBase] = useState('');
  const [wifiPollError, setWifiPollError] = useState(null);
  const [otaProgress, setOtaProgress] = useState(null);
  const [scanRssi, setScanRssi] = useState(null);
  const [versionDetailVisible, setVersionDetailVisible] = useState(false);
  const [versionDetailLoading, setVersionDetailLoading] = useState(false);
  const [versionCompareRows, setVersionCompareRows] = useState([]);
  const [tankMaxDraft, setTankMaxDraft] = useState(null);
  const [pumpAlertTanks, setPumpAlertTanks] = useState(() => new Set());
  const [pumpAlertFlashOn, setPumpAlertFlashOn] = useState(true);

  const wifiPollRef = useRef(null);
  const flowHistoryRef = useRef(Object.fromEntries([...Array(8)].map((_, i) => [i, []])));
  const lastFlowCountsRef = useRef(new Array(8).fill(0));
  const lastFlowTickRef = useRef(0);

  const TANK_CONFIG = [
    { name: 'Port', pumps: [1, 2], color: 'White/Green' },
    { name: 'Starboard', pumps: [0, 3], color: 'White/Green' },
    { name: 'Mid', pumps: [4, 5], color: 'Blue/Blue' },
    { name: 'Forward', pumps: [6, 7], color: 'Yellow/Yellow' },
  ];

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      (async () => {
        try {
          const [ip, um, ppg, ppg2, tm] = await Promise.all([
            AsyncStorage.getItem(STORAGE.WIFI_IP),
            AsyncStorage.getItem(STORAGE.UNIT_MODE),
            AsyncStorage.getItem(STORAGE.PULSES_PER_GAL),
            AsyncStorage.getItem(STORAGE.POUNDS_PER_GAL),
            AsyncStorage.getItem(STORAGE.TANK_MAX),
          ]);
          if (ip) {
            setWifiIpInput(ip);
            setWifiBase(normalizeWifiBase(ip));
          }
          if (um === 'counter' || um === 'gallons' || um === 'pounds') setUnitMode(um);
          if (ppg) {
            const n = parseFloat(ppg, 10);
            if (Number.isFinite(n) && n > 0) setPulsesPerGallon(n);
          }
          if (ppg2) {
            const n = parseFloat(ppg2, 10);
            if (Number.isFinite(n) && n > 0) setPoundsPerGallon(n);
          }
          if (tm) {
            const o = JSON.parse(tm);
            if (tankMaxMatchesLegacyDefaults(o)) {
              setTankMaxValues(DEFAULT_TANK_MAX);
              await AsyncStorage.setItem(STORAGE.TANK_MAX, JSON.stringify(DEFAULT_TANK_MAX));
            } else if (o && typeof o === 'object') {
              setTankMaxValues((prev) => ({ ...prev, ...o }));
            }
          }
        } catch (e) {
          // ignore
        }
      })();
    });
    return () => task.cancel();
  }, []);

  const applyWifiDeepLink = useCallback((url) => {
    const ip = parseWifiDeepLink(url);
    if (!ip) return false;
    setWifiIpInput(ip);
    setCurrentScreen('home');
    setWifiModalVisible(true);
    return true;
  }, []);

  useEffect(() => {
    const onUrl = ({ url }) => {
      applyWifiDeepLink(url);
    };
    Linking.getInitialURL()
      .then((url) => {
        if (url) applyWifiDeepLink(url);
      })
      .catch(() => {});
    const sub = Linking.addEventListener('url', onUrl);
    return () => sub.remove();
  }, [applyWifiDeepLink]);

  useEffect(() => {
    if (currentScreen === 'settings') {
      setTankMaxDraft(
        TANK_NAMES.reduce((acc, name) => {
          const key = name.toLowerCase();
          acc[key] = String(tankMaxValues[key] ?? '');
          return acc;
        }, {}),
      );
    }
  }, [currentScreen]);

  useEffect(() => {
    if (!isConnected) {
      setPumpAlertTanks(new Set());
      flowHistoryRef.current = Object.fromEntries([...Array(8)].map((_, i) => [i, []]));
      lastFlowCountsRef.current = new Array(8).fill(0);
      lastFlowTickRef.current = 0;
      return undefined;
    }
    const now = Date.now();
    if (lastFlowTickRef.current > 0 && now - lastFlowTickRef.current < 900) return undefined;
    const dtSec = lastFlowTickRef.current > 0 ? (now - lastFlowTickRef.current) / 1000 : 1;
    lastFlowTickRef.current = now;
    const ppg = pulsesPerGallon > 0 ? pulsesPerGallon : 450;

    for (let i = 0; i < 8; i += 1) {
      const pulsesPerSec = (flowValues[i] - lastFlowCountsRef.current[i]) / dtSec;
      const gpm = (pulsesPerSec * 60) / ppg;
      const hist = flowHistoryRef.current[i];
      hist.push(gpm);
      if (hist.length > 5) hist.shift();
      lastFlowCountsRef.current[i] = flowValues[i];
    }

    const alerts = new Set();
    for (const tank of TANK_CONFIG) {
      const [p1, p2] = tank.pumps;
      const h1 = flowHistoryRef.current[p1];
      const h2 = flowHistoryRef.current[p2];
      if (h1.length < 5 || h2.length < 5) continue;
      const f1 = h1.reduce((a, b) => a + b, 0) / h1.length;
      const f2 = h2.reduce((a, b) => a + b, 0) / h2.length;
      const r1 = f1 > MIN_FLOW_RATE_GPM;
      const r2 = f2 > MIN_FLOW_RATE_GPM;
      if (r1 !== r2) alerts.add(tank.name);
    }
    setPumpAlertTanks(alerts);
    return undefined;
  }, [flowValues, isConnected, pulsesPerGallon]);

  useEffect(() => {
    if (pumpAlertTanks.size === 0) {
      setPumpAlertFlashOn(true);
      return undefined;
    }
    const id = setInterval(() => setPumpAlertFlashOn((on) => !on), 500);
    return () => clearInterval(id);
  }, [pumpAlertTanks]);

  const persistWifiIp = useCallback(async (v) => {
    const n = normalizeWifiBase(v);
    setWifiBase(n);
    if (n) await AsyncStorage.setItem(STORAGE.WIFI_IP, n);
    else await AsyncStorage.removeItem(STORAGE.WIFI_IP);
  }, []);

  const persistTankMax = useCallback(async (next) => {
    setTankMaxValues(next);
    await AsyncStorage.setItem(STORAGE.TANK_MAX, JSON.stringify(next));
  }, []);

  /** Apply JSON from GET /api/settings or `settings` on GET /api/info (Pico `ballast_settings.json`). */
  const applySettingsFromPico = useCallback((s) => {
    if (!s || typeof s !== 'object') return;
    const um = s.unit_mode;
    if (um === 'counter' || um === 'gallons' || um === 'pounds') setUnitMode(um);
    const ppg = Number(s.pulses_per_gallon);
    if (Number.isFinite(ppg) && ppg > 0) setPulsesPerGallon(ppg);
    const ppg2 = Number(s.pounds_per_gallon);
    if (Number.isFinite(ppg2) && ppg2 > 0) setPoundsPerGallon(ppg2);
    if (s.tank_max && typeof s.tank_max === 'object') {
      const tm = s.tank_max;
      setTankMaxValues((prev) => ({
        port: Number(tm.port) > 0 ? Number(tm.port) : prev.port,
        starboard: Number(tm.starboard) > 0 ? Number(tm.starboard) : prev.starboard,
        mid: Number(tm.mid) > 0 ? Number(tm.mid) : prev.mid,
        forward: Number(tm.forward) > 0 ? Number(tm.forward) : prev.forward,
      }));
    }
    if (typeof s.is_fill_mode === 'boolean') setIsFillMode(s.is_fill_mode);
    if (s.tank_fill && typeof s.tank_fill === 'object') {
      const tf = s.tank_fill;
      setTankFillModes((prev) => ({
        Port: tf.Port !== undefined ? Boolean(tf.Port) : prev.Port,
        Starboard: tf.Starboard !== undefined ? Boolean(tf.Starboard) : prev.Starboard,
        Mid: tf.Mid !== undefined ? Boolean(tf.Mid) : prev.Mid,
        Forward: tf.Forward !== undefined ? Boolean(tf.Forward) : prev.Forward,
      }));
    }
  }, []);

  const saveSettingsToStorage = useCallback(async () => {
    try {
      const nextTankMax = tankMaxDraft ? parseTankMaxDraft(tankMaxDraft, tankMaxValues) : tankMaxValues;
      setTankMaxValues(nextTankMax);
      await AsyncStorage.setItem(STORAGE.UNIT_MODE, unitMode);
      await AsyncStorage.setItem(STORAGE.PULSES_PER_GAL, String(pulsesPerGallon));
      await AsyncStorage.setItem(STORAGE.POUNDS_PER_GAL, String(poundsPerGallon));
      await AsyncStorage.setItem(STORAGE.TANK_MAX, JSON.stringify(nextTankMax));
      if (connectionMode === 'wifi' && wifiBase) {
        const res = await fetchWithTimeout(
          `http://${wifiBase}/api/settings`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              unit_mode: unitMode,
              pulses_per_gallon: pulsesPerGallon,
              pounds_per_gallon: poundsPerGallon,
              tank_max: nextTankMax,
              is_fill_mode: isFillMode,
              tank_fill: tankFillModes,
            }),
          },
          12000,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      Alert.alert(
        'Saved',
        connectionMode === 'wifi' && wifiBase
          ? 'Settings saved on this phone and on the Pico.'
          : 'Settings saved on this phone. Connect via Wi‑Fi to sync calibration to the Pico.',
      );
    } catch (e) {
      Alert.alert('Save failed', String(e.message || e));
    }
  }, [
    unitMode,
    pulsesPerGallon,
    poundsPerGallon,
    tankMaxValues,
    tankMaxDraft,
    connectionMode,
    wifiBase,
    isFillMode,
    tankFillModes,
  ]);

  /** BLE firmware-revision char or WiFi GET /api/info → Pico firmware string (e.g. 4-18-2026-v1.2). */
  const fetchPicoVersionNow = useCallback(async () => {
    try {
      if (connectionMode === 'ble' && device) {
        const v = await readBleFirmwareRevision(device);
        if (v) {
          setPicoVersion(v);
          return v;
        }
      }
      if (connectionMode === 'wifi' && wifiBase) {
        const res = await fetchWithTimeout(`http://${wifiBase}/api/info`, { method: 'GET' }, 6000);
        if (res.ok) {
          const info = await res.json();
          const v = String(info.version ?? info.v ?? '').replace(/\0/g, '').trim();
          if (v) {
            setPicoVersion(v);
            return v;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }, [connectionMode, device, wifiBase]);

  useEffect(() => {
    if (!bleManager || connectionMode !== 'ble' || !device || !isConnected) return undefined;
    const id = setInterval(async () => {
      try {
        const d = await device.readRSSI();
        const r = typeof d === 'number' ? d : d?.rssi;
        if (Number.isFinite(r)) setSignalStrength(r);
      } catch (e) {
        try {
          const d2 = await bleManager.readRSSIForDevice(device.id);
          const r2 = typeof d2 === 'number' ? d2 : d2?.rssi;
          if (Number.isFinite(r2)) setSignalStrength(r2);
        } catch (e2) {
          // ignore
        }
      }
    }, 2000);
    return () => clearInterval(id);
  }, [connectionMode, device, isConnected, bleManager]);

  // Passive RSSI on home (no connect): wait for BT PoweredOn like connect does, then scan by service UUID.
  useEffect(() => {
    if (currentScreen !== 'home' || isConnected || isScanning) return undefined;
    let cancelled = false;
    let delayTimer = null;
    let stopTimer = null;
    const task = InteractionManager.runAfterInteractions(() => {
      delayTimer = setTimeout(async () => {
        if (cancelled) return;
        let mgr;
        try {
          mgr = await ensureBleManager();
          await waitForBluetoothPoweredOn(mgr);
        } catch {
          return;
        }
        if (cancelled) return;
        mgr.startDeviceScan([SERVICE_UUID], { allowDuplicates: true }, (error, dev) => {
          if (cancelled || error || !dev) return;
          // Scan is filtered to 0x181A; iOS may omit name on first advertisements.
          if (Number.isFinite(dev.rssi)) {
            setScanRssi(dev.rssi);
          }
        });
        stopTimer = setTimeout(() => {
          if (cancelled) return;
          try {
            mgr.stopDeviceScan();
          } catch (_) {
            /* ignore */
          }
        }, 12000);
      }, 400);
    });
    return () => {
      cancelled = true;
      task.cancel();
      if (delayTimer) clearTimeout(delayTimer);
      if (stopTimer) clearTimeout(stopTimer);
      if (bleManagerRef.current) {
        try {
          bleManagerRef.current.stopDeviceScan();
        } catch (_) {
          /* ignore */
        }
      }
    };
  }, [currentScreen, isConnected, isScanning, ensureBleManager]);

  useEffect(() => {
    if (connectionMode !== 'wifi' || !wifiBase || !isConnected) {
      if (wifiPollRef.current) {
        clearInterval(wifiPollRef.current);
        wifiPollRef.current = null;
      }
      return undefined;
    }
    const tick = async () => {
      const base = `http://${wifiBase}`;
      try {
        const [pulsesRes, infoRes] = await Promise.all([
          fetchWithTimeout(`${base}/api/pulses`, { method: 'GET' }, 8000),
          fetchWithTimeout(`${base}/api/info`, { method: 'GET' }, 8000).catch(() => null),
        ]);
        if (!pulsesRes.ok) throw new Error(`HTTP ${pulsesRes.status}`);
        const data = await pulsesRes.json();
        const arr = data.pulses || data.values || data;
        if (!Array.isArray(arr) || arr.length < 8) throw new Error('Bad JSON');
        setFlowValues(arr.slice(0, 8).map((n) => Number(n) || 0));
        pushWatchContextNow();
        setWifiPollError(null);
        if (infoRes?.ok) {
          try {
            const info = await infoRes.json();
            const v = String(info.version ?? info.v ?? '').replace(/\0/g, '').trim();
            if (v) setPicoVersion(v);
            const st = info.settings;
            if (st && typeof st === 'object') {
              if (typeof st.is_fill_mode === 'boolean') setIsFillMode(st.is_fill_mode);
              if (st.tank_fill && typeof st.tank_fill === 'object') {
                const tf = st.tank_fill;
                setTankFillModes((prev) => ({
                  Port: tf.Port !== undefined ? Boolean(tf.Port) : prev.Port,
                  Starboard: tf.Starboard !== undefined ? Boolean(tf.Starboard) : prev.Starboard,
                  Mid: tf.Mid !== undefined ? Boolean(tf.Mid) : prev.Mid,
                  Forward: tf.Forward !== undefined ? Boolean(tf.Forward) : prev.Forward,
                }));
              }
            }
          } catch (_) {
            /* ignore */
          }
        }
      } catch (e) {
        setWifiPollError(String(e.message || e));
      }
    };
    tick();
    wifiPollRef.current = setInterval(tick, 1000);
    return () => {
      if (wifiPollRef.current) clearInterval(wifiPollRef.current);
      wifiPollRef.current = null;
    };
  }, [connectionMode, wifiBase, isConnected]);

  useEffect(() => {
    if (currentScreen !== 'settings') return undefined;
    let cancelled = false;
    setSettingsVersionLoading(true);
    (async () => {
      try {
        let v = await fetchPicoVersionNow();
        if (cancelled) return;
        if (!v && connectionMode === 'ble' && device) {
          v = await readBleFirmwareRevision(device);
          if (v) setPicoVersion(v);
        }
        if (!v) {
          const ip = normalizeWifiBase(wifiIpInput);
          if (ip) {
            try {
              const res = await fetchWithTimeout(`http://${ip}/api/info`, { method: 'GET' }, 6000);
              if (cancelled || !res.ok) return;
              const info = await res.json();
              const ver = String(info.version ?? info.v ?? '').replace(/\0/g, '').trim();
              if (ver) setPicoVersion(ver);
            } catch (_) {
              /* ignore */
            }
          }
        }
      } finally {
        if (!cancelled) setSettingsVersionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentScreen, fetchPicoVersionNow, wifiIpInput, connectionMode, device]);

  const getSignalQuality = (rssi) => {
    if (!Number.isFinite(rssi)) return { bars: '○○○○○', text: 'No Signal' };
    if (rssi >= -50) return { bars: '●●●●●', text: 'Excellent' };
    if (rssi >= -60) return { bars: '●●●●○', text: 'Good' };
    if (rssi >= -70) return { bars: '●●●○○', text: 'Fair' };
    if (rssi >= -80) return { bars: '●●○○○', text: 'Weak' };
    return { bars: '●○○○○', text: 'Poor' };
  };

  const scanAndConnect = async () => {
    let mgr;
    try {
      mgr = await ensureBleManager();
    } catch (e) {
      Alert.alert('Bluetooth', `Could not start Bluetooth: ${String(e?.message || e)}`);
      return;
    }
    setIsScanning(true);
    try {
      await waitForBluetoothPoweredOn(mgr, 5000);
      startScan(mgr);
    } catch (error) {
      setIsScanning(false);
      Alert.alert('Bluetooth Error', error.message || 'Bluetooth is not available');
    }
  };

  const startScan = (mgr) => {
    setScanRssi(null);
    let found = false;
    mgr.startDeviceScan([SERVICE_UUID], { allowDuplicates: true }, (error, dev) => {
      if (error) {
        mgr.stopDeviceScan();
        setIsScanning(false);
        Alert.alert('Scan Error', error.message);
        return;
      }
      if (isBallastBleCandidate(dev)) {
        setScannedDevice(dev);
        if (Number.isFinite(dev.rssi)) setScanRssi(dev.rssi);
        if (!found) {
          found = true;
          mgr.stopDeviceScan();
          connectToDevice(dev);
        }
      }
    });
    setTimeout(() => {
      if (!found) {
        mgr.stopDeviceScan();
        setIsScanning(false);
        setScanRssi(null);
        Alert.alert('Not Found', 'Ballast Monitor not found');
      }
    }, 15000);
  };

  const connectToDevice = async (scannedDev) => {
    try {
      const connectedDevice = await scannedDev.connect();
      setDevice(connectedDevice);
      setConnectionMode('ble');
      await connectedDevice.discoverAllServicesAndCharacteristics();

      try {
        const version = await readBleFirmwareRevision(connectedDevice);
        if (version) setPicoVersion(version);
      } catch (e) {
        // ignore
      }

      try {
        const rd = await connectedDevice.readRSSI();
        const r0 = typeof rd === 'number' ? rd : rd?.rssi;
        if (Number.isFinite(r0)) setSignalStrength(r0);
      } catch (e) {
        // ignore
      }

      connectedDevice.monitorCharacteristicForService(SERVICE_UUID, FLOW_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const data = Buffer.from(characteristic.value, 'base64');
          const values = [];
          for (let i = 0; i < 8; i += 1) {
            values.push(data.readUInt32LE(i * 4));
          }
          setFlowValues(values);
          pushWatchContextNow();
        }
      });

      setIsConnected(true);
      setIsScanning(false);
      setScanRssi(null);
      setCurrentScreen('main');
    } catch (error) {
      setIsScanning(false);
      setScanRssi(null);
      Alert.alert('Connection Failed', error.message);
    }
  };

  const connectWifi = async () => {
    const base = normalizeWifiBase(wifiIpInput);
    if (!base) {
      Alert.alert('WiFi', 'Enter a valid IP address (e.g. 192.168.1.50).');
      return;
    }
    try {
      let pulsesArr = null;
      let versionLabel = '';
      const infoRes = await fetchWithTimeout(`http://${base}/api/info`, { method: 'GET' }, 6000);
      if (infoRes.ok) {
        const info = await infoRes.json();
        const arr = info.pulses || info.values;
        if (Array.isArray(arr) && arr.length >= 8) {
          pulsesArr = arr;
        }
        versionLabel = String(info.version || '').trim();
      }
      if (!pulsesArr) {
        const url = `http://${base}/api/pulses`;
        const res = await fetchWithTimeout(url, { method: 'GET' }, 8000);
        if (!res.ok) {
          Alert.alert(
            'WiFi',
            `Could not read ${url} (HTTP ${res.status}). Flash main_wifi.py with GET /api/pulses and GET /api/info.`,
          );
          return;
        }
        const data = await res.json();
        const arr = data.pulses || data.values || data;
        if (!Array.isArray(arr) || arr.length < 8) {
          Alert.alert('WiFi', 'Unexpected JSON. Expected { "pulses": [8 numbers] }.');
          return;
        }
        pulsesArr = arr;
      }
      setFlowValues(pulsesArr.slice(0, 8).map((n) => Number(n) || 0));
      setWifiBase(base);
      await persistWifiIp(base);
      setConnectionMode('wifi');
      setDevice(null);
      setSignalStrength(null);
      setWifiPollError(null);
      setPicoVersion(versionLabel || '');
      setIsConnected(true);
      setWifiModalVisible(false);
      setCurrentScreen('main');
      try {
        const sr = await fetchWithTimeout(`http://${base}/api/settings`, { method: 'GET' }, 6000);
        if (sr.ok) {
          const remote = await sr.json();
          applySettingsFromPico(remote);
          const um =
            remote.unit_mode === 'counter' || remote.unit_mode === 'gallons' || remote.unit_mode === 'pounds'
              ? remote.unit_mode
              : 'gallons';
          await AsyncStorage.setItem(STORAGE.UNIT_MODE, um);
          await AsyncStorage.setItem(STORAGE.PULSES_PER_GAL, String(remote.pulses_per_gallon ?? 450));
          await AsyncStorage.setItem(STORAGE.POUNDS_PER_GAL, String(remote.pounds_per_gallon ?? 8.34));
          if (remote.tank_max && typeof remote.tank_max === 'object') {
            await AsyncStorage.setItem(STORAGE.TANK_MAX, JSON.stringify(remote.tank_max));
          }
        }
      } catch (_) {
        /* Pico may run older main_wifi without /api/settings */
      }
    } catch (e) {
      Alert.alert('WiFi', String(e.message || e));
    }
  };

  const disconnect = async () => {
    if (wifiPollRef.current) {
      clearInterval(wifiPollRef.current);
      wifiPollRef.current = null;
    }
    if (connectionMode === 'ble' && device) {
      try {
        await device.cancelConnection();
      } catch (e) {
        // ignore
      }
    }
    setDevice(null);
    setConnectionMode(null);
    setIsConnected(false);
    setFlowValues(new Array(8).fill(0));
    setCurrentScreen('home');
    setScannedDevice(null);
    setSignalStrength(null);
    setWifiPollError(null);
    setScanRssi(null);
    setPicoVersion('');
  };

  const getTankTotalPulses = (tankName) => {
    const tank = TANK_CONFIG.find((t) => t.name === tankName);
    if (!tank) return 0;
    return tank.pumps.reduce((sum, idx) => sum + flowValues[idx], 0);
  };

  const getTankPercentDisplay = (tankName) => {
    const maxP = tankMaxValues[tankName.toLowerCase()];
    if (!maxP) return 0;
    const total = getTankTotalPulses(tankName);
    const fill = Math.min(1, total / maxP);
    const drain = !tankFillModes[tankName];
    const pct = drain ? Math.round((1 - fill) * 100) : Math.round(fill * 100);
    return Math.min(100, Math.max(0, pct));
  };

  const formatPumpValue = (pumpIdx, tankName) => {
    return convertValue(flowValues[pumpIdx]);
  };

  const formatTotalValue = () => {
    if (isFillMode) {
      const totalPulses = flowValues.reduce((a, b) => a + b, 0);
      return convertValue(totalPulses);
    }
    const remaining = TANK_NAMES.reduce((sum, name) => {
      const maxP = tankMaxValues[name.toLowerCase()] || 0;
      const total = getTankTotalPulses(name);
      return sum + Math.max(0, maxP - total);
    }, 0);
    return convertValue(remaining);
  };

  const convertValue = (pulses) => {
    if (unitMode === 'counter') return String(Math.round(pulses));
    const gallons = pulses / pulsesPerGallon;
    if (unitMode === 'gallons') return gallons.toFixed(1);
    return (gallons * poundsPerGallon).toFixed(1);
  };

  const getUnitLabel = () => {
    if (unitMode === 'counter') return '';
    if (unitMode === 'gallons') return 'gal';
    return 'lbs';
  };

  const wifiPostForm = async (path, body) => {
    const base = `http://${wifiBase}`;
    const res = await fetchWithTimeout(
      `${base}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body || '',
      },
      12000,
    );
    return res;
  };

  const resetAll = async () => {
    if (connectionMode === 'wifi') {
      try {
        const res = await wifiPostForm('/reset_all', '');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        Alert.alert('Reset', 'All pumps reset');
      } catch (e) {
        Alert.alert('Reset Failed', String(e.message || e));
      }
      return;
    }
    if (!device) return;
    try {
      const cmd = Buffer.from([0x01]);
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CONTROL_CHAR_UUID,
        cmd.toString('base64'),
      );
      Alert.alert('Reset', 'All pumps reset');
    } catch (error) {
      Alert.alert('Reset Failed', error.message);
    }
  };

  const resetPump = async (index) => {
    if (connectionMode === 'wifi') {
      try {
        await wifiPostForm('/reset', `meter=${encodeURIComponent(index)}`);
      } catch (e) {
        // ignore
      }
      return;
    }
    if (!device) return;
    try {
      const cmd = Buffer.from([0x02, index]);
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CONTROL_CHAR_UUID,
        cmd.toString('base64'),
      );
    } catch (error) {
      // ignore
    }
  };

  const resetTank = (tankName) => {
    const tank = TANK_CONFIG.find((t) => t.name === tankName);
    if (tank) {
      tank.pumps.forEach((idx) => resetPump(idx));
    }
  };

  const setTankFull = async (tankName) => {
    const tank = TANK_CONFIG.find((t) => t.name === tankName);
    if (!tank) return;
    const totalPulses = tank.pumps.reduce((sum, idx) => sum + flowValues[idx], 0);
    const key = tankName.toLowerCase();
    const next = { ...tankMaxValues, [key]: Math.max(1, totalPulses) };
    await persistTankMax(next);
    Alert.alert('Set Full', `${tankName} max set to ${totalPulses} pulses`);
  };

  const setTankFillMode = (tankName, fill) => {
    setTankFillModes((prev) => ({ ...prev, [tankName]: fill }));
  };

  const applyMasterFillDrain = (fill) => {
    setIsFillMode(fill);
    setTankFillModes({
      Port: fill,
      Starboard: fill,
      Mid: fill,
      Forward: fill,
    });
  };

  const fetchGithubLatestCommit = async () => {
    const res = await fetchWithTimeout(GITHUB_COMMITS_URL, {}, 15000);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  };

  const fetchGithubRawFile = async (name) => {
    const res = await fetchWithTimeout(`${GITHUB_RAW_BASE}/${name}`, {}, 15000);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.text();
  };

  const bleTransferFile = async (filename, content, onChunkProgress) => {
    const buf = Buffer.from(content, 'utf8');
    const size = buf.length;
    const nameBuf = Buffer.from(filename, 'utf8');
    if (nameBuf.length > 200) {
      throw new Error(`Filename too long for BLE OTA: ${filename}`);
    }
    const start = Buffer.alloc(1 + 4 + 1 + nameBuf.length);
    start.writeUInt8(0x01, 0);
    start.writeUInt32LE(size, 1);
    start.writeUInt8(nameBuf.length, 5);
    nameBuf.copy(start, 6);
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      FILE_CONTROL_UUID,
      start.toString('base64'),
    );
    await new Promise((r) => setTimeout(r, 50));
    const chunkSize = 20;
    for (let off = 0; off < buf.length; off += chunkSize) {
      const chunk = buf.slice(off, off + chunkSize);
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_TRANSFER_UUID,
        chunk.toString('base64'),
      );
      if (onChunkProgress) onChunkProgress(Math.min(off + chunk.length, buf.length), buf.length);
      await new Promise((r) => setTimeout(r, 20));
    }
    const end = Buffer.from([0x02]);
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      FILE_CONTROL_UUID,
      end.toString('base64'),
    );
    await new Promise((r) => setTimeout(r, 100));
  };

  const bleSendReboot = async () => {
    const reboot = Buffer.from([0x03]);
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      FILE_CONTROL_UUID,
      reboot.toString('base64'),
    );
  };

  const runFirmwareUpdateBle = async () => {
    if (!device || connectionMode !== 'ble') {
      Alert.alert('OTA', 'Connect via BLE first.');
      return;
    }
    if (otaProgress != null) return;
    setOtaProgress(0);
    try {
      for (let i = 0; i < OTA_FILES.length; i += 1) {
        const fn = OTA_FILES[i];
        const text = await fetchGithubRawFile(fn);
        await bleTransferFile(fn, text, (sent, total) => {
          const t = (i + sent / total) / OTA_FILES.length;
          setOtaProgress(Math.min(99, Math.round(t * 100)));
        });
        setOtaProgress(Math.round(((i + 1) / OTA_FILES.length) * 99));
      }
      setOtaProgress(100);
      try {
        await bleSendReboot();
      } catch (e) {
        // Pico may already reboot from last file save
      }
      await disconnect();
      Alert.alert(
        'Update complete',
        'Files flashed and reboot sent. Wait a few seconds, then use Connect to Boat (BLE) again. If the version still looks old, reconnect once more after the Pico finishes rebooting.',
      );
    } catch (e) {
      Alert.alert('OTA Failed', String(e.message || e));
    } finally {
      setOtaProgress(null);
    }
  };

  const runFirmwareUpdateWifi = async () => {
    if (connectionMode !== 'wifi' || !wifiBase) {
      Alert.alert('OTA', 'Connect via WiFi first.');
      return;
    }
    if (otaProgress != null) return;
    setOtaProgress(1);
    try {
      const files = OTA_FILES.join(',');
      const res = await wifiPostForm('/install_updates', `files=${encodeURIComponent(files)}`);
      setOtaProgress(100);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await disconnect();
      Alert.alert('Update started', 'The Pico should reboot. When it is back on the network, open WiFi on the home screen and enter its IP again.');
    } catch (e) {
      Alert.alert('OTA Failed', String(e.message || e));
    } finally {
      setOtaProgress(null);
    }
  };

  /** Pico firmware: control cmd 0x04 writes wifi_once.flag and resets; main.py runs main_wifi once then returns to config.MODE (BLE). */
  const scheduleOneShotWifiBoot = () => {
    if (connectionMode !== 'ble' || !device) {
      Alert.alert('WiFi once', 'Connect via Bluetooth first.');
      return;
    }
    Alert.alert(
      'Reboot to WiFi (one session)',
      'The Pico will restart in WiFi / web mode for this session only. If Pushover or ntfy is configured on the Pico, you may get the IP on your phone; otherwise check the router (look for Ballast-Monitor) or USB serial.\n\niOS cannot force-quit this app; you will return to the home screen with the WiFi dialog open.\n\nAfter a full power cycle, the Pico returns to BLE.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reboot to WiFi',
          style: 'destructive',
          onPress: async () => {
            try {
              const cmd = Buffer.from([0x04]);
              await device.writeCharacteristicWithResponseForService(
                SERVICE_UUID,
                CONTROL_CHAR_UUID,
                cmd.toString('base64'),
              );
              await disconnect();
              InteractionManager.runAfterInteractions(() => {
                setCurrentScreen('home');
                setWifiModalVisible(true);
                Alert.alert('WiFi', 'Enter the Pico IP when it is online, or use your saved IP.');
              });
            } catch (e) {
              Alert.alert('Failed', String(e.message || e));
            }
          },
        },
      ],
    );
  };

  const rebootToBleFromWifi = () => {
    if (connectionMode !== 'wifi' || !wifiBase) {
      Alert.alert('Bluetooth', 'Connect via WiFi first.');
      return;
    }
    Alert.alert(
      'Reboot to Bluetooth',
      'The Pico will restart in BLE mode. Requires POST /reboot_to_ble in main_wifi.py on the device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reboot to BLE',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await wifiPostForm('/reboot_to_ble', '');
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              disconnect();
              Alert.alert('Pico', 'Rebooting to Bluetooth. Use Connect to Boat on the home screen when the device is advertising.');
            } catch (e) {
              Alert.alert('Failed', String(e.message || e));
            }
          },
        },
      ],
    );
  };

  const openVersionDetails = async () => {
    setVersionDetailVisible(true);
    setVersionDetailLoading(true);
    setVersionCompareRows([]);
    try {
      let deviceLine = String(picoVersion ?? '').replace(/\0/g, '').trim();
      const fresh = await fetchPicoVersionNow();
      if (fresh) deviceLine = fresh;
      if (!deviceLine && connectionMode === 'ble' && device) {
        const v = await readBleFirmwareRevision(device);
        if (v) {
          setPicoVersion(v);
          deviceLine = v;
        }
      }
      if (!deviceLine) {
        const ip = normalizeWifiBase(wifiIpInput);
        if (ip) {
          try {
            const res = await fetchWithTimeout(`http://${ip}/api/info`, { method: 'GET' }, 6000);
            if (res.ok) {
              const info = await res.json();
              const v = String(info.version ?? info.v ?? '').replace(/\0/g, '').trim();
              if (v) {
                setPicoVersion(v);
                deviceLine = v;
              }
            }
          } catch (_) {
            /* ignore */
          }
        }
      }

      const manifest = await fetchFirmwareManifest();

      let rows;
      if (manifestIsUsable(manifest)) {
        const fallbackRelease = String(manifest.release ?? manifest.bundle_version ?? '')
          .replace(/\0/g, '')
          .trim();
        rows = OTA_FILES.map((fn) => {
          let ref = '';
          if (manifest.files && typeof manifest.files === 'object' && manifest.files[fn] != null) {
            ref = String(manifest.files[fn]).replace(/\0/g, '').trim();
          } else {
            ref = fallbackRelease;
          }
          const status = rowStatusDeviceVsRef(deviceLine, ref);
          const hint = ref
            ? deviceLine
              ? `device: ${deviceLine.slice(0, 36)} · github: ${ref.slice(0, 36)}`
              : ref.slice(0, 80)
            : '—';
          return { fn, status, hint };
        });
      } else {
        const fileTexts = await Promise.all(OTA_FILES.map((fn) => fetchGithubRawFile(fn)));
        rows = OTA_FILES.map((fn, i) => {
          const text = fileTexts[i];
          const head = text.split('\n').slice(0, 50).join('\n');
          const firstLine = text.split('\n').find((l) => l.trim()) || '';
          const shortHint = firstLine.trim().slice(0, 80);
          const status = deviceLine ? rowStatusDeviceVsRef(deviceLine, shortHint) : 'unknown';
          const hint = deviceLine
            ? `device: ${deviceLine.slice(0, 36)} · file: ${shortHint.slice(0, 36)}`
            : shortHint;
          return { fn, status, hint };
        });
      }
      setVersionCompareRows(rows);
    } catch (e) {
      setVersionCompareRows([{ fn: '—', status: 'unknown', hint: String(e.message || e) }]);
    } finally {
      setVersionDetailLoading(false);
    }
  };

  const checkFirmwareUpdates = async () => {
    try {
      let v = await fetchPicoVersionNow();
      if (!v && connectionMode === 'ble' && device) {
        const r = await readBleFirmwareRevision(device);
        if (r) {
          setPicoVersion(r);
          v = r;
        }
      }
      const savedIp = normalizeWifiBase(wifiIpInput);
      if (!v && savedIp) {
        try {
          const res = await fetchWithTimeout(`http://${savedIp}/api/info`, { method: 'GET' }, 6000);
          if (res.ok) {
            const info = await res.json();
            const ver = String(info.version ?? info.v ?? '').replace(/\0/g, '').trim();
            if (ver) {
              setPicoVersion(ver);
              v = ver;
            }
          }
        } catch (_) {
          /* ignore */
        }
      }
      const manifest = await fetchFirmwareManifest();
      const commit = await fetchGithubLatestCommit();
      const sha = commit.sha?.slice(0, 7) || '?';
      const msg = commit.commit?.message?.split('\n')[0] || '';
      const remoteHint = `${sha} ${msg}`;
      const local = (v && String(v).trim()) || String(picoVersion || '').replace(/\0/g, '').trim();
      const githubTag = String(manifest?.release ?? manifest?.bundle_version ?? '').trim();
      const needs = firmwareNeedsUpdate(local, manifest);
      const alertButtons = needs
        ? [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Apply update',
              onPress: () => {
                if (connectionMode === 'ble') runFirmwareUpdateBle();
                else if (connectionMode === 'wifi') runFirmwareUpdateWifi();
                else Alert.alert('Firmware', 'Connect via BLE or WiFi first.');
              },
            },
          ]
        : [{ text: 'OK' }];
      Alert.alert(
        'Firmware',
        `Device (Pico): ${local || '(not read)'}${
          githubTag ? `\nGitHub firmware tag: ${githubTag}` : ''
        }\nLatest source commit: ${remoteHint}\n\n${
          !local
            ? 'Connect via BLE or Wi‑Fi, or enter the Pico IP in the WiFi field so /api/info can be read.'
            : needs
              ? 'The Pico version does not match firmware_versions.json on GitHub main — tap Apply update to flash OTA files.'
              : githubTag
                ? 'Pico matches GitHub (firmware tag and per-file labels). The commit line is only the latest change on main (not stored on the device).'
                : 'Pico matches GitHub per-file labels in firmware_versions.json.'
        }`,
        alertButtons,
      );
    } catch (e) {
      Alert.alert('Firmware', String(e.message || e));
    }
  };

  const handleWatchToggleFillDrain = useCallback(() => {
    setIsFillMode((prev) => {
      const next = !prev;
      setTankFillModes({
        Port: next,
        Starboard: next,
        Mid: next,
        Forward: next,
      });
      return next;
    });
  }, []);

  const handleWatchSetUnit = useCallback((unit) => {
    if (unit === 'counter' || unit === 'gallons' || unit === 'pounds') setUnitMode(unit);
  }, []);

  const handleWatchResetTank = useCallback((tankName) => {
    if (TANK_CONFIG.some((t) => t.name === tankName)) resetTank(tankName);
  }, []);

  const handleWatchToggleTankFillDrain = useCallback((tankName) => {
    if (!TANK_CONFIG.some((t) => t.name === tankName)) return;
    setTankFillModes((prev) => ({ ...prev, [tankName]: !prev[tankName] }));
  }, []);

  useWatchSync({
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
    onResetAll: resetAll,
    onToggleFillDrain: handleWatchToggleFillDrain,
    onDisconnect: disconnect,
    onSetUnit: handleWatchSetUnit,
    onResetTank: handleWatchResetTank,
    onToggleTankFillDrain: handleWatchToggleTankFillDrain,
  });

  // HOME (not connected)
  if (currentScreen === 'home' && !isConnected) {
    const homeRssi = Number.isFinite(scanRssi) ? scanRssi : signalStrength;
    const signal = getSignalQuality(homeRssi);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Ballast Monitor</Text>
        </View>
        <View style={styles.connectScreen}>
          <View style={styles.photoCircle}>
            <Image
              source={require('./assets/heather-surfing.png')}
              style={styles.photoImage}
              resizeMode="cover"
              accessibilityLabel="Heather surfing"
            />
          </View>
          <Text style={styles.subtitle}>Monitor ballast tanks</Text>
          <View style={styles.deviceCard}>
            <Text style={styles.deviceText}>Device: Ballast Monitor</Text>
            <Text style={styles.deviceText}>
              Signal: {signal.bars} {signal.text}
              {Number.isFinite(homeRssi) ? ` (${homeRssi} dBm)` : ''}
            </Text>
            <Text style={styles.deviceText}>Channels: 8 Flow Meters</Text>
          </View>
          <TouchableOpacity style={styles.connectButton} onPress={scanAndConnect} disabled={isScanning}>
            {isScanning ? (
              <View>
                <ActivityIndicator color="white" />
                <Text style={styles.connectButtonText}>Connecting...</Text>
              </View>
            ) : (
              <Text style={styles.connectButtonText}>Connect to Boat (BLE)</Text>
            )}
          </TouchableOpacity>
          {isScanning && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                bleManager?.stopDeviceScan();
                setIsScanning(false);
                setScanRssi(null);
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.wifiCornerBtn} onPress={() => setWifiModalVisible(true)}>
            <Text style={styles.wifiCornerText}>WiFi</Text>
          </TouchableOpacity>
          <View style={styles.version}>
            <Text style={styles.versionText}>v{APP_VERSION}</Text>
          </View>
        </View>

        <Modal visible={wifiModalVisible} animationType="slide" transparent>
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.modalBackdrop}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Connect via WiFi</Text>
              <Text style={styles.modalHint}>
                Pico IP. Firmware should serve GET /api/pulses and GET /api/info (see main_wifi.py in the ballast repo).
              </Text>
              <TextInput
                style={styles.modalInput}
                value={wifiIpInput}
                onChangeText={setWifiIpInput}
                placeholder="192.168.x.x"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity style={styles.modalConnect} onPress={connectWifi}>
                <Text style={styles.modalConnectText}>Connect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setWifiModalVisible(false)}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  // SETTINGS
  if (currentScreen === 'settings') {
    const sig = getSignalQuality(signalStrength);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header} accessibilityRole="header">
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsScrollContent}>
          <Text style={styles.sectionTitle}>System</Text>
          <Text style={styles.settingsText}>App: v{APP_VERSION}</Text>
          <Text style={styles.settingsText}>Connection: {connectionMode === 'wifi' ? 'WiFi' : connectionMode === 'ble' ? 'Bluetooth' : '—'}</Text>
          <Text style={styles.settingsText}>
            Pico firmware:{' '}
            {settingsVersionLoading ? '…' : String(picoVersion ?? '').replace(/\0/g, '').trim() || '—'}
          </Text>
          <Text style={styles.settingsHint}>
            Same string the Pico exposes on the BLE firmware-revision characteristic and on Wi‑Fi GET /api/info (e.g.
            4-18-2026-v1.2).
          </Text>
          <Text style={styles.settingsText}>
            Signal:{' '}
            {connectionMode === 'wifi'
              ? 'N/A (WiFi)'
              : `${sig.bars} ${sig.text}${Number.isFinite(signalStrength) ? ` (${signalStrength} dBm)` : ''}`}
          </Text>
          {wifiBase ? <Text style={styles.settingsText}>WiFi IP: {wifiBase}</Text> : null}

          <Text style={styles.sectionTitle}>Units</Text>
          <View style={styles.segmentRow}>
            {['counter', 'gallons', 'pounds'].map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.segmentBtn, unitMode === m && styles.segmentBtnOn]}
                onPress={() => setUnitMode(m)}
              >
                <Text style={[styles.segmentBtnText, unitMode === m && styles.segmentBtnTextOn]}>
                  {m === 'counter' ? 'Counter' : m === 'gallons' ? 'Gallons' : 'Pounds'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Calibration</Text>
          <Text style={styles.inputLabel}>Pulses per gallon</Text>
          <TextInput
            style={styles.settingsInput}
            keyboardType="decimal-pad"
            value={String(pulsesPerGallon)}
            onChangeText={(t) => {
              const n = parseFloat(t);
              if (t === '' || Number.isFinite(n)) setPulsesPerGallon(t === '' ? pulsesPerGallon : n);
            }}
          />
          <Text style={styles.inputLabel}>Pounds per gallon (water density)</Text>
          <TextInput
            style={styles.settingsInput}
            keyboardType="decimal-pad"
            value={String(poundsPerGallon)}
            onChangeText={(t) => {
              const n = parseFloat(t);
              if (t === '' || Number.isFinite(n)) setPoundsPerGallon(t === '' ? poundsPerGallon : n);
            }}
          />

          <Text style={styles.sectionTitle}>Tank max (pulses)</Text>
          {TANK_NAMES.map((name) => (
            <View key={name} style={styles.tankMaxRow}>
              <Text style={styles.tankMaxLabel}>{name}</Text>
              <TextInput
                style={styles.tankMaxInput}
                keyboardType="number-pad"
                value={tankMaxDraft?.[name.toLowerCase()] ?? String(tankMaxValues[name.toLowerCase()] ?? '')}
                onChangeText={(t) => {
                  const key = name.toLowerCase();
                  if (/^\d*$/.test(t)) {
                    setTankMaxDraft((prev) => ({ ...(prev || {}), [key]: t }));
                  }
                }}
              />
            </View>
          ))}

          <TouchableOpacity style={styles.saveButton} onPress={saveSettingsToStorage}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Firmware (OTA)</Text>
          {otaProgress != null ? (
            <View style={styles.progressWrap}>
              <Text style={styles.settingsText}>Updating… {otaProgress}%</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${otaProgress}%` }]} />
              </View>
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.secondaryBtn, otaProgress != null && styles.secondaryBtnDisabled]}
            disabled={otaProgress != null}
            onPress={checkFirmwareUpdates}
          >
            <Text style={styles.secondaryBtnText}>Check for updates</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryBtn, otaProgress != null && styles.secondaryBtnDisabled]}
            disabled={otaProgress != null}
            onPress={openVersionDetails}
          >
            <Text style={styles.secondaryBtnText}>Compare file versions (GitHub)</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Connection</Text>
          <TouchableOpacity
            style={[styles.secondaryBtn, connectionMode !== 'ble' && styles.secondaryBtnDisabled]}
            disabled={connectionMode !== 'ble'}
            onPress={scheduleOneShotWifiBoot}
          >
            <Text style={styles.secondaryBtnText}>Reboot Pico to WiFi (one session)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryBtn, connectionMode !== 'wifi' && styles.secondaryBtnDisabled]}
            disabled={connectionMode !== 'wifi'}
            onPress={rebootToBleFromWifi}
          >
            <Text style={styles.secondaryBtnText}>Reboot Pico to Bluetooth (WiFi only)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeButton} onPress={() => setCurrentScreen('main')}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={versionDetailVisible} animationType="slide" transparent>
          <View style={styles.modalBackdrop}>
            <View style={styles.versionDetailCard}>
              <Text style={styles.modalTitle}>GitHub files vs device</Text>
              <Text style={styles.versionCompareSubtitle}>
                Pico: {String(picoVersion ?? '').replace(/\0/g, '').trim() || '(none yet)'} — ✓ same label as
                firmware_versions.json on GitHub main, ● different (e.g. 4-18 vs 4-19), — unknown. Dates in the hint
                are firmware labels, not file edit dates.
              </Text>
              <ScrollView style={styles.versionDetailScroll}>
                {versionDetailLoading ? (
                  <Text style={styles.versionDetailText}>Loading…</Text>
                ) : (
                  versionCompareRows.map((row, idx) => (
                    <View key={`${row.fn}-${idx}`} style={styles.versionCompareRow}>
                      <Text style={styles.versionCompareName} numberOfLines={1}>
                        {row.fn}
                      </Text>
                      <Text style={styles.versionCompareIcon} accessibilityLabel={row.status}>
                        {row.status === 'ok' ? '✓' : row.status === 'stale' ? '●' : '—'}
                      </Text>
                      <Text style={styles.versionCompareHint} numberOfLines={2}>
                        {row.hint}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setVersionDetailVisible(false)}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // MAIN
  const signal = getSignalQuality(signalStrength);
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ballast Monitor</Text>
        <Text style={styles.headerSignal}>
          {connectionMode === 'wifi'
            ? `WiFi • ${wifiPollError ? 'poll error' : 'connected'}`
            : `BLE • ${signal.text}${Number.isFinite(signalStrength) ? ` • ${signalStrength} dBm` : ''}`}
        </Text>
        {connectionMode === 'wifi' && wifiPollError ? (
          <Text style={styles.headerWarn}>{wifiPollError}</Text>
        ) : null}
      </View>

      <View style={styles.statusBar}>
        <View style={styles.fillDrainRow}>
          <TouchableOpacity
            style={[styles.toggleButton, isFillMode && styles.toggleActive]}
            onPress={() => applyMasterFillDrain(true)}
          >
            <Text style={[styles.toggleText, isFillMode && styles.toggleTextOn]}>Fill</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, !isFillMode && styles.toggleActive]}
            onPress={() => applyMasterFillDrain(false)}
          >
            <Text style={[styles.toggleText, !isFillMode && styles.toggleTextOn]}>Drain</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={styles.tankGrid}>
          {TANK_CONFIG.map((tank, tankIdx) => {
            const [pump1Idx, pump2Idx] = tank.pumps;
            const [color1, color2] = tank.color.split('/');
            const fillOn = tankFillModes[tank.name];
            const pumpAlert = pumpAlertTanks.has(tank.name);
            return (
              <View
                key={tankIdx}
                style={[styles.tankCard, pumpAlert && pumpAlertFlashOn && styles.tankCardPumpAlert]}
              >
                <View style={styles.tankTopToggle}>
                  <TouchableOpacity
                    style={[styles.miniToggle, fillOn && styles.miniToggleOn]}
                    onPress={() => setTankFillMode(tank.name, true)}
                  >
                    <Text style={[styles.miniToggleText, fillOn && styles.miniToggleTextOn]}>Fill</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.miniToggle, !fillOn && styles.miniToggleOn]}
                    onPress={() => setTankFillMode(tank.name, false)}
                  >
                    <Text style={[styles.miniToggleText, !fillOn && styles.miniToggleTextOn]}>Drain</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.tankTitleRow}>
                  <Text style={styles.tankName}>{tank.name}</Text>
                  <Text style={styles.tankPercent}>{getTankPercentDisplay(tank.name)}%</Text>
                </View>
                <View style={styles.pumpRow}>
                  <TouchableOpacity style={styles.pumpSemiReset} onPress={() => resetPump(pump1Idx)} accessibilityLabel="Reset top pump">
                    <Text style={styles.semiResetText}>↻</Text>
                  </TouchableOpacity>
                  <View style={styles.pumpMain}>
                    <Text style={styles.pumpLabel}>Top ({color1})</Text>
                    <Text style={styles.pumpValue}>
                      {formatPumpValue(pump1Idx, tank.name)} {getUnitLabel()}
                    </Text>
                  </View>
                </View>
                <View style={styles.pumpRow}>
                  <TouchableOpacity style={styles.pumpSemiReset} onPress={() => resetPump(pump2Idx)} accessibilityLabel="Reset bottom pump">
                    <Text style={styles.semiResetText}>↻</Text>
                  </TouchableOpacity>
                  <View style={styles.pumpMain}>
                    <Text style={styles.pumpLabel}>Btm ({color2})</Text>
                    <Text style={styles.pumpValue}>
                      {formatPumpValue(pump2Idx, tank.name)} {getUnitLabel()}
                    </Text>
                  </View>
                </View>
                <View style={styles.tankBottomRow}>
                  <TouchableOpacity style={styles.tankWideReset} onPress={() => resetTank(tank.name)} accessibilityLabel="Reset both pumps for this tank">
                    <Text style={styles.semiResetText}>↻ Tank</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.setFullBtn} onPress={() => setTankFull(tank.name)}>
                    <Text style={styles.setFullBtnText}>Set Full</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{isFillMode ? 'Total Water' : 'Remaining (all tanks)'}</Text>
          <Text style={styles.totalValue}>
            {formatTotalValue()} {getUnitLabel()}
          </Text>
        </View>
        <TouchableOpacity style={styles.resetAllBottom} onPress={resetAll}>
          <Text style={styles.resetAllBottomText}>Reset All</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setCurrentScreen('settings')}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={28} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={disconnect}
          accessibilityLabel="Disconnect"
        >
          <Ionicons name="exit-outline" size={40} color="#C62828" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { backgroundColor: '#4CAF50', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16, alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 20, ...FW500 },
  headerSignal: { color: 'rgba(255,255,255,0.9)', fontSize: 11, marginTop: 4 },
  headerWarn: { color: '#FFEB3B', fontSize: 10, marginTop: 4, textAlign: 'center' },
  connectScreen: { flex: 1, padding: 24 },
  photoCircle: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#4CAF50', alignSelf: 'center', marginVertical: 20, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  deviceCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  deviceText: { fontSize: 14, paddingVertical: 4 },
  connectButton: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  connectButtonText: { color: 'white', fontSize: 18, ...FW500 },
  cancelButton: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  cancelButtonText: { fontSize: 14 },
  wifiCornerBtn: { position: 'absolute', left: 16, bottom: 48, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#E8F5E9', borderRadius: 8, borderWidth: 1, borderColor: '#4CAF50' },
  wifiCornerText: { color: '#2E7D32', ...FW600 },
  version: { position: 'absolute', bottom: 16, right: 16 },
  versionText: { fontSize: 11, color: '#999' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, marginBottom: 8, ...FW600 },
  modalHint: { fontSize: 12, color: '#666', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  modalConnect: { backgroundColor: '#4CAF50', padding: 14, borderRadius: 8, alignItems: 'center' },
  modalConnectText: { color: '#fff', ...FW600 },
  modalCancel: { padding: 12, alignItems: 'center' },
  modalCancelText: { color: '#666' },
  statusBar: { backgroundColor: '#f5f5f5', paddingVertical: 14, paddingHorizontal: 12 },
  fillDrainRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  toggleButton: { paddingVertical: 10, paddingHorizontal: 28, backgroundColor: 'white', borderWidth: 2, borderColor: '#c8e6c9', marginHorizontal: 6, borderRadius: 10 },
  toggleActive: { backgroundColor: '#4CAF50', borderColor: '#2E7D32' },
  toggleText: { fontSize: 15, color: '#555', ...FW600 },
  toggleTextOn: { color: '#fff' },
  scrollView: { flex: 1 },
  tankGrid: { padding: 12, flexDirection: 'row', flexWrap: 'wrap' },
  tankCard: { width: '48%', backgroundColor: '#f5f5f5', borderRadius: 12, padding: 10, margin: '1%' },
  tankCardPumpAlert: { backgroundColor: '#FFE0B2', borderWidth: 2, borderColor: '#FF9800' },
  pumpAlertBanner: {
    fontSize: 10,
    color: '#E65100',
    marginBottom: 6,
    textAlign: 'center',
    ...FW600,
  },
  tankTopToggle: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  miniToggle: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', marginHorizontal: 3, borderRadius: 6 },
  miniToggleOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  miniToggleText: { fontSize: 11, color: '#666' },
  miniToggleTextOn: { color: '#fff', ...FW600 },
  tankTitleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  tankName: { fontSize: 15, ...FW600 },
  tankPercent: { fontSize: 13, color: '#666' },
  pumpRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  pumpSemiReset: {
    width: 36,
    minHeight: 48,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#EEEEEE',
    borderWidth: 1,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  pumpMain: { flex: 1, backgroundColor: 'white', borderRadius: 8, padding: 8 },
  pumpLabel: { fontSize: 11, color: '#666' },
  pumpValue: { fontSize: 16, color: '#4CAF50', marginTop: 4, ...FW500 },
  tankBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 },
  tankWideReset: {
    flex: 1,
    marginRight: 8,
    height: 28,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: '#EEEEEE',
    borderWidth: 1,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  semiResetText: { fontSize: 14, color: '#666' },
  setFullBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  setFullBtnText: { fontSize: 11, color: '#333' },
  totalCard: { margin: 12, backgroundColor: '#E3F2FD', borderRadius: 12, padding: 16, alignItems: 'center' },
  totalLabel: { fontSize: 13, color: '#1976D2', marginBottom: 4 },
  totalValue: { fontSize: 28, color: '#1565C0', ...FW500 },
  resetAllBottom: { alignSelf: 'center', marginBottom: 20, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fafafa' },
  resetAllBottomText: { fontSize: 12, color: '#777' },
  bottomBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  settingsButton: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: 'white', justifyContent: 'center', alignItems: 'center' },
  disconnectButton: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center' },
  settingsScroll: { flex: 1 },
  settingsScrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, marginTop: 16, marginBottom: 8, color: '#333', ...FW600 },
  settingsText: { fontSize: 14, marginBottom: 6, color: '#444' },
  settingsHint: { fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 15 },
  settingsInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 16 },
  inputLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap' },
  segmentBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', marginRight: 8, marginBottom: 8 },
  segmentBtnOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  segmentBtnText: { fontSize: 13, color: '#555' },
  segmentBtnTextOn: { color: '#fff', ...FW600 },
  tankMaxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tankMaxLabel: { width: 100, fontSize: 14 },
  tankMaxInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, fontSize: 15 },
  secondaryBtn: { marginTop: 8, padding: 12, backgroundColor: '#E3F2FD', borderRadius: 8, alignItems: 'center' },
  secondaryBtnDisabled: { opacity: 0.45 },
  secondaryBtnText: { color: '#1565C0', ...FW600 },
  helpText: { fontSize: 13, color: '#666', marginBottom: 10, lineHeight: 18 },
  progressWrap: { marginVertical: 8 },
  progressBar: { height: 8, backgroundColor: '#eee', borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 8, backgroundColor: '#4CAF50' },
  saveButton: { backgroundColor: '#1565C0', padding: 16, borderRadius: 12, marginTop: 20, alignItems: 'center' },
  saveButtonText: { color: 'white', fontSize: 16, ...FW600 },
  closeButton: { backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, marginTop: 12, alignItems: 'center' },
  closeButtonText: { color: 'white', fontSize: 16, ...FW500 },
  versionDetailCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '85%', width: '100%' },
  versionCompareSubtitle: { fontSize: 11, color: '#666', marginBottom: 10, lineHeight: 15 },
  versionDetailScroll: { maxHeight: 380 },
  versionDetailText: { fontSize: 11, color: '#333' },
  versionCompareRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  versionCompareName: { flex: 1, minWidth: '40%', fontSize: 12, ...FW600, color: '#1565C0' },
  versionCompareIcon: { fontSize: 16, width: 28, textAlign: 'center', color: '#333' },
  versionCompareHint: { flexBasis: '100%', fontSize: 10, color: '#666', marginTop: 4 },
});
