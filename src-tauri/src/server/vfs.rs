use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Descriptor of an active mod's assets and tree mappings
#[derive(Clone, Debug)]
pub struct ActiveModDescriptor {
    pub id: String,
    pub root_dir: PathBuf,
    pub trees: HashMap<String, String>, // e.g. "./Assets/" -> "assets://"
    pub routes: HashMap<String, String>, // e.g. "assets://file.gif" -> "./file.gif"
}

#[derive(Clone)]
pub struct Vfs {
    base_dir: Arc<std::sync::RwLock<PathBuf>>,
    custom_asset_dir: Arc<std::sync::RwLock<PathBuf>>,
    overlay_map: Arc<RwLock<HashMap<String, PathBuf>>>,
    active_mods: Arc<RwLock<Vec<ActiveModDescriptor>>>,
    installed_overlay_map: Arc<RwLock<HashMap<String, PathBuf>>>,
    installed_mods: Arc<RwLock<Vec<ActiveModDescriptor>>>,
    overlay_generation: Arc<AtomicU64>,
}

impl Vfs {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir: Arc::new(std::sync::RwLock::new(base_dir)),
            custom_asset_dir: Arc::new(std::sync::RwLock::new(PathBuf::new())),
            overlay_map: Arc::new(RwLock::new(HashMap::new())),
            active_mods: Arc::new(RwLock::new(Vec::new())),
            installed_overlay_map: Arc::new(RwLock::new(HashMap::new())),
            installed_mods: Arc::new(RwLock::new(Vec::new())),
            overlay_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn base_dir(&self) -> PathBuf {
        self.base_dir.read().unwrap().clone()
    }

    pub fn set_base_dir(&self, base_dir: PathBuf) {
        *self.base_dir.write().unwrap() = base_dir;
    }

    pub fn set_custom_asset_dir(&self, custom_asset_dir: PathBuf) {
        *self.custom_asset_dir.write().unwrap() = custom_asset_dir;
    }

    pub fn custom_asset_dir(&self) -> PathBuf {
        self.custom_asset_dir.read().unwrap().clone()
    }

    pub async fn active_mod_roots(&self) -> Vec<(String, PathBuf)> {
        self.active_mods
            .read()
            .await
            .iter()
            .map(|m| (m.id.clone(), m.root_dir.clone()))
            .collect()
    }

    pub fn generation(&self) -> u64 {
        self.overlay_generation.load(Ordering::SeqCst)
    }

    pub fn bump_generation(&self) -> u64 {
        self.overlay_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Normalizes, percent-decodes, and sanitizes incoming URI paths
    pub fn sanitize_path(raw_path: &str) -> Option<String> {
        // Quick null byte rejection
        if raw_path.contains('\0') {
            return None;
        }

        // 1. URL percent-decoding
        let decoded = percent_encoding::percent_decode_str(raw_path)
            .decode_utf8()
            .ok()?;

        if decoded.contains('\0') {
            return None;
        }

        // 2. Strip query string and fragment
        let clean = decoded.split('?').next().unwrap_or(&decoded);
        let clean = clean.split('#').next().unwrap_or(clean);

        // 3. Strip scheme and prefix slashes
        let clean = clean.strip_prefix("assets://").unwrap_or(clean);
        let clean = clean.strip_prefix('/').unwrap_or(clean);
        let clean = clean.strip_prefix("assets/").unwrap_or(clean);
        let clean = clean.trim_start_matches('/');

        // Reject if path starts with slash or was effectively empty
        if clean.is_empty() {
            return None;
        }

        // 4. Traversal defense: reject any ".." path segments
        for seg in clean.split('/') {
            if seg == ".." || seg.is_empty() && clean.contains("//") {
                return None;
            }
        }

        Some(clean.to_string())
    }

    /// Resolves a requested URI path to an absolute disk path in O(1)
    pub async fn resolve(&self, raw_path: &str) -> Option<PathBuf> {
        let clean = Self::sanitize_path(raw_path)?;

        // 1. Check mod overlay map (O(1) in-memory lookup)
        {
            let map = self.overlay_map.read().await;
            if let Some(target) = map.get(&clean) {
                if target.is_file() {
                    return Some(target.clone());
                }
            }
        }

        let base_dir = self.base_dir.read().unwrap().clone();
        let custom_asset_dir = self.custom_asset_dir.read().unwrap().clone();

        // 2. Fallback for collection logo when requested through VFS /assets/
        if clean == "collection_logo.gif" || clean == "collection_logo.png" {
            let alt1 = base_dir.join("archive/collection/collection_logo.png");
            if alt1.is_file() {
                return Some(alt1);
            }
            let alt2 = base_dir.join("archive/collection/logo_static.png");
            if alt2.is_file() {
                return Some(alt2);
            }
        }

        // 3. User-imported assets override the base pack without modifying it.
        let custom_candidate = custom_asset_dir.join(&clean);
        if custom_candidate.is_file() {
            return Some(custom_candidate);
        }

        // 4. Base Asset Pack directory
        let candidate = base_dir.join(&clean);
        if candidate.is_file() {
            return Some(candidate);
        }

        // 3b. Direct mod asset reference fallback: mods/<mod_id>/<rest>
        if let Some(after_mods) = clean
            .strip_prefix("mods/")
            .or_else(|| clean.strip_prefix("mod/"))
        {
            if let Some((mod_id, rel_inside)) = after_mods.split_once('/') {
                let active = self.active_mods.read().await;
                if let Some(m) = active.iter().find(|m| {
                    m.id == mod_id
                        || m.id.eq_ignore_ascii_case(mod_id)
                        || m.id.replace('_', " ").eq_ignore_ascii_case(mod_id)
                        || m.id.replace(' ', "_").eq_ignore_ascii_case(mod_id)
                }) {
                    let mod_candidate = m.root_dir.join(rel_inside);
                    if mod_candidate.starts_with(&m.root_dir) && mod_candidate.is_file() {
                        return Some(mod_candidate);
                    }
                }
            }
        }

        // 3c. Fallback for installed mod assets (previews, disabled themes, etc.)
        {
            let installed_map = self.installed_overlay_map.read().await;
            if let Some(target) = installed_map.get(&clean) {
                if target.is_file() {
                    return Some(target.clone());
                }
            }
        }

        // 3d. Fallback relative path lookup inside installed mod root directories
        {
            let installed = self.installed_mods.read().await;
            for m in installed.iter() {
                let candidate = m.root_dir.join(&clean);
                if candidate.starts_with(&m.root_dir) && candidate.is_file() {
                    return Some(candidate);
                }
            }
        }

        // 5. Built-in fallback routes
        // Fallback for Ruffle WASM/JS: js/ruffle/<file> -> archive/imods/<bundle>/js/ruffle/<file>
        if let Some(rel) = clean.strip_prefix("js/ruffle/") {
            let imod = base_dir
                .join("archive/imods/_ruffle_bundle/js/ruffle")
                .join(rel);
            if imod.is_file() {
                return Some(imod);
            }
            let imods_dir = base_dir.join("archive/imods");
            if let Ok(entries) = std::fs::read_dir(&imods_dir) {
                for entry in entries.flatten() {
                    let sub_path = entry.path();
                    if sub_path.is_dir() {
                        let candidate = sub_path.join("js/ruffle").join(rel);
                        if candidate.is_file() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }

        None
    }

    /// Rebuilds the in-memory overlay map from active mods in <2ms
    pub async fn rebuild_overlay(&self, mods: Vec<ActiveModDescriptor>) -> std::io::Result<usize> {
        let mut new_overlay = HashMap::new();

        // Process mods in reverse order so earlier mods take priority
        for m in mods.iter().rev() {
            // Process trees (e.g. "./Assets/" -> "assets://")
            for (mod_tree_rel, asset_tree) in &m.trees {
                let mod_tree_rel_clean =
                    mod_tree_rel.trim_start_matches("./").trim_end_matches('/');
                let mut mod_tree_dir = m.root_dir.join(mod_tree_rel_clean);

                // Case-insensitive fallback for tree folder name (e.g. Assets vs assets)
                if !mod_tree_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&m.root_dir) {
                        for entry in entries.flatten() {
                            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                                && entry
                                    .file_name()
                                    .to_string_lossy()
                                    .eq_ignore_ascii_case(mod_tree_rel_clean)
                            {
                                mod_tree_dir = entry.path();
                                break;
                            }
                        }
                    }
                }

                if !mod_tree_dir.is_dir() {
                    continue;
                }

                let target_prefix = asset_tree
                    .strip_prefix("assets://")
                    .unwrap_or(asset_tree)
                    .trim_matches('/');

                for entry in walkdir::WalkDir::new(&mod_tree_dir)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    if entry.file_type().is_file() {
                        if let Ok(rel) = entry.path().strip_prefix(&mod_tree_dir) {
                            let rel_str = rel.to_string_lossy().replace('\\', "/");
                            let asset_key = if target_prefix.is_empty() {
                                rel_str
                            } else {
                                format!("{}/{}", target_prefix, rel_str)
                            };
                            new_overlay.insert(asset_key, entry.path().to_path_buf());
                        }
                    }
                }
            }

            // Process explicit routes (e.g. "assets://file.gif" -> "./file.gif" or "assets://other.gif")
            for (asset_uri, target_spec) in &m.routes {
                if let Some(clean_key) = Self::sanitize_path(asset_uri) {
                    if target_spec.starts_with("assets://") || target_spec.starts_with("/assets/") {
                        if let Some(clean_target) = Self::sanitize_path(target_spec) {
                            if clean_target == clean_key {
                                continue;
                            }
                            let resolved_target =
                                if let Some(existing) = new_overlay.get(&clean_target) {
                                    Some(existing.clone())
                                } else {
                                    let base_dir = self.base_dir.read().unwrap().clone();
                                    let base_candidate = base_dir.join(&clean_target);
                                    if base_candidate.is_file() {
                                        Some(base_candidate)
                                    } else {
                                        None
                                    }
                                };
                            if let Some(target_path) = resolved_target {
                                new_overlay.insert(clean_key, target_path);
                            }
                        }
                    } else if let Some(clean_rel) =
                        Self::sanitize_path(target_spec.trim_start_matches("./"))
                    {
                        let target_path = m.root_dir.join(&clean_rel);
                        if target_path.is_file() {
                            new_overlay.insert(clean_key, target_path);
                        }
                    }
                }
            }
        }

        let count = new_overlay.len();
        {
            let mut map = self.overlay_map.write().await;
            *map = new_overlay;
        }
        {
            let mut active = self.active_mods.write().await;
            *active = mods;
        }

        self.overlay_generation.fetch_add(1, Ordering::SeqCst);

        Ok(count)
    }

    /// Indexes all installed mods so previews, theme assets, and resources resolve cleanly
    /// even when a mod is currently disabled
    pub async fn set_installed_descriptors(&self, mods: Vec<ActiveModDescriptor>) {
        let mut new_map = HashMap::new();
        for m in mods.iter().rev() {
            for (mod_tree_rel, asset_tree) in &m.trees {
                let mod_tree_rel_clean =
                    mod_tree_rel.trim_start_matches("./").trim_end_matches('/');
                let mut mod_tree_dir = m.root_dir.join(mod_tree_rel_clean);

                if !mod_tree_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&m.root_dir) {
                        for entry in entries.flatten() {
                            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                                && entry
                                    .file_name()
                                    .to_string_lossy()
                                    .eq_ignore_ascii_case(mod_tree_rel_clean)
                            {
                                mod_tree_dir = entry.path();
                                break;
                            }
                        }
                    }
                }

                if !mod_tree_dir.is_dir() {
                    continue;
                }

                let target_prefix = asset_tree
                    .strip_prefix("assets://")
                    .unwrap_or(asset_tree)
                    .trim_matches('/');

                for entry in walkdir::WalkDir::new(&mod_tree_dir)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    if entry.file_type().is_file() {
                        if let Ok(rel) = entry.path().strip_prefix(&mod_tree_dir) {
                            let rel_str = rel.to_string_lossy().replace('\\', "/");
                            let asset_key = if target_prefix.is_empty() {
                                rel_str
                            } else {
                                format!("{}/{}", target_prefix, rel_str)
                            };
                            new_map.insert(asset_key, entry.path().to_path_buf());
                        }
                    }
                }
            }

            for (asset_uri, target_spec) in &m.routes {
                if let Some(clean_key) = Self::sanitize_path(asset_uri) {
                    if let Some(clean_rel) =
                        Self::sanitize_path(target_spec.trim_start_matches("./"))
                    {
                        let target_path = m.root_dir.join(&clean_rel);
                        if target_path.is_file() {
                            new_map.insert(clean_key, target_path);
                        }
                    }
                }
            }
        }

        {
            let mut map = self.installed_overlay_map.write().await;
            *map = new_map;
        }
        {
            let mut imods = self.installed_mods.write().await;
            *imods = mods;
        }
    }

    pub async fn overlay_count(&self) -> usize {
        self.overlay_map.read().await.len()
    }

    pub async fn get_active_mod_ids(&self) -> Vec<String> {
        self.active_mods
            .read()
            .await
            .iter()
            .map(|m| m.id.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_path_valid() {
        assert_eq!(
            Vfs::sanitize_path("/assets/media/sample/001.gif"),
            Some("media/sample/001.gif".to_string())
        );
        assert_eq!(
            Vfs::sanitize_path("assets://media/chapter1/00001.gif"),
            Some("media/chapter1/00001.gif".to_string())
        );
        assert_eq!(
            Vfs::sanitize_path("/archive/audio/Sample%20Track%20-%20Complete.mp3"),
            Some("archive/audio/Sample Track - Complete.mp3".to_string())
        );
    }

    #[test]
    fn test_sanitize_path_security() {
        assert_eq!(Vfs::sanitize_path("/assets/../../etc/passwd"), None);
        assert_eq!(Vfs::sanitize_path("/assets/%2e%2e%2fetc/passwd"), None);
        assert_eq!(
            Vfs::sanitize_path("/assets/media/sample/001.gif\0.txt"),
            None
        );
        assert_eq!(Vfs::sanitize_path("/assets/"), None);
        assert_eq!(Vfs::sanitize_path(""), None);
    }

    #[tokio::test]
    async fn test_vfs_overlay_resolution() {
        let temp_dir = tempfile::tempdir().unwrap();
        let base_dir = temp_dir.path().join("base");
        let mod_dir = temp_dir.path().join("mods").join("test_mod");
        std::fs::create_dir_all(base_dir.join("media/chapter1")).unwrap();
        std::fs::create_dir_all(mod_dir.join("Assets/media/chapter1")).unwrap();

        let base_file = base_dir.join("media/chapter1/00001.gif");
        let base_file2 = base_dir.join("media/chapter1/00002.gif");
        let mod_file2 = mod_dir.join("Assets/media/chapter1/00002.gif");

        std::fs::write(&base_file, b"base 1").unwrap();
        std::fs::write(&base_file2, b"base 2").unwrap();
        std::fs::write(&mod_file2, b"mod 2").unwrap();

        let vfs = Vfs::new(base_dir);
        assert_eq!(vfs.generation(), 1);

        // Before mod overlay: both resolve to base
        assert_eq!(
            vfs.resolve("/media/chapter1/00001.gif").await,
            Some(base_file.clone())
        );
        assert_eq!(
            vfs.resolve("/media/chapter1/00002.gif").await,
            Some(base_file2.clone())
        );

        // Add mod overlay
        let mut trees = HashMap::new();
        trees.insert("./assets/".to_string(), "assets://".to_string()); // test case-insensitive match against "Assets" on disk
        let desc = ActiveModDescriptor {
            id: "test_mod".to_string(),
            root_dir: mod_dir,
            trees,
            routes: HashMap::new(),
        };

        let count = vfs.rebuild_overlay(vec![desc]).await.unwrap();
        assert_eq!(count, 1);
        assert_eq!(vfs.generation(), 2);

        // After overlay: 00001.gif is base, 00002.gif is overridden by mod
        assert_eq!(
            vfs.resolve("/media/chapter1/00001.gif").await,
            Some(base_file.clone())
        );
        assert_eq!(
            vfs.resolve("/media/chapter1/00002.gif").await,
            Some(mod_file2.clone())
        );

        // Clearing overlay restores base
        vfs.rebuild_overlay(vec![]).await.unwrap();
        assert_eq!(vfs.generation(), 3);
        assert_eq!(
            vfs.resolve("/media/chapter1/00002.gif").await,
            Some(base_file2)
        );
    }
}
