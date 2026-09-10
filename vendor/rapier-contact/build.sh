#!/usr/bin/env bash
# Rebuild the pinned uniform-f64 compatibility package using repository TypeScript.
set -euo pipefail
recipe_dir=$(cd -- "$(dirname -- "$0")" && pwd)
workspace_dir=$(cd -- "$recipe_dir/../.." && pwd)
contact_build_dir=/tmp/simulacrum-rapier-contact-build-v2
mkdir "$contact_build_dir"
trap 'echo "Build files retained at $contact_build_dir"' EXIT
offline_flags=()
if [[ "${RAPIER_OFFLINE:-0}" == 1 ]]; then offline_flags=(--offline); fi
if [[ -n "${RAPIER_SOURCE_ARCHIVE:-}" ]]; then
  cp "$RAPIER_SOURCE_ARCHIVE" "$contact_build_dir/source.tgz"
else
  curl --fail --location 'https://codeload.github.com/dimforge/rapier/tar.gz/3e12c2679cb1940a876bde93af9cec0cf2f57944' -o "$contact_build_dir/source.tgz"
fi
python3 - "$recipe_dir" "$contact_build_dir/source.tgz" <<'PY'
import hashlib,json,sys
from pathlib import Path
meta=json.loads((Path(sys.argv[1])/'provenance.json').read_text())
assert hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()==meta['sourceArchiveSha256']
assert hashlib.sha256((Path(sys.argv[1])/'contact.patch').read_bytes()).hexdigest()==meta['patchSha256']
PY
mkdir "$contact_build_dir/source"
tar -xzf "$contact_build_dir/source.tgz" --strip-components=1 -C "$contact_build_dir/source"
mkdir "$contact_build_dir/parry3d-f64"
contact_cargo_root=${CARGO_HOME:-$HOME/.cargo}
if [[ -n "${PARRY_SOURCE_ARCHIVE:-}" ]]; then
  cp "$PARRY_SOURCE_ARCHIVE" "$contact_build_dir/parry.crate"
else
  parry_cached=("$contact_cargo_root"/registry/cache/*/parry3d-f64-0.30.2.crate)
  if [[ -f "${parry_cached[0]}" ]]; then
    cp "${parry_cached[0]}" "$contact_build_dir/parry.crate"
  elif [[ "${RAPIER_OFFLINE:-0}" == 1 ]]; then
    echo "Offline rebuild requires cached Parry0.30.2 or PARRY_SOURCE_ARCHIVE" >&2
    exit 1
  else
    curl --fail --location 'https://static.crates.io/crates/parry3d-f64/parry3d-f64-0.30.2.crate' -o "$contact_build_dir/parry.crate"
  fi
fi
python3 - "$recipe_dir" "$contact_build_dir/parry.crate" <<'PARRY_CHECK'
import hashlib,json,sys
from pathlib import Path
meta=json.loads((Path(sys.argv[1])/'provenance.json').read_text())['parry']
assert hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()==meta['sourceArchiveSha256']
assert hashlib.sha256((Path(sys.argv[1])/'parry.patch').read_bytes()).hexdigest()==meta['patchSha256']
PARRY_CHECK
tar -xzf "$contact_build_dir/parry.crate" --strip-components=1 -C "$contact_build_dir/parry3d-f64"
(cd "$contact_build_dir/parry3d-f64" && patch -p1 < "$recipe_dir/parry.patch")
cd "$contact_build_dir/source"
patch -p1 < "$recipe_dir/contact.patch"
cd typescript
npm ci --ignore-scripts "${offline_flags[@]}"
cd rapier-compat
npm ci --ignore-scripts "${offline_flags[@]}"
cd ../builds/rapier3d-deterministic
contact_source_root=$(cd ../../.. && pwd -P)
contact_cargo_root=${CARGO_HOME:-$HOME/.cargo}
export CARGO_TARGET_DIR="$contact_build_dir/target"
export RUSTFLAGS="--remap-path-prefix=$contact_source_root=/rapier-source --remap-path-prefix=$contact_build_dir/parry3d-f64=/parry-source --remap-path-prefix=$contact_cargo_root/registry/src=/cargo-registry"
rustc --edition=2021 --test "$contact_source_root/src/dynamics/solver/contact_constraint/friction_projection.rs" -o "$contact_build_dir/friction-tests"
"$contact_build_dir/friction-tests"
cargo build --lib --release --target wasm32-unknown-unknown --locked "${offline_flags[@]}"
wasm-bindgen "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rapier_wasm3d.wasm" --target web --out-dir "$contact_build_dir/wasm"
wasm-opt -O4 --dce --enable-bulk-memory --enable-nontrapping-float-to-int "$contact_build_dir/wasm/rapier_wasm3d_bg.wasm" -o "$contact_build_dir/wasm/optimized.wasm"
mv "$contact_build_dir/wasm/optimized.wasm" "$contact_build_dir/wasm/rapier_wasm3d_bg.wasm"
python3 - "$contact_build_dir/wasm/package.json" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'name':'@dimforge/rapier3d-deterministic-compat','version':'0.20.0-simulacrum.spring.7.f64','description':'Pinned uniform-f64 spring and contact runtime.'}))
PY
cd ../../rapier-compat
mkdir -p builds/3d-deterministic/wasm-build
cp "$contact_build_dir/wasm/"* builds/3d-deterministic/wasm-build/
sh ./gen_src.sh
"$workspace_dir/node_modules/.bin/tsc" --lib ES6,DOM,ESNext.Disposable --project builds/3d-deterministic/tsconfig.pkg.json --outDir builds/3d-deterministic/gen3d-js --declarationDir builds/3d-deterministic/gen3d-js
node_modules/.bin/rollup --config rollup.config.js --bundleConfigAsCjs
python3 - <<'PY'
from pathlib import Path
base=Path('builds/3d-deterministic')
for source in (base/'gen3d-js').rglob('*.d.ts'):
    target=base/'pkg/dist'/source.relative_to(base/'gen3d-js')
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(source.read_text().replace('../pkg/dist/rapier_wasm3d','./rapier_wasm3d'))
PY
npm --cache "$contact_build_dir/npm-pack-cache" pack ./builds/3d-deterministic/pkg --pack-destination "$contact_build_dir"
