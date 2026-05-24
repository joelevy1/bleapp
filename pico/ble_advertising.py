"""
BLE advertising for Ballast Monitor (Pico W).
Version: 4-23-2026-v1.4

- Turns off WiFi before BLE (Pico W shares the radio).
- Puts service UUID in adv packet, device name in scan response (iOS-friendly).
- Validates payload length and gap_advertise errors.
"""

import bluetooth
import struct

MODULE_VERSION = "4-23-2026-v1.4"


def ensure_wifi_off():
    """Pico W: CYW43439 cannot reliably advertise while WiFi STA/AP is active."""
    import network

    for label, iface in (("STA", network.STA_IF), ("AP", network.AP_IF)):
        try:
            wlan = network.WLAN(iface)
            if wlan.active():
                wlan.active(False)
                print(f"WiFi {label} disabled for BLE")
        except Exception as e:
            print(f"WiFi {label} off: {e}")


def advertising_payload(limited_disc=False, br_edr=False, name=None, services=None, appearance=0):
    """Build one AD packet (max 31 bytes). Raises ValueError if too long."""
    payload = bytearray()

    def _append(adv_type, value):
        nonlocal payload
        payload += struct.pack("BB", len(value) + 1, adv_type) + value

    _append(0x01, struct.pack("B", (0x01 if limited_disc else 0x02) + (0x00 if br_edr else 0x04)))

    if name:
        # 0x09 = Complete Local Name (0x08 = Short Name if you need to save bytes)
        _append(0x09, name.encode())

    if services:
        for uuid in services:
            b = bytes(uuid)
            if len(b) == 2:
                _append(0x03, b)
            elif len(b) == 4:
                _append(0x05, b)
            elif len(b) == 16:
                _append(0x07, b)

    if appearance:
        _append(0x19, struct.pack("<H", appearance))

    if len(payload) > 31:
        raise ValueError("adv payload {} bytes > 31".format(len(payload)))
    return payload


class BLEAdvertising:
    def __init__(self, ble, name="Ballast Monitor"):
        self._ble = ble
        self._name = name
        self._services = None
        self._interval_us = 500_000
        self._advertising = False

    def start_advertising(self, services=None, interval_us=None):
        """Start connectable advertising. Returns True on success."""
        if interval_us is not None:
            self._interval_us = interval_us
        self._services = services

        if not self._ble.active():
            self._ble.active(True)
        if not self._ble.active():
            print("ERROR: BLE radio did not activate (ble.active() is False)")
            return False

        # Adv: flags + service UUID. Name in scan response (common MicroPython pattern).
        try:
            adv_data = advertising_payload(limited_disc=True, br_edr=False, services=services)
            resp_data = advertising_payload(name=self._name)
        except ValueError as e:
            print("ERROR: advertising payload:", e)
            return False

        try:
            self._ble.gap_advertise(
                self._interval_us,
                adv_data=adv_data,
                resp_data=resp_data,
                connectable=True,
            )
        except OSError as e:
            print("ERROR: gap_advertise failed:", e)
            self._advertising = False
            return False

        self._advertising = True
        print("BLE advertising as '{}'".format(self._name))
        print("BLE adv {} B, scan resp {} B, interval {} us".format(
            len(adv_data), len(resp_data), self._interval_us))
        print("BLE advertising started ({})".format(MODULE_VERSION))
        return True

    def restart_advertising(self):
        """Call after central disconnect — advertising stops while connected."""
        if self._services is None:
            return self.start_advertising()
        return self.start_advertising(services=self._services)

    def stop_advertising(self):
        try:
            self._ble.gap_advertise(None)
        except OSError as e:
            print("gap_advertise(stop) warning:", e)
        self._advertising = False
        print("BLE advertising stopped")

    @property
    def is_advertising(self):
        return self._advertising
