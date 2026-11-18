#!/usr/bin/env bash
set -euo pipefail

REPO="${RRWR_REPO:-criperrr/rrwr}"
APP_NAME="rrwr"
DISPLAY_NAME="RRWR"
INSTALL_DIR="${RRWR_INSTALL_DIR:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DIR="$DATA_HOME/icons/hicolor/256x256/apps"
PIXMAP_DIR="$DATA_HOME/pixmaps"
DESKTOP_DIR="$DATA_HOME/applications"
FORCE_SOURCE="${RRWR_FORCE_SOURCE:-0}"

for arg in "$@"; do
    case "$arg" in
        --from-source) FORCE_SOURCE=1 ;;
    esac
done

if [ -z "${NO_COLOR:-}" ] && { [ -t 1 ] || [ "${FORCE_COLOR:-0}" = "1" ]; }; then
    C_RESET='\033[0m'
    C_BOLD='\033[1m'
    C_DIM='\033[2m'
    C_CYAN='\033[36m'
    C_GREEN='\033[32m'
    C_YELLOW='\033[33m'
    C_BLUE='\033[34m'
else
    C_RESET=''
    C_BOLD=''
    C_DIM=''
    C_CYAN=''
    C_GREEN=''
    C_YELLOW=''
    C_BLUE=''
fi

printf '%b' "${C_CYAN}${C_BOLD}"
cat <<'BANNER'
+------------------------------------------------------------------------------+
|  ____  ____  __        ______    _           _        _ _                    |
| |  _ \|  _ \ \ \      / /  _ \  (_)_ __  ___| |_ __ _| | | ___ _ __          |
| | |_) | |_) | \ \ /\ / /| |_) | | | '_ \/ __| __/ _` | | |/ _ \ '__|         |
| |  _ <|  _ <   \ V  V / |  _ <  | | | | \__ \ || (_| | | |  __/ |            |
| |_| \_\_| \_\   \_/\_/  |_| \_\ |_|_| |_|___/\__\__,_|_|_|\___|_|            |
|                                                                              |
|  RRWR - Rust-Ruffle WebComic Reader // Linux Installer                       |
+------------------------------------------------------------------------------+
BANNER
printf '%b\n' "${C_RESET}"

info() {
    printf '%b[*]%b %s\n' "${C_BLUE}${C_BOLD}" "${C_RESET}" "$*"
}

ok() {
    printf '%b[OK]%b %s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}" "$*"
}

notice() {
    printf '%b[!]%b %s\n' "${C_YELLOW}${C_BOLD}" "${C_RESET}" "$*"
}

step() {
    printf '\n%b================================================================================%b\n' "${C_CYAN}" "${C_RESET}"
    printf '%b[+] %s%b\n' "${C_CYAN}${C_BOLD}" "$*" "${C_RESET}"
    printf '%b================================================================================%b\n' "${C_CYAN}" "${C_RESET}"
}

step "Step 1/6: Detecting System Environment & Permissions"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    elif command -v doas >/dev/null 2>&1; then
        SUDO="doas"
    fi
fi

detect_pkg_manager() {
    if command -v pacman >/dev/null 2>&1; then
        echo "pacman"
    elif command -v apt-get >/dev/null 2>&1; then
        echo "apt"
    elif command -v dnf >/dev/null 2>&1; then
        echo "dnf"
    elif command -v yum >/dev/null 2>&1; then
        echo "yum"
    elif command -v zypper >/dev/null 2>&1; then
        echo "zypper"
    elif command -v apk >/dev/null 2>&1; then
        echo "apk"
    elif command -v xbps-install >/dev/null 2>&1; then
        echo "xbps"
    else
        echo "unknown"
    fi
}

PKG_MGR="$(detect_pkg_manager)"
ARCH="$(uname -m)"
OS_ID="linux"
if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-linux}"
fi

SESSION_TYPE="${XDG_SESSION_TYPE:-unknown}"
CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-unknown}"

info "Distribution     : $OS_ID (Architecture: $ARCH)"
info "Package Manager  : $PKG_MGR"
info "Privilege Helper : ${SUDO:-root (running as UID 0)}"
info "Graphical Session: $CURRENT_DESKTOP (Protocol: $SESSION_TYPE)"
info "Binary Target    : $INSTALL_DIR/$APP_NAME"
info "Launcher Target  : $DESKTOP_DIR/$APP_NAME.desktop"

step "Step 2/6: Checking & Installing System Runtime Dependencies"
notice "This step verifies WebKitGTK 4.1, GTK3, GStreamer (PipeWire/PulseAudio audio bridge), Mesa/EGL graphics libraries, and standard fonts."

install_runtime_deps() {
    case "$PKG_MGR" in
        pacman)
            local pkgs=(
                webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg
                gst-plugins-base gst-plugins-good gst-libav
                mesa libglvnd ttf-dejavu
                curl tar ca-certificates
            )
            local missing=()
            for pkg in "${pkgs[@]}"; do
                if ! pacman -Q "$pkg" >/dev/null 2>&1; then
                    missing+=("$pkg")
                fi
            done
            if [ "${#missing[@]}" -gt 0 ]; then
                notice "Missing Arch Linux packages detected: ${missing[*]}"
                notice "Running a full system sync and upgrade ('pacman -Syu --needed') before installing missing packages to avoid partial-upgrade library conflicts on Arch Linux."
                $SUDO pacman -Syu --needed --noconfirm "${missing[@]}"
            else
                info "All required Arch Linux runtime packages are already installed. Skipping pacman update."
            fi
            ;;
        apt)
            export DEBIAN_FRONTEND=noninteractive
            notice "Refreshing APT package lists ('apt-get update')..."
            $SUDO apt-get update -y
            local webkit_pkg="libwebkit2gtk-4.1-0"
            if ! apt-cache show "$webkit_pkg" >/dev/null 2>&1; then
                webkit_pkg="libwebkit2gtk-4.0-37"
            fi
            local indicator_pkg="libayatana-appindicator3-1"
            if ! apt-cache show "$indicator_pkg" >/dev/null 2>&1; then
                indicator_pkg="libappindicator3-1"
            fi
            local soup_pkg="libsoup-3.0-0"
            if ! apt-cache show "$soup_pkg" >/dev/null 2>&1; then
                soup_pkg="libsoup2.4-1"
            fi
            local extra_pkgs=()
            for opt_pkg in gstreamer1.0-libav libgl1-mesa-dri libegl1 libgbm1 fonts-dejavu-core; do
                if apt-cache show "$opt_pkg" >/dev/null 2>&1; then
                    extra_pkgs+=("$opt_pkg")
                fi
            done
            notice "Installing runtime libraries via apt-get (without unnecessary recommended packages)..."
            $SUDO apt-get install -y --no-install-recommends \
                ca-certificates curl tar file \
                libgtk-3-0 "$webkit_pkg" "$soup_pkg" "$indicator_pkg" \
                librsvg2-2 gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
                "${extra_pkgs[@]}"
            ;;
        dnf|yum)
            notice "Installing runtime libraries via $PKG_MGR (may refresh repository metadata)..."
            $SUDO "$PKG_MGR" install -y \
                ca-certificates curl tar file \
                gtk3 webkit2gtk4.1 libsoup3 libayatana-appindicator-gtk3 \
                librsvg2 gstreamer1-plugins-base gstreamer1-plugins-good \
                mesa-dri-drivers mesa-libEGL mesa-libgbm dejavu-sans-fonts
            ;;
        zypper)
            notice "Installing runtime libraries via zypper (non-interactive mode)..."
            $SUDO zypper --non-interactive install \
                ca-certificates curl tar file \
                libgtk-3-0 libwebkit2gtk-4_1-0 libsoup-3_0-0 libayatana-appindicator3-1 \
                librsvg-2-2 gstreamer-plugins-base gstreamer-plugins-good \
                Mesa-dri libEGL1 libgbm1 dejavu-fonts
            ;;
        apk)
            notice "Installing runtime libraries via Alpine apk..."
            $SUDO apk add --no-cache \
                ca-certificates curl tar file \
                gtk+3.0 webkit2gtk-4.1 libsoup3 libayatana-appindicator \
                librsvg gst-plugins-base gst-plugins-good \
                mesa-dri-gallium mesa-egl mesa-gbm font-dejavu
            ;;
        xbps)
            notice "Synchronizing Void Linux repositories and installing runtime libraries via xbps-install..."
            $SUDO xbps-install -Sy \
                ca-certificates curl tar file \
                gtk+3 webkit2gtk libsoup3 libayatana-appindicator \
                librsvg gst-plugins-base1 gst-plugins-good1 \
                mesa-dri libegl libgbm dejavu-fonts-ttf
            ;;
        *)
            notice "Unknown package manager ($PKG_MGR). Skipping automatic package installation and assuming runtime libraries are present."
            ;;
    esac
}

install_build_deps() {
    notice "Installing compiler toolchain and -dev/-devel headers for native source compilation..."
    case "$PKG_MGR" in
        pacman)
            local pkgs=(base-devel pkgconf git curl webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg openssl gst-plugins-base gst-plugins-good)
            local missing=()
            for pkg in "${pkgs[@]}"; do
                if ! pacman -Q "$pkg" >/dev/null 2>&1; then
                    missing+=("$pkg")
                fi
            done
            if [ "${#missing[@]}" -gt 0 ]; then
                notice "Running 'pacman -Syu --needed' to install build dependencies: ${missing[*]}"
                $SUDO pacman -Syu --needed --noconfirm "${missing[@]}"
            fi
            ;;
        apt)
            export DEBIAN_FRONTEND=noninteractive
            $SUDO apt-get update -y
            local webkit_dev="libwebkit2gtk-4.1-dev"
            if ! apt-cache show "$webkit_dev" >/dev/null 2>&1; then
                webkit_dev="libwebkit2gtk-4.0-dev"
            fi
            local indicator_dev="libayatana-appindicator3-dev"
            if ! apt-cache show "$indicator_dev" >/dev/null 2>&1; then
                indicator_dev="libappindicator3-dev"
            fi
            $SUDO apt-get install -y --no-install-recommends \
                build-essential pkg-config git curl ca-certificates file \
                libssl-dev libgtk-3-dev "$webkit_dev" "$indicator_dev" \
                librsvg2-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
            ;;
        dnf|yum)
            $SUDO "$PKG_MGR" install -y \
                gcc gcc-c++ make pkgconf-pkg-config git curl ca-certificates file \
                openssl-devel gtk3-devel webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel \
                librsvg2-devel gstreamer1-devel gstreamer1-plugins-base-devel
            ;;
        zypper)
            $SUDO zypper --non-interactive install \
                gcc gcc-c++ make pkg-config git curl ca-certificates file \
                libopenssl-devel gtk3-devel webkit2gtk3-devel libayatana-appindicator3-devel \
                librsvg-devel gstreamer-devel gstreamer-plugins-base-devel
            ;;
        apk)
            $SUDO apk add --no-cache \
                build-base pkgconf git curl ca-certificates file \
                openssl-dev gtk+3.0-dev webkit2gtk-4.1-dev libayatana-appindicator-dev \
                librsvg-dev gstreamer-dev gst-plugins-base-dev
            ;;
        xbps)
            $SUDO xbps-install -Sy \
                base-devel pkg-config git curl ca-certificates file \
                openssl-devel gtk+3-devel webkit2gtk-devel libayatana-appindicator-devel \
                librsvg-devel gstreamer1-devel gst-plugins-base1-devel
            ;;
        *)
            echo "Error: Cannot automatically install build dependencies for $PKG_MGR." >&2
            exit 1
            ;;
    esac
}

install_runtime_deps

mkdir -p "$INSTALL_DIR" "$ICON_DIR" "$PIXMAP_DIR" "$DESKTOP_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

binary_links_cleanly() {
    local bin="$1"
    if [ ! -f "$bin" ] || [ ! -x "$bin" ]; then
        return 1
    fi
    if command -v ldd >/dev/null 2>&1; then
        local ldd_out
        ldd_out="$(LC_ALL=C LANG=C ldd "$bin" 2>&1 || true)"
        if echo "$ldd_out" | grep -qi "not found"; then
            return 1
        fi
    fi
    return 0
}

find_extracted_binary() {
    local candidate
    for candidate in \
        "$TMP_DIR/$APP_NAME" \
        "$TMP_DIR"/*/"$APP_NAME" \
        "$TMP_DIR"/*/usr/bin/"$APP_NAME" \
        "$TMP_DIR"/*/*/"$APP_NAME" \
        "$TMP_DIR"/*/*/*/"$APP_NAME"; do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    if command -v find >/dev/null 2>&1; then
        find "$TMP_DIR" -maxdepth 6 -type f -name "$APP_NAME" 2>/dev/null | head -n 1
    fi
}

find_extracted_icon() {
    local candidate
    for candidate in \
        "$TMP_DIR"/*/usr/share/icons/hicolor/256x256/apps/"$APP_NAME.png" \
        "$TMP_DIR"/*/usr/share/icons/hicolor/*/apps/"$APP_NAME.png" \
        "$TMP_DIR"/*/usr/share/pixmaps/"$APP_NAME.png"; do
        if [ -f "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    if command -v find >/dev/null 2>&1; then
        find "$TMP_DIR" -maxdepth 7 -type f -name "$APP_NAME.png" 2>/dev/null | head -n 1
    fi
}

step "Step 3/6: Acquiring & Verifying $DISPLAY_NAME Binary"

INSTALLED_MODE=""

if [ "$FORCE_SOURCE" != "1" ] && [ "$ARCH" = "x86_64" ] && [ "$PKG_MGR" != "apk" ]; then
    info "Querying latest GitHub release metadata from https://github.com/$REPO ..."
    RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || curl -fsSL "https://api.github.com/repos/$REPO/releases" 2>/dev/null || true)"

    TAR_URL="$(printf '%s\n' "$RELEASE_JSON" | grep -oE 'https://[^"]+linux-x86_64\.tar\.gz' | head -n 1 || true)"
    APPIMAGE_URL="$(printf '%s\n' "$RELEASE_JSON" | grep -oE 'https://[^"]+\.AppImage' | head -n 1 || true)"

    if [ -n "$TAR_URL" ]; then
        notice "Downloading prebuilt Linux x86_64 tarball: $TAR_URL"
        if curl -fL --retry 3 -o "$TMP_DIR/rrwr.tar.gz" "$TAR_URL"; then
            tar -xzf "$TMP_DIR/rrwr.tar.gz" -C "$TMP_DIR"
            BIN_PATH="$(find_extracted_binary || true)"
            if [ -n "$BIN_PATH" ] && [ -f "$BIN_PATH" ]; then
                chmod +x "$BIN_PATH"
                info "Validating shared library links (ldd) against your system..."
                if binary_links_cleanly "$BIN_PATH"; then
                    install -Dm755 "$BIN_PATH" "$INSTALL_DIR/$APP_NAME"
                    EXTRACTED_ICON="$(find_extracted_icon || true)"
                    if [ -n "$EXTRACTED_ICON" ] && [ -f "$EXTRACTED_ICON" ]; then
                        cp -f "$EXTRACTED_ICON" "$ICON_DIR/$APP_NAME.png"
                        cp -f "$EXTRACTED_ICON" "$PIXMAP_DIR/$APP_NAME.png"
                    fi
                    INSTALLED_MODE="prebuilt-tarball"
                    info "Prebuilt binary verified and installed to $INSTALL_DIR/$APP_NAME."
                else
                    notice "Prebuilt tarball binary has missing library links on this distro; trying next fallback..."
                fi
            fi
        fi
    fi

    if [ -z "$INSTALLED_MODE" ] && [ -n "$APPIMAGE_URL" ]; then
        notice "Downloading AppImage bundle: $APPIMAGE_URL"
        if curl -fL --retry 3 -o "$TMP_DIR/$APP_NAME.AppImage" "$APPIMAGE_URL"; then
            chmod +x "$TMP_DIR/$APP_NAME.AppImage"
            info "Extracting AppImage contents (FUSE-free mode)..."
            (cd "$TMP_DIR" && "./$APP_NAME.AppImage" --appimage-extract >/dev/null 2>&1 || true)
            if [ -f "$TMP_DIR/squashfs-root/usr/bin/$APP_NAME" ] && binary_links_cleanly "$TMP_DIR/squashfs-root/usr/bin/$APP_NAME"; then
                install -Dm755 "$TMP_DIR/squashfs-root/usr/bin/$APP_NAME" "$INSTALL_DIR/$APP_NAME"
                if [ -f "$TMP_DIR/squashfs-root/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png" ]; then
                    cp -f "$TMP_DIR/squashfs-root/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png" "$ICON_DIR/$APP_NAME.png"
                    cp -f "$TMP_DIR/squashfs-root/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png" "$PIXMAP_DIR/$APP_NAME.png"
                fi
                INSTALLED_MODE="appimage-extracted"
            else
                install -Dm755 "$TMP_DIR/$APP_NAME.AppImage" "$INSTALL_DIR/$APP_NAME"
                INSTALLED_MODE="appimage-direct"
            fi
        fi
    fi
fi

if [ -z "$INSTALLED_MODE" ]; then
    notice "Compiling $DISPLAY_NAME natively from source (this may take a few minutes)..."
    install_build_deps
    if ! command -v cargo >/dev/null 2>&1; then
        notice "Rust toolchain (cargo) not found. Installing minimal Rust toolchain via official rustup.rs..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env"
    fi
    info "Cloning $REPO repository into temporary build directory..."
    git clone --depth 1 "https://github.com/$REPO.git" "$TMP_DIR/src"
    (
        cd "$TMP_DIR/src/src-tauri"
        info "Running 'cargo build --release'..."
        cargo build --release
        install -Dm755 "target/release/$APP_NAME" "$INSTALL_DIR/$APP_NAME"
        if [ -f "icons/128x128@2x.png" ]; then
            cp -f "icons/128x128@2x.png" "$ICON_DIR/$APP_NAME.png"
            cp -f "icons/128x128@2x.png" "$PIXMAP_DIR/$APP_NAME.png"
        fi
    )
    INSTALLED_MODE="source-build"
fi

step "Step 4/6: Installing Application Icons"

if [ ! -f "$ICON_DIR/$APP_NAME.png" ]; then
    info "Downloading application icon from repository..."
    if curl -fsSL -o "$ICON_DIR/$APP_NAME.png" \
        "https://raw.githubusercontent.com/$REPO/main/src-tauri/icons/128x128@2x.png" 2>/dev/null; then
        cp -f "$ICON_DIR/$APP_NAME.png" "$PIXMAP_DIR/$APP_NAME.png"
    fi
fi
info "Icons installed to:"
info "  - $ICON_DIR/$APP_NAME.png"
info "  - $PIXMAP_DIR/$APP_NAME.png"

step "Step 5/6: Registering Desktop Launcher & Shortcuts (GNOME, KDE, Hyprland, Sway, X11, Wayland)"
info "Using native GPU DMA-BUF compositing by default (override with WEBKIT_DISABLE_DMABUF_RENDERER=1 only if needed)."

DESKTOP_FILE_CONTENT="[Desktop Entry]
Type=Application
Name=$DISPLAY_NAME
GenericName=Archive Reader
Comment=Lightweight Desktop Archive Reader & Media Player
Exec=\"$INSTALL_DIR/$APP_NAME\" %U
TryExec=$INSTALL_DIR/$APP_NAME
Icon=$APP_NAME
Terminal=false
Categories=Graphics;Viewer;
Keywords=Archive;Reader;Flash;SWF;Media;
StartupWMClass=$APP_NAME
StartupNotify=true
"

printf '%s' "$DESKTOP_FILE_CONTENT" > "$DESKTOP_DIR/$APP_NAME.desktop"
chmod +x "$DESKTOP_DIR/$APP_NAME.desktop"
info "Application menu entry written to: $DESKTOP_DIR/$APP_NAME.desktop"

USER_DESKTOP_DIR=""
if command -v xdg-user-dir >/dev/null 2>&1; then
    USER_DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if { [ -z "$USER_DESKTOP_DIR" ] || [ "$USER_DESKTOP_DIR" = "$HOME/Desktop" ]; } && [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" ]; then
    PARSED_DESKTOP_DIR="$(HOME="$HOME" . "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" 2>/dev/null && printf '%s' "${XDG_DESKTOP_DIR:-}" || true)"
    if [ -n "$PARSED_DESKTOP_DIR" ]; then
        USER_DESKTOP_DIR="$PARSED_DESKTOP_DIR"
    fi
fi
if [ -z "$USER_DESKTOP_DIR" ] && [ -d "$HOME/Desktop" ]; then
    USER_DESKTOP_DIR="$HOME/Desktop"
fi
if [ -n "$USER_DESKTOP_DIR" ] && [ -d "$USER_DESKTOP_DIR" ] && [ "$USER_DESKTOP_DIR" != "$HOME" ]; then
    printf '%s' "$DESKTOP_FILE_CONTENT" > "$USER_DESKTOP_DIR/$APP_NAME.desktop"
    chmod +x "$USER_DESKTOP_DIR/$APP_NAME.desktop"
    if command -v gio >/dev/null 2>&1; then
        gio set "$USER_DESKTOP_DIR/$APP_NAME.desktop" metadata::trusted true >/dev/null 2>&1 || true
    fi
    info "Desktop shortcut written to: $USER_DESKTOP_DIR/$APP_NAME.desktop"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 >/dev/null 2>&1 || true
fi

step "Step 6/6: Verifying Shell PATH & Completing Setup"

case ":$PATH:" in
    *":$INSTALL_DIR:"*)
        info "$INSTALL_DIR is already present in your PATH."
        ;;
    *)
        notice "$INSTALL_DIR is not in your current PATH. Adding it to your shell configuration..."
        for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
            if [ -f "$rc" ] && ! grep -q "$INSTALL_DIR" "$rc" 2>/dev/null; then
                printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$rc"
                info "Added PATH export to $rc"
            fi
        done
        if [ -d "$HOME/.config/fish" ]; then
            mkdir -p "$HOME/.config/fish/conf.d"
            printf 'fish_add_path -g "%s"\n' "$INSTALL_DIR" > "$HOME/.config/fish/conf.d/rrwr.fish"
            info "Added PATH entry to $HOME/.config/fish/conf.d/rrwr.fish"
        fi
        ;;
esac

ok "Installation complete! Mode: $INSTALLED_MODE"
ok "Executable : $INSTALL_DIR/$APP_NAME"
ok "Launcher   : $DESKTOP_DIR/$APP_NAME.desktop"
info "You can now launch $DISPLAY_NAME from your application menu or by running: $INSTALL_DIR/$APP_NAME"
