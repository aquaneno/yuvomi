# Paperless saved-view folders

Documents can connect a saved Paperless view as a live, read-only folder.
Nothing is copied into `family_documents`, and a document can appear in several
views. This is a core extension, not a scheduled import.

## Use

1. Configure Paperless under Settings -> Documents -> Document management, using
   the server root URL and an API token. The Paperless user must be able to
   read saved views and the documents in them.
2. Create and save the desired view in Paperless.
3. In Documents, use the plus button beside Paperless views. Pick the
   connection, saved view and local name.
4. Keep the default Only me, or select Family and explicitly confirm sharing.
5. Open the folder. Refresh or reopen it to get the current result; use Next
   for further pages. Preview opens a new tab; Download keeps the file's name.

Family sharing delegates permission to read/download **all current and future
matches** to everyone who may read Documents in Yuvomi. This uses the
configured Paperless account, not the visitor's own Paperless identity. A view
with no filters delegates the account's complete readable archive. Later
changes to the source view can expand or narrow that delegation. Only the
creating administrator can rename, share or disconnect their folder. Revoking
sharing takes effect on the next request; already downloaded files cannot be
recalled. Removing the DMS connection also removes its view-folder bindings.

## Design

- Migration 276 adds `paperless_view_folders`; shipped migrations stay intact.
- `server/services/dms/paperless-views.js` translates persisted Paperless rule
  IDs. Unknown or malformed rules fail closed with 422.
- `PaperlessAdapter` reads `/api/saved_views/{id}/` on every document request
  and calls `/api/documents/` with the filters, ordering and page parameters.
  It uses the existing token, request timeout, target guard and API v9 header.
- Page size is 50; no first-page/20-result truncation. Absolute `next` URLs are
  not followed with credentials.
- `/api/v1/documents/dms/paperless` uses core authentication, Documents module
  permissions, token scopes and CSRF middleware. Configuration needs an admin.
- Media routes intersect current view filters with the requested document ID
  before fetching content, and recheck local sharing after remote awaits.
- Responses are `no-store`, upstream errors are sanitized and previews allow
  only PDF, PNG, JPEG, WebP, GIF and plain text. Other types are download-only.
- An account or view cannot be retargeted in-place. Create a new binding for a
  different source to make the new delegation explicit.

Supported rule IDs 0-50 follow Paperless's persisted filter definitions:
text/title/content, ASN, correspondents, types, storage paths, tags (all/any/not),
dates, owners, sharing, custom fields and MIME filters. Legacy API v9 filter
parameters remain in use for legacy rules. A new upstream rule requires a
mapping and tests before it can be used. The actual installed Paperless release
still needs an integration check, especially for newer rule types.

## Limits

These are root-level virtual folders displayed alongside local folders. They
are not nested in the local tree, included in All documents or global search,
archived locally, linked automatically to tasks/budgets, or stored offline.
Local category/archive/search controls are hidden while a source folder is
open. Paperless's source ordering is preserved. This first version shows a
list; source thumbnails have an endpoint but are not downloaded for every row.
Preview opens separately and is not Yuvomi's editable local-document viewer.

There is no push subscription or background poll. Reopening, refreshing or
changing page reads the source again. A changing source can move documents
between pages, as with Paperless's ordinary paginated API. Folder authorization
is checked around remote operations; view membership and fetching content are
separate Paperless requests and cannot form one cross-server transaction.
The existing DMS adapter's target-guard and DNS/redirect limitations are not
changed by this feature.

## Pull request / fork

The implementation starts at Yuvomi commit
`58f2f4aec6a8f178f3eaa8971061636c5f98df57` (2.84.0 development tree).

1. Fork `ulsklyc/yuvomi`, clone the fork and create a feature branch from that
   commit. Apply the supplied patch with `git apply --check` then `git apply`.
2. Run `npm ci`, `npm run test:paperless-folders`, `npm test`, and the browser
   suite `npm run test:paperless-folders-browser` with a supported local Chrome.
3. Follow CONTRIBUTING.md, disclose AI assistance and submit to upstream main.
   The contributor guide asks for a feature issue first; the original DMS issue
   #277 deliberately chose curated document links. A curated, explicitly
   selected saved view is the proposal here, but acceptance is the maintainer's
   decision. No issue or PR is created by applying this patch.
4. Before submission, integrate upstream main. If migration 276 has since
   shipped for another feature, renumber this unshipped migration and its test
   mirror to the next free number. Do not edit any already shipped migration.
5. For an immediate private deployment build your fork's Docker image, rather
   than pulling the official `latest` image over it.

Back up and test a separate installation first. The migration only adds a
binding table, but an older official server refuses a database with a newer
schema. Roll back with the matching pre-upgrade backup; do not manually lower
the schema version. See the German installation guide shipped with the patch
for concrete Git and Compose commands and a suggested PR description.

## Optional own module

`examples/modules/paperless-views/` provides an additional Paperless navigation
page using the same API/component. After applying the core patch, copy it into
`modules/paperless-views/`, restart, and enable it in Settings. It can also be
zipped with `module.json` at the root and uploaded through module installation.
Users need both module access and Documents access. No credentials are stored
in this module.

**It is not standalone on the stock official image.** Yuvomi modules are
browser code. They cannot register server routes or change the database of the
built-in Documents page. An independent stock-image solution would need its
own sidecar backend, credentials and session/permission/CSRF checks described
in MODULES.md; it would be a separate application surface. The supplied module
therefore reuses the core implementation instead of hiding this dependency.
