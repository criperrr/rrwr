use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::data::story::StoryPage;
use crate::data::ArchiveStore;
use crate::server::Vfs;

const BUCKET_MAX_ITEMS: usize = 120;
const MAX_INLINE_JSON_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_image: Option<String>,
    pub has_children: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChildrenResponse {
    pub node_id: String,
    pub items: Vec<TreeNode>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSearchResponse {
    pub query: String,
    pub items: Vec<TreeNode>,
    pub total: usize,
}

fn format_key_label(key: &str) -> String {
    let mut words = Vec::new();
    let mut current = String::new();
    for ch in key.chars() {
        if ch == '_' || ch == '-' || ch == ' ' {
            if !current.is_empty() {
                words.push(current.clone());
                current.clear();
            }
        } else if ch.is_uppercase() && !current.is_empty() {
            words.push(current.clone());
            current.clear();
            current.push(ch);
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        words.push(current);
    }

    words
        .into_iter()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => {
                    let mut s = first.to_uppercase().to_string();
                    s.push_str(&chars.as_str().to_lowercase());
                    s
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn format_duration(seconds: u32) -> String {
    let mins = seconds / 60;
    let secs = seconds % 60;
    format!("{}:{:02}", mins, secs)
}

fn is_image_filename(raw: &str) -> bool {
    let clean = raw
        .split('?')
        .next()
        .unwrap_or(raw)
        .split('#')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();
    clean.ends_with(".gif")
        || clean.ends_with(".png")
        || clean.ends_with(".jpg")
        || clean.ends_with(".jpeg")
        || clean.ends_with(".webp")
        || clean.ends_with(".svg")
        || clean.ends_with(".bmp")
}

fn media_to_asset_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !is_image_filename(trimmed) {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    Vfs::sanitize_path(trimmed).map(|clean| format!("/assets/{}", clean))
}

fn first_image_for_page(page: &StoryPage) -> Option<String> {
    page.media.iter().find_map(|m| media_to_asset_url(m))
}

fn first_image_for_keys(keys: &[String], map: &HashMap<String, StoryPage>) -> Option<String> {
    keys.iter()
        .take(20)
        .find_map(|k| map.get(k).and_then(first_image_for_page))
}

fn sort_page_keys(map: &HashMap<String, StoryPage>) -> Vec<String> {
    let mut numeric_keys: Vec<(u32, String)> = Vec::new();
    let mut other_keys: Vec<String> = Vec::new();

    for key in map.keys() {
        if let Ok(num) = key.parse::<u32>() {
            numeric_keys.push((num, key.clone()));
        } else {
            other_keys.push(key.clone());
        }
    }
    numeric_keys.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    other_keys.sort();

    let mut out: Vec<String> = numeric_keys.into_iter().map(|(_, k)| k).collect();
    out.extend(other_keys);
    out
}

fn paginate(items: Vec<TreeNode>, offset: usize, limit: usize) -> (Vec<TreeNode>, usize, bool) {
    let total = items.len();
    if offset >= total {
        return (Vec::new(), total, false);
    }
    let end = offset.saturating_add(limit).min(total);
    let has_more = end < total;
    (items[offset..end].to_vec(), total, has_more)
}

fn build_story_range_nodes(
    range_prefix: &str,
    col_key: &str,
    keys: &[String],
    map: &HashMap<String, StoryPage>,
    start: usize,
    end: usize,
) -> Vec<TreeNode> {
    let end = end.min(keys.len());
    if start >= end {
        return Vec::new();
    }
    let len = end - start;
    if len <= BUCKET_MAX_ITEMS {
        return keys[start..end]
            .iter()
            .filter_map(|k| {
                map.get(k).map(|p| TreeNode {
                    id: format!("story:{}:page:{}", col_key, k),
                    label: if p.title.trim().is_empty() {
                        k.clone()
                    } else {
                        format!("{} - {}", k, p.title.trim())
                    },
                    subtitle: if p.timestamp.trim().is_empty() {
                        None
                    } else {
                        Some(p.timestamp.trim().to_string())
                    },
                    kind: "PAGE".to_string(),
                    route: Some(format!("/page/{}", k)),
                    asset_url: None,
                    preview_image: first_image_for_page(p),
                    has_children: false,
                    count: None,
                })
            })
            .collect();
    }

    // Choose a balanced chunk size so each level has ~10-25 branches max
    let chunk_size = if len <= BUCKET_MAX_ITEMS * 25 {
        BUCKET_MAX_ITEMS
    } else {
        let raw = len.div_ceil(20);
        // Round up to a clean multiple of BUCKET_MAX_ITEMS
        raw.div_ceil(BUCKET_MAX_ITEMS) * BUCKET_MAX_ITEMS
    };

    let mut nodes = Vec::new();
    let mut cur = start;
    while cur < end {
        let next = (cur + chunk_size).min(end);
        let first_key = &keys[cur];
        let last_key = &keys[next - 1];
        nodes.push(TreeNode {
            id: format!("{}:range:{}:{}", range_prefix, cur, next),
            label: format!("{} - {}", first_key, last_key),
            subtitle: Some(format!("{} items", next - cur)),
            kind: "BRANCH".to_string(),
            route: None,
            asset_url: None,
            preview_image: first_image_for_keys(&keys[cur..next], map),
            has_children: true,
            count: Some(next - cur),
        });
        cur = next;
    }
    nodes
}

pub(crate) fn extract_media_root(page: &StoryPage) -> Option<String> {
    let raw = page.media.iter().find(|m| !m.trim().is_empty())?;
    let trimmed = raw
        .trim()
        .split('?')
        .next()
        .unwrap_or(raw)
        .split('#')
        .next()
        .unwrap_or(raw);
    let clean = trimmed
        .strip_prefix("assets://")
        .unwrap_or(trimmed)
        .trim_start_matches('/');
    let mut parts = clean.split('/').filter(|s| !s.is_empty());
    let first = parts.next()?;
    let second = parts.next()?;
    Some(format!("{}/{}", first, second))
}

fn is_generic_chapter_heading(title: &str) -> bool {
    let lower = title.trim().to_ascii_lowercase();
    let stripped = lower.strip_prefix("[s] ").unwrap_or(&lower).trim_start();
    const PREFIXES: [&str; 8] = [
        "act ",
        "chapter ",
        "part ",
        "book ",
        "episode ",
        "intermission",
        "prologue",
        "epilogue",
    ];
    PREFIXES.iter().any(|p| stripped.starts_with(p))
}

fn build_chapter_or_range_nodes(
    range_prefix: &str,
    col_key: &str,
    keys: &[String],
    map: &HashMap<String, StoryPage>,
) -> Vec<TreeNode> {
    if keys.is_empty() {
        return Vec::new();
    }

    let mut chapter_starts: Vec<usize> = Vec::new();
    let mut active_theme: Option<String> = None;

    for (idx, k) in keys.iter().enumerate() {
        let Some(page) = map.get(k) else {
            continue;
        };
        let explicit_theme = page
            .theme
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty() && !t.eq_ignore_ascii_case("default"))
            .map(|t| t.to_string());

        let theme_changed = match (&active_theme, &explicit_theme) {
            (Some(prev), Some(curr)) => prev != curr,
            (None, Some(_)) if idx > 0 => true,
            _ => false,
        };
        if let Some(curr) = explicit_theme {
            active_theme = Some(curr);
        }

        let is_break = idx == 0
            || page.previous.is_none()
            || is_generic_chapter_heading(&page.title)
            || theme_changed;

        if is_break {
            chapter_starts.push(idx);
        }
    }

    if chapter_starts.len() >= 2 {
        let mut nodes = Vec::with_capacity(chapter_starts.len());
        for (i, &c_start) in chapter_starts.iter().enumerate() {
            let c_end = chapter_starts.get(i + 1).copied().unwrap_or(keys.len());
            if c_start >= c_end {
                continue;
            }
            let first_key = &keys[c_start];
            let last_key = &keys[c_end - 1];
            let first_title = map
                .get(first_key)
                .map(|p| p.title.trim())
                .filter(|t| !t.is_empty() && *t != "==>")
                .map(|t| t.to_string())
                .unwrap_or_else(|| format!("{} - {}", first_key, last_key));
            let count = c_end - c_start;
            nodes.push(TreeNode {
                id: format!("{}:range:{}:{}", range_prefix, c_start, c_end),
                label: first_title,
                subtitle: Some(format!("{} pages ({} - {})", count, first_key, last_key)),
                kind: "BRANCH".to_string(),
                route: None,
                asset_url: None,
                preview_image: first_image_for_keys(&keys[c_start..c_end], map),
                has_children: true,
                count: Some(count),
            });
        }
        if nodes.len() >= 2 {
            return nodes;
        }
    }

    build_story_range_nodes(range_prefix, col_key, keys, map, 0, keys.len())
}

fn detect_metadata_group_field(map: &HashMap<String, StoryPage>) -> Option<&'static str> {
    if map.is_empty() {
        return None;
    }
    let candidates = ["book", "story", "part", "act", "chapter", "section", "arc"];
    let total = map.len();
    for field in candidates {
        let count = map
            .values()
            .filter(|p| {
                p.extra.get(field).is_some_and(|v| match v {
                    serde_json::Value::String(s) => !s.trim().is_empty(),
                    serde_json::Value::Number(_) => true,
                    _ => false,
                })
            })
            .count();
        if count * 2 >= total {
            return Some(field);
        }
    }
    None
}

fn meta_value_string(val: &serde_json::Value) -> Option<String> {
    match val {
        serde_json::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub async fn get_archive_tree_roots(store: &ArchiveStore, vfs: &Vfs) -> Vec<TreeNode> {
    let mut roots = Vec::new();

    // 1. Dynamic story collections from loaded StoryArchive
    {
        let base = store.story.base_archive();
        let collections: [(&str, &HashMap<String, StoryPage>); 5] = [
            ("story", &base.story),
            ("extra_stories", &base.extra_stories),
            ("bonus_pages", &base.bonus_pages),
            ("alt_stories", &base.alt_stories),
            ("faqs", &base.faqs),
        ];
        for (key, map) in collections {
            if !map.is_empty() {
                let keys = sort_page_keys(map);
                roots.push(TreeNode {
                    id: format!("story:{}", key),
                    label: format_key_label(key),
                    subtitle: Some(format!("{} pages", map.len())),
                    kind: "BRANCH".to_string(),
                    route: None,
                    asset_url: None,
                    preview_image: first_image_for_keys(&keys, map),
                    has_children: true,
                    count: Some(map.len()),
                });
            }
        }
    }

    let added_count = store.story.get_added_pages_count().await;
    if added_count > 0 {
        let added = store.story.get_added_pages_snapshot().await;
        let keys = sort_page_keys(&added);
        roots.push(TreeNode {
            id: "story:addedPages".to_string(),
            label: format_key_label("addedPages"),
            subtitle: Some(format!("{} pages", added_count)),
            kind: "BRANCH".to_string(),
            route: None,
            asset_url: None,
            preview_image: first_image_for_keys(&keys, &added),
            has_children: true,
            count: Some(added_count),
        });
    }

    let fancomics_map = store.story.get_fancomics().await;
    if !fancomics_map.is_empty() {
        roots.push(TreeNode {
            id: "story:fancomics".to_string(),
            label: format_key_label("fancomics"),
            subtitle: Some(format!("{} stories", fancomics_map.len())),
            kind: "BRANCH".to_string(),
            route: None,
            asset_url: None,
            preview_image: None,
            has_children: true,
            count: Some(fancomics_map.len()),
        });
    }

    // 2. Music JSON collection
    {
        let music = store.music.read().unwrap().clone();
        if !music.albums.is_empty() || !music.tracks.is_empty() {
            roots.push(TreeNode {
                id: "music:root".to_string(),
                label: "Music".to_string(),
                subtitle: Some(format!(
                    "{} albums, {} tracks",
                    music.albums.len(),
                    music.tracks.len()
                )),
                kind: "BRANCH".to_string(),
                route: Some("/music".to_string()),
                asset_url: None,
                preview_image: None,
                has_children: !music.albums.is_empty(),
                count: Some(music.albums.len()),
            });
        }
    }

    // 3. VFS Filesystem roots
    let base_dir = vfs.base_dir();
    if base_dir.is_dir() {
        let dir_name = base_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "Base".to_string());
        roots.push(TreeNode {
            id: "vfs:base:".to_string(),
            label: "Asset Files".to_string(),
            subtitle: Some(dir_name),
            kind: "DIR".to_string(),
            route: None,
            asset_url: None,
            preview_image: None,
            has_children: true,
            count: None,
        });
    }

    let custom_dir = vfs.custom_asset_dir();
    if custom_dir.is_dir()
        && std::fs::read_dir(&custom_dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
    {
        roots.push(TreeNode {
            id: "vfs:custom:".to_string(),
            label: "Custom Assets".to_string(),
            subtitle: Some("User Overlay".to_string()),
            kind: "DIR".to_string(),
            route: None,
            asset_url: None,
            preview_image: None,
            has_children: true,
            count: None,
        });
    }

    for (mod_id, mod_root) in vfs.active_mod_roots().await {
        if mod_root.is_dir() {
            roots.push(TreeNode {
                id: format!("vfs:mod:{}:", mod_id),
                label: format!("Mod: {}", mod_id),
                subtitle: Some("Active Mod".to_string()),
                kind: "DIR".to_string(),
                route: None,
                asset_url: None,
                preview_image: None,
                has_children: true,
                count: None,
            });
        }
    }

    roots
}

fn resolve_scope_root(vfs: &Vfs, scope: &str, mod_roots: &[(String, PathBuf)]) -> Option<PathBuf> {
    if scope == "base" {
        Some(vfs.base_dir())
    } else if scope == "custom" {
        Some(vfs.custom_asset_dir())
    } else if let Some(mod_id) = scope.strip_prefix("mod:") {
        mod_roots
            .iter()
            .find(|(id, _)| id == mod_id)
            .map(|(_, p)| p.clone())
    } else {
        None
    }
}

fn parse_vfs_node_id(raw: &str) -> Result<(&str, &str), String> {
    if let Some(rest) = raw.strip_prefix("base:") {
        Ok(("base", rest))
    } else if let Some(rest) = raw.strip_prefix("custom:") {
        Ok(("custom", rest))
    } else if let Some(rest) = raw.strip_prefix("mod:") {
        let Some((mod_id_end, _)) = rest.match_indices(':').next() else {
            return Err("Invalid mod VFS node id".to_string());
        };
        let scope_len = "mod:".len() + mod_id_end;
        let scope = &raw[..scope_len];
        let rel = &raw[scope_len + 1..];
        Ok((scope, rel))
    } else {
        Err("Invalid VFS scope".to_string())
    }
}

fn resolve_safe_vfs_path(root: &Path, rel: &str) -> Result<(PathBuf, String), String> {
    let clean_rel = if rel.is_empty() {
        String::new()
    } else {
        Vfs::sanitize_path(rel).ok_or_else(|| "Invalid or unsafe VFS path".to_string())?
    };

    let canon_root = root
        .canonicalize()
        .map_err(|_| "VFS root directory is not accessible".to_string())?;
    let target = if clean_rel.is_empty() {
        canon_root.clone()
    } else {
        let candidate = canon_root.join(&clean_rel);
        candidate
            .canonicalize()
            .map_err(|_| "Target path does not exist".to_string())?
    };

    if !target.starts_with(&canon_root) {
        return Err("Path escapes VFS root".to_string());
    }
    Ok((target, clean_rel))
}

fn build_asset_url(scope: &str, clean_rel: &str) -> Option<String> {
    if clean_rel.is_empty() {
        return None;
    }
    if scope == "base" || scope == "custom" {
        Some(format!("/assets/{}", clean_rel))
    } else {
        scope
            .strip_prefix("mod:")
            .map(|mod_id| format!("/assets/mods/{}/{}", mod_id, clean_rel))
    }
}

async fn get_vfs_dir_children(
    vfs: &Vfs,
    rest: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<TreeNode>, usize, bool), String> {
    let (scope, rel) = parse_vfs_node_id(rest)?;
    let mod_roots = vfs.active_mod_roots().await;
    let root = resolve_scope_root(vfs, scope, &mod_roots)
        .ok_or_else(|| format!("Unknown VFS scope '{}'", scope))?;
    let scope_owned = scope.to_string();
    let rel_owned = rel.to_string();

    tokio::task::spawn_blocking(move || {
        let (target_dir, clean_rel) = resolve_safe_vfs_path(&root, &rel_owned)?;
        if !target_dir.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        let mut dirs: Vec<TreeNode> = Vec::new();
        let mut files: Vec<TreeNode> = Vec::new();

        let entries = std::fs::read_dir(&target_dir)
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            let child_rel = if clean_rel.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", clean_rel, name)
            };

            if ft.is_dir() {
                dirs.push(TreeNode {
                    id: format!("vfs:{}:{}", scope_owned, child_rel),
                    label: name,
                    subtitle: None,
                    kind: "DIR".to_string(),
                    route: None,
                    asset_url: None,
                    preview_image: None,
                    has_children: true,
                    count: None,
                });
            } else if ft.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let is_json = name.to_ascii_lowercase().ends_with(".json");
                let is_img = is_image_filename(&name);
                let asset_url = build_asset_url(&scope_owned, &child_rel);
                files.push(TreeNode {
                    id: if is_json {
                        format!("json:{}:{}", scope_owned, child_rel)
                    } else {
                        format!("vfs-file:{}:{}", scope_owned, child_rel)
                    },
                    label: name,
                    subtitle: Some(format_bytes(size)),
                    kind: if is_json {
                        "JSON".to_string()
                    } else {
                        "FILE".to_string()
                    },
                    route: None,
                    preview_image: if is_img { asset_url.clone() } else { None },
                    asset_url,
                    has_children: is_json,
                    count: None,
                });
            }
        }

        dirs.sort_by(|a, b| {
            a.label
                .to_ascii_lowercase()
                .cmp(&b.label.to_ascii_lowercase())
        });
        files.sort_by(|a, b| {
            a.label
                .to_ascii_lowercase()
                .cmp(&b.label.to_ascii_lowercase())
        });
        dirs.extend(files);

        Ok(paginate(dirs, offset, limit))
    })
    .await
    .map_err(|e| format!("Directory scan task failed: {}", e))?
}

fn escape_pointer_token(token: &str) -> String {
    token.replace('~', "~0").replace('/', "~1")
}

fn preview_json_primitive(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.chars().count() > 80 {
                let short: String = trimmed.chars().take(77).collect();
                format!("\"{}...\"", short)
            } else {
                format!("\"{}\"", trimmed)
            }
        }
        serde_json::Value::Array(arr) => format!("[{} items]", arr.len()),
        serde_json::Value::Object(obj) => format!("{{{} keys}}", obj.len()),
    }
}

async fn get_json_file_children(
    vfs: &Vfs,
    rest: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<TreeNode>, usize, bool), String> {
    let (vfs_part, pointer) = match rest.split_once('#') {
        Some((p, ptr)) => (p, ptr.to_string()),
        None => (rest, String::new()),
    };
    let (scope, rel) = parse_vfs_node_id(vfs_part)?;
    let mod_roots = vfs.active_mod_roots().await;
    let root = resolve_scope_root(vfs, scope, &mod_roots)
        .ok_or_else(|| format!("Unknown VFS scope '{}'", scope))?;
    let vfs_part_owned = vfs_part.to_string();
    let rel_owned = rel.to_string();

    tokio::task::spawn_blocking(move || {
        let (target_file, _) = resolve_safe_vfs_path(&root, &rel_owned)?;
        if !target_file.is_file() {
            return Err("JSON target is not a file".to_string());
        }
        let meta = std::fs::metadata(&target_file)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        if meta.len() > MAX_INLINE_JSON_BYTES {
            return Err(format!(
                "JSON file ({}) exceeds {} inline tree limit",
                format_bytes(meta.len()),
                format_bytes(MAX_INLINE_JSON_BYTES)
            ));
        }

        let content = std::fs::read_to_string(&target_file)
            .map_err(|e| format!("Failed to read JSON file: {}", e))?;
        let root_val: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;

        let target_val = if pointer.is_empty() {
            &root_val
        } else {
            let ptr_norm = if pointer.starts_with('/') {
                pointer.clone()
            } else {
                format!("/{}", pointer)
            };
            root_val
                .pointer(&ptr_norm)
                .ok_or_else(|| "JSON pointer path not found".to_string())?
        };

        let mut nodes = Vec::new();
        match target_val {
            serde_json::Value::Object(obj) => {
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();
                for key in keys {
                    let child = &obj[key];
                    let child_ptr = format!("{}/{}", pointer, escape_pointer_token(key));
                    let has_children = matches!(
                        child,
                        serde_json::Value::Object(m) if !m.is_empty()
                    ) || matches!(
                        child,
                        serde_json::Value::Array(a) if !a.is_empty()
                    );
                    let count = match child {
                        serde_json::Value::Object(m) => Some(m.len()),
                        serde_json::Value::Array(a) => Some(a.len()),
                        _ => None,
                    };
                    nodes.push(TreeNode {
                        id: format!("json:{}#{}", vfs_part_owned, child_ptr),
                        label: if has_children {
                            key.clone()
                        } else {
                            format!("{}: {}", key, preview_json_primitive(child))
                        },
                        subtitle: if has_children {
                            Some(preview_json_primitive(child))
                        } else {
                            None
                        },
                        kind: if has_children {
                            "JSON".to_string()
                        } else {
                            "FILE".to_string()
                        },
                        route: None,
                        asset_url: None,
                        preview_image: None,
                        has_children,
                        count,
                    });
                }
            }
            serde_json::Value::Array(arr) => {
                for (idx, child) in arr.iter().enumerate() {
                    let child_ptr = format!("{}/{}", pointer, idx);
                    let has_children = matches!(
                        child,
                        serde_json::Value::Object(m) if !m.is_empty()
                    ) || matches!(
                        child,
                        serde_json::Value::Array(a) if !a.is_empty()
                    );
                    let count = match child {
                        serde_json::Value::Object(m) => Some(m.len()),
                        serde_json::Value::Array(a) => Some(a.len()),
                        _ => None,
                    };
                    nodes.push(TreeNode {
                        id: format!("json:{}#{}", vfs_part_owned, child_ptr),
                        label: if has_children {
                            format!("[{}]", idx)
                        } else {
                            format!("[{}]: {}", idx, preview_json_primitive(child))
                        },
                        subtitle: if has_children {
                            Some(preview_json_primitive(child))
                        } else {
                            None
                        },
                        kind: if has_children {
                            "JSON".to_string()
                        } else {
                            "FILE".to_string()
                        },
                        route: None,
                        asset_url: None,
                        preview_image: None,
                        has_children,
                        count,
                    });
                }
            }
            _ => {}
        }

        Ok(paginate(nodes, offset, limit))
    })
    .await
    .map_err(|e| format!("JSON parse task failed: {}", e))?
}

async fn get_story_collection_children(
    store: &ArchiveStore,
    col_key: &str,
    sub_spec: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<(Vec<TreeNode>, usize, bool), String> {
    if col_key == "fancomics" {
        let fancomics_map = store.story.get_fancomics().await;
        if let Some(spec) = sub_spec {
            if let Some(story_id) = spec.strip_prefix("story:") {
                let Some(story_val) = fancomics_map.get(story_id) else {
                    return Err(format!("Fancomic story '{}' not found", story_id));
                };
                let mut nodes = Vec::new();
                if let Some(pages) = story_val.get("p").and_then(|v| v.as_array()) {
                    for (idx, p) in pages.iter().enumerate() {
                        let page_num = idx + 1;
                        let title = p
                            .get("c")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        nodes.push(TreeNode {
                            id: format!("story:fancomics:page:{}:{}", story_id, page_num),
                            label: if title.is_empty() {
                                format!("Page {}", page_num)
                            } else {
                                format!("{} - {}", page_num, title)
                            },
                            subtitle: None,
                            kind: "PAGE".to_string(),
                            route: Some(format!("/page/fanventure:{}:{}", story_id, page_num)),
                            asset_url: None,
                            preview_image: None,
                            has_children: false,
                            count: None,
                        });
                    }
                }
                return Ok(paginate(nodes, offset, limit));
            }
            return Err("Invalid fanventure node id".to_string());
        }

        let mut ids: Vec<&String> = fancomics_map.keys().collect();
        ids.sort();
        let nodes: Vec<TreeNode> = ids
            .into_iter()
            .map(|id| {
                let val = &fancomics_map[id];
                let name = val
                    .get("n")
                    .or_else(|| val.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(id);
                let page_count = val
                    .get("p")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                let icon_img = val
                    .get("o")
                    .and_then(|v| v.as_str())
                    .and_then(media_to_asset_url);
                TreeNode {
                    id: format!("story:fancomics:story:{}", id),
                    label: name.to_string(),
                    subtitle: Some(format!("{} pages", page_count)),
                    kind: "BRANCH".to_string(),
                    route: None,
                    asset_url: None,
                    preview_image: icon_img,
                    has_children: page_count > 0,
                    count: Some(page_count),
                }
            })
            .collect();
        return Ok(paginate(nodes, offset, limit));
    }

    let added_snapshot;
    let base_arc;
    let map: &HashMap<String, StoryPage> = if col_key == "addedPages" {
        added_snapshot = store.story.get_added_pages_snapshot().await;
        &added_snapshot
    } else {
        base_arc = store.story.base_archive();
        match col_key {
            "story" => &base_arc.story,
            "extra_stories" => &base_arc.extra_stories,
            "bonus_pages" => &base_arc.bonus_pages,
            "alt_stories" => &base_arc.alt_stories,
            "faqs" => &base_arc.faqs,
            _ => return Err(format!("Unknown story collection '{}'", col_key)),
        }
    };

    match sub_spec {
        None => {
            if let Some(meta_field) = detect_metadata_group_field(map) {
                let mut groups: HashMap<String, Vec<String>> = HashMap::new();
                for (k, p) in map {
                    let group_val = p
                        .extra
                        .get(meta_field)
                        .and_then(meta_value_string)
                        .unwrap_or_else(|| "Other".to_string());
                    groups.entry(group_val).or_default().push(k.clone());
                }
                let mut group_keys: Vec<String> = groups.keys().cloned().collect();
                group_keys.sort();
                let nodes: Vec<TreeNode> = group_keys
                    .into_iter()
                    .map(|gk| {
                        let count = groups[&gk].len();
                        let preview = first_image_for_keys(&groups[&gk], map);
                        let encoded = percent_encoding::utf8_percent_encode(
                            &gk,
                            percent_encoding::NON_ALPHANUMERIC,
                        )
                        .to_string();
                        TreeNode {
                            id: format!("story:{}:meta:{}:{}", col_key, meta_field, encoded),
                            label: format!("{} {}", format_key_label(meta_field), gk),
                            subtitle: Some(format!("{} pages", count)),
                            kind: "BRANCH".to_string(),
                            route: None,
                            asset_url: None,
                            preview_image: preview,
                            has_children: true,
                            count: Some(count),
                        }
                    })
                    .collect();
                return Ok(paginate(nodes, offset, limit));
            }

            let keys = sort_page_keys(map);
            let mut media_groups: HashMap<String, Vec<String>> = HashMap::new();
            let mut media_order: Vec<String> = Vec::new();
            for k in &keys {
                let root_key = map
                    .get(k)
                    .and_then(extract_media_root)
                    .unwrap_or_else(|| "other".to_string());
                if !media_groups.contains_key(&root_key) {
                    media_order.push(root_key.clone());
                }
                media_groups.entry(root_key).or_default().push(k.clone());
            }

            let non_other_roots = media_order.iter().filter(|r| r.as_str() != "other").count();
            if non_other_roots >= 2 {
                let nodes: Vec<TreeNode> = media_order
                    .into_iter()
                    .map(|root_key| {
                        let g_keys = &media_groups[&root_key];
                        let count = g_keys.len();
                        let first_key = &g_keys[0];
                        let last_key = &g_keys[count - 1];
                        let first_title = map
                            .get(first_key)
                            .map(|p| p.title.trim())
                            .filter(|t| !t.is_empty() && *t != "==>")
                            .map(|t| t.to_string())
                            .unwrap_or_else(|| format_key_label(&root_key.replace('/', " ")));
                        let encoded = percent_encoding::utf8_percent_encode(
                            &root_key,
                            percent_encoding::NON_ALPHANUMERIC,
                        )
                        .to_string();
                        TreeNode {
                            id: format!("story:{}:media:{}", col_key, encoded),
                            label: first_title,
                            subtitle: Some(format!(
                                "{} ({} pages, {} - {})",
                                root_key, count, first_key, last_key
                            )),
                            kind: "BRANCH".to_string(),
                            route: None,
                            asset_url: None,
                            preview_image: first_image_for_keys(g_keys, map),
                            has_children: true,
                            count: Some(count),
                        }
                    })
                    .collect();
                return Ok(paginate(nodes, offset, limit));
            }

            let nodes =
                build_chapter_or_range_nodes(&format!("story:{}", col_key), col_key, &keys, map);
            Ok(paginate(nodes, offset, limit))
        }
        Some(spec) => {
            if let Some(media_spec) = spec.strip_prefix("media:") {
                let (encoded_root, sub_range) = match media_spec.split_once(":range:") {
                    Some((er, r)) => (er, Some(r)),
                    None => (media_spec, None),
                };
                let target_root = percent_encoding::percent_decode_str(encoded_root)
                    .decode_utf8()
                    .map_err(|_| "Invalid media root encoding".to_string())?
                    .into_owned();
                let mut filtered: HashMap<String, StoryPage> = HashMap::new();
                for (k, p) in map {
                    let r = extract_media_root(p).unwrap_or_else(|| "other".to_string());
                    if r == target_root {
                        filtered.insert(k.clone(), p.clone());
                    }
                }
                let keys = sort_page_keys(&filtered);
                let media_prefix = format!("story:{}:media:{}", col_key, encoded_root);
                if let Some(range_spec) = sub_range {
                    let Some((s_str, e_str)) = range_spec.split_once(':') else {
                        return Err("Invalid range node id".to_string());
                    };
                    let start: usize = s_str
                        .parse()
                        .map_err(|_| "Invalid range start".to_string())?;
                    let end: usize = e_str.parse().map_err(|_| "Invalid range end".to_string())?;
                    let nodes = build_story_range_nodes(
                        &media_prefix,
                        col_key,
                        &keys,
                        &filtered,
                        start,
                        end,
                    );
                    return Ok(paginate(nodes, offset, limit));
                }
                let nodes = build_chapter_or_range_nodes(&media_prefix, col_key, &keys, &filtered);
                Ok(paginate(nodes, offset, limit))
            } else if let Some(range_spec) = spec.strip_prefix("range:") {
                let Some((s_str, e_str)) = range_spec.split_once(':') else {
                    return Err("Invalid range node id".to_string());
                };
                let start: usize = s_str
                    .parse()
                    .map_err(|_| "Invalid range start".to_string())?;
                let end: usize = e_str.parse().map_err(|_| "Invalid range end".to_string())?;
                let keys = sort_page_keys(map);
                let nodes = build_story_range_nodes(
                    &format!("story:{}", col_key),
                    col_key,
                    &keys,
                    map,
                    start,
                    end,
                );
                Ok(paginate(nodes, offset, limit))
            } else if let Some(meta_spec) = spec.strip_prefix("meta:") {
                let Some((field, encoded_val)) = meta_spec.split_once(':') else {
                    return Err("Invalid metadata group node id".to_string());
                };
                let target_val = percent_encoding::percent_decode_str(encoded_val)
                    .decode_utf8()
                    .map_err(|_| "Invalid metadata group encoding".to_string())?
                    .into_owned();
                let mut filtered: HashMap<String, StoryPage> = HashMap::new();
                for (k, p) in map {
                    let g = p
                        .extra
                        .get(field)
                        .and_then(meta_value_string)
                        .unwrap_or_else(|| "Other".to_string());
                    if g == target_val {
                        filtered.insert(k.clone(), p.clone());
                    }
                }
                let keys = sort_page_keys(&filtered);
                let nodes = build_chapter_or_range_nodes(
                    &format!("story:{}:meta:{}:{}", col_key, field, encoded_val),
                    col_key,
                    &keys,
                    &filtered,
                );
                Ok(paginate(nodes, offset, limit))
            } else {
                Err(format!("Unknown story node specifier '{}'", spec))
            }
        }
    }
}

pub async fn get_archive_tree_children(
    store: &ArchiveStore,
    vfs: &Vfs,
    node_id: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<TreeChildrenResponse, String> {
    let off = offset.unwrap_or(0);
    let lim = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let (items, total, has_more) = if let Some(rest) = node_id.strip_prefix("story:") {
        let (col_key, sub_spec) = match rest.split_once(':') {
            Some((c, s)) => (c, Some(s)),
            None => (rest, None),
        };
        get_story_collection_children(store, col_key, sub_spec, off, lim).await?
    } else if node_id == "music:root" {
        let music = store.music.read().unwrap().clone();
        let mut album_keys: Vec<(&String, &crate::data::music::Album)> =
            music.albums.iter().collect();
        album_keys.sort_by(|a, b| {
            a.1.date
                .as_deref()
                .unwrap_or("")
                .cmp(b.1.date.as_deref().unwrap_or(""))
                .then_with(|| a.1.name.cmp(&b.1.name))
        });
        let nodes: Vec<TreeNode> = album_keys
            .into_iter()
            .map(|(k, album)| TreeNode {
                id: format!("music:album:{}", k),
                label: album.name.clone(),
                subtitle: Some(format!("{} tracks", album.tracks.len())),
                kind: "ALBUM".to_string(),
                route: Some(format!("/music/album/{}", k)),
                asset_url: None,
                preview_image: None,
                has_children: !album.tracks.is_empty(),
                count: Some(album.tracks.len()),
            })
            .collect();
        paginate(nodes, off, lim)
    } else if let Some(album_key) = node_id.strip_prefix("music:album:") {
        let music = store.music.read().unwrap().clone();
        let Some(album) = music.albums.get(album_key) else {
            return Err(format!("Album '{}' not found", album_key));
        };
        let nodes: Vec<TreeNode> = album
            .tracks
            .iter()
            .map(|t_key| {
                if let Some(track) = music.tracks.get(t_key) {
                    TreeNode {
                        id: format!("music:track:{}", t_key),
                        label: track.name.clone(),
                        subtitle: Some(format_duration(track.duration)),
                        kind: "TRACK".to_string(),
                        route: Some(format!("/music/track/{}", t_key)),
                        asset_url: None,
                        preview_image: None,
                        has_children: false,
                        count: None,
                    }
                } else {
                    TreeNode {
                        id: format!("music:track:{}", t_key),
                        label: t_key.clone(),
                        subtitle: None,
                        kind: "TRACK".to_string(),
                        route: Some(format!("/music/track/{}", t_key)),
                        asset_url: None,
                        preview_image: None,
                        has_children: false,
                        count: None,
                    }
                }
            })
            .collect();
        paginate(nodes, off, lim)
    } else if let Some(rest) = node_id.strip_prefix("vfs:") {
        get_vfs_dir_children(vfs, rest, off, lim).await?
    } else if let Some(rest) = node_id.strip_prefix("json:") {
        get_json_file_children(vfs, rest, off, lim).await?
    } else {
        return Err(format!("Unknown tree node id '{}'", node_id));
    };

    Ok(TreeChildrenResponse {
        node_id: node_id.to_string(),
        items,
        total,
        offset: off,
        limit: lim,
        has_more,
    })
}

pub async fn search_archive_tree(
    store: &ArchiveStore,
    vfs: &Vfs,
    query: &str,
    limit: Option<usize>,
) -> TreeSearchResponse {
    let q = query.trim().to_ascii_lowercase();
    let max_results = limit.unwrap_or(50).clamp(1, 200);
    if q.is_empty() {
        return TreeSearchResponse {
            query: query.to_string(),
            items: Vec::new(),
            total: 0,
        };
    }

    let mut results: Vec<TreeNode> = Vec::new();

    // 1. Search Story collections
    {
        let base = store.story.base_archive();
        let collections: [(&str, &HashMap<String, StoryPage>); 5] = [
            ("story", &base.story),
            ("extra_stories", &base.extra_stories),
            ("bonus_pages", &base.bonus_pages),
            ("alt_stories", &base.alt_stories),
            ("faqs", &base.faqs),
        ];
        for (col_key, map) in collections {
            if map.is_empty() || results.len() >= max_results {
                continue;
            }
            for key in sort_page_keys(map) {
                if results.len() >= max_results {
                    break;
                }
                if let Some(page) = map.get(&key) {
                    if key.to_ascii_lowercase().contains(&q)
                        || page.title.to_ascii_lowercase().contains(&q)
                    {
                        results.push(TreeNode {
                            id: format!("story:{}:page:{}", col_key, key),
                            label: if page.title.trim().is_empty() {
                                key.clone()
                            } else {
                                format!("{} - {}", key, page.title.trim())
                            },
                            subtitle: Some(format_key_label(col_key)),
                            kind: "PAGE".to_string(),
                            route: Some(format!("/page/{}", key)),
                            asset_url: None,
                            preview_image: first_image_for_page(page),
                            has_children: false,
                            count: None,
                        });
                    }
                }
            }
        }
    }

    // 2. Search Music albums & tracks
    if results.len() < max_results {
        let music = store.music.read().unwrap().clone();
        for (k, album) in &music.albums {
            if results.len() >= max_results {
                break;
            }
            if album.name.to_ascii_lowercase().contains(&q) || k.to_ascii_lowercase().contains(&q) {
                results.push(TreeNode {
                    id: format!("music:album:{}", k),
                    label: album.name.clone(),
                    subtitle: Some(format!("Album ({} tracks)", album.tracks.len())),
                    kind: "ALBUM".to_string(),
                    route: Some(format!("/music/album/{}", k)),
                    asset_url: None,
                    preview_image: None,
                    has_children: !album.tracks.is_empty(),
                    count: Some(album.tracks.len()),
                });
            }
        }
        for (k, track) in &music.tracks {
            if results.len() >= max_results {
                break;
            }
            if track.name.to_ascii_lowercase().contains(&q) || k.to_ascii_lowercase().contains(&q) {
                results.push(TreeNode {
                    id: format!("music:track:{}", k),
                    label: track.name.clone(),
                    subtitle: Some(format!("Track ({})", format_duration(track.duration))),
                    kind: "TRACK".to_string(),
                    route: Some(format!("/music/track/{}", k)),
                    asset_url: None,
                    preview_image: None,
                    has_children: false,
                    count: None,
                });
            }
        }
    }

    // 3. Shallow VFS search (depth <= 2) if still under max_results
    if results.len() < max_results {
        let base_dir = vfs.base_dir();
        let remaining = max_results - results.len();
        let q_clone = q.clone();
        if let Ok(vfs_hits) = tokio::task::spawn_blocking(move || {
            let mut hits = Vec::new();
            if !base_dir.is_dir() {
                return hits;
            }
            for entry in walkdir::WalkDir::new(&base_dir)
                .max_depth(2)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if hits.len() >= remaining {
                    break;
                }
                if entry.depth() == 0 {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                if name.to_ascii_lowercase().contains(&q_clone) {
                    if let Ok(rel) = entry.path().strip_prefix(&base_dir) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        let is_dir = entry.file_type().is_dir();
                        let is_json = !is_dir && name.to_ascii_lowercase().ends_with(".json");
                        let asset_url = if is_dir {
                            None
                        } else {
                            Some(format!("/assets/{}", rel_str))
                        };
                        let preview_image = if !is_dir && is_image_filename(&name) {
                            asset_url.clone()
                        } else {
                            None
                        };
                        hits.push(TreeNode {
                            id: if is_dir {
                                format!("vfs:base:{}", rel_str)
                            } else if is_json {
                                format!("json:base:{}", rel_str)
                            } else {
                                format!("vfs-file:base:{}", rel_str)
                            },
                            label: name,
                            subtitle: Some(rel_str.clone()),
                            kind: if is_dir {
                                "DIR".to_string()
                            } else if is_json {
                                "JSON".to_string()
                            } else {
                                "FILE".to_string()
                            },
                            route: None,
                            asset_url,
                            preview_image,
                            has_children: is_dir || is_json,
                            count: None,
                        });
                    }
                }
            }
            hits
        })
        .await
        {
            results.extend(vfs_hits);
        }
    }

    let total = results.len();
    TreeSearchResponse {
        query: query.to_string(),
        items: results,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::music::{Album, MusicArchive, Track};
    use crate::data::story::{StoryArchive, StoryStore};
    use std::sync::Arc;
    use tempfile::tempdir;

    fn make_page(id: &str, title: &str) -> StoryPage {
        StoryPage {
            page_id: id.to_string(),
            title: title.to_string(),
            timestamp: "12345".to_string(),
            content: "body".to_string(),
            media: if id == "000001" {
                vec!["assets://media/sample/00001.gif".to_string()]
            } else {
                vec![]
            },
            flag: vec![],
            next: vec![],
            previous: None,
            theme: None,
            header_banner: None,
            header_tooltip: None,
            extra: Default::default(),
        }
    }

    fn make_store(page_count: usize) -> ArchiveStore {
        let mut story = HashMap::new();
        for i in 1..=page_count {
            let k = format!("{:06}", i);
            let mut p = make_page(&k, &format!("Page {}", i));
            if i > 1 {
                p.previous = Some(format!("{:06}", i - 1));
            }
            story.insert(k, p);
        }
        let mut extra_stories = HashMap::new();
        extra_stories.insert("000001".to_string(), make_page("000001", "Extra Start"));

        let mut albums = HashMap::new();
        albums.insert(
            "vol1".to_string(),
            Album {
                name: "Volume One".to_string(),
                directory: "vol1".to_string(),
                date: Some("2009-01-01".to_string()),
                tracks: vec!["track1".to_string()],
                album_cover_artists: vec![],
                artists: None,
                bonus: vec![],
                commentary: None,
                has_track_art: false,
                urls: vec![],
                uses_groups: false,
            },
        );
        let mut tracks = HashMap::new();
        tracks.insert(
            "track1".to_string(),
            Track {
                name: "First Tune".to_string(),
                directory: "first-tune".to_string(),
                album: vec!["vol1".to_string()],
                artists: vec![],
                duration: 125,
                group: String::new(),
                date: None,
                bandcamp_id: None,
                commentary: None,
                contributors: vec![],
                cover_artists: None,
                lyrics: None,
                pages: vec![],
                references: vec![],
                referenced_by: vec![],
                urls: vec![],
            },
        );

        let arc = StoryArchive {
            story,
            extra_stories,
            bonus_pages: HashMap::new(),
            alt_stories: HashMap::new(),
            faqs: HashMap::new(),
            tags: vec![],
            alt_media: String::new(),
        };
        let music = MusicArchive {
            albums,
            tracks,
            artists: HashMap::new(),
            flashes: HashMap::new(),
        };
        ArchiveStore {
            story: Arc::new(StoryStore::new(arc)),
            music: Arc::new(std::sync::RwLock::new(Arc::new(music))),
            music_raw: Arc::new(std::sync::RwLock::new(Arc::new(serde_json::Value::Null))),
        }
    }

    #[tokio::test]
    async fn test_tree_roots_dynamic_collections() {
        let dir = tempdir().unwrap();
        let store = make_store(5);
        let vfs = Vfs::new(dir.path().to_path_buf());

        let roots = get_archive_tree_roots(&store, &vfs).await;
        let ids: Vec<&str> = roots.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains(&"story:story"));
        assert!(ids.contains(&"story:extra_stories"));
        assert!(!ids.contains(&"story:alt_stories"));
        assert!(ids.contains(&"music:root"));
        assert!(ids.contains(&"vfs:base:"));
        let story_root = roots.iter().find(|n| n.id == "story:story").unwrap();
        assert_eq!(
            story_root.preview_image.as_deref(),
            Some("/assets/media/sample/00001.gif")
        );
    }

    #[tokio::test]
    async fn test_tree_range_grouping_and_pagination() {
        let dir = tempdir().unwrap();
        let store = make_store(250);
        let vfs = Vfs::new(dir.path().to_path_buf());

        let top = get_archive_tree_children(&store, &vfs, "story:story", Some(0), Some(10))
            .await
            .unwrap();
        assert_eq!(top.total, 3);
        assert_eq!(top.items[0].kind, "BRANCH");
        assert_eq!(top.items[0].id, "story:story:range:0:120");
        assert_eq!(top.items[2].id, "story:story:range:240:250");

        let leaf_page =
            get_archive_tree_children(&store, &vfs, "story:story:range:0:120", Some(10), Some(15))
                .await
                .unwrap();
        assert_eq!(leaf_page.total, 120);
        assert_eq!(leaf_page.items.len(), 15);
        assert!(leaf_page.has_more);
        assert_eq!(leaf_page.items[0].kind, "PAGE");
        assert_eq!(leaf_page.items[0].route.as_deref(), Some("/page/000011"));
    }

    #[tokio::test]
    async fn test_tree_multi_signal_media_root_and_chapter_detection() {
        let dir = tempdir().unwrap();
        let vfs = Vfs::new(dir.path().to_path_buf());

        let mut story = HashMap::new();
        // Section 1: advimgs/alpha
        let mut p1 = make_page("000001", "Alpha Adventure");
        p1.media = vec!["assets://advimgs/alpha/001.gif".to_string()];
        story.insert("000001".to_string(), p1);

        let mut p2 = make_page("000002", "Alpha Step 2");
        p2.previous = Some("000001".to_string());
        p2.media = vec!["assets://advimgs/alpha/002.gif".to_string()];
        story.insert("000002".to_string(), p2);

        // Section 2: media/beta with generic Act / Chapter / Intermission headings
        let mut p3 = make_page("000010", "Act 1: Beginning");
        p3.previous = None;
        p3.media = vec!["assets://media/beta/010.png".to_string()];
        story.insert("000010".to_string(), p3);

        let mut p4 = make_page("000011", "Inside Act 1");
        p4.previous = Some("000010".to_string());
        p4.media = vec!["assets://media/beta/011.png".to_string()];
        story.insert("000011".to_string(), p4);

        let mut p5 = make_page("000012", "Intermission");
        p5.previous = Some("000011".to_string());
        p5.media = vec!["assets://media/beta/012.png".to_string()];
        story.insert("000012".to_string(), p5);

        let mut p6 = make_page("000013", "Chapter 2: Next");
        p6.previous = Some("000012".to_string());
        p6.media = vec!["assets://media/beta/013.png".to_string()];
        story.insert("000013".to_string(), p6);

        let arc = StoryArchive {
            story,
            extra_stories: HashMap::new(),
            bonus_pages: HashMap::new(),
            alt_stories: HashMap::new(),
            faqs: HashMap::new(),
            tags: vec![],
            alt_media: String::new(),
        };
        let store = ArchiveStore {
            story: Arc::new(StoryStore::new(arc)),
            music: Arc::new(std::sync::RwLock::new(Arc::new(MusicArchive {
                albums: HashMap::new(),
                tracks: HashMap::new(),
                artists: HashMap::new(),
                flashes: HashMap::new(),
            }))),
            music_raw: Arc::new(std::sync::RwLock::new(Arc::new(serde_json::Value::Null))),
        };

        // Top level should group into 2 media-root sections
        let sections = get_archive_tree_children(&store, &vfs, "story:story", None, None)
            .await
            .unwrap();
        assert_eq!(sections.total, 2);
        assert_eq!(sections.items[0].label, "Alpha Adventure");
        assert_eq!(
            sections.items[0].preview_image.as_deref(),
            Some("/assets/advimgs/alpha/001.gif")
        );
        assert_eq!(sections.items[1].label, "Act 1: Beginning");
        assert_eq!(
            sections.items[1].preview_image.as_deref(),
            Some("/assets/media/beta/010.png")
        );

        // Drilling into media/beta section should detect 3 chapters
        let chapters = get_archive_tree_children(&store, &vfs, &sections.items[1].id, None, None)
            .await
            .unwrap();
        assert_eq!(chapters.total, 3);
        assert_eq!(chapters.items[0].label, "Act 1: Beginning");
        assert_eq!(chapters.items[1].label, "Intermission");
        assert_eq!(chapters.items[2].label, "Chapter 2: Next");

        // Drilling into Act 1 should yield its 2 pages
        let act1_pages = get_archive_tree_children(&store, &vfs, &chapters.items[0].id, None, None)
            .await
            .unwrap();
        assert_eq!(act1_pages.total, 2);
        assert_eq!(act1_pages.items[0].kind, "PAGE");
        assert_eq!(act1_pages.items[0].route.as_deref(), Some("/page/000010"));
    }

    #[tokio::test]
    async fn test_tree_vfs_traversal_rejection_and_json_expansion() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(
            dir.path().join("sub/sample.json"),
            r#"{"alpha": {"nested": [10, 20]}, "beta": "hello"}"#,
        )
        .unwrap();

        let store = make_store(1);
        let vfs = Vfs::new(dir.path().to_path_buf());

        let err = get_archive_tree_children(&store, &vfs, "vfs:base:../../etc", None, None)
            .await
            .unwrap_err();
        assert!(err.contains("Invalid") || err.contains("unsafe"));

        let err_enc =
            get_archive_tree_children(&store, &vfs, "vfs:base:%2e%2e/%2e%2e/etc", None, None)
                .await
                .unwrap_err();
        assert!(err_enc.contains("Invalid") || err_enc.contains("unsafe"));

        let json_root =
            get_archive_tree_children(&store, &vfs, "json:base:sub/sample.json", None, None)
                .await
                .unwrap();
        assert_eq!(json_root.total, 2);
        assert_eq!(json_root.items[0].label, "alpha");
        assert!(json_root.items[0].has_children);
        assert_eq!(json_root.items[1].label, "beta: \"hello\"");
        assert!(!json_root.items[1].has_children);

        let json_nested = get_archive_tree_children(
            &store,
            &vfs,
            "json:base:sub/sample.json#/alpha/nested",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(json_nested.total, 2);
        assert_eq!(json_nested.items[0].label, "[0]: 10");
    }

    #[tokio::test]
    async fn test_tree_music_and_search() {
        let dir = tempdir().unwrap();
        let store = make_store(5);
        let vfs = Vfs::new(dir.path().to_path_buf());

        let albums = get_archive_tree_children(&store, &vfs, "music:root", None, None)
            .await
            .unwrap();
        assert_eq!(albums.total, 1);
        assert_eq!(albums.items[0].kind, "ALBUM");

        let tracks = get_archive_tree_children(&store, &vfs, "music:album:vol1", None, None)
            .await
            .unwrap();
        assert_eq!(tracks.total, 1);
        assert_eq!(tracks.items[0].kind, "TRACK");
        assert_eq!(tracks.items[0].subtitle.as_deref(), Some("2:05"));

        let search = search_archive_tree(&store, &vfs, "First Tune", Some(10)).await;
        assert_eq!(search.total, 1);
        assert_eq!(search.items[0].kind, "TRACK");
    }
}
