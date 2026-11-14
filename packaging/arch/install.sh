#!/usr/bin/env bash
# ==============================================================================
# RRWR-rust Automated Arch Linux Installer
#
# Clones, compiles, installs RRWR to /usr/local/bin, desktop entry, and icon,
# then completely cleans up temporary source and build files.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/criperrr/RRWR-rust/main/packaging/arch/install.sh | bash
# ==============================================================================

set -euo pipefail

echo "================================================================="
echo "   RRWR-rust Automated Arch Linux Installer                      "
echo "================================================================="

# 1. Verify Arch Linux environment
if [ ! -f /etc/arch-release ] && ! command -v pacman >/dev/null 2>&1; then
  echo "Error: This installer is intended for Arch Linux and Arch-based distributions (Manjaro, EndeavourOS, etc.)." >&2
  exit 1
fi

# 2. Check sudo / root privileges
if [ "$EUID" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Error: 'sudo' command not found. Please run this script with root privileges or install sudo." >&2
    exit 1
  fi
  SUDO="sudo"
else
  SUDO=""
fi

echo "[*] Step 1/4: Installing required Arch Linux packages via pacman..."
$SUDO pacman -S --needed --noconfirm \
  base-devel \
  git \
  rust \
  cargo \
  pkgconf \
  openssl \
  webkit2gtk-4.1 \
  gtk3 \
  libayatana-appindicator

# 3. Create isolated temporary build directory
BUILD_DIR="$(mktemp -d -t rrwr-arch-build-XXXXXX)"
echo "[*] Step 2/4: Created temporary build directory at ${BUILD_DIR}"

cleanup() {
  local exit_code=$?
  echo "[*] Cleaning up temporary build artifacts..."
  rm -rf "$BUILD_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# 4. Clone repository
REPO_URL="${RRWR_REPO_URL:-https://github.com/criperrr/RRWR-rust.git}"
BRANCH="${RRWR_BRANCH:-main}"

echo "[*] Step 3/4: Fetching latest source code from ${REPO_URL} (${BRANCH} branch)..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$BUILD_DIR"

# 5. Build release binary
echo "[*] Step 4/4: Compiling RRWR-rust in release mode (cargo build --release)..."
cd "$BUILD_DIR"
cargo build --release --locked

# 6. Install to system (/usr/local/)
echo "[*] Installing binary and desktop integration..."
$SUDO install -Dm755 target/release/rrwr /usr/local/bin/rrwr
$SUDO install -Dm644 packaging/linux/rrwr.desktop /usr/local/share/applications/rrwr.desktop
$SUDO install -Dm644 src-tauri/icons/icon.png /usr/local/share/icons/hicolor/256x256/apps/rrwr.png

# Update desktop and icon databases if tools exist
if command -v update-desktop-database >/dev/null 2>&1; then
  $SUDO update-desktop-database /usr/local/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  $SUDO gtk-update-icon-cache -q /usr/local/share/icons/hicolor || true
fi

echo "================================================================="
echo "   Installation Completed Successfully!                          "
echo "================================================================="
echo "RRWR-rust has been installed to /usr/local/bin/rrwr."
echo "You can launch it from your desktop menu or by typing 'rrwr' in terminal."
echo "All temporary build sources have been deleted."
