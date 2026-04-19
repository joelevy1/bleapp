# WiFi JSON endpoint for the mobile app

The stock `main_wifi.py` web UI does not expose machine-readable pulse counts. Add this route next to the other `elif path == ...` branches inside `start_server()` (before the final `else: 404`), so the app can poll `GET /api/pulses`:

```python
elif path == '/api/pulses' and method == 'GET':
    counts = flow_manager.get_all_pulse_counts()
    payload = json.dumps({"pulses": counts})
    cl.send('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n')
    cl.sendall(payload)
```

Response shape:

```json
{"pulses":[0,0,0,0,0,0,0,0]}
```

After saving, restart the Pico. The app uses `http://<pico-ip>/api/pulses` when connected over WiFi.
