#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install.sh" ]; then
  exec bash "$SCRIPT_DIR/install.sh" "$@"
fi
exec bash <(curl -fsSL "https://raw.githubusercontent.com/${RRWR_REPO:-criperrr/rrwr}/${RRWR_BRANCH:-main}/scripts/install.sh") "$@"
