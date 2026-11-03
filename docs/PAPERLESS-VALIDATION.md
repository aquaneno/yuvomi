# Paperless folders: compatibility check, 2026-11-03

Upstream and fork base: `58f2f4aec6a8f178f3eaa8971061636c5f98df57`
(Yuvomi 2.84.0). The original implementation was based on 2.81.0.

## Integration changes

- Preserved upstream migrations 269-275; the new binding table uses migration
  276, including its test-schema mirror.
- Retained the new Documents person filters and document deep links. The
  person filter is hidden with the other local filters inside a Paperless view.
- Kept the current upstream test chains and added the two Paperless suites.
- Adopted the current UI rule: missing view selections are validated on submit;
  a completed picker request does not leave Save disabled by field validity.
- Updated the installation document to this base and migration number.

## Checks completed

All of these passed on the ported implementation:

| Check | Cases |
| --- | ---: |
| Paperless filter/route/security regression suite | 23 |
| Paperless/DMS adapter | 22 |
| Existing DMS routes | 34 |
| Documents UX | 133 |
| Module read-only and ownership UI | 234 |
| General API contracts | 57 |
| OpenAPI structure/coverage/reasons and schema mirror | 34 |
| Frontend audit | 562 |
| Component/control conventions | 147 |
| Typography | 34 |
| Restore / asynchronous-response guard | 9 |
| Suite registration | 12 |
| Locale keys/placeholders | 82 |
| Translation baseline | 104 |
| Changelog | 42 (40 passed, 2 skipped) |
| Full-app browser integration | 2 |

The browser integration starts the actual application and a loopback Paperless
server. It verifies creating/sharing a folder, pagination past 50 documents,
source filter changes, download membership checks, mobile navigation,
disconnecting a folder and the optional module with its permission manifest.
JavaScript syntax and whitespace checks also passed.

Environment: Node 24.22.1; Chromium 153.0.8010.0. No additional runtime
project dependency was introduced for the browser.

## Limits

This compatibility check is targeted; the complete current npm test chain and
the full release browser handrail were not rerun. CI takes up to 45 minutes per
Node version on upstream. No green full-CI claim is made here. A feature-branch
push alone does not trigger the repository's CI workflow (it watches main and
pull requests); run CI before merging or deployment.

The source was a protocol test server, not the user's installed Paperless.
Actual Paperless version, TLS/reverse proxy behavior, Docker builds and
production data have not been verified. The old package's full-suite results
refer to the previous base and must not be treated as current CI results.

AI assistance: implementation and compatibility work drafted with OpenAI Codex.
