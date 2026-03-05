# Versioning Policy

SiliconDev follows **Semantic Versioning**: `MAJOR.MINOR.PATCH`.

## Bump Rules

- **PATCH** (`0.1.0 -> 0.1.1`) for bug fixes and non-breaking internal improvements.
- **MINOR** (`0.1.0 -> 0.2.0`) for new features that are backward compatible.
- **MAJOR** (`0.x.y -> 1.0.0`, `1.x.y -> 2.0.0`) for breaking changes.

## Breaking Change Definition

A change is breaking when it requires users/integrators to update behavior or configuration to keep working, for example:

- API contract changes (request/response format, removed endpoints, renamed fields)
- CLI/automation behavior changes that break existing scripts
- Removed or incompatible configuration keys
- Data format/storage changes without backward compatibility

## Single Source of Truth

Version must be synchronized in:

- `package.json` (`version`)
- `backend/pyproject.toml` (`[project].version`)
- `README.md` version badge

## Required Workflow

1. Choose bump type (`major`, `minor`, `patch`) from change scope.
2. Run `python scripts/version_manager.py bump --type <type> --apply`.
3. Run `make test`.
4. Commit and push.
5. Create or move tag `vX.Y.Z` to the release commit.

## Guardrails

- CI fails if versions are out of sync.
- Release workflow fails if tag version does not match repository version.
