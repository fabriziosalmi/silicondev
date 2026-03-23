"""Tests for Feature 3: Live Preview."""

import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from app.engine.project_detector import detect_project, ProjectType, _npm_or_pnpm


class TestProjectDetection:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_json(self, name: str, data: dict):
        (Path(self.tmpdir) / name).write_text(json.dumps(data))

    def test_vite_project(self):
        self._write_json("package.json", {
            "devDependencies": {"vite": "^5.0.0"},
            "scripts": {"dev": "vite"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.VITE
        assert "dev" in cmd
        assert port == 5173

    def test_nextjs_project(self):
        self._write_json("package.json", {
            "dependencies": {"next": "14.0.0", "react": "18.0.0"},
            "scripts": {"dev": "next dev"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.NEXTJS
        assert port == 3000

    def test_cra_project(self):
        self._write_json("package.json", {
            "dependencies": {"react-scripts": "5.0.0"},
            "scripts": {"start": "react-scripts start"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.CRA
        assert "start" in cmd

    def test_static_html(self):
        (Path(self.tmpdir) / "index.html").write_text("<html></html>")
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.STATIC
        assert "http.server" in cmd
        assert port == 3000

    def test_unknown_project(self):
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.UNKNOWN
        assert cmd is None
        assert port is None

    def test_svelte_project(self):
        self._write_json("package.json", {
            "devDependencies": {"@sveltejs/kit": "2.0.0", "svelte": "4.0.0"},
            "scripts": {"dev": "vite dev"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.SVELTE

    def test_astro_project(self):
        self._write_json("package.json", {
            "dependencies": {"astro": "4.0.0"},
            "scripts": {"dev": "astro dev"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.ASTRO
        assert port == 4321

    def test_generic_dev_script(self):
        self._write_json("package.json", {
            "scripts": {"dev": "some-framework dev"}
        })
        ptype, cmd, port = detect_project(self.tmpdir)
        assert cmd is not None
        assert "dev" in cmd

    def test_pnpm_detection(self):
        self._write_json("package.json", {
            "devDependencies": {"vite": "5.0.0"},
            "scripts": {"dev": "vite"}
        })
        (Path(self.tmpdir) / "pnpm-lock.yaml").write_text("lockfileVersion: 9")
        ptype, cmd, port = detect_project(self.tmpdir)
        assert cmd.startswith("pnpm")

    def test_yarn_detection(self):
        self._write_json("package.json", {
            "devDependencies": {"vite": "5.0.0"},
            "scripts": {"dev": "vite"}
        })
        (Path(self.tmpdir) / "yarn.lock").write_text("")
        ptype, cmd, port = detect_project(self.tmpdir)
        assert cmd.startswith("yarn")

    def test_bun_detection(self):
        self._write_json("package.json", {
            "devDependencies": {"vite": "5.0.0"},
            "scripts": {"dev": "vite"}
        })
        (Path(self.tmpdir) / "bun.lockb").write_bytes(b"")
        ptype, cmd, port = detect_project(self.tmpdir)
        assert cmd.startswith("bun")

    def test_fastapi_from_requirements(self):
        (Path(self.tmpdir) / "requirements.txt").write_text("fastapi==0.100.0\nuvicorn")
        (Path(self.tmpdir) / "main.py").write_text("app = FastAPI()")
        ptype, cmd, port = detect_project(self.tmpdir)
        assert ptype == ProjectType.FASTAPI
        assert "uvicorn" in cmd
        assert port == 8000

    def test_next_takes_priority_over_vite(self):
        """Next.js should be detected even if vite is also a dep."""
        self._write_json("package.json", {
            "dependencies": {"next": "14.0.0"},
            "devDependencies": {"vite": "5.0.0"},
            "scripts": {"dev": "next dev"}
        })
        ptype, _, _ = detect_project(self.tmpdir)
        assert ptype == ProjectType.NEXTJS

    def test_corrupted_package_json(self):
        (Path(self.tmpdir) / "package.json").write_text("not json {{{")
        ptype, cmd, port = detect_project(self.tmpdir)
        # Should fall through to UNKNOWN without crashing
        assert ptype == ProjectType.UNKNOWN


class TestNpmOrPnpm:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_default_npm(self):
        assert _npm_or_pnpm(Path(self.tmpdir), "dev") == "npm run dev"

    def test_pnpm(self):
        (Path(self.tmpdir) / "pnpm-lock.yaml").write_text("")
        assert _npm_or_pnpm(Path(self.tmpdir), "dev") == "pnpm dev"

    def test_yarn(self):
        (Path(self.tmpdir) / "yarn.lock").write_text("")
        assert _npm_or_pnpm(Path(self.tmpdir), "dev") == "yarn dev"

    def test_bun(self):
        (Path(self.tmpdir) / "bun.lockb").write_bytes(b"")
        assert _npm_or_pnpm(Path(self.tmpdir), "start") == "bun run start"
