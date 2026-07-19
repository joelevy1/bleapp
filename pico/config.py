"""
Configuration for Ballast Monitor
Version: 7-19-2026-v1.6
"""

# System version
VERSION = "7-19-2026-v1.6"


def read_py_file_version(filename):
    """
    Read a 'Version: …' tag from the top of a .py file.
    Ignores false matches (e.g. if "Version:" in line, HTML templates).
    """
    try:
        with open(filename, "r") as f:
            head = f.read(8000)
    except OSError:
        return "unknown"
    for line in head.split("\n"):
        if "Version:" not in line:
            continue
        st = line.strip()
        if st.startswith("if ") and '"Version:"' in line:
            continue
        if ".split(" in line and "Version:" in line:
            continue
        if "{VERSION}" in line or "</" in line or "<strong" in line:
            continue
        part = line.split("Version:", 1)[1].strip().strip('"').strip("'")
        part = part.split("#")[0].strip()
        if part and len(part) < 120 and not part.startswith("{"):
            return part
    return "unknown"

# Mode: "wifi" or "ble" (default BLE). iOS app Settings can schedule one-shot WiFi via BLE cmd 0x04; no need to edit MODE here.
MODE = "ble"

# WiFi credentials
WIFI_SSID = "Levy-Guest"
WIFI_PASSWORD = "welcomehome"

# Backup WiFi
WIFI_SSID_BACKUP = "Levy2.4"
WIFI_PASSWORD_BACKUP = "@Sonoma4real"

WIFI_NETWORKS = [
    {"ssid": WIFI_SSID, "password": WIFI_PASSWORD},
    {"ssid": WIFI_SSID_BACKUP, "password": WIFI_PASSWORD_BACKUP},
]

# Shown on many routers' DHCP client lists (MicroPython: set before connect).
DHCP_HOSTNAME = "Ballast-Monitor"

# Optional: ntfy.sh topic (install ntfy app). Leave empty to disable.
NTFY_TOPIC = ""

# Optional: Pushover (https://pushover.net) — install Pushover on iPhone; create an "Application" to get an API token.
# Leave either empty to disable. User Key is on your Pushover account; App token is from "Create an Application".
PUSHOVER_USER_KEY = "gs9oc23w8vxaaifjse979kci3y5jdx"
PUSHOVER_APP_TOKEN = "apd81oscwawp7nrf9mcuqyh1ymh4z4"

# GitHub OTA update settings
GITHUB_USER = "joelevy1"
GITHUB_REPO = "ballast"
GITHUB_BRANCH = "main"

# Files to check for updates (only used in WiFi mode)
UPDATE_FILES = [
    "main.py",
    "main_wifi.py",
    "ble_service.py",
    "ble_advertising.py",
    "flow_meters.py",
    "config.py"
]

# Flow meter GPIO pins (GP0-GP7)
FLOW_METER_PINS = [0, 1, 2, 3, 4, 5, 6, 7]

# Tank configuration
# Each tank has two pumps (top and bottom)
TANKS = {
    'port': {
        'pumps': [1, 2],  # GP1 (Top White), GP2 (Bottom Green)
        'name': 'Port Tank'
    },
    'starboard': {
        'pumps': [0, 3],  # GP0 (Top White), GP3 (Bottom Green)
        'name': 'Starboard Tank'
    },
    'mid': {
        'pumps': [4, 5],  # GP4 (Port Blue), GP5 (Starboard Blue)
        'name': 'Mid Tank'
    },
    'forward': {
        'pumps': [6, 7],  # GP6 (Port Yellow), GP7 (Mid Yellow)
        'name': 'Forward Tank'
    }
}

# Flow meter calibration
PULSES_PER_GALLON = 450  # Estimated, needs physical calibration
POUNDS_PER_GALLON = 8.34
LBS_PER_GALLON = POUNDS_PER_GALLON

# Default tank capacity (pulse counts at full)
TANK_MAX_DEFAULTS = {
    "port": 9940,
    "starboard": 9958,
    "mid": 11087,
    "forward": 8764,
}


# main_wifi.py: minimum gal/min to consider a pump "running" for mismatch alerts
MIN_FLOW_RATE = 0.5

# Display layout for WiFi HTML (meters = flow meter indices; names = pump row labels)
TANK_CONFIG = {
    "Port": {"meters": TANKS["port"]["pumps"], "names": ["Top (White)", "Btm (Green)"]},
    "Starboard": {"meters": TANKS["starboard"]["pumps"], "names": ["Top (White)", "Btm (Green)"]},
    "Mid": {"meters": TANKS["mid"]["pumps"], "names": ["Port (Blue)", "Stbd (Blue)"]},
    "Forward": {"meters": TANKS["forward"]["pumps"], "names": ["Port (Yellow)", "Mid (Yellow)"]},
}

# BLE settings
BLE_DEVICE_NAME = "Ballast Monitor"
