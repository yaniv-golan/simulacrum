#!/bin/sh
# Use an already installed pinned runtime. Never install or mutate shell configuration.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pin=$(tr -d '\r\n' < "$root/.nvmrc")
case "$pin" in *[!0-9.v]*|'') echo 'Invalid .nvmrc version' >&2; exit 1;; esac
pin=${pin#v}
if [ "$(node --version 2>/dev/null || true)" = "v$pin" ]; then
  runtime=$(command -v node)
else
  runtime="${NVM_DIR:-$HOME/.nvm}/versions/node/v$pin/bin/node"
fi
if [ ! -x "$runtime" ] || [ "$("$runtime" --version)" != "v$pin" ]; then
  echo "Node $pin is not installed. Install it with your version manager (for nvm: nvm install $pin), then rerun scripts/with-node.sh <command> [args]. Nothing was installed or executed." >&2
  exit 1
fi
[ "$#" -gt 0 ] || { echo 'Use scripts/with-node.sh <command> [args], for example npm run verify:prepare' >&2; exit 1; }
PATH="$(dirname "$runtime"):$PATH"
export PATH
exec "$@"
