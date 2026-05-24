"""
Ballast Monitor - Main Entry Point
Version: 4-23-2026-v1.4
Routes to WiFi or BLE mode based on config
"""

# One-shot WiFi session: BLE command 0x04 creates wifi_once.flag then reboots.
# Next boot runs main_wifi once; flag is removed so following boots use config.MODE (default "ble").
try:
    import os

    if "wifi_once.flag" in os.listdir():
        with open("wifi_once.flag", "r") as _wf:
            if _wf.read().strip() == "1":
                try:
                    os.remove("wifi_once.flag")
                except OSError:
                    pass
                print("One-shot WiFi boot (wifi_once.flag)")
                import main_wifi

                main_wifi.run()
except Exception as _e:
    print("wifi_once check:", _e)

import config

print("Ballast Monitor v{}".format(config.VERSION))
print("=" * 50)
print("Mode: {}".format(config.MODE.upper()))

print("File Versions:")
for fname in [
    "ble_service.py",
    "main.py",
    "main_wifi.py",
    "config.py",
    "ble_advertising.py",
    "flow_meters.py",
]:
    try:
        v = config.read_py_file_version(fname)
        print("  {}: {}".format(fname, v))
    except Exception:
        print("  {}: Not found".format(fname))

print("=" * 50)

if config.MODE == "wifi":
    import main_wifi

    main_wifi.run()

elif config.MODE == "ble":
    import bluetooth
    import time

    from ble_advertising import BLEAdvertising, ensure_wifi_off
    from ble_service import BLEService
    from flow_meters import FlowMeters

    print("Starting BLE mode...")
    ensure_wifi_off()

    print("Initializing flow meters...")
    flow_meters = FlowMeters(config.FLOW_METER_PINS)

    print("Starting BLE service...")
    ble = bluetooth.BLE()
    ble.active(True)

    if not ble.active():
        print("ERROR: BLE failed to activate - unplug USB 10s (hard reset) and try again")
    else:
        ble_service = BLEService(ble, flow_meters, config.VERSION)
        advertising = BLEAdvertising(ble, config.BLE_DEVICE_NAME)
        ble_service.set_advertising(advertising)

        if not advertising.start_advertising(services=[bluetooth.UUID(0x181A)]):
            print("ERROR: advertising did not start")
        else:
            print("System ready!")
            print("Connect with BLE app")
            print("Device name: {}".format(config.BLE_DEVICE_NAME))
            print("=" * 50)

            while True:
                ble_service.update_flow_values()
                time.sleep_ms(100)

else:
    print("Unknown mode: {}".format(config.MODE))
