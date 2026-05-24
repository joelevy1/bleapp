# Replace the BLE block in main.py (elif config.MODE == "ble":) with this pattern.
# Also copy ble_advertising.py and ble_service.py from this pico/ folder to the Pico.

import bluetooth
from ble_service import BLEService
from ble_advertising import BLEAdvertising, ensure_wifi_off
from flow_meters import FlowMeters
import time

print("Starting BLE mode...")
ensure_wifi_off()

print("Initializing flow meters...")
flow_meters = FlowMeters(config.FLOW_METER_PINS)

print("Starting BLE service...")
ble = bluetooth.BLE()
ble.active(True)
if not ble.active():
    print("ERROR: BLE failed to activate — try unplugging USB 10s (hard reset)")
else:
    ble_service = BLEService(ble, flow_meters, config.VERSION)
    advertising = BLEAdvertising(ble, config.BLE_DEVICE_NAME)
    ble_service.set_advertising(advertising)
    if not advertising.start_advertising(services=[bluetooth.UUID(0x181A)]):
        print("ERROR: advertising did not start")

    print("System ready!")
    print("Connect with BLE app")
    print("Device name: {}".format(config.BLE_DEVICE_NAME))
    print("=" * 50)

    while True:
        ble_service.update_flow_values()
        time.sleep_ms(100)
