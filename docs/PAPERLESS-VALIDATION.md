# Paperless folders: Yuvomi 2.85.0 compatibility, 2026-11-04

Release checked: `v2.85.0`, commit
`3477e2a1d649085dbf98e555686127e36f143263`.
Published Paperless fork checked: `feat/paperless-view-folders`, commit
`7c1c8e418657e365b9bf0692bca247d00487add2` (based on 2.84.0).
The compatibility result is on `compat/paperless-yuvomi-2.85.0`.

## Finding and correction

The old branch cannot be merged with 2.85.0 unchanged: both assigned migration
276, and Git also reports conflicts in package.json and CHANGELOG.md. The new
upstream version uses 276 for pantry product minimums and 277 for task rotation.
A simple renumbering is insufficient for an installation that already ran the
published fork: its ledger would skip the upstream pantry migration.

The compatibility branch keeps upstream migrations 1-277 byte-for-byte and
adds the Paperless table as migration 278, with its matching test-schema mirror.
Existing folder rows are preserved. Its transactional afterUp hook recognizes
only the exact legacy Paperless description at version 276, runs upstream's
original pantry SQL if the product minimum column is missing, and corrects the
ledger description. Already present product minimums are not overwritten.
A failed backfill rolls back its column and marker correction together and can
be retried. No ordinary application request rewrites the migration ledger.

All upstream test-chain additions and translations were retained; the extension's
three suites are registered and documented. Released changelog sections are
unchanged. No Paperless filter, route or component behavior needed a further
change for this release.

## Checks on the adapted branch

| Suite group | Cases | Result |
| --- | ---: | --- |
| Paperless filters, routes, media and sharing | 23 | Passed |
| Upgrade from stock 2.84, stock 2.85, legacy fork; retry and rollback | 5 | Passed |
| DMS adapter, routes and target guard | 69 | Passed |
| Documents, Documents UX and viewer focus | 148 | Passed |
| Module read-only/ownership UI | 234 | Passed |
| General API | 57 | Passed |
| Schema mirror, append-only guard, migration concurrency tolerance | 21 | Passed |
| OpenAPI structure, coverage and reasons | 31 | Passed |
| Frontend audit, control conventions and typography | 743 | Passed |
| Restore gate and asynchronous response guard | 14 | Passed |
| Test-chain registration | 12 | Passed |
| Locale key/placeholder and translation baseline | 186 | Passed |
| Upstream pantry product minimums and task rotation | 51 | Passed |
| Shared-expense guest auth scope | 10 | Passed |
| Changelog including release-tag parity | 42 | Passed |
| General document storage | 85 | 82 passed, 3 failed; identical on unmodified release |
| Full-app Paperless browser integration | 2 | Passed |

The 28 passing non-browser suites contain 1,646 cases; both browser cases also pass. The five upgrade tests
use the real migration runner and include a frozen copy of the database schema
shipped by the published fork; they preserve the saved binding and its access
settings, check the pantry backfill and timestamps, repeat migration, and
inject a failed backfill to verify rollback and retry.

The three document-storage failures are connection-test timeouts in:

- protected config changes reject DNS rebinding before the WebDAV request;
- trusted environment WebDAV targets may use private network addresses;
- DOCUMENT_STORAGE_WEBDAV_ALLOW_PRIVATE_NETWORK opt-in allows UI-configured private targets.

The same 82/85 result and same three failing cases were reproduced in a separate
checkout of unmodified `v2.85.0`. They are not introduced by the Paperless changes;
a completely green document-storage suite is not claimed for this environment.

The browser cases run the actual application and a loopback Paperless server:
folder creation/sharing, pagination beyond 50 documents, changed source filters,
media membership enforcement, mobile navigation, disconnection and the optional
module. Initial Chromium failures were traced to its external font configuration;
using system fonts fixed them. CDP pipe transport and serverless runtime flags
were used for this environment.

Environment: Node 24.22.1; Chromium 153.0.8010.0. The browser runtime is external
to the project; no dependency, test assertion or application code was relaxed
to accommodate the environment.

## Limits and deployment

This is a targeted compatibility run, not the complete npm test chain or release
browser handrail. Full CI on both supported Node versions remains to be run.
No Docker build, production database or user's real Paperless instance was used.
Before deploying, take a complete database/configuration backup and test the
compatibility branch on a copy. Roll back using the matching pre-upgrade backup;
do not edit schema_migrations or run the stock 2.85 image on the legacy fork's
database as an intermediate upgrade step.

The branch contains the release tag exactly, rather than later commits on upstream
main. Main and the previous feature branch were not changed by this check.

AI assistance: implementation and compatibility work drafted with OpenAI Codex.
