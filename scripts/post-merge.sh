#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Pre-install the rsrc Go tool used by the EXE builder to embed the Windows
# application manifest + icon into generated EXEs. Without this, EXEs ship
# without a manifest and silently fail to launch on Windows 11 with
# SmartScreen / Smart App Control enforcement.
if [ ! -x "$HOME/.cache/go/bin/rsrc" ] && command -v go >/dev/null 2>&1; then
  GOPATH="$HOME/.cache/go" \
  GOCACHE="$HOME/.cache/go/build-cache" \
  GOMODCACHE="$HOME/.cache/go/mod" \
  GOBIN="$HOME/.cache/go/bin" \
  go install github.com/akavel/rsrc@latest || echo "warning: failed to install rsrc; EXE manifest embedding will be skipped"
fi
