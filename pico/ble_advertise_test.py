"""
Standalone BLE advertise test for Raspberry Pi Pico W.
Copy to the Pico and Run in Thonny (do not need main.py / flow_meters).

Expected serial output:
  WiFi STA disabled...
  BLE active OK
  Advertising - check LightBlue for 'Ballast Monitor'

Then open LightBlue on your phone within 10 s.
If this script works but main.py does not, the full app loop or old ble_advertising.py is the issue.
If this script fails, suspect board power, Pico W (not Pico), or hard power-cycle (unplug 10s).
"""

import time
import struct
import bluetooth


def ensure_wifi_off():
    import network

    for label, iface in (("STA", network.STA_IF), ("AP", network.AP_IF)):
        try:
            wlan = network.WLAN(iface)
            if wlan.active():
                wlan.active(False)
                print("WiFi {} off".format(label))
        except Exception as e:
            print("WiFi {}: {}".format(label, e))


def advertising_payload(limited_disc=False, br_edr=False, name=None, services=None):
    payload = bytearray()

    def _append(adv_type, value):
        nonlocal payload
        payload += struct.pack("BB", len(value) + 1, adv_type) + value

    _append(0x01, struct.pack("B", (0x01 if limited_disc else 0x02) + (0x00 if br_edr else 0x04)))
    if name:
        _append(0x09, name.encode())
    if services:
        for uuid in services:
            b = bytes(uuid)
            if len(b) == 2:
                _append(0x03, b)
    if len(payload) > 31:
        raise ValueError("payload {} > 31".format(len(payload)))
    return payload


NAME = "Ballast Monitor"
SERVICE = bluetooth.UUID(0x181A)

print("=== BLE advertise test (Pico W) ===")
ensure_wifi_off()

ble = bluetooth.BLE()
try:
    ble.active(True)
except Exception as e:
    print("ERROR ble.active:", e)
    raise SystemExit

if not ble.active():
    print("ERROR: ble.active() is False after activate")
    raise SystemExit
print("BLE active OK")

try:
    adv_data = advertising_payload(limited_disc=True, services=[SERVICE])
    resp_data = advertising_payload(name=NAME)
except ValueError as e:
    print("ERROR payload:", e)
    raise SystemExit

print("adv_data", len(adv_data), "bytes:", adv_data.hex())
print("resp_data", len(resp_data), "bytes:", resp_data.hex())

try:
    ble.gap_advertise(500_000, adv_data=adv_data, resp_data=resp_data, connectable=True)
except OSError as e:
    print("ERROR gap_advertise:", e)
    raise SystemExit

print("Advertising '{}' — open LightBlue now (30 s)".format(NAME))
for i in range(30, 0, -1):
    print(" ", i, "s left")
    time.sleep(1)
print("Done. Stop script or unplug to end advertising.")
