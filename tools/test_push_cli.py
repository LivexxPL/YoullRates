"""Tests for push_cli.py against a fake Betaflight CLI on a pseudo-terminal (Linux/macOS).

    pip install pyserial
    python -m unittest discover -s tools -p "test_*.py"
"""
from __future__ import annotations

import os
import pty
import tempfile
import threading
import unittest

import push_cli

BANNER = "# Betaflight / STM32F7X2 (S7X2) 4.5.2 Nov 1 2026 / 17:22:46 (7dcc851) MSP API: 1.46"
KNOWN = {"p_roll", "d_min_roll", "roll_srate", "gyro_lpf2_static_hz"}


class FakeFlightController(threading.Thread):
    """Just enough of the Betaflight CLI: prompt, echo, set, batch error flag, save/exit reboot."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.master, slave = pty.openpty()
        self.path = os.ttyname(slave)
        self.slave = slave
        self.values: dict[str, str] = {}
        self.saved: dict[str, str] | None = None
        self.batch_error = False

    def emit(self, text: str) -> None:
        os.write(self.master, text.encode())

    def run(self) -> None:
        line, in_cli = "", False
        while True:
            try:
                data = os.read(self.master, 1024).decode()
            except OSError:
                return
            for ch in data:
                if not in_cli:
                    if ch == "#":
                        in_cli = True
                        self.emit("\r\nEntering CLI Mode, type 'exit' to reboot, or 'help'\r\n\r\n# ")
                    continue
                if ch in "\r\n":
                    if line and not self.handle(line):
                        return
                    line = ""
                else:
                    line += ch

    def handle(self, line: str) -> bool:
        self.emit(line + "\r\n")
        if line == "version":
            self.emit(BANNER + "\r\n")
        elif line == "batch start":
            self.batch_error = False
            self.emit("Command batch started\r\n")
        elif line.startswith("set "):
            name, value = (part.strip() for part in line[4:].split("=", 1))
            if name in KNOWN:
                self.values[name] = value
                self.emit(f"{name} set to {value}\r\n")
            else:
                self.batch_error = True
                self.emit(f"###ERROR IN set: INVALID NAME: {name} = {value}###\r\n")
        elif line in ("save", "exit"):
            if line == "save" and self.batch_error:
                self.emit("###ERROR IN save: PLEASE FIX ERRORS THEN 'SAVE'###\r\n\r\n# ")
                return True
            if line == "save":
                self.saved = dict(self.values)
                self.emit("\r\n# saving\r\n")
            self.emit("\r\nRebooting")
            return False
        self.emit("\r\n# ")
        return True


def write_script(lines: list[str]) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
    handle.write("# TuneForge FPV test script\n\n" + "\n".join(lines) + "\n")
    handle.close()
    return handle.name


class PushCliTest(unittest.TestCase):
    def run_push(self, lines: list[str], *extra: str) -> tuple[int, FakeFlightController]:
        fc = FakeFlightController()
        fc.start()
        code = push_cli.main([write_script(lines), "--port", fc.path, *extra])
        fc.join(timeout=2)
        return code, fc

    def test_saves_when_every_command_is_accepted(self) -> None:
        code, fc = self.run_push(["batch start", "profile 0", "set p_roll = 52  # inline comment", "set d_min_roll = 34", "save"], "--expect-version", "4.5")
        self.assertEqual(code, 0)
        self.assertEqual(fc.saved, {"p_roll": "52", "d_min_roll": "34"})

    def test_stops_at_first_error_without_saving(self) -> None:
        code, fc = self.run_push(["batch start", "set p_roll = 52", "set d_max_roll = 40", "set roll_srate = 85", "save"])
        self.assertEqual(code, 1)
        self.assertIsNone(fc.saved)
        self.assertNotIn("roll_srate", fc.values)

    def test_refuses_other_firmware_versions(self) -> None:
        code, fc = self.run_push(["set p_roll = 52", "save"], "--expect-version", "2026.6")
        self.assertEqual(code, 2)
        self.assertEqual(fc.values, {})

    def test_dry_run_never_saves(self) -> None:
        code, fc = self.run_push(["set p_roll = 52", "save"], "--dry-run")
        self.assertEqual(code, 0)
        self.assertIsNone(fc.saved)


if __name__ == "__main__":
    unittest.main()
