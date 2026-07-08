"""
Flow Meter Handler
Version: 4-19-2026-v1.3
Handles 8 flow meters with interrupt-based counting
"""

from machine import Pin
import time

class FlowMeters:
    def __init__(self, pins):
        self._pins = pins
        self._counts = [0] * len(pins)
        self._last_time = [0] * len(pins)
        self._meters = []
        
        # Setup GPIO pins with pull-up and interrupts
        for i, pin_num in enumerate(pins):
            pin = Pin(pin_num, Pin.IN, Pin.PULL_UP)
            pin.irq(trigger=Pin.IRQ_FALLING, handler=lambda p, idx=i: self._pulse_handler(idx))
            self._meters.append(pin)
        
        print(f"Flow meters initialized: {len(pins)} channels (v4-18-2026-v1.2)")
    
    def _pulse_handler(self, meter_id):
        """Handle pulse interrupt with debouncing"""
        current_time = time.ticks_ms()
        
        # Debounce: ignore pulses within 50ms
        if time.ticks_diff(current_time, self._last_time[meter_id]) > 50:
            self._counts[meter_id] += 1
            self._last_time[meter_id] = current_time
    
    def get_count(self, meter_id):
        """Get pulse count for specific meter"""
        if 0 <= meter_id < len(self._counts):
            return self._counts[meter_id]
        return 0
    
    def get_all_counts(self):
        """Get all meter counts"""
        return self._counts.copy()
    
    def reset_meter(self, meter_id):
        """Reset specific meter"""
        if 0 <= meter_id < len(self._counts):
            self._counts[meter_id] = 0
            print(f"Reset meter {meter_id}")
    
    def reset_all(self):
        """Reset all meters"""
        self._counts = [0] * len(self._counts)
        print("Reset all meters")


class FlowMeterManager:
    """Used by main_wifi.py (WiFi web server). Wraps FlowMeters with that API."""

    def __init__(self):
        import config

        self._fm = FlowMeters(config.FLOW_METER_PINS)

    def get_all_pulse_counts(self):
        return self._fm.get_all_counts()

    def reset_counter(self, meter_id):
        self._fm.reset_meter(meter_id)

    def reset_all_counters(self):
        self._fm.reset_all()
