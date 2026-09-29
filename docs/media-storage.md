# School media storage

New uploads are stored on the Node server, never as Base64/database blobs. The
default root is `schooloBackend/storage`; set `MEDIA_STORAGE_ROOT` to an absolute
path on a persistent volume in production. Back up this volume with all branch
and platform databases. Files are not publicly served by Express.

```
storage/schools/<schoolId>/school/logos/<fileId>.jpg
storage/schools/<schoolId>/branches/<branchId>/<module>/<purpose>/<fileId>.jpg
storage/drafts/owners/<ownerId>/logos/<fileId>.jpg
```

Modules: students, teachers, staff, transport. Purposes: photos, documents,
signatures. Owner logos stage before school creation, then move to the school's
folder. UUID-like Mongo file IDs prevent filename collisions; original names
are metadata only. School and branch IDs come from the authenticated tenant.

## Upload and access

Existing upload endpoints accept one binary `document` file in multipart
FormData, plus `purpose` (default documents). Owner `/api/owner/upload-logo`
accepts a `logo` file. Flutter applies JPEG quality 75, preserves EXIF orientation,
flattens transparency onto white, and reduces dimensions if necessary. The final
file must not exceed **409,600 bytes (400 KiB)**. Source images above 20 MiB or
40 megapixels are rejected. PDFs remain PDFs and must fit the same upload limit.

The server independently enforces the size limit, checks file signatures, and
only accepts JPEG, PNG, WebP or PDF. Images are required for photos/signatures/
logos. New uploads return `id`, `documentUrl`, name and size (logos: `logoUrl`).
Save the returned relative URL in the existing record field; transport continues
to save its file ID. Tenant media metadata lives in the branch DB; logo metadata
lives in the platform DB. Metadata contains size, type, location, purpose, owner,
attachment status and timestamps, not file contents.

Read files through `/api/media/:id` with a Bearer token. Permissions are checked
against current staff records. Parents can read only the linked child's profile
photo, not certificates or medical documents. Teachers can read their own files
and assigned students' photos. Financial staff can read photos required by their
student lookup but not private student documents. Owner logo URLs use
`/api/owner/media/:id`. Flutter fetches bytes with authenticated Dio requests,
including on Web; auth headers are never sent to another server.

## Existing files and migration

Legacy `/uploads/...` URLs are not publicly accessible. Flutter maps them to
protected legacy APIs which verify references in the current branch. Existing
driver blobs remain readable until migrated. To migrate, stop writes or use a
maintenance window and back up the databases plus `uploads/` first:

```sh
node scripts/mediaMaintenance.js --migrate
node scripts/mediaMaintenance.js --migrate --apply
```

The first command is a dry run. The second copies files into tenant folders,
updates references, and moves old driver blob contents onto disk while keeping
their IDs. Original files in `uploads/` are retained as migration backups. Legacy
files larger than 400 KiB are preserved during migration; the limit applies to
new uploads. Invalid/missing files fail migration rather than silently losing
references. Re-running skips migrated references.

## Cleanup

The server runs cleanup daily. Unreferenced uploads older than 48 hours (including
replaced media and abandoned forms) are eligible. Current record references are
re-checked and attachment reservations prevent deletion while a form is saved.
No referenced files are deleted. Manual preview/apply:

```sh
node scripts/mediaMaintenance.js
node scripts/mediaMaintenance.js --apply
```

Multi-process/multi-server deployments must share the persistent volume.
