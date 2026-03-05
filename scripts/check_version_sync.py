#!/usr/bin/env python3
"""Check version consistency across project files and optional git tag context."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from version_manager import read_versions, assert_synced  # noqa: E402

TAG_RE = re.compile(r"^v(\d+\.\d+\.\d+)$")


def main() -> int:
    versions = read_versions()
    try:
        assert_synced(versions)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    version = versions.package
    print(f"Version sync OK: {version}")

    ref = os.getenv("GITHUB_REF", "")
    if ref.startswith("refs/tags/"):
        tag = ref.removeprefix("refs/tags/")
        m = TAG_RE.match(tag)
        if not m:
            print(f"ERROR: Tag '{tag}' is not valid SemVer tag format (expected vX.Y.Z)")
            return 1
        tag_version = m.group(1)
        if tag_version != version:
            print(
                f"ERROR: Tag version ({tag_version}) does not match repository version ({version})"
            )
            return 1
        print(f"Tag/version alignment OK: {tag}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
