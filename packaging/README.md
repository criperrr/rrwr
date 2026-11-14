# Linux packages

GitHub Releases provide the `.deb` package for Ubuntu/Debian, `.rpm` for Fedora-compatible distributions, an AppImage, and an x86_64 runtime tarball for Arch's binary package. The AppImage includes GStreamer media components for wider playback support. Native system webview dependencies remain external for the deb/rpm and Arch builds.

Arch users can build from source with `yay -S rrwr-git` (the `main` branch) or `yay -S rrwr-dev-git` (the `dev` branch), or install the prebuilt release using `yay -S rrwr-bin`. The matching PKGBUILDs are in `packaging/arch/`; publishing them to the AUR requires an authenticated AUR account.

The source packages compile the checked-in Cargo workspace and require Rust/Cargo plus GTK 3, WebKitGTK 4.1, and libayatana-appindicator at build/runtime. The binary package depends on the matching runtime libraries and downloads the release tarball.
