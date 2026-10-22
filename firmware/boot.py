# Pitch Studio button: enable a second USB serial port (data) next to the REPL console.
# Chrome's Web Serial talks to the data port; the keyboard (HID) stays on for the fallback.
import usb_cdc

usb_cdc.enable(console=True, data=True)
