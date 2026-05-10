#!/usr/bin/env bash
#
# SiliconDev release script — local build, sign, notarize, publish.
#
# Reads Apple credentials from .env.local (gitignored) so you don't have to
# export them every time. Never sends secrets to GitHub Actions.
#
# Usage: scripts/release.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ─── Colors ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
    C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'
    C_BLUE=$'\033[0;34m'; C_CYAN=$'\033[0;36m'
else
    C_RESET=''; C_DIM=''; C_BOLD=''
    C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

info()  { printf "${C_CYAN}▸${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$*"; }
err()   { printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; }
die()   { err "$*"; exit 1; }
step()  { printf "\n${C_BOLD}${C_BLUE}━━━ %s ━━━${C_RESET}\n" "$*"; }
dim()   { printf "${C_DIM}%s${C_RESET}\n" "$*"; }

confirm() {
    local prompt="$1"
    if [[ $ASSUME_YES -eq 1 ]]; then
        info "$prompt → auto-confirmed (-y)"
        return 0
    fi
    read -r -p "$(printf "${C_YELLOW}?${C_RESET} %s [y/N] " "$prompt")" reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

timer_start() { TIMER_START=$SECONDS; }
timer_end()   { printf "${C_DIM}  (%ds)${C_RESET}\n" $((SECONDS - TIMER_START)); }

# ─── Defaults ─────────────────────────────────────────────────────────────
SKIP_BUILD=0
SKIP_BACKEND_BUILD=0
DRY_RUN=0
REPLACE_ASSETS=0
PUBLISH=1
ASSUME_YES=0
TAG=""
RELEASE_REPO="${RELEASE_REPO:-fabriziosalmi/silicondev}"

usage() {
    cat <<EOF
${C_BOLD}SiliconDev release — build, sign, notarize, publish${C_RESET}

${C_BOLD}USAGE${C_RESET}
    scripts/release.sh [options]

${C_BOLD}OPTIONS${C_RESET}
    -v, --version TAG        Release version (e.g. v0.14.1). Default: read from package.json
    --skip-build             Reuse existing release/*.dmg and *.zip (skip vite/tsc/electron-builder)
    --skip-backend-build     Reuse existing backend/dist/silicon_server (skip PyInstaller)
    --replace                If the GitHub release already exists, delete and re-upload mac assets
    --no-publish             Build and sign locally, do not push tag or upload to GitHub
    -y, --yes                Skip confirmation prompts (use carefully)
    --dry-run                Print actions without executing
    -h, --help               Show this help

${C_BOLD}REQUIRED ENV${C_RESET}  (read from .env.local in repo root, or your shell)
    APPLE_ID                       Your Apple ID email
    APPLE_TEAM_ID                  Developer Team ID (e.g. 7FC7ZTYMYU)
    APPLE_APP_SPECIFIC_PASSWORD    From appleid.apple.com → App-Specific Passwords

${C_BOLD}EXAMPLES${C_RESET}
    # Full release of the version in package.json
    scripts/release.sh --version v0.14.1

    # Re-upload signed artifacts to an existing release
    scripts/release.sh --version v0.14.0 --skip-build --replace

    # Test build locally without publishing
    scripts/release.sh --no-publish

EOF
}

# ─── Arg parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -v|--version)         TAG="$2"; shift 2 ;;
        --skip-build)         SKIP_BUILD=1; shift ;;
        --skip-backend-build) SKIP_BACKEND_BUILD=1; shift ;;
        --replace)            REPLACE_ASSETS=1; shift ;;
        --no-publish)         PUBLISH=0; shift ;;
        -y|--yes)             ASSUME_YES=1; shift ;;
        --dry-run)            DRY_RUN=1; shift ;;
        -h|--help)            usage; exit 0 ;;
        *)                    die "Unknown option: $1 (try --help)" ;;
    esac
done

# ─── Load .env.local ──────────────────────────────────────────────────────
if [[ -f .env.local ]]; then
    dim "Loading .env.local"
    set -a
    # shellcheck disable=SC1091
    source .env.local
    set +a
fi

# ─── Preflight ────────────────────────────────────────────────────────────
step "Preflight"

PKG_VERSION=$(node -p "require('./package.json').version")
if [[ -z "$TAG" ]]; then
    TAG="v$PKG_VERSION"
    info "Version not specified, using package.json: ${C_BOLD}$TAG${C_RESET}"
else
    EXPECTED="v$PKG_VERSION"
    if [[ "$TAG" != "$EXPECTED" ]]; then
        warn "Tag $TAG does not match package.json version $PKG_VERSION."
        warn "Bump it first:  npm version ${TAG#v} --no-git-tag-version"
        die "Aborting due to version mismatch"
    fi
    info "Version: ${C_BOLD}$TAG${C_RESET}"
fi

PLAIN_VERSION="${TAG#v}"
DMG="release/SiliconDev-${PLAIN_VERSION}.dmg"
ZIP="release/SiliconDev-${PLAIN_VERSION}-mac.zip"

# Required env vars
for var in APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
        err "Missing env var: $var"
        err "Set it in .env.local (copy from .env.local.example) or your shell"
        exit 1
    fi
done
ok "Apple credentials present (APPLE_ID=${APPLE_ID})"

# Required tools
MISSING=()
for cmd in gh node npm xcrun codesign jq; do
    command -v "$cmd" >/dev/null 2>&1 || MISSING+=("$cmd")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
    die "Missing required tools: ${MISSING[*]}"
fi
ok "Required tools present"

# Backend venv
if [[ ! -x "backend/.venv/bin/python" ]]; then
    die "Backend venv missing at backend/.venv. Run: make setup"
fi
ok "Backend venv present"

# PyInstaller
if [[ $SKIP_BACKEND_BUILD -eq 0 && ! -x "backend/.venv/bin/pyinstaller" ]]; then
    warn "PyInstaller not in venv, installing..."
    backend/.venv/bin/pip install pyinstaller >/dev/null
    ok "PyInstaller installed"
fi

# Codesign identity
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application.*(${APPLE_TEAM_ID})"; then
    die "Developer ID Application identity for team ${APPLE_TEAM_ID} not found in keychain"
fi
ok "Codesign identity available (team ${APPLE_TEAM_ID})"

# Notarization credentials test
info "Testing notarization credentials..."
if ! xcrun notarytool history \
        --apple-id "$APPLE_ID" \
        --team-id "$APPLE_TEAM_ID" \
        --password "$APPLE_APP_SPECIFIC_PASSWORD" >/dev/null 2>&1; then
    die "notarytool credentials rejected (check APPLE_APP_SPECIFIC_PASSWORD)"
fi
ok "Notarization credentials valid"

# Git state — informational, not blocking
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
GIT_DIRTY=""
if ! git diff-index --quiet HEAD --; then GIT_DIRTY="${C_YELLOW}(dirty)${C_RESET}"; fi
info "Git: $GIT_BRANCH $GIT_DIRTY"

if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY RUN — no actions will run past preflight"
    exit 0
fi

# ─── Build ────────────────────────────────────────────────────────────────
if [[ $SKIP_BUILD -eq 1 ]]; then
    step "Build (skipped)"
    [[ -f "$DMG" && -f "$ZIP" ]] || die "Skip requested but artifacts missing: $DMG / $ZIP"
    ok "Reusing $DMG and $ZIP"
else
    step "Build frontend"
    timer_start
    npm run build
    timer_end
    ok "Frontend built"

    if [[ $SKIP_BACKEND_BUILD -eq 1 ]]; then
        step "Backend (skipped)"
        [[ -d "backend/dist/silicon_server" ]] || die "Skip requested but backend/dist/silicon_server missing"
        ok "Reusing backend bundle"
    else
        step "Build backend (PyInstaller)"
        timer_start
        (cd backend && .venv/bin/python -m PyInstaller spec/silicon_server.spec --clean --noconfirm)
        timer_end
        ok "Backend built"
    fi

    step "Package + sign + notarize .app"
    timer_start
    npx electron-builder build --mac
    timer_end
    ok ".app signed and notarized via electron-builder"
fi

[[ -f "$DMG" ]] || die "Expected DMG not found: $DMG"
[[ -f "$ZIP" ]] || die "Expected ZIP not found: $ZIP"

# ─── Notarize + staple DMG ────────────────────────────────────────────────
step "Notarize + staple DMG"

if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
    ok "DMG already stapled, skipping submission"
else
    info "Submitting $DMG to Apple notary (typically 2–10 min)..."
    timer_start
    xcrun notarytool submit "$DMG" \
        --apple-id "$APPLE_ID" \
        --team-id "$APPLE_TEAM_ID" \
        --password "$APPLE_APP_SPECIFIC_PASSWORD" \
        --wait
    timer_end
    ok "Apple accepted DMG"

    info "Stapling ticket onto DMG..."
    xcrun stapler staple "$DMG"
    ok "DMG stapled"
fi

# ─── Verify ───────────────────────────────────────────────────────────────
step "Verify artifacts"

xcrun stapler validate "$DMG" >/dev/null || die "DMG stapler validation failed"
ok "DMG stapler ticket valid"

if codesign --verify --deep --strict "release/mac/SiliconDev.app" 2>/dev/null; then
    ok ".app signature valid"
else
    warn ".app verification failed (release/mac/SiliconDev.app may have been removed)"
fi

DMG_SIZE=$(du -h "$DMG" | cut -f1)
ZIP_SIZE=$(du -h "$ZIP" | cut -f1)
info "Artifacts ready:"
printf "    %s  ${C_DIM}(%s)${C_RESET}\n" "$DMG" "$DMG_SIZE"
printf "    %s  ${C_DIM}(%s)${C_RESET}\n" "$ZIP" "$ZIP_SIZE"

# ─── Publish ──────────────────────────────────────────────────────────────
if [[ $PUBLISH -eq 0 ]]; then
    step "Publish (skipped — --no-publish)"
    ok "Local artifacts ready. Re-run without --no-publish to upload."
    exit 0
fi

step "Publish to GitHub ($RELEASE_REPO)"

RELEASE_EXISTS=0
if gh release view "$TAG" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
    RELEASE_EXISTS=1
fi

if [[ $RELEASE_EXISTS -eq 1 ]]; then
    if [[ $REPLACE_ASSETS -eq 1 ]]; then
        warn "Release $TAG already exists. Will REPLACE its mac assets."
        confirm "Delete + re-upload $DMG and $ZIP on $TAG?" \
            || die "Aborted by user"
        gh release delete-asset "$TAG" "SiliconDev-${PLAIN_VERSION}.dmg" \
            --repo "$RELEASE_REPO" --yes 2>/dev/null || true
        gh release delete-asset "$TAG" "SiliconDev-${PLAIN_VERSION}-mac.zip" \
            --repo "$RELEASE_REPO" --yes 2>/dev/null || true
        ok "Old assets removed"
    else
        die "Release $TAG already exists. Use --replace to overwrite, or pick a new --version."
    fi
else
    if ! git rev-parse "$TAG" >/dev/null 2>&1; then
        info "Tag $TAG does not exist locally."
        confirm "Create tag $TAG and push to origin?" \
            || die "Aborted: cannot publish without a tag"
        git tag -a "$TAG" -m "Release $TAG"
        git push origin "$TAG"
        ok "Tag $TAG created and pushed"
    fi

    info "Creating GitHub release..."
    gh release create "$TAG" \
        --repo "$RELEASE_REPO" \
        --title "SiliconDev $TAG" \
        --generate-notes
    ok "Release $TAG created"
fi

info "Uploading assets..."
gh release upload "$TAG" "$DMG" "$ZIP" --repo "$RELEASE_REPO" --clobber
ok "Assets uploaded"

REL_URL="https://github.com/${RELEASE_REPO}/releases/tag/${TAG}"
step "Done"
ok "Release published"
printf "    ${C_BOLD}%s${C_RESET}\n" "$REL_URL"
