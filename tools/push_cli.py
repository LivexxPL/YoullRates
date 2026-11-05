#!/usr/bin/env python3
"""Push a TuneForge (or any Betaflight) CLI script to a flight controller over USB serial.

    pip install pyserial
    python tools/push_cli.py tune.txt                          # pick the flight controller port automatically
    python tools/push_cli.py tune.txt --port /dev/ttyACM0 --expect-version 4.5
    python tools/push_cli.py tune.txt --dry-run                # check every line, then leave without saving
    python tools/push_cli.py --list                            # show serial ports

Same protocol as src/transport/cliSession.ts in the web app:
  * '#' switches the flight controller from MSP to CLI mode;
  * one command at a time, waiting for the "\\r\\n# " prompt (plus a short quiet time, because
    output lines such as "# Betaflight / ..." also start with "# ");
  * the first "###ERROR ...###" stops the push and sends 'exit', which reboots without saving;
  * 'save' is only sent when every command was accepted (Betaflight then reboots).
"""
from __future__ import annotations

import argparse
import re
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover - message for users without pyserial
    sys.exit("pyserial is required: pip install pyserial")

PROMPT = re.compile(r"\r?\n# $")
ERROR = re.compile(r"###ERROR[^#]*###")
BANNER = re.compile(r"#\s*(\w+)\s*/\s*\S+\s*\(\w+\)\s+(\d+)\.(\d+)\.(\d+)")
# STMicroelectronics, Artery, Silicon Labs, FTDI, QinHeng (CH340)
FC_VENDOR_IDS = {0x0483, 0x2E3C, 0x10C4, 0x0403, 0x1A86}


class CliError(RuntimeError):
    pass


class Cli:
    def __init__(self, port: serial.Serial, timeout: float = 3.0, settle: float = 0.03):
        self.port = port
        self.timeout = timeout
        self.settle = settle

    def _read_until_prompt(self) -> str:
        buffer = ""
        deadline = time.monotonic() + self.timeout
        prompt_seen_at = None
        while time.monotonic() < deadline:
            chunk = self.port.read(self.port.in_waiting or 1).decode("utf-8", errors="replace")
            if chunk:
                buffer += chunk
                prompt_seen_at = time.monotonic() if PROMPT.search(buffer) else None
            elif prompt_seen_at is not None and time.monotonic() - prompt_seen_at >= self.settle:
                return buffer
        raise CliError(f"no CLI prompt within {self.timeout:.0f} s (output so far: {buffer[-120:]!r})")

    def enter(self) -> str:
        self.port.reset_input_buffer()
        self.port.write(b"#")
        return self._read_until_prompt()

    def send(self, command: str) -> tuple[str, str | None]:
        self.port.write((command + "\n").encode())
        raw = self._read_until_prompt()
        lines = [line.rstrip("\r") for line in PROMPT.sub("", raw).split("\n")]
        output = "\n".join(line for line in lines if line.strip() != command.strip()).strip()
        error = ERROR.search(raw)
        return output, (error.group(0) if error else None)

    def save(self, timeout: float = 6.0) -> tuple[bool, str]:
        self.port.write(b"save\n")
        buffer = ""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                chunk = self.port.read(self.port.in_waiting or 1).decode("utf-8", errors="replace")
            except (serial.SerialException, OSError):
                return True, buffer  # the port vanished: the flight controller rebooted after saving
            buffer += chunk
            if ERROR.search(buffer) and PROMPT.search(buffer):
                return False, ERROR.search(buffer).group(0)
            if "Rebooting" in buffer:
                return True, buffer
        return "saving" in buffer, buffer


def load_commands(path: str) -> list[str]:
    with open(path, encoding="utf-8") as handle:
        lines = [re.sub(r"#.*$", "", line).strip() for line in handle]
    return [line for line in lines if line]


def find_port() -> str:
    candidates = [p for p in list_ports.comports() if p.vid in FC_VENDOR_IDS]
    if len(candidates) == 1:
        return candidates[0].device
    if not candidates:
        sys.exit("No flight controller found. Plug it in (USB data cable) or pass --port.")
    sys.exit("Several possible ports: " + ", ".join(p.device for p in candidates) + ". Pass --port.")


def version_id(banner: str) -> str | None:
    match = BANNER.search(banner)
    if not match:
        return None
    major, minor = int(match.group(2)), int(match.group(3))
    return f"{major}.{minor}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("script", nargs="?", help="CLI script exported by TuneForge")
    parser.add_argument("--port", help="serial port (default: the only flight controller found)")
    parser.add_argument("--baud", type=int, default=115200, help="ignored by USB VCP, used by UART adapters")
    parser.add_argument("--expect-version", help="refuse to write unless the firmware reports this version, e.g. 4.5 or 2026.6")
    parser.add_argument("--dry-run", action="store_true", help="send every command but leave without saving")
    parser.add_argument("--list", action="store_true", help="list serial ports and exit")
    args = parser.parse_args(argv)

    if args.list:
        for p in list_ports.comports():
            vid = f"{p.vid:04x}" if p.vid is not None else "----"
            print(f"{p.device:20} {vid}  {p.description}")
        return 0
    if not args.script:
        parser.error("a script file is required")

    commands = load_commands(args.script)
    body = [c for c in commands if c != "save"]
    port_name = args.port or find_port()
    with serial.Serial(port_name, args.baud, timeout=0.05) as port:
        cli = Cli(port)
        cli.enter()
        banner, _ = cli.send("version")
        detected = version_id(banner)
        print(f"Connected to {port_name}: {banner.splitlines()[0] if banner else 'unknown firmware'}")
        if args.expect_version and detected != args.expect_version:
            port.write(b"exit\n")
            print(f"Firmware {detected} does not match --expect-version {args.expect_version}; nothing was changed.", file=sys.stderr)
            return 2
        for index, command in enumerate(body, start=1):
            output, error = cli.send(command)
            print(f"[{index:3}/{len(body)}] {command}")
            if error:
                port.write(b"exit\n")
                print(f"      {error}\nStopped: nothing was saved, the flight controller reboots with its previous settings.", file=sys.stderr)
                return 1
            if command.startswith("set ") and " set to " not in output:
                print(f"      warning: unexpected reply {output!r}")
        if args.dry_run or "save" not in commands:
            port.write(b"exit\n")
            print("Dry run: every command was accepted; left without saving.")
            return 0
        ok, detail = cli.save()
        if not ok:
            print(f"Save refused: {detail}", file=sys.stderr)
            return 1
        print("Saved. The flight controller is rebooting with the new settings.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
