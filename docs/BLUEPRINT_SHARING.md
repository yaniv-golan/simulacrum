# Blueprint Exchange

Blueprint Exchange is Simulacrum's local-first sharing system for complete
machines, reusable subassemblies, and single custom components. It does not
require an account or hosted service.

## Player workflow

Open **Tools → Blueprint Exchange**. Add a title, optional creator credit,
description, and up to eight tags. From there you can:

- **Save current to Exchange** to keep an immutable package in this browser.
- **Download current** to create a portable `.simshare` file.
- **Copy current link** to put a compressed, thumbnail-free package in the URL.
- **Add My Parts** to publish every reusable component or mechanism currently in
  the personal component library.
- Drop a current `.simshare` file onto the import area, choose one, paste current
  package JSON, or paste a share link.

The local gallery searches title, creator, description, and tags. It filters
complete machines, reusable assemblies, individual components, proven designs,
and favorites. Loading a machine replaces the current build. Adding an assembly
or component installs a fresh reusable copy into **My Parts**.

## Portable package contract

`simulacrum-share-package` version 1 contains:

- the normalized blueprint or subassembly;
- each part's SI position and canonical local-to-world quaternion orientation;
- title, description, tags, creator credit, thumbnail, and timestamps;
- part, connection, component-type, and controller-language dependencies;
- a content fingerprint;
- remix parent, root, depth, and original-creator attribution;
- successful challenge records that match the exact content fingerprint.

The fingerprint is domain-separated SHA-256 over normalized portable
engineering content. Renaming a design does not create a different machine;
moving or reconfiguring a part does. On import, the fingerprint is recalculated
and mismatches are rejected. Packages are capped at 2 MB, thumbnails at 90 KB,
and share links at 60,000 characters. Larger designs remain shareable as files.

The catalog has one canonical entry per fingerprint. Importing the same content
from a file and a link adds acquisition history rather than duplicate cards. If
a locally saved entry later arrives from elsewhere, its local title, description,
creator, tags, and thumbnail win; compatible verification records are merged.
Acquisition origin is history, never a trust signal.

Sharing accepts only the version 1 package envelope, containing blueprint v1 or
subassembly v1. Raw blueprint/subassembly JSON and unsupported package versions
are rejected with a clear import error instead of being guessed or rewritten.

## Trust, proof, and social data

A locally completed challenge can add a proof-v1 attachment only when its
starting-machine fingerprint and objective binding exactly match the shared
machine. Malformed or unsupported proof attachments are omitted with a warning; they
never make an otherwise valid design unusable. The Exchange labels
that record **Proven on this device** only when every proof field exactly matches
a challenge record still stored on this device. A file or link can carry a record,
but the receiving browser labels it **Challenge proof attached** because a
local-only app cannot independently authenticate another player's result.

Favorites and your one-to-five-star rating are personal library state. They are
stored separately under the package fingerprint and are never written to the
portable file or link. A future hosted gallery can add aggregate ratings,
accounts, moderation, comments, and signed verification as a server-side overlay
without changing the immutable package format.

## Remix behavior

Choose **Remix** to load a design and retain its parent, root, depth, and original
creator. Edit the machine, then save or share it. An unchanged copy has the same
content fingerprint and is deduplicated rather than presented as a distinct
self-remix.

Remix attribution is an editor draft, not a global mode. Loading another demo,
loading an unrelated machine, or clearing the build plate clears that draft, so
an unrelated design cannot accidentally inherit another creator's lineage.

## Storage and privacy

Packages, origins, favorites, and personal ratings use Simulacrum's current
transactional browser-storage snapshot. Creator credit is optional. Nothing is
uploaded by the application. **Tools → Local Data → Reset local data** removes
the local catalog along with the rest of this browser's Simulacrum workshop,
so important designs should also be downloaded as `.simshare` files.

The Exchange owns one package catalog and one deletion path; no mirror catalog
or tombstones exist. Catalog updates use a transactional repository: if any
browser-storage write fails, the in-memory catalog and all affected roots are
rolled back together. Damaged current catalog records are isolated at startup
and surfaced as recovery diagnostics.

File and link decoding counts UTF-8 bytes. Compressed links are decompressed as
a bounded stream and rejected before materializing more than 2 MB.
