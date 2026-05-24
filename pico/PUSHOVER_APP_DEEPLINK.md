# Pushover → Ballast Monitor app (WiFi IP)

The iOS app handles `ballastmonitor://wifi?ip=192.168.x.x` and opens the WiFi connect dialog with the IP filled in.

In **`joelevy1/ballast` `main_wifi.py`**, extend `notify_wifi_ip` so Pushover’s `url` field uses that scheme (message can still mention `http://` for a browser):

```python
def notify_wifi_ip(ip_addr):
    ip_s = str(ip_addr)
    msg = "Ballast WiFi " + ip_s + " — open http://" + ip_s + "/ (v" + VERSION + ")"
    title = "Ballast Monitor"
    app_url = "ballastmonitor://wifi?ip=" + quote_plus(ip_s)

    # ... ntfy unchanged ...

    if uk and at:
        body = (
            "token=" + quote_plus(at)
            + "&user=" + quote_plus(uk)
            + "&title=" + quote_plus(title)
            + "&message=" + quote_plus(msg)
            + "&url=" + quote_plus(app_url)
        )
        # ... post as today ...
```

After flashing WiFi firmware with this change, tapping the Pushover notification should open Ballast Monitor with the IP ready to connect.
