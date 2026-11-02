#!/usr/bin/env bash
set -euo pipefail

cargo build -p rilgate-client-ffi --release
case "$(uname -s)" in
  Darwin) library=target/release/librilgate_client_ffi.dylib ;;
  Linux) library=target/release/librilgate_client_ffi.so ;;
  *) echo "Unsupported host OS" >&2; exit 1 ;;
esac
for language in swift kotlin; do
  cargo run -p rilgate-client-ffi --features cli --bin uniffi-bindgen -- generate \
    --library "$library" --language "$language" --out-dir "target/bindings/$language"
done
