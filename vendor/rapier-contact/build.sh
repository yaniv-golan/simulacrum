#!/usr/bin/env bash
# Optional dependency rebuild. Requires Node 24.18, Rust 1.94 and wasm32-unknown-unknown.
set -euo pipefail
recipe_dir=$(cd -- "$(dirname -- "$0")" && pwd)
# Cargo hashes path-based package identities into symbol ordering. Use one
# public build path as well as remapping embedded source locations.
contact_build_dir=/tmp/simulacrum-rapier-contact-build-v1
mkdir "$contact_build_dir" # Refuse reuse; preserve previous evidence instead of deleting it.
trap 'echo "Build files retained at $contact_build_dir"' EXIT
curl --fail --location 'https://codeload.github.com/dimforge/rapier/tar.gz/3e12c2679cb1940a876bde93af9cec0cf2f57944' -o "$contact_build_dir/source.tgz"
python3 - "$recipe_dir" "$contact_build_dir/source.tgz" <<'PY'
import hashlib,json,sys
from pathlib import Path
meta=json.loads((Path(sys.argv[1])/'provenance.json').read_text())
assert hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()==meta['sourceArchiveSha256']
PY
mkdir "$contact_build_dir/source"
tar -xzf "$contact_build_dir/source.tgz" --strip-components=1 -C "$contact_build_dir/source"
cd "$contact_build_dir/source"
patch -p1 < "$recipe_dir/contact.patch"
cd typescript
npm ci --ignore-scripts
cargo run -p prepare_builds -- -d dim3 -f deterministic
cargo run -p prepare_builds -- -d dim2 -f deterministic
cp "$recipe_dir/Cargo.lock" Cargo.lock
cargo check --locked -p dimforge_rapier2d-deterministic
contact_source_root=$(cd .. && pwd -P)
contact_cargo_root=${CARGO_HOME:-$HOME/.cargo}
RUSTFLAGS="--remap-path-prefix=$contact_source_root=/rapier-source --remap-path-prefix=$contact_cargo_root/registry/src=/cargo-registry" node_modules/.bin/wasm-pack build --target web --out-dir "$contact_build_dir/wasm" builds/rapier3d-deterministic --locked
cd rapier-compat
npm ci --ignore-scripts
python3 - <<'PY'
from pathlib import Path
p=Path('gen_src.sh');s=p.read_text();start=s.index('for features_set in ');end=s.index('\ndo',start);p.write_text(s[:start]+'for features_set in "3 deterministic"'+s[end:])
p=Path('rollup.config.js');s=p.read_text();start=s.index('export default');p.write_text(s[:start]+'export default [config("3d", "3d-deterministic")];\n')
PY
mkdir -p builds/3d-deterministic/wasm-build
cp "$contact_build_dir/wasm/"* builds/3d-deterministic/wasm-build/
npm run build-genjs
npm run build-js
printf 'export * from "./rapier_wasm3d";\n' > builds/3d-deterministic/pkg/dist/raw.d.ts
python3 - <<'PY'
from pathlib import Path
import json
p=Path('builds/3d-deterministic/pkg/package.json');d=json.loads(p.read_text());d['version']='0.20.0-simulacrum.spring.3';d['description']='Local bounded spring and contact build of Rapier; pinned source and contact patch in vendor/rapier-contact.';p.write_text(json.dumps(d,indent=2)+'\n')
PY
npm pack ./builds/3d-deterministic/pkg --pack-destination "$contact_build_dir"
