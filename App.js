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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import Svg, { Polygon } from 'react-native-svg';
import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { useWatchSync } from './watchSync';

global.Buffer = Buffer;

const DEVICE_NAME = 'Ballast Monitor';
const SERVICE_UUID = '0000181a-0000-1000-8000-00805f9b34fb';
const FLOW_CHAR_UUID = '00002a6e-0000-1000-8000-00805f9b34fb';
const CONTROL_CHAR_UUID = '00002a6f-0000-1000-8000-00805f9b34fb';
const VERSION_CHAR_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const FILE_TRANSFER_UUID = '00002a6d-0000-1000-8000-00805f9b34fb';
const FILE_CONTROL_UUID = '00002a6c-0000-1000-8000-00805f9b34fb';

const GITHUB_COMMITS_URL = 'https://api.github.com/repos/joelevy1/ballast/commits/main';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/joelevy1/ballast/main';
const OTA_FILES = ['main.py', 'ble_service.py', 'config.py', 'flow_meters.py', 'ble_advertising.py'];

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

function normalizeWifiBase(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  return s.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function StopSignOctagon({ size = 48 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const pts = [];
  for (let i = 0; i < 8; i += 1) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return (
    <View
      style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}
      accessibilityLabel="Disconnect"
      accessibilityRole="button"
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Polygon points={pts.join(' ')} fill="#D32F2F" stroke="#B71C1C" strokeWidth={1} />
      </Svg>
      <Text style={{ fontSize: size * 0.2, fontWeight: '900', color: '#FFEBEE' }}>STOP</Text>
    </View>
  );
}

export default function App() {
  const [bleManager] = useState(() => new BleManager());
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
  const [picoVersion, setPicoVersion] = useState('Unknown');
  const [signalStrength, setSignalStrength] = useState(null);
  const [tankMaxValues, setTankMaxValues] = useState({
    port: 10000,
    starboard: 10000,
    mid: 10000,
    forward: 5000,
  });
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
  const [versionDetailBody, setVersionDetailBody] = useState('');

  const wifiPollRef = useRef(null);

  const TANK_CONFIG = [
    { name: 'Port', pumps: [1, 2], color: 'White/Green' },
    { name: 'Starboard', pumps: [0, 3], color: 'White/Green' },
    { name: 'Mid', pumps: [4, 5], color: 'Blue/Blue' },
    { name: 'Forward', pumps: [6, 7], color: 'Yellow/Yellow' },
  ];

  useEffect(() => {
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
          if (o && typeof o === 'object') {
            setTankMaxValues((prev) => ({ ...prev, ...o }));
          }
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

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

  const saveSettingsToStorage = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE.UNIT_MODE, unitMode);
      await AsyncStorage.setItem(STORAGE.PULSES_PER_GAL, String(pulsesPerGallon));
      await AsyncStorage.setItem(STORAGE.POUNDS_PER_GAL, String(poundsPerGallon));
      await AsyncStorage.setItem(STORAGE.TANK_MAX, JSON.stringify(tankMaxValues));
      Alert.alert('Saved', 'Settings were saved to this phone.');
    } catch (e) {
      Alert.alert('Save failed', String(e.message || e));
    }
  }, [unitMode, pulsesPerGallon, poundsPerGallon, tankMaxValues]);

  useEffect(() => {
    if (connectionMode !== 'ble' || !device || !isConnected) return undefined;
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
        const res = await fetch(`${base}/api/pulses`, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const arr = data.pulses || data.values || data;
        if (!Array.isArray(arr) || arr.length < 8) throw new Error('Bad JSON');
        setFlowValues(arr.slice(0, 8).map((n) => Number(n) || 0));
        setWifiPollError(null);
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
    if (currentScreen !== 'settings' || connectionMode !== 'ble' || !device) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const versionChar = await device.readCharacteristicForService(SERVICE_UUID, VERSION_CHAR_UUID);
        if (cancelled || !versionChar?.value) return;
        const v = Buffer.from(versionChar.value, 'base64').toString('utf-8').replace(/\0/g, '').trim();
        if (v) setPicoVersion(v);
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentScreen, connectionMode, device]);

  const getSignalQuality = (rssi) => {
    if (!Number.isFinite(rssi)) return { bars: '○○○○○', text: 'No Signal' };
    if (rssi >= -50) return { bars: '●●●●●', text: 'Excellent' };
    if (rssi >= -60) return { bars: '●●●●○', text: 'Good' };
    if (rssi >= -70) return { bars: '●●●○○', text: 'Fair' };
    if (rssi >= -80) return { bars: '●●○○○', text: 'Weak' };
    return { bars: '●○○○○', text: 'Poor' };
  };

  const scanAndConnect = async () => {
    setIsScanning(true);
    try {
      const subscription = bleManager.onStateChange((state) => {
        if (state === 'PoweredOn') {
          subscription.remove();
          startScan();
        } else if (state === 'Unsupported' || state === 'Unauthorized') {
          subscription.remove();
          setIsScanning(false);
          Alert.alert('Bluetooth Error', 'Bluetooth is not available');
        }
      }, true);
      setTimeout(() => {
        subscription.remove();
        setIsScanning((s) => {
          if (s) {
            Alert.alert('Timeout', 'Bluetooth initialization timed out');
            return false;
          }
          return s;
        });
      }, 5000);
    } catch (error) {
      setIsScanning(false);
      Alert.alert('Error', `Failed to scan: ${error.message}`);
    }
  };

  const startScan = () => {
    setScanRssi(null);
    let found = false;
    bleManager.startDeviceScan(null, { allowDuplicates: true }, (error, dev) => {
      if (error) {
        bleManager.stopDeviceScan();
        setIsScanning(false);
        Alert.alert('Scan Error', error.message);
        return;
      }
      if (dev.name === DEVICE_NAME) {
        setScannedDevice(dev);
        if (Number.isFinite(dev.rssi)) setScanRssi(dev.rssi);
        if (!found) {
          found = true;
          bleManager.stopDeviceScan();
          connectToDevice(dev);
        }
      }
    });
    setTimeout(() => {
      if (!found) {
        bleManager.stopDeviceScan();
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
        const versionChar = await connectedDevice.readCharacteristicForService(
          SERVICE_UUID,
          VERSION_CHAR_UUID,
        );
        if (versionChar?.value) {
          const version = Buffer.from(versionChar.value, 'base64').toString('utf-8').replace(/\0/g, '').trim();
          if (version) setPicoVersion(version);
        }
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
      const infoRes = await fetch(`http://${base}/api/info`, { method: 'GET' });
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
        const res = await fetch(url, { method: 'GET' });
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
      setPicoVersion(versionLabel || `WiFi @ ${base}`);
      setIsConnected(true);
      setWifiModalVisible(false);
      setCurrentScreen('main');
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
    const pulses = flowValues[pumpIdx];
    const maxP = tankMaxValues[tankName.toLowerCase()];
    const totalTank = getTankTotalPulses(tankName);
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
    return convertValue(displayPulses);
  };

  const formatTotalValue = () => {
    const totalPulses = flowValues.reduce((a, b) => a + b, 0);
    const totalMax = TANK_NAMES.reduce((s, n) => s + (tankMaxValues[n.toLowerCase()] || 0), 0);
    if (isFillMode) {
      return convertValue(totalPulses);
    }
    return convertValue(Math.max(0, totalMax - totalPulses));
  };

  const convertValue = (pulses) => {
    if (unitMode === 'counter') return pulses;
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
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body || '',
    });
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
    const res = await fetch(GITHUB_COMMITS_URL);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  };

  const fetchGithubRawFile = async (name) => {
    const res = await fetch(`${GITHUB_RAW_BASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.text();
  };

  const bleTransferFile = async (filename, content) => {
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
    // Default BLE ATT payload is ~20 bytes; large writes get truncated/corrupted on iOS/Central.
    const chunkSize = 20;
    for (let off = 0; off < buf.length; off += chunkSize) {
      const chunk = buf.slice(off, off + chunkSize);
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_TRANSFER_UUID,
        chunk.toString('base64'),
      );
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
    setOtaProgress(0);
    try {
      for (let i = 0; i < OTA_FILES.length; i += 1) {
        const fn = OTA_FILES[i];
        setOtaProgress(Math.round(((i + 0.1) / OTA_FILES.length) * 100));
        const text = await fetchGithubRawFile(fn);
        await bleTransferFile(fn, text);
        setOtaProgress(Math.round(((i + 1) / OTA_FILES.length) * 100));
      }
      try {
        await bleSendReboot();
      } catch (e) {
        // Pico may already reboot from last file save
      }
      Alert.alert('OTA', 'All files transferred. Pico should reboot (cmd 0x03).');
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
    setOtaProgress(1);
    try {
      const files = OTA_FILES.join(',');
      const res = await wifiPostForm('/install_updates', `files=${encodeURIComponent(files)}`);
      setOtaProgress(100);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Alert.alert('OTA', 'Install started; Pico will reboot shortly.');
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
              setWifiModalVisible(true);
              Alert.alert(
                'WiFi',
                'When the Pico is on WiFi, enter its IP in the dialog (or check Pushover / ntfy / router for Ballast-Monitor). GET /api/info on the Pico shows version and IP.',
              );
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
              Alert.alert('Pico', 'Rebooting to BLE. Use Connect to Boat on the home screen.');
              disconnect();
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
    setVersionDetailBody('Loading…');
    try {
      const blocks = [];
      for (let i = 0; i < OTA_FILES.length; i += 1) {
        const fn = OTA_FILES[i];
        const text = await fetchGithubRawFile(fn);
        const head = text.split('\n').slice(0, 8).join('\n');
        blocks.push(`${fn}:\n${head}`);
      }
      const local = String(picoVersion || '').trim();
      setVersionDetailBody(
        `Device reported: ${local || 'Unknown'}\n\nGitHub main (first lines per file):\n\n${blocks.join('\n\n')}`,
      );
    } catch (e) {
      setVersionDetailBody(String(e.message || e));
    }
  };

  const checkFirmwareUpdates = async () => {
    try {
      const commit = await fetchGithubLatestCommit();
      const sha = commit.sha?.slice(0, 7) || '?';
      const msg = commit.commit?.message?.split('\n')[0] || '';
      const remoteHint = `${sha} ${msg}`;
      const local = String(picoVersion || '').replace(/\0/g, '').trim() || 'Unknown';
      const needs = local !== 'Unknown' && !local.includes(sha);
      Alert.alert(
        'Firmware',
        `Device: ${local}\nGitHub main: ${remoteHint}\n\n${needs ? 'Commit SHA is not in the device string — an update may be available.' : 'Use Settings > Compare file versions (GitHub) to see file headers, or Apply to reinstall.'}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Apply update',
            onPress: () => {
              if (connectionMode === 'ble') runFirmwareUpdateBle();
              else if (connectionMode === 'wifi') runFirmwareUpdateWifi();
              else Alert.alert('Firmware', 'Connect via BLE or WiFi first.');
            },
          },
        ],
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
  });

  // HOME (not connected)
  if (currentScreen === 'home' && !isConnected) {
    const homeRssi = Number.isFinite(scanRssi) ? scanRssi : signalStrength;
    const signal = getSignalQuality(homeRssi);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🚤 Ballast Monitor</Text>
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
                bleManager.stopDeviceScan();
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
          <Text style={styles.headerTitle}>⚙️ Settings</Text>
        </View>
        <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsScrollContent}>
          <Text style={styles.sectionTitle}>System</Text>
          <Text style={styles.settingsText}>App: v{APP_VERSION}</Text>
          <Text style={styles.settingsText}>Connection: {connectionMode === 'wifi' ? 'WiFi' : connectionMode === 'ble' ? 'Bluetooth' : '—'}</Text>
          <Text style={styles.settingsText}>
            Pico: {String(picoVersion ?? '').replace(/\0/g, '').trim() || 'Unknown'}
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
                value={String(tankMaxValues[name.toLowerCase()] ?? '')}
                onChangeText={(t) => {
                  const n = parseInt(t, 10);
                  if (t === '' || Number.isFinite(n)) {
                    setTankMaxValues((prev) => ({ ...prev, [name.toLowerCase()]: t === '' ? prev[name.toLowerCase()] : n }));
                  }
                }}
              />
            </View>
          ))}

          <Text style={styles.sectionTitle}>Firmware (OTA)</Text>
          {otaProgress != null ? (
            <View style={styles.progressWrap}>
              <Text style={styles.settingsText}>Updating… {otaProgress}%</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${otaProgress}%` }]} />
              </View>
            </View>
          ) : null}
          <TouchableOpacity style={styles.secondaryBtn} onPress={checkFirmwareUpdates}>
            <Text style={styles.secondaryBtnText}>Check for updates</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={openVersionDetails}>
            <Text style={styles.secondaryBtnText}>Compare file versions (GitHub)</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Notifications</Text>
          <Text style={styles.helpText}>
            This app does not send push alerts itself. On the Pico, optional WiFi startup notifications: set PUSHOVER_USER_KEY
            and PUSHOVER_APP_TOKEN in config (Pushover iOS app), and/or NTFY_TOPIC (ntfy app). The Pico also requests the DHCP
            name Ballast-Monitor so your router may show it by that name.
          </Text>

          <Text style={styles.sectionTitle}>Connection</Text>
          <Text style={styles.helpText}>
            Normal use is Bluetooth. One-shot WiFi runs the web UI for this session only; after a full power cycle the Pico
            returns to BLE. Use “Reboot to BLE” while on WiFi to return to Bluetooth without pulling power.
          </Text>
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

          <TouchableOpacity style={styles.saveButton} onPress={saveSettingsToStorage}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeButton} onPress={() => setCurrentScreen('main')}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={versionDetailVisible} animationType="slide" transparent>
          <View style={styles.modalBackdrop}>
            <View style={styles.versionDetailCard}>
              <Text style={styles.modalTitle}>Version comparison</Text>
              <ScrollView style={styles.versionDetailScroll}>
                <Text style={styles.versionDetailText}>{versionDetailBody}</Text>
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
        <Text style={styles.headerTitle}>🚤 Ballast Monitor</Text>
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
            return (
              <View key={tankIdx} style={styles.tankCard}>
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
        <TouchableOpacity style={styles.settingsButton} onPress={() => setCurrentScreen('settings')}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
          <StopSignOctagon size={48} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { backgroundColor: '#4CAF50', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16, alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: '500' },
  headerSignal: { color: 'rgba(255,255,255,0.9)', fontSize: 11, marginTop: 4 },
  headerWarn: { color: '#FFEB3B', fontSize: 10, marginTop: 4, textAlign: 'center' },
  connectScreen: { flex: 1, padding: 24 },
  photoCircle: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#4CAF50', alignSelf: 'center', marginVertical: 20, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  deviceCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  deviceText: { fontSize: 14, paddingVertical: 4 },
  connectButton: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  connectButtonText: { color: 'white', fontSize: 18, fontWeight: '500' },
  cancelButton: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  cancelButtonText: { fontSize: 14 },
  wifiCornerBtn: { position: 'absolute', left: 16, bottom: 48, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#E8F5E9', borderRadius: 8, borderWidth: 1, borderColor: '#4CAF50' },
  wifiCornerText: { color: '#2E7D32', fontWeight: '600' },
  version: { position: 'absolute', bottom: 16, right: 16 },
  versionText: { fontSize: 11, color: '#999' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  modalHint: { fontSize: 12, color: '#666', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  modalConnect: { backgroundColor: '#4CAF50', padding: 14, borderRadius: 8, alignItems: 'center' },
  modalConnectText: { color: '#fff', fontWeight: '600' },
  modalCancel: { padding: 12, alignItems: 'center' },
  modalCancelText: { color: '#666' },
  statusBar: { backgroundColor: '#f5f5f5', paddingVertical: 14, paddingHorizontal: 12 },
  fillDrainRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  toggleButton: { paddingVertical: 10, paddingHorizontal: 28, backgroundColor: 'white', borderWidth: 2, borderColor: '#c8e6c9', marginHorizontal: 6, borderRadius: 10 },
  toggleActive: { backgroundColor: '#4CAF50', borderColor: '#2E7D32' },
  toggleText: { fontSize: 15, fontWeight: '600', color: '#555' },
  toggleTextOn: { color: '#fff' },
  scrollView: { flex: 1 },
  tankGrid: { padding: 12, flexDirection: 'row', flexWrap: 'wrap' },
  tankCard: { width: '48%', backgroundColor: '#f5f5f5', borderRadius: 12, padding: 10, margin: '1%' },
  tankTopToggle: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  miniToggle: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', marginHorizontal: 3, borderRadius: 6 },
  miniToggleOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  miniToggleText: { fontSize: 11, color: '#666' },
  miniToggleTextOn: { color: '#fff', fontWeight: '600' },
  tankTitleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  tankName: { fontSize: 15, fontWeight: '600' },
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
  pumpValue: { fontSize: 16, fontWeight: '500', color: '#4CAF50', marginTop: 4 },
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
  totalValue: { fontSize: 28, fontWeight: '500', color: '#1565C0' },
  resetAllBottom: { alignSelf: 'center', marginBottom: 20, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fafafa' },
  resetAllBottomText: { fontSize: 12, color: '#777' },
  bottomBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  settingsButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: 'white', justifyContent: 'center', alignItems: 'center' },
  settingsIcon: { fontSize: 20 },
  disconnectButton: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center' },
  settingsScroll: { flex: 1 },
  settingsScrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8, color: '#333' },
  settingsText: { fontSize: 14, marginBottom: 6, color: '#444' },
  settingsInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 16 },
  inputLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap' },
  segmentBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', marginRight: 8, marginBottom: 8 },
  segmentBtnOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  segmentBtnText: { fontSize: 13, color: '#555' },
  segmentBtnTextOn: { color: '#fff', fontWeight: '600' },
  tankMaxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tankMaxLabel: { width: 100, fontSize: 14 },
  tankMaxInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, fontSize: 15 },
  secondaryBtn: { marginTop: 8, padding: 12, backgroundColor: '#E3F2FD', borderRadius: 8, alignItems: 'center' },
  secondaryBtnDisabled: { opacity: 0.45 },
  secondaryBtnText: { color: '#1565C0', fontWeight: '600' },
  helpText: { fontSize: 13, color: '#666', marginBottom: 10, lineHeight: 18 },
  progressWrap: { marginVertical: 8 },
  progressBar: { height: 8, backgroundColor: '#eee', borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 8, backgroundColor: '#4CAF50' },
  saveButton: { backgroundColor: '#1565C0', padding: 16, borderRadius: 12, marginTop: 20, alignItems: 'center' },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  closeButton: { backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, marginTop: 12, alignItems: 'center' },
  closeButtonText: { color: 'white', fontSize: 16, fontWeight: '500' },
  versionDetailCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '80%', width: '100%' },
  versionDetailScroll: { maxHeight: 400 },
  versionDetailText: { fontSize: 11, color: '#333' },
});
