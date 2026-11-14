#!/usr/bin/env bash
set -euo pipefail

REPO_SLUG="${RRWR_REPO:-criperrr/rrwr}"
REPO_URL="https://github.com/${REPO_SLUG}.git"
BRANCH="${RRWR_BRANCH:-main}"
INSTALL_DIR="${RRWR_INSTALL_DIR:-$HOME/.local/bin}"
ICON_DIR="${RRWR_ICON_DIR:-$HOME/.local/share/icons/hicolor/128x128/apps}"
DESKTOP_DIR="${RRWR_DESKTOP_DIR:-$HOME/.local/share/applications}"

FROM_SOURCE=0
SKIP_DEPS=0

for arg in "$@"; do
  case "$arg" in
    --from-source) FROM_SOURCE=1 ;;
    --no-deps) SKIP_DEPS=1 ;;
    -h|--help)
      echo "Usage: install-arch.sh [--from-source] [--no-deps]"
      exit 0
      ;;
  esac
done

if ! command -v pacman >/dev/null 2>&1; then
  echo "Error: pacman not found. This installer targets Arch Linux and derivatives." >&2
  exit 1
fi

install_missing_pkgs() {
  local missing=()
  for pkg in "$@"; do
    if ! pacman -Q "$pkg" >/dev/null 2>&1; then
      missing+=("$pkg")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Installing Arch Linux packages: ${missing[*]}"
    sudo pacman -S --needed --noconfirm "${missing[@]}"
  fi
}

if [ "$SKIP_DEPS" -eq 0 ]; then
  install_missing_pkgs webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg fuse2 curl
fi

mkdir -p "$INSTALL_DIR" "$ICON_DIR" "$DESKTOP_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

INSTALLED_MODE=""

if [ "$FROM_SOURCE" -eq 0 ]; then
  APPIMAGE_URL="$(
    curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" 2>/dev/null \
      | grep -Eo 'https://[^"]+\.AppImage' \
      | head -n 1 || true
  )"
  if [ -n "$APPIMAGE_URL" ]; then
    echo "Downloading latest RRWR AppImage..."
    curl -fL "$APPIMAGE_URL" -o "$TMP_DIR/rrwr.AppImage"
    chmod +x "$TMP_DIR/rrwr.AppImage"
    install -m 755 "$TMP_DIR/rrwr.AppImage" "$INSTALL_DIR/rrwr"
    curl -fsSL "https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}/src-tauri/icons/128x128.png" \
      -o "$ICON_DIR/rrwr.png" 2>/dev/null || true
    INSTALLED_MODE="appimage"
  fi
fi

if [ -z "$INSTALLED_MODE" ]; then
  echo "Building RRWR from source..."
  if [ "$SKIP_DEPS" -eq 0 ]; then
    install_missing_pkgs base-devel git
    if ! command -v cargo >/dev/null 2>&1; then
      install_missing_pkgs rust
    fi
  fi

  SRC_DIR=""
  if [ -f "src-tauri/Cargo.toml" ] && [ -f "src/index.html" ]; then
    SRC_DIR="$PWD"
  else
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/rrwr"
    SRC_DIR="$TMP_DIR/rrwr"
  fi

  cargo build --release --manifest-path "$SRC_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SRC_DIR/target/release/rrwr"
  if [ ! -f "$BIN_PATH" ]; then
    BIN_PATH="$SRC_DIR/src-tauri/target/release/rrwr"
  fi
  install -m 755 "$BIN_PATH" "$INSTALL_DIR/rrwr"
  if [ -f "$SRC_DIR/src-tauri/icons/128x128.png" ]; then
    install -m 644 "$SRC_DIR/src-tauri/icons/128x128.png" "$ICON_DIR/rrwr.png"
  fi
  INSTALLED_MODE="source"
fi

cat > "$DESKTOP_DIR/rrwr.desktop" <<EOF
[Desktop Entry]
Name=RRWR
Comment=Rust-Ruffle WebComic Reader
Exec=${INSTALL_DIR}/rrwr
Icon=rrwr
Terminal=false
Type=Application
Categories=Utility;Graphics;
StartupWMClass=rrwr
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "RRWR installed (${INSTALLED_MODE}) to ${INSTALL_DIR}/rrwr"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Note: add ${INSTALL_DIR} to your PATH to run 'rrwr' directly." ;;
esac
