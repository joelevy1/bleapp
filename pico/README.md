# Pico W BLE fixes (copy to your board)

Your Thonny log can say **advertising started** while the phone sees nothing. On **Pico W**, BLE and WiFi share one radio — WiFi must be off, and iOS scanners work better when the **name is in the scan response**.

## Quick test (do this first)

1. Copy **`ble_advertise_test.py`** to the Pico (Thonny → Save as → `ble_advertise_test.py` on device).
2. **Unplug USB 10 seconds**, plug back in (hard reset — not only soft reboot).
3. Open the file → **Run** (do not run full `main.py` yet).
4. Open **LightBlue** within 10 s — look for **Ballast Monitor** or a strong unnamed device (tap it → Local Name).

| Result | Next step |
|--------|-----------|
| Shows in LightBlue | Copy updated **`ble_advertising.py`** + **`ble_service.py`**, update `main.py` per **`main_ble_snippet.py`**, reboot |
| Serial `ERROR gap_advertise` | Paste error here |
| No device in LightBlue | Power/USB, confirm **Pico W**, try another phone |

## Full firmware update

Copy to the Pico (overwrite):

- `ble_advertising.py` (v1.4)
- `ble_service.py` (v1.4)

In `main.py` BLE section, add before creating BLE:

```python
from ble_advertising import ensure_wifi_off
ensure_wifi_off()
```

After `BLEService(...)` and `BLEAdvertising(...)`:

```python
ble_service.set_advertising(advertising)
if not advertising.start_advertising(services=[bluetooth.UUID(0x181A)]):
    print("ERROR: advertising did not start")
```

See **`main_ble_snippet.py`** for the full block.

## What changed (v1.4)

- **`ensure_wifi_off()`** — disables STA and AP before BLE
- **Split payloads** — service `0x181A` in advertise packet, name in **scan response**
- **`gap_advertise(..., connectable=True)`** with error checks
- **Restart advertising** when the last phone disconnects

## Sync to GitHub `ballast` repo

These files mirror what should go in **joelevy1/ballast** for OTA (`ble_advertising.py`, `ble_service.py`, `main.py`).
