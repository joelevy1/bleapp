"""
Ballast Flow Meter Monitor - WiFi Web Version v3.0
Version: 4-19-2026-v1.3
Features: iOS-aligned UI, settings on Pico, pump alerts, GitHub OTA
"""

import network
import socket
from time import sleep, time
import json
import urequests
from config import *

try:
    from flow_meters import FlowMeterManager
except ImportError:
    # Older flow_meters.py on device had only FlowMeters
    from flow_meters import FlowMeters

    class FlowMeterManager:
        def __init__(self):
            self._fm = FlowMeters(FLOW_METER_PINS)

        def get_all_pulse_counts(self):
            return self._fm.get_all_counts()

        def reset_counter(self, meter_id):
            self._fm.reset_meter(meter_id)

        def reset_all_counters(self):
            self._fm.reset_all()

try:
    from urllib.parse import quote_plus, unquote_plus
except ImportError:
    def quote_plus(s):
        return str(s).replace(" ", "+")

    def unquote_plus(s):
        return str(s).replace("+", " ")

# Global settings — extended to match iOS app + ballast_settings.json on flash
def _default_settings():
    return {
        "pulses_per_gallon": PULSES_PER_GALLON,
        "pounds_per_gallon": POUNDS_PER_GALLON,
        "unit_mode": "gallons",
        "show_pounds": False,
        "is_fill_mode": True,
        "tank_fill": {"Port": True, "Starboard": True, "Mid": True, "Forward": True},
        "tank_max": TANK_MAX_DEFAULTS.copy(),
        "calibration": [0] * 8,
    }


settings = _default_settings()

# Flow rate tracking for alerts
flow_history = {i: [] for i in range(8)}  # Last 5 seconds of flow data


def migrate_settings(s):
    """Merge legacy calibration-only settings into tank_max + unit_mode."""
    d = _default_settings()
    for k, v in d.items():
        if k not in s:
            s[k] = v
    if "tank_max" not in s or not isinstance(s.get("tank_max"), dict):
        s["tank_max"] = d["tank_max"].copy()
    for key in ("port", "starboard", "mid", "forward"):
        if key not in s["tank_max"]:
            s["tank_max"][key] = d["tank_max"][key]
    cal = s.get("calibration")
    if not isinstance(cal, list) or len(cal) < 8:
        s["calibration"] = [0] * 8
    if "unit_mode" not in s:
        s["unit_mode"] = "pounds" if s.get("show_pounds") else "gallons"
    um = s["unit_mode"]
    if um == "pounds":
        s["show_pounds"] = True
    elif um in ("gallons", "counter"):
        s["show_pounds"] = False
    if "is_fill_mode" not in s:
        s["is_fill_mode"] = True
    if "tank_fill" not in s or not isinstance(s.get("tank_fill"), dict):
        s["tank_fill"] = d["tank_fill"].copy()
    for tn in ("Port", "Starboard", "Mid", "Forward"):
        if tn not in s["tank_fill"]:
            s["tank_fill"][tn] = True
    if "pounds_per_gallon" not in s:
        s["pounds_per_gallon"] = POUNDS_PER_GALLON
    return s


def load_settings():
    global settings
    try:
        with open("ballast_settings.json", "r") as f:
            settings = json.load(f)
        settings = migrate_settings(settings)
        print("Loaded saved settings")
    except Exception:
        print("No saved settings, using defaults")
        settings = _default_settings()
        save_settings()


def save_settings():
    try:
        with open("ballast_settings.json", "w") as f:
            json.dump(settings, f)
        print("Settings saved")
    except Exception as e:
        print(f"Error saving settings: {e}")


def settings_for_api():
    """Subset exposed to the iOS app (JSON-serializable)."""
    return {
        "pulses_per_gallon": settings["pulses_per_gallon"],
        "pounds_per_gallon": settings["pounds_per_gallon"],
        "unit_mode": settings["unit_mode"],
        "tank_max": settings["tank_max"].copy(),
        "is_fill_mode": settings["is_fill_mode"],
        "tank_fill": settings["tank_fill"].copy(),
    }


def apply_settings_from_json(data):
    """Update global settings from a dict (from POST /api/settings)."""
    global settings
    if not isinstance(data, dict):
        return False
    if "pulses_per_gallon" in data:
        v = float(data["pulses_per_gallon"])
        if v > 0:
            settings["pulses_per_gallon"] = v
    if "pounds_per_gallon" in data:
        v = float(data["pounds_per_gallon"])
        if v > 0:
            settings["pounds_per_gallon"] = v
    if "unit_mode" in data:
        um = str(data["unit_mode"])
        if um in ("counter", "gallons", "pounds"):
            settings["unit_mode"] = um
            settings["show_pounds"] = um == "pounds"
    if "is_fill_mode" in data:
        settings["is_fill_mode"] = bool(data["is_fill_mode"])
    if "tank_fill" in data and isinstance(data["tank_fill"], dict):
        for tn in ("Port", "Starboard", "Mid", "Forward"):
            if tn in data["tank_fill"]:
                settings["tank_fill"][tn] = bool(data["tank_fill"][tn])
    if "tank_max" in data and isinstance(data["tank_max"], dict):
        for k in ("port", "starboard", "mid", "forward"):
            if k in data["tank_max"]:
                try:
                    n = int(data["tank_max"][k])
                    if n > 0:
                        settings["tank_max"][k] = n
                except (TypeError, ValueError):
                    pass
    save_settings()
    return True


def get_tank_total_pulses(tank_name, counts):
    meters = TANK_CONFIG[tank_name]["meters"]
    return counts[meters[0]] + counts[meters[1]]


def fmt_pulses(pulses, unit_mode, ppg, ppg_lb):
    if unit_mode == "counter":
        return (str(int(pulses)), "")
    gal = float(pulses) / ppg
    if unit_mode == "gallons":
        return (f"{gal:.1f}", "gal")
    return (f"{gal * ppg_lb:.1f}", "lbs")


def format_pump_display(pump_idx, tank_name, counts):
    pulses = counts[pump_idx]
    return fmt_pulses(
        pulses,
        settings["unit_mode"],
        settings["pulses_per_gallon"],
        settings["pounds_per_gallon"],
    )


def get_tank_percent_display(tank_name, counts):
    tm = settings["tank_max"].get(tank_name.lower(), 0)
    if not tm:
        return 0
    total = get_tank_total_pulses(tank_name, counts)
    fill = min(1.0, total / tm) if tm else 0
    drain = not settings["tank_fill"].get(tank_name, True)
    if drain:
        pct = round((1 - fill) * 100)
    else:
        pct = round(fill * 100)
    return max(0, min(100, pct))


def format_total_line(counts):
    total_pulses = sum(counts)
    ppg = settings["pulses_per_gallon"]
    ppg_lb = settings["pounds_per_gallon"]
    um = settings["unit_mode"]
    tm = settings["tank_max"]
    if settings["is_fill_mode"]:
        val, u = fmt_pulses(total_pulses, um, ppg, ppg_lb)
        label = "Total water"
    else:
        rem = 0
        for tank_name in TANK_CONFIG:
            key = tank_name.lower()
            max_p = tm.get(key, 0)
            total_tank = get_tank_total_pulses(tank_name, counts)
            rem += max(0, max_p - total_tank)
        val, u = fmt_pulses(rem, um, ppg, ppg_lb)
        label = "Remaining (all tanks)"
    return label, val, u

# Initialize
load_settings()
flow_manager = FlowMeterManager()
last_counts = [0] * 8
last_check_time = time()

# Connect to WiFi
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    try:
        hn = DHCP_HOSTNAME
    except NameError:
        hn = "Ballast-Monitor"
    try:
        wlan.config(dhcp_hostname=hn)
        print("DHCP hostname:", hn)
    except Exception as e:
        print("dhcp_hostname not set:", e)

    for network_config in WIFI_NETWORKS:
        ssid = network_config["ssid"]
        password = network_config["password"]
        
        print(f'Trying {ssid}...')
        wlan.connect(ssid, password)
        
        max_wait = 10
        while max_wait > 0:
            if wlan.status() < 0 or wlan.status() >= 3:
                break
            max_wait -= 1
            sleep(1)
        
        if wlan.status() == 3:
            status = wlan.ifconfig()
            print(f'Connected to {ssid}! IP: {status[0]}')
            return status[0]
    
    raise RuntimeError('WiFi connection failed')

# Update flow rate history
def update_flow_history():
    global last_counts, last_check_time
    
    current_time = time()
    time_diff = current_time - last_check_time
    
    if time_diff >= 1.0:  # Update every second
        counts = flow_manager.get_all_pulse_counts()
        
        for i in range(8):
            pulses_per_sec = (counts[i] - last_counts[i]) / time_diff
            gallons_per_min = (pulses_per_sec * 60) / settings["pulses_per_gallon"]
            
            # Keep last 5 seconds
            flow_history[i].append(gallons_per_min)
            if len(flow_history[i]) > 5:
                flow_history[i].pop(0)
        
        last_counts = counts.copy()
        last_check_time = current_time

# Check for pump failures
def check_pump_failures():
    alerts = []
    
    for tank_name, tank_info in TANK_CONFIG.items():
        meters = tank_info["meters"]
        
        if len(flow_history[meters[0]]) >= 5 and len(flow_history[meters[1]]) >= 5:
            # Average flow rate over last 5 seconds
            pump1_flow = sum(flow_history[meters[0]]) / len(flow_history[meters[0]])
            pump2_flow = sum(flow_history[meters[1]]) / len(flow_history[meters[1]])
            
            # Check if one pump running but not the other
            pump1_running = pump1_flow > MIN_FLOW_RATE
            pump2_running = pump2_flow > MIN_FLOW_RATE
            
            if pump1_running and not pump2_running:
                alerts.append(f"{tank_name} Tank: Only pump 1 running!")
            elif pump2_running and not pump1_running:
                alerts.append(f"{tank_name} Tank: Only pump 2 running!")
    
    return alerts

# Check GitHub for updates
def check_github_updates():
    updates_available = []
    
    try:
        for filename in UPDATE_FILES:
            url = f"https://raw.githubusercontent.com/{GITHUB_USER}/{GITHUB_REPO}/{GITHUB_BRANCH}/{filename}"
            
            try:
                response = urequests.get(url, timeout=5)
                if response.status_code == 200:
                    remote_content = response.text
                    
                    # Try to read local file
                    try:
                        with open(filename, 'r') as f:
                            local_content = f.read()
                        
                        if remote_content != local_content:
                            updates_available.append(filename)
                    except:
                        # File doesn't exist locally
                        updates_available.append(filename)
                
                response.close()
            except Exception as e:
                print(f"Error checking {filename}: {e}")
        
    except Exception as e:
        print(f"GitHub check failed: {e}")
    
    return updates_available

# Download and install updates
def install_github_updates(files):
    results = []
    
    for filename in files:
        url = f"https://raw.githubusercontent.com/{GITHUB_USER}/{GITHUB_REPO}/{GITHUB_BRANCH}/{filename}"
        
        try:
            response = urequests.get(url, timeout=10)
            if response.status_code == 200:
                with open(filename, 'w') as f:
                    f.write(response.text)
                results.append(f"OK {filename}")
            else:
                results.append(f"FAIL {filename} (HTTP {response.status_code})")
            response.close()
        except Exception as e:
            results.append(f"FAIL {filename} ({str(e)})")
    
    return results

def build_file_versions():
    out = {}
    for fn in ["main.py", "main_wifi.py", "flow_meters.py", "ble_service.py", "ble_advertising.py", "config.py"]:
        out[fn] = read_py_file_version(fn)
    return out

# Generate HTML
def get_html():
    update_flow_history()
    counts = flow_manager.get_all_pulse_counts()
    alerts = check_pump_failures()
    
    # Alert banner
    alert_html = ""
    if alerts:
        alert_list = "<br>".join(f"WARNING: {alert}" for alert in alerts)
        alert_html = f'''
        <div class="alert-banner">
            {alert_list}
        </div>
        '''
    
    # Build tank cards
    tank_cards = ""

    for tank_name, tank_info in TANK_CONFIG.items():
        meters = tank_info["meters"]
        names = tank_info["names"]
        
        pump_data = []

        for i, meter_idx in enumerate(meters):
            pulses = counts[meter_idx]

            if len(flow_history[meter_idx]) > 0:
                flow_rate = sum(flow_history[meter_idx]) / len(flow_history[meter_idx])
                is_running = flow_rate > MIN_FLOW_RATE
            else:
                is_running = False

            pv, pun = format_pump_display(meter_idx, tank_name, counts)
            display_val = f"{pv} {pun}".strip() if pun else pv

            status = "RUNNING" if is_running else "STOPPED"
            status_class = "running" if is_running else "stopped"

            pump_data.append({
                "name": names[i],
                "value": display_val,
                "status": status,
                "status_class": status_class,
                "meter_idx": meter_idx,
            })

        percent = get_tank_percent_display(tank_name, counts)

        um = settings["unit_mode"]
        ppg = settings["pulses_per_gallon"]
        ppg_lb = settings["pounds_per_gallon"]
        tt_val, tt_unit = fmt_pulses(
            get_tank_total_pulses(tank_name, counts), um, ppg, ppg_lb
        )
        tank_display = f"{tt_val} {tt_unit}".strip() if tt_unit else tt_val
        
        tf = settings["tank_fill"].get(tank_name, True)
        f_cls = "mini-on" if tf else ""
        d_cls = "" if tf else "mini-on"
        pump_rows = ""
        for pump in pump_data:
            pump_rows += f'''
            <div class="pump-row">
                <form method="POST" action="/reset" style="display:flex;">
                    <input type="hidden" name="meter" value="{pump["meter_idx"]}">
                    <button type="submit" class="pump-reset" title="Reset">&#8635;</button>
                </form>
                <div class="pump-main">
                    <div class="lbl">{pump["name"]} &middot; <span class="{pump["status_class"]}">{pump["status"]}</span></div>
                    <div class="num">{pump["value"]}</div>
                </div>
            </div>
            '''

        tank_cards += f'''
        <div class="tank-card">
            <div class="tank-mini">
                <form method="POST" action="/set_tank_fill"><input type="hidden" name="tank" value="{tank_name}"/><input type="hidden" name="fill" value="1"/>
                    <button type="submit" class="mini {f_cls}">Fill</button></form>
                <form method="POST" action="/set_tank_fill"><input type="hidden" name="tank" value="{tank_name}"/><input type="hidden" name="fill" value="0"/>
                    <button type="submit" class="mini {d_cls}">Drain</button></form>
            </div>
            <div class="tank-title">
                <span>{tank_name}</span>
                <span class="tank-pct">{percent:.0f}%</span>
            </div>
            <div style="font-size:12px;color:#666;margin-bottom:6px;">{tank_display} total</div>
            {pump_rows}
            <div class="tank-actions">
                <form method="POST" action="/reset_tank" style="flex:1;"><input type="hidden" name="tank" value="{tank_name}"/>
                    <button type="submit">&#8635; Tank</button></form>
                <form method="POST" action="/set_full" style="flex:1;"><input type="hidden" name="tank" value="{tank_name}"/>
                    <button type="submit">Set full</button></form>
            </div>
        </div>
        '''
    
    tot_label, tot_val, tot_u = format_total_line(counts)
    total_display = f"{tot_val} {tot_u}".strip() if tot_u else tot_val
    fv = build_file_versions()
    fill_on = "toggle-active" if settings["is_fill_mode"] else ""
    drain_on = "" if settings["is_fill_mode"] else "toggle-active"
    um = settings["unit_mode"]
    c_on = "seg-on" if um == "counter" else ""
    g_on = "seg-on" if um == "gallons" else ""
    p_on = "seg-on" if um == "pounds" else ""

    html = f'''<!DOCTYPE html>
<html>
<head>
    <title>Ballast Monitor v{VERSION}</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="2">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #fff;
            color: #333;
            padding-bottom: 72px;
        }}
        .topbar {{
            background: #4CAF50;
            color: #fff;
            text-align: center;
            padding: 14px 16px 12px;
        }}
        .topbar h1 {{ font-size: 20px; font-weight: 500; }}
        .topbar .sub {{ font-size: 11px; opacity: 0.95; margin-top: 4px; }}
        .alert-banner {{
            background: #ff3b30;
            color: #fff;
            padding: 12px;
            text-align: center;
            font-weight: 600;
            font-size: 14px;
        }}
        .statusbar {{
            background: #f5f5f5;
            padding: 12px;
            border-bottom: 1px solid #eee;
        }}
        .fill-row {{
            display: flex;
            justify-content: center;
            gap: 12px;
        }}
        .toggle {{
            padding: 10px 28px;
            border-radius: 10px;
            border: 2px solid #c8e6c9;
            background: #fff;
            font-size: 15px;
            font-weight: 600;
            color: #555;
            cursor: pointer;
        }}
        .toggle-active {{
            background: #4CAF50;
            border-color: #2E7D32;
            color: #fff;
        }}
        .units-row {{
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
            margin-top: 10px;
        }}
        .seg {{
            padding: 8px 14px;
            border-radius: 8px;
            border: 1px solid #ddd;
            background: #fff;
            font-size: 13px;
            cursor: pointer;
        }}
        .seg-on {{
            background: #4CAF50;
            border-color: #4CAF50;
            color: #fff;
        }}
        .toolbar {{
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 12px;
            justify-content: center;
            border-bottom: 1px solid #eee;
        }}
        .btn {{
            border: none;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            color: #fff;
        }}
        .btn-blue {{ background: #1976D2; }}
        .btn-red {{ background: #c62828; }}
        .btn-purple {{ background: #7b1fa2; }}
        .total-card {{
            margin: 12px;
            background: #E3F2FD;
            border-radius: 12px;
            padding: 16px;
            text-align: center;
        }}
        .total-card .lbl {{ font-size: 13px; color: #1976D2; margin-bottom: 4px; }}
        .total-card .val {{ font-size: 28px; color: #1565C0; font-weight: 500; }}
        .tank-grid {{
            display: flex;
            flex-wrap: wrap;
            padding: 6px;
            gap: 8px;
        }}
        .tank-card {{
            width: calc(50% - 8px);
            min-width: 160px;
            flex: 1 1 45%;
            background: #f5f5f5;
            border-radius: 12px;
            padding: 10px;
        }}
        .tank-mini {{
            display: flex;
            justify-content: center;
            gap: 6px;
            margin-bottom: 8px;
        }}
        .mini {{
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid #ddd;
            background: #fff;
            font-size: 11px;
            cursor: pointer;
        }}
        .mini-on {{ background: #4CAF50; border-color: #4CAF50; color: #fff; }}
        .tank-title {{
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
            font-weight: 600;
            font-size: 15px;
        }}
        .tank-pct {{ font-size: 13px; color: #666; font-weight: 400; }}
        .pump-row {{
            display: flex;
            align-items: stretch;
            margin-bottom: 6px;
        }}
        .pump-reset {{
            width: 36px;
            min-height: 44px;
            border: 1px solid #ccc;
            border-radius: 18px 4px 4px 18px;
            background: #eee;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 8px;
            cursor: pointer;
            font-size: 16px;
            color: #666;
        }}
        .pump-main {{
            flex: 1;
            background: #fff;
            border-radius: 8px;
            padding: 8px;
        }}
        .pump-main .lbl {{ font-size: 11px; color: #666; }}
        .pump-main .num {{ font-size: 16px; color: #4CAF50; margin-top: 4px; font-weight: 500; }}
        .tank-actions {{
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }}
        .tank-actions button {{
            flex: 1;
            padding: 6px;
            font-size: 11px;
            border-radius: 6px;
            border: 1px solid #ddd;
            background: #fff;
            cursor: pointer;
        }}
        .footer {{
            text-align: center;
            font-size: 12px;
            color: #888;
            padding: 16px;
            line-height: 1.5;
        }}
        .footer summary {{ cursor: pointer; color: #1565C0; }}
        .footer code {{ font-size: 11px; display: block; margin-top: 8px; text-align: left; }}
        @media (max-width: 520px) {{
            .tank-card {{ width: 100%; flex: 1 1 100%; }}
        }}
    </style>
</head>
<body>
    <div class="topbar">
        <h1>Ballast Monitor</h1>
        <div class="sub">WiFi &middot; v{VERSION} &middot; refresh 2s</div>
    </div>
    {alert_html}
    <div class="statusbar">
        <div class="fill-row">
            <form method="POST" action="/set_master_fill"><input type="hidden" name="mode" value="fill"/>
                <button type="submit" class="toggle {fill_on}">Fill</button></form>
            <form method="POST" action="/set_master_fill"><input type="hidden" name="mode" value="drain"/>
                <button type="submit" class="toggle {drain_on}">Drain</button></form>
        </div>
        <div class="units-row">
            <form method="POST" action="/set_unit_mode"><input type="hidden" name="mode" value="counter"/>
                <button type="submit" class="seg {c_on}">Counter</button></form>
            <form method="POST" action="/set_unit_mode"><input type="hidden" name="mode" value="gallons"/>
                <button type="submit" class="seg {g_on}">Gallons</button></form>
            <form method="POST" action="/set_unit_mode"><input type="hidden" name="mode" value="pounds"/>
                <button type="submit" class="seg {p_on}">Pounds</button></form>
        </div>
    </div>
    <div class="toolbar">
        <form method="POST" action="/reset_all"><button type="submit" class="btn btn-red">Reset all</button></form>
        <form method="POST" action="/check_updates"><button type="submit" class="btn btn-purple">Check updates</button></form>
    </div>
    <div class="total-card">
        <div class="lbl">{tot_label}</div>
        <div class="val">{total_display}</div>
    </div>
    <div class="tank-grid">
        {tank_cards}
    </div>
    <div class="footer">
        Pulses/gal: {settings["pulses_per_gallon"]:.0f} &middot; Saved on Pico as <code>ballast_settings.json</code>
        <details>
            <summary>File versions</summary>
            <code>
main.py: {fv.get("main.py", "?")}<br/>
main_wifi.py: {fv.get("main_wifi.py", "?")}<br/>
flow_meters.py: {fv.get("flow_meters.py", "?")}<br/>
ble_service.py: {fv.get("ble_service.py", "?")}<br/>
ble_advertising.py: {fv.get("ble_advertising.py", "?")}<br/>
config.py: {fv.get("config.py", "?")}
            </code>
        </details>
    </div>
</body>
</html>
'''
    return html

# Parse POST data (application/x-www-form-urlencoded)
def parse_post(data):
    params = {}
    try:
        pairs = data.split("&")
        for pair in pairs:
            if "=" in pair:
                key, value = pair.split("=", 1)
                params[unquote_plus(key)] = unquote_plus(value)
    except Exception:
        pass
    return params


def read_http_request(cl):
    """Read up to Content-Length so JSON POST bodies are not truncated."""
    buf = b""
    while len(buf) < 65536:
        chunk = cl.recv(1024)
        if not chunk:
            break
        buf += chunk
        if b"\r\n\r\n" in buf:
            header, _, rest = buf.partition(b"\r\n\r\n")
            hdr = header.decode("utf-8")
            clen = 0
            for line in hdr.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    try:
                        clen = int(line.split(":", 1)[1].strip())
                    except (ValueError, IndexError):
                        pass
            if clen <= 0:
                return hdr + "\r\n\r\n" + rest.decode("utf-8", "replace")
            body = rest
            while len(body) < clen:
                body += cl.recv(1024)
            return hdr + "\r\n\r\n" + body[:clen].decode("utf-8")
    return buf.decode("utf-8", "replace")


def post_body(request):
    """Return body after headers from a full HTTP request string."""
    if "\r\n\r\n" not in request:
        return ""
    return request.split("\r\n\r\n", 1)[1]


# Start web server
def start_server(ip):
    addr = socket.getaddrinfo("0.0.0.0", 80)[0][-1]
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(addr)
    s.listen(1)

    print(f'\n{"=" * 60}')
    print(f"Web server running!")
    print(f"Open: http://{ip}")
    print(f'{"=" * 60}\n')

    while True:
        try:
            cl, _addr = s.accept()
            request = read_http_request(cl)

            lines = request.split("\r\n")
            if len(lines) < 1:
                cl.close()
                continue
            request_line = lines[0]
            parts = request_line.split(" ")
            if len(parts) < 2:
                cl.close()
                continue
            method = parts[0]
            path = parts[1].split("?")[0]

            if path == "/" or path == "":
                response = get_html()
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n")
                cl.sendall(response.encode("utf-8") if isinstance(response, str) else response)

            elif path == "/set_master_fill" and method == "POST":
                params = parse_post(post_body(request))
                m = params.get("mode", "fill")
                settings["is_fill_mode"] = m == "fill"
                save_settings()
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/set_unit_mode" and method == "POST":
                params = parse_post(post_body(request))
                m = params.get("mode", "gallons")
                if m in ("counter", "gallons", "pounds"):
                    settings["unit_mode"] = m
                    settings["show_pounds"] = m == "pounds"
                    save_settings()
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/set_tank_fill" and method == "POST":
                params = parse_post(post_body(request))
                tn = params.get("tank", "")
                if tn in settings["tank_fill"]:
                    settings["tank_fill"][tn] = params.get("fill", "1") == "1"
                    save_settings()
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/reset_tank" and method == "POST":
                params = parse_post(post_body(request))
                tn = params.get("tank", "")
                if tn in TANK_CONFIG:
                    for mi in TANK_CONFIG[tn]["meters"]:
                        flow_manager.reset_counter(mi)
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/set_full" and method == "POST":
                params = parse_post(post_body(request))
                tn = params.get("tank", "")
                if tn in TANK_CONFIG:
                    counts = flow_manager.get_all_pulse_counts()
                    total = get_tank_total_pulses(tn, counts)
                    key = tn.lower()
                    if key in settings["tank_max"]:
                        settings["tank_max"][key] = max(1, int(total))
                        save_settings()
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/reset" and method == "POST":
                params = parse_post(post_body(request))
                if "meter" in params:
                    meter = int(params["meter"])
                    flow_manager.reset_counter(meter)
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/reset_all" and method == "POST":
                flow_manager.reset_all_counters()
                cl.send(b"HTTP/1.1 303 See Other\r\nLocation: /\r\nConnection: close\r\n\r\n")

            elif path == "/check_updates" and method == "POST":
                updates = check_github_updates()
                if updates:
                    response = f"""<!DOCTYPE html>
<html><head><title>Updates</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui;padding:20px;background:#fff;color:#333;">
<h2>Updates available</h2>
<p>{", ".join(updates)}</p>
<form method="POST" action="/install_updates">
<input type="hidden" name="files" value="{",".join(updates)}">
<button type="submit" style="background:#4CAF50;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-size:16px;">Install</button>
</form>
<p><a href="/">Back</a></p>
</body></html>"""
                else:
                    response = """<!DOCTYPE html>
<html><head><title>Updates</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui;padding:20px;background:#fff;color:#333;">
<h2>Up to date</h2>
<p><a href="/">Back</a></p>
</body></html>"""
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n")
                cl.sendall(response.encode("utf-8"))

            elif path == "/install_updates" and method == "POST":
                params = parse_post(post_body(request))
                if "files" in params:
                    files = params["files"].split(",")
                    results = install_github_updates(files)
                    result_html = "<br>".join(results)
                    response = f"""<!DOCTYPE html>
<html><head><title>Done</title><meta http-equiv="refresh" content="3;url=/"></head>
<body style="font-family:system-ui;padding:20px;background:#fff;color:#333;">
<h2>Update results</h2>
<p>{result_html}</p>
<p>Restarting…</p>
</body></html>"""
                    cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n")
                    cl.sendall(response.encode("utf-8"))
                    cl.close()
                    import machine
                    sleep(3)
                    machine.reset()
                else:
                    cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n")
                    cl.sendall(b"<html><body>Error</body></html>")

            elif path == "/api/pulses" and method == "GET":
                update_flow_history()
                counts = flow_manager.get_all_pulse_counts()
                body = json.dumps({"pulses": counts})
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n")
                cl.sendall(body.encode("utf-8"))

            elif path == "/api/settings" and method == "GET":
                body = json.dumps(settings_for_api())
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n")
                cl.sendall(body.encode("utf-8"))

            elif path == "/api/settings" and method == "POST":
                raw = post_body(request)
                try:
                    data = json.loads(raw)
                    apply_settings_from_json(data)
                    body = json.dumps({"ok": True, "settings": settings_for_api()})
                except Exception as e:
                    body = json.dumps({"ok": False, "error": str(e)})
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n")
                cl.sendall(body.encode("utf-8"))

            elif path == "/api/info" and method == "GET":
                update_flow_history()
                counts = flow_manager.get_all_pulse_counts()
                body = json.dumps(
                    {
                        "version": VERSION,
                        "ip": ip,
                        "pulses": counts,
                        "files": build_file_versions(),
                        "settings": settings_for_api(),
                    }
                )
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n")
                cl.sendall(body.encode("utf-8"))

            elif path == "/reboot_to_ble" and method == "POST":
                cl.send(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOK")
                cl.close()
                import machine
                sleep(0.3)
                machine.reset()

            else:
                cl.send(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")

            cl.close()
            
        except Exception as e:
            print(f'Error: {e}')
            try:
                cl.close()
            except:
                pass

def notify_wifi_ip(ip_addr):
    msg = "Ballast WiFi " + str(ip_addr) + " — open http://" + str(ip_addr) + "/ (v" + VERSION + ")"
    title = "Ballast Monitor"

    try:
        topic = NTFY_TOPIC
    except NameError:
        topic = ""
    if topic:
        try:
            url = "https://ntfy.sh/" + topic
            r = urequests.post(url, data=msg.encode("utf-8"), timeout=10)
            r.close()
            print("ntfy notification sent")
        except Exception as e:
            print("ntfy notify failed:", e)

    try:
        uk = PUSHOVER_USER_KEY
        at = PUSHOVER_APP_TOKEN
    except NameError:
        uk = ""
        at = ""
    if uk and at:
        try:
            body = (
                "token="
                + quote_plus(at)
                + "&user="
                + quote_plus(uk)
                + "&title="
                + quote_plus(title)
                + "&message="
                + quote_plus(msg)
            )
            r = urequests.post(
                "https://api.pushover.net/1/messages.json",
                data=body.encode("utf-8"),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=12,
            )
            r.close()
            print("Pushover notification sent")
        except Exception as e:
            print("Pushover notify failed:", e)

def run():
    print(f"\nBallast Monitor v{VERSION} - WiFi Mode")
    print("=" * 60)
    ip = connect_wifi()
    notify_wifi_ip(ip)
    start_server(ip)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopping...")
    except Exception as e:
        print(f"Error: {e}")
