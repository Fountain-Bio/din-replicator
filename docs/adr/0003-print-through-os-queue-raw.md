---
status: accepted
---

# Replicas are sent as raw ZPL through the operating system print queue

The printer is a Zebra ZD411t on USB. We write ZPL bytes to the installed print queue in raw mode: the CUPS queue on macOS and the spooler with the RAW datatype on Windows. This needs no extra software on the machine and leaves the vendor driver in charge of the USB device.

## Considered options

- **Direct USB with libusb**: works on macOS, but on Windows the Zebra driver owns the device and replacing it with WinUSB breaks every other print path.
- **Zebra Browser Print**: cross-platform, but a separate agent and certificate to install and keep working on every machine.

## Consequences

- The app checks the queue state before every print run and refuses to submit when the printer is offline, paused, or reports a media fault, so a replica never prints unattended later.
- Someone must add the printer to the operating system once per machine.
