# Pitch Studio button + LED ring (CircuitPython 9/10, Raspberry Pi Pico 2 / RP2350 or Pico / RP2040).
#
# Wiring (see firmware/README.md):
#   GP15  arcade button to GND (internal pull-up)
#   GP14  button lamp via logic-level MOSFET (PWM)
#   GP16  WS2812 ring around the camera lens (24 px) via 74AHCT125
#   GP17  optional "ON AIR" strip outside the booth (8 px)
#
# Host protocol (USB serial "data" port, 115200, one line per message):
#   host -> device: HELLO | PING | MODE <idle|calib|count n|rec p|cue|proc|replay|share|ok|off>
#   device -> host: DOWN | UP
# Without pings for 5 s the button falls back to a USB keyboard (F13 down/up), so the booth
# works even when Web Serial was never paired.

import math
import time
import board
import digitalio
import pwmio
import neopixel
import usb_cdc
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

RING_N, STRIP_N = 24, 8
BRIGHT = 0.25  # 24 px at full white draw ~1.4 A; USB gives 0.5 A

ring = neopixel.NeoPixel(board.GP16, RING_N, brightness=BRIGHT, auto_write=False)
strip = neopixel.NeoPixel(board.GP17, STRIP_N, brightness=0.4, auto_write=False)
lamp = pwmio.PWMOut(board.GP14, frequency=1000, duty_cycle=0)
btn = digitalio.DigitalInOut(board.GP15)
btn.switch_to_input(pull=digitalio.Pull.UP)
kbd = Keyboard(usb_hid.devices)
ser = usb_cdc.data

WHITE, RED, DIM_RED, GREEN, OFF = (255, 236, 210), (229, 50, 45), (40, 6, 5), (60, 200, 90), (0, 0, 0)

mode, arg, mode_t = "idle", 0.0, time.monotonic()
flash_until, flash_col = 0, OFF
last_ping = -100
pressed = False
buf = b""


def host_connected():
    return time.monotonic() - last_ping < 5


def set_mode(m, a):
    global mode, arg, mode_t, flash_until, flash_col
    if m in ("cue", "ok"):  # one-shot flashes on top of the current mode
        flash_until = time.monotonic() + (0.35 if m == "cue" else 0.7)
        flash_col = WHITE if m == "cue" else GREEN
        return
    if m != mode:
        mode_t = time.monotonic()
    mode, arg = m, a


def read_serial():
    global buf, last_ping
    if ser is None or not ser.in_waiting:
        return
    buf += ser.read(ser.in_waiting)
    while b"\n" in buf:
        line, buf = buf.split(b"\n", 1)
        parts = line.decode("utf-8", "ignore").strip().split()
        if not parts:
            continue
        last_ping = time.monotonic()
        if parts[0] == "MODE" and len(parts) > 1:
            try:
                a = float(parts[2]) if len(parts) > 2 else 0.0
            except ValueError:
                a = 0.0
            set_mode(parts[1], a)


def send(msg):
    if ser is not None and host_connected():
        ser.write((msg + "\n").encode())


def scale(c, k):
    return (int(c[0] * k), int(c[1] * k), int(c[2] * k))


def render(now):
    t = now - mode_t
    breathe = 0.5 + 0.5 * math.sin(now * 2.0)
    on_air = False
    lamp_k = 0.0
    if mode == "idle":
        ring.fill(scale(WHITE, 0.04 + 0.08 * breathe))
        lamp_k = 0.25 + 0.75 * breathe  # the button breathes: press me
    elif mode == "calib":
        ring.fill(scale(WHITE, 0.6 + 0.4 * breathe))  # look here
        lamp_k = 0.3
    elif mode == "count":
        n = int(arg)
        lit = int(RING_N * (4 - n) / 3)
        for i in range(RING_N):
            ring[i] = WHITE if i < lit else OFF
        on_air = True
        lamp_k = 1.0
    elif mode == "rec":
        lit = min(RING_N, int(RING_N * arg + 0.5))
        over = arg > 1.0
        for i in range(RING_N):
            ring[i] = RED if i < lit else DIM_RED
        if over and int(now * 2) % 2:
            ring.fill(DIM_RED)
        on_air = True
        lamp_k = 1.0
    elif mode == "proc":
        head = int(t * 16) % RING_N
        for i in range(RING_N):
            d = (head - i) % RING_N
            ring[i] = scale(WHITE, max(0, 0.6 - d * 0.1))
    elif mode in ("replay", "share"):
        ring.fill(scale(WHITE, 0.05))
        lamp_k = 0.6
    else:
        ring.fill(OFF)
    if now < flash_until:
        ring.fill(flash_col)
    ring.show()
    strip.fill(RED if on_air else OFF)
    strip.show()
    lamp.duty_cycle = int(65535 * lamp_k)


while True:
    now = time.monotonic()
    read_serial()
    down = not btn.value
    if down != pressed:  # simple debounce: state must hold for 20 ms
        time.sleep(0.02)
        if (not btn.value) == down:
            pressed = down
            if host_connected():
                send("DOWN" if down else "UP")
            elif down:
                kbd.press(Keycode.F13)
            else:
                kbd.release_all()
    if not host_connected() and mode not in ("idle",):
        set_mode("idle", 0)  # booth page gone: back to the inviting idle glow
    render(now)
    time.sleep(0.01)
