# Releasing SiliconDev

How a signed and notarized macOS release is cut. The pipeline runs **locally** on the developer Mac — code-signing material never leaves the machine and is not stored as GitHub Actions secrets.

## Why local-only

- Apple Developer ID `.p12` and the app-specific password stay on disk, not in CI.
- A leaked GitHub secret would let anyone publish builds signed as us.
- Solo-dev project: there is no second engineer who needs to run a release without your machine.

CI (`ci.yml`) keeps doing lint/test/build (unsigned) on every push and PR. The deleted `release.yml` workflow used to try a CI build and only produced unsigned junk because it had no signing material.

## Pre-requisites (one-time)

1. **Apple Developer Program** active.
2. **Developer ID Application** certificate installed in your `login.keychain`. Verify with:
   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   You should see one identity with your Team ID in parentheses (e.g. `(7FC7ZTYMYU)`).
3. **App-specific password** generated at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Format `xxxx-xxxx-xxxx-xxxx`.
4. **`.env.local`** at the repo root (gitignored). Copy `.env.local.example` and fill:
   ```bash
   APPLE_ID="your.apple.id@example.com"
   APPLE_TEAM_ID="7FC7ZTYMYU"
   APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   ```
5. **Toolchain installed**:
   - `npm install` at the root and in `src/renderer/`
   - `make setup` for the backend venv
   - `backend/.venv/bin/pip install pyinstaller`
   - `backend/.venv/bin/python -m spacy download en_core_web_sm`

## Release flow

1. **Bump the version everywhere it appears.** The version is duplicated across 5 files (`package.json`, `src/renderer/package.json`, `backend/pyproject.toml`, `backend/app/version.py`, `README.md` badge). The `version_manager.py` script keeps them in sync; `npm version` only touches the root.

   ```bash
   # bump root package.json without creating a git tag
   npm version 0.14.2 --no-git-tag-version
   # then update the others manually OR use the helper
   backend/.venv/bin/python scripts/version_manager.py set --version 0.14.2 --apply
   ```

   `assert_synced` (run by every CI step and the pre-commit hook) will fail if any of the five drifts.

2. **Update `CHANGELOG.md`** with a new section at the top.

3. **Run the release script.**

   ```bash
   ./scripts/release.sh --version v0.14.2
   ```

   In sequence the script:
   1. Preflight: env vars, keychain identity, notarytool credentials, git state, version sync.
   2. Frontend build (`vite build` + `tsc` for main).
   3. Backend build (`pyinstaller spec/silicon_server.spec`).
   4. `electron-builder build --mac` — codesign + notarize the `.app`, package DMG and zip.
   5. `xcrun notarytool submit` the **DMG** itself (electron-builder only notarizes the `.app`).
   6. `xcrun stapler staple` the DMG so Gatekeeper accepts it offline.
   7. Verify: `stapler validate`, `codesign --verify --deep --strict`.
   8. Confirms (`y`/`N`) before creating + pushing the git tag and the GitHub release.
   9. Uploads the DMG and zip as release assets.

   Total time: ~17 min on an M-series Mac. Most of it is the Apple notary queue.

## Skip flags (for partial reruns)

| Flag | When to use |
|---|---|
| `--skip-build` | Reuse `release/*.dmg` and `*.zip` already built. Useful if you said "no" to the tag prompt and want to retry only the publish step. |
| `--skip-backend-build` | Reuse `backend/dist/silicon_server`. Saves ~80 s when you've only touched frontend code. |
| `--replace` | The GitHub release for this version already exists — delete and re-upload its mac assets. |
| `--no-publish` | Build and sign locally, do not push tag or upload to GitHub. Use to test the pipeline. |
| `--dry-run` | Run preflight only, then exit. No build, no upload. |
| `-y` / `--yes` | Skip confirmation prompts. Use carefully — the prompts guard tag push and asset replacement. |

## Recovery — common scenarios

### "Aborted: cannot publish without a tag"

You answered `n` to the tag prompt. The DMG is signed and stapled in `release/` and notarization is already done. To finish:

```bash
./scripts/release.sh --version v0.14.2 --skip-build
```

The script detects the existing stapled DMG and goes straight to publish.

### Tag already exists, asset upload mismatch

```bash
./scripts/release.sh --version v0.14.2 --skip-build --replace
```

`--replace` deletes the existing mac assets on the GitHub release and re-uploads the local ones.

### "Tag version (X) does not match repository version (Y)"

The 5 version sources are out of sync. Run:

```bash
backend/.venv/bin/python scripts/version_manager.py show
```

If it errors with mismatch list, set them all explicitly:

```bash
backend/.venv/bin/python scripts/version_manager.py set --version 0.14.2 --apply
```

### Notarization rejected

The script prints the submission ID. Get the detailed log with:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

Most common causes: a binary inside the bundle is not signed (electron-builder usually catches this), or the entitlements claim a capability the app cert doesn't allow.

### Verify a published DMG is actually accepted by Gatekeeper

`spctl` on your machine may say `accepted, source=no usable signature, override=security disabled` if you've ever run `sudo spctl --master-disable`. The truth comes from `stapler validate`:

```bash
xcrun stapler validate release/SiliconDev-0.14.2.dmg
# expected: "The validate action worked!"
```

For a realistic Gatekeeper test, simulate a Safari download:

```bash
cp release/SiliconDev-0.14.2.dmg /tmp/test.dmg
xattr -w com.apple.quarantine "0083;$(printf '%x' $(date +%s));Safari;|com.apple.Safari" /tmp/test.dmg
spctl -a -vv -t open --context context:primary-signature /tmp/test.dmg
# expected: "source=Notarized Developer ID"
```

## Mark old releases as superseded

If a previous release shipped unsigned (everything ≤ v0.14.0 in this repo), don't delete it — just label it so users find the signed one:

```bash
gh release edit v0.14.0 --repo fabriziosalmi/silicondev --notes "$(cat <<'EOF'
> ⚠️ **Superseded by [v0.14.2](https://github.com/fabriziosalmi/silicondev/releases/tag/v0.14.2)** — same code, signed and notarized.
EOF
)"
```

## What the script never does

- It never pushes to `main` or any non-tag ref.
- It never re-signs an existing remote release without `--replace`.
- It never reads the Apple credentials from CI — only from `.env.local` or the local shell.
- It never skips notarization. If notary rejects the DMG, the script aborts before touching GitHub.
