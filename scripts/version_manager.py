#!/usr/bin/env python3
"""SemVer version manager for SiliconDev."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
PYPROJECT = ROOT / "backend" / "pyproject.toml"
README = ROOT / "README.md"

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
README_BADGE_RE = re.compile(r"(version-)(\d+\.\d+\.\d+)(-blue)")


@dataclass(frozen=True)
class Versions:
    package: str
    backend: str
    readme_badge: str


def _parse_semver(version: str) -> tuple[int, int, int]:
    m = SEMVER_RE.match(version)
    if not m:
        raise ValueError(f"Invalid SemVer: {version}")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def _format_semver(parts: tuple[int, int, int]) -> str:
    return f"{parts[0]}.{parts[1]}.{parts[2]}"


def _read_package_version() -> str:
    payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return payload["version"]


def _read_pyproject_version() -> str:
    text = PYPROJECT.read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$', text, re.MULTILINE)
    if not m:
        raise ValueError("Cannot find [project].version in backend/pyproject.toml")
    return m.group(1)


def _read_readme_badge_version() -> str:
    text = README.read_text(encoding="utf-8")
    m = README_BADGE_RE.search(text)
    if not m:
        raise ValueError("Cannot find version badge in README.md")
    return m.group(2)


def read_versions() -> Versions:
    return Versions(
        package=_read_package_version(),
        backend=_read_pyproject_version(),
        readme_badge=_read_readme_badge_version(),
    )


def assert_synced(v: Versions) -> None:
    values = {v.package, v.backend, v.readme_badge}
    if len(values) != 1:
        raise ValueError(
            "Version mismatch: "
            f"package.json={v.package}, backend/pyproject.toml={v.backend}, README badge={v.readme_badge}"
        )


def bump(version: str, bump_type: str) -> str:
    major, minor, patch = _parse_semver(version)
    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    elif bump_type == "patch":
        patch += 1
    else:
        raise ValueError(f"Unknown bump type: {bump_type}")
    return _format_semver((major, minor, patch))


def _write_package_version(version: str) -> None:
    payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    payload["version"] = version
    PACKAGE_JSON.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")


def _write_pyproject_version(version: str) -> None:
    text = PYPROJECT.read_text(encoding="utf-8")
    new_text, count = re.subn(
        r'^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"\s*$',
        f'version = "{version}"',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise ValueError("Failed to update backend/pyproject.toml version")
    PYPROJECT.write_text(new_text, encoding="utf-8")


def _write_readme_badge_version(version: str) -> None:
    text = README.read_text(encoding="utf-8")
    new_text, count = README_BADGE_RE.subn(rf"\g<1>{version}\g<3>", text, count=1)
    if count != 1:
        raise ValueError("Failed to update README version badge")
    README.write_text(new_text, encoding="utf-8")


def apply_version(version: str) -> None:
    _parse_semver(version)
    _write_package_version(version)
    _write_pyproject_version(version)
    _write_readme_badge_version(version)


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage SiliconDev semantic versions")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("show", help="Show current synchronized version")

    bump_p = sub.add_parser("bump", help="Bump version by type")
    bump_p.add_argument("--type", choices=["major", "minor", "patch"], required=True)
    bump_p.add_argument("--apply", action="store_true", help="Apply changes to files")

    set_p = sub.add_parser("set", help="Set explicit version")
    set_p.add_argument("--version", required=True)
    set_p.add_argument("--apply", action="store_true", help="Apply changes to files")

    args = parser.parse_args()

    versions = read_versions()
    assert_synced(versions)
    current = versions.package

    if args.cmd == "show":
        print(current)
        return 0

    if args.cmd == "bump":
        target = bump(current, args.type)
    else:
        _parse_semver(args.version)
        target = args.version

    if not args.apply:
        print(f"{current} -> {target}")
        print("Dry-run. Use --apply to write files.")
        return 0

    apply_version(target)
    print(f"Updated version: {current} -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
