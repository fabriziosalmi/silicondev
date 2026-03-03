#!/usr/bin/env python3
"""Pre-flight check for SiliconDev v0.6.1 release build.

Run this BEFORE PyInstaller + electron-builder to catch problems early.
Usage: python scripts/pre_flight_check.py
"""

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

EXPECTED_VERSION = "0.6.1"
CHECKS_PASSED = 0
CHECKS_FAILED = 0

# ANSI colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD = "\033[1m"


def ok(msg: str):
    global CHECKS_PASSED
    CHECKS_PASSED += 1
    print(f"  {GREEN}PASS{RESET}  {msg}")


def fail(msg: str):
    global CHECKS_FAILED
    CHECKS_FAILED += 1
    print(f"  {RED}FAIL{RESET}  {msg}")


def warn(msg: str):
    print(f"  {YELLOW}WARN{RESET}  {msg}")


def section(title: str):
    print(f"\n{BOLD}--- {title} ---{RESET}")


# ── 1. Python dependencies ──────────────────────────────────

section("Python Dependencies")

for mod_name in ["mlx", "mlx_lm", "fastapi", "uvicorn", "presidio_analyzer"]:
    try:
        __import__(mod_name)
        ok(f"{mod_name} importable")
    except Exception as e:
        fail(f"{mod_name} NOT importable: {type(e).__name__}: {e}")

# Check MLX Metal backend is functional (not just importable)
try:
    import mlx.core as mx
    _ = mx.array([1.0, 2.0, 3.0])
    ok("mlx.core array creation works (Metal backend functional)")
except Exception as e:
    fail(f"mlx.core array creation failed: {e}")


# ── 2. Port 8000 free ───────────────────────────────────────

section("Port Availability")

for port in [8000, 8001]:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        sock.bind(("127.0.0.1", port))
        sock.close()
        ok(f"Port {port} is free")
    except OSError:
        fail(f"Port {port} is in use — kill the process before building")


# ── 3. Data directory permissions ────────────────────────────

section("Data Directory")

data_dir = Path.home() / ".silicon-studio"
if data_dir.exists():
    if os.access(data_dir, os.R_OK | os.W_OK):
        ok(f"{data_dir} exists with read/write access")
    else:
        fail(f"{data_dir} exists but lacks read/write permissions")
else:
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        ok(f"{data_dir} created successfully")
    except OSError as e:
        fail(f"Cannot create {data_dir}: {e}")


# ── 4. Version alignment ────────────────────────────────────

section(f"Version Alignment (expected: {EXPECTED_VERSION})")

root = Path(__file__).resolve().parent.parent

# package.json
pkg_json = root / "package.json"
try:
    pkg = json.loads(pkg_json.read_text())
    v = pkg.get("version", "")
    if v == EXPECTED_VERSION:
        ok(f"package.json: {v}")
    else:
        fail(f"package.json: {v} (expected {EXPECTED_VERSION})")
except Exception as e:
    fail(f"package.json unreadable: {e}")

# pyproject.toml
pyproject = root / "backend" / "pyproject.toml"
try:
    text = pyproject.read_text()
    for line in text.splitlines():
        if line.strip().startswith("version"):
            v = line.split("=")[1].strip().strip('"').strip("'")
            if v == EXPECTED_VERSION:
                ok(f"pyproject.toml: {v}")
            else:
                fail(f"pyproject.toml: {v} (expected {EXPECTED_VERSION})")
            break
    else:
        fail("pyproject.toml: no version field found")
except Exception as e:
    fail(f"pyproject.toml unreadable: {e}")

# FastAPI app version in main.py
main_py = root / "backend" / "main.py"
try:
    text = main_py.read_text()
    import re
    match = re.search(r'version="([^"]+)"', text)
    if match:
        v = match.group(1)
        if v == EXPECTED_VERSION:
            ok(f"backend/main.py FastAPI version: {v}")
        else:
            fail(f"backend/main.py FastAPI version: {v} (expected {EXPECTED_VERSION})")
    else:
        fail("backend/main.py: no version= string found")
except Exception as e:
    fail(f"backend/main.py unreadable: {e}")


# ── 5. Build tools available ────────────────────────────────

section("Build Tools")

for cmd, check_args in [
    ("node", ["--version"]),
    ("npm", ["--version"]),
    ("python3", ["--version"]),
]:
    try:
        result = subprocess.run(
            [cmd] + check_args,
            capture_output=True, text=True, timeout=10,
        )
        ver = result.stdout.strip() or result.stderr.strip()
        ok(f"{cmd}: {ver}")
    except FileNotFoundError:
        fail(f"{cmd} not found in PATH")
    except Exception as e:
        fail(f"{cmd} check failed: {e}")

# PyInstaller
try:
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--version"],
        capture_output=True, text=True, timeout=10,
    )
    ver = result.stdout.strip()
    if ver:
        ok(f"PyInstaller: {ver}")
    else:
        fail("PyInstaller not installed (pip install pyinstaller)")
except Exception:
    fail("PyInstaller not installed")


# ── 6. Entitlements file ────────────────────────────────────

section("macOS Entitlements")

ent_path = root / "resources" / "entitlements.mac.plist"
if ent_path.exists():
    ent_text = ent_path.read_text()
    required_keys = [
        "com.apple.security.cs.allow-jit",
        "com.apple.security.cs.disable-library-validation",
        "com.apple.security.cs.allow-unsigned-executable-memory",
    ]
    for key in required_keys:
        if key in ent_text:
            ok(f"Entitlement present: {key}")
        else:
            fail(f"Entitlement MISSING: {key}")
else:
    fail(f"Entitlements file not found: {ent_path}")


# ── 7. Architecture check ───────────────────────────────────

section("Architecture")

import platform
arch = platform.machine()
if arch == "arm64":
    ok(f"Running on arm64 (Apple Silicon)")
else:
    fail(f"Running on {arch} — build must happen on arm64 for MLX")


# ── Summary ─────────────────────────────────────────────────

print(f"\n{BOLD}{'='*50}{RESET}")
print(f"  {GREEN}{CHECKS_PASSED} passed{RESET}  {RED}{CHECKS_FAILED} failed{RESET}")

if CHECKS_FAILED > 0:
    print(f"\n  {RED}FIX ALL FAILURES BEFORE BUILDING{RESET}\n")
    sys.exit(1)
else:
    print(f"\n  {GREEN}All clear — ready to build{RESET}\n")
    sys.exit(0)
