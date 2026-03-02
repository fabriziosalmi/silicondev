VENV   := backend/.venv
PYTHON := $(VENV)/bin/python
PIP    := $(VENV)/bin/pip
DEPS   := $(VENV)/.deps

.PHONY: setup run test clean

# ── Setup ────────────────────────────────────────────────
# Creates the venv, installs Python + JS deps.
# Re-runs pip only when pyproject.toml changes.

setup: $(DEPS) node_modules

$(DEPS): backend/pyproject.toml
	python3 -m venv $(VENV)
	$(PIP) install -e "backend/.[dev]"
	@touch $@

node_modules: package.json
	npm install
	@touch $@

# ── Run ──────────────────────────────────────────────────
# Starts both backend and frontend in dev mode.

run: $(DEPS) node_modules
	npm run dev

# ── Test ─────────────────────────────────────────────────

test: $(DEPS)
	$(PYTHON) -m pytest backend/tests/ -v --ignore=backend/tests/test_shield.py

# ── Clean ────────────────────────────────────────────────

clean:
	rm -rf $(VENV) node_modules dist out
