use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_ARCHIVE_UNPACKED_BYTES: u64 = 16 * 1024 * 1024 * 1024;

/// Resolves the `(story_json, music_json)` data files inside an asset pack root.
/// Prefers `story.json`, and falls back to any JSON object in the data directory
/// containing a top-level `"story"` key.
pub fn find_archive_data_files(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let candidates = ["archive/data", "archive/Data", "Archive/data"];
    for rel in candidates {
        let data_dir = path.join(rel);
        if !data_dir.is_dir() {
            continue;
        }
        let music_path = data_dir.join("music.json");
        if !music_path.is_file() {
            continue;
        }
        let primary_story = data_dir.join("story.json");
        if primary_story.is_file() {
            return Some((primary_story, music_path));
        }
        if let Ok(entries) = fs::read_dir(&data_dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }
                let is_json = entry_path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
                let is_music = entry_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("music.json"));
                if !is_json || is_music {
                    continue;
                }
                if let Ok(mut file) = File::open(&entry_path) {
                    let mut buf = [0u8; 512];
                    if let Ok(n) = file.read(&mut buf) {
                        if let Ok(head) = std::str::from_utf8(&buf[..n]) {
                            let trimmed = head.trim_start();
                            if trimmed.starts_with('{') && trimmed.contains("\"story\"") {
                                return Some((entry_path, music_path));
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn is_asset_pack(path: &Path) -> bool {
    find_archive_data_files(path).is_some()
}

pub fn custom_asset_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| {
            #[cfg(target_os = "android")]
            return PathBuf::from("/sdcard/Android/data/com.rrwr.app/files");
            #[cfg(not(target_os = "android"))]
            PathBuf::from(".")
        })
        .join("rrwr")
        .join("custom-assets")
}

pub fn managed_asset_packs_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("asset_packs")
}

pub fn import_asset_pack_zip(source: &Path, packs_dir: &Path) -> Result<PathBuf, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("Could not open selected archive: {error}"))?;
    if !source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        return Err("Choose a .zip archive.".to_string());
    }
    let staging = tempfile::tempdir().map_err(|error| error.to_string())?;
    extract_zip(&source, staging.path())?;
    let root = find_asset_root(staging.path()).unwrap_or_else(|| staging.path().to_path_buf());
    if !is_asset_pack(&root) {
        return Err("No valid asset pack was found in the selected .zip.".to_string());
    }
    fs::create_dir_all(packs_dir).map_err(|error| error.to_string())?;
    let base_name = source
        .file_stem()
        .and_then(|name| name.to_str())
        .map(safe_name)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "asset-pack".to_string());
    let target = unique_target(packs_dir, &base_name);
    copy_tree(&root, &target).map_err(|error| format!("Could not import asset pack: {error}"))?;
    Ok(target)
}

pub fn list_managed_asset_packs(
    packs_dir: &Path,
    active_dir: &Path,
) -> Vec<(String, String, bool)> {
    let mut packs = Vec::new();
    let Ok(entries) = fs::read_dir(packs_dir) else {
        return packs;
    };
    let active_canon = active_dir.canonicalize().ok();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !is_asset_pack(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_active = active_canon
            .as_ref()
            .is_some_and(|ac| path.canonicalize().ok().as_ref() == Some(ac))
            || path == active_dir;
        packs.push((name, path.to_string_lossy().into_owned(), is_active));
    }
    packs.sort_by(|a, b| a.0.cmp(&b.0));
    packs
}

pub fn validate_asset_pack(path: &Path) -> Result<PathBuf, String> {
    let candidate = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    if candidate.is_dir() && is_asset_pack(&candidate) {
        return Ok(candidate);
    }
    let sub = candidate.join("Asset Pack");
    if sub.is_dir() && is_asset_pack(&sub) {
        return Ok(sub);
    }
    if !candidate.is_dir() {
        return Err("Select the extracted Asset Pack folder.".to_string());
    }
    Err(
        "This folder is not an Asset Pack root: archive/data/story.json and archive/data/music.json are missing."
            .to_string(),
    )
}

pub fn import_mod(source: &Path, mods_dir: &Path) -> Result<Vec<String>, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("Could not open selected mod: {error}"))?;
    let staging = tempfile::tempdir().map_err(|error| error.to_string())?;
    let scan_root = if source.is_dir() {
        source.clone()
    } else if source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        extract_zip(&source, staging.path())?;
        staging.path().to_path_buf()
    } else {
        return Err("Choose a mod folder or a .zip archive.".to_string());
    };

    let roots = find_mod_roots(&scan_root)?;
    if roots.is_empty() {
        return Err("No mod.js was found in the selected folder or archive.".to_string());
    }

    fs::create_dir_all(mods_dir).map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for root in roots {
        let base_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .map(safe_name)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "imported-mod".to_string());
        let target = unique_target(mods_dir, &base_name);
        copy_tree(&root, &target)?;
        imported.push(target.file_name().unwrap().to_string_lossy().into_owned());
    }
    Ok(imported)
}

pub fn import_assets(source: &Path, target_dir: &Path) -> Result<usize, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("Could not open selected assets: {error}"))?;
    let staging = tempfile::tempdir().map_err(|error| error.to_string())?;
    let (payload_root, prefix) = if source.is_dir() {
        if source.file_name().is_some_and(|name| name == "assets") {
            let prefix = if source
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == "archive")
            {
                PathBuf::from("archive/assets")
            } else {
                PathBuf::from("assets")
            };
            (source, prefix)
        } else {
            (find_asset_root(&source).unwrap_or(source), PathBuf::new())
        }
    } else if source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        extract_zip(&source, staging.path())?;
        (
            find_asset_root(staging.path()).unwrap_or_else(|| staging.path().to_path_buf()),
            PathBuf::new(),
        )
    } else {
        return Err("Choose an assets folder or a .zip archive.".to_string());
    };

    let destination = target_dir.join(prefix);
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    copy_tree(&payload_root, &destination)
        .map_err(|error| format!("Could not import assets: {error}"))
}

fn find_mod_roots(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    for entry in walkdir::WalkDir::new(root).follow_links(false).max_depth(5) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_symlink() {
            continue;
        }
        if entry.file_type().is_file() && entry.file_name() == "mod.js" {
            let candidate = entry
                .path()
                .parent()
                .ok_or_else(|| "Invalid mod directory".to_string())?
                .to_path_buf();
            if !roots.iter().any(|path| path == &candidate) {
                roots.push(candidate);
            }
        }
    }
    roots.sort();
    Ok(roots)
}

fn find_asset_root(root: &Path) -> Option<PathBuf> {
    let entries = walkdir::WalkDir::new(root)
        .follow_links(false)
        .max_depth(3)
        .into_iter()
        .filter_map(Result::ok);
    for entry in entries {
        if !entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if ["archive", "assets"]
            .iter()
            .any(|name| path.join(name).is_dir())
        {
            return Some(path.to_path_buf());
        }
    }
    None
}

fn extract_zip(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("Invalid ZIP: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("The ZIP contains too many files to import safely.".to_string());
    }

    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read ZIP entry: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "The ZIP contains an unsafe path.".to_string())?
            .to_path_buf();
        if !safe_relative_path(&relative) || entry.is_symlink() {
            return Err("The ZIP contains an unsafe path or symbolic link.".to_string());
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_ARCHIVE_UNPACKED_BYTES {
            return Err("The ZIP is larger than the 16 GiB import limit.".to_string());
        }

        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut out = File::create(&output).map_err(|error| error.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|error| error.to_string())?;
        out.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<usize, String> {
    let mut copied = 0;
    for entry in walkdir::WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_symlink() {
            return Err(format!(
                "Symbolic links are not supported in imports: {}",
                entry.path().display()
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        if relative.as_os_str().is_empty() {
            fs::create_dir_all(destination).map_err(|error| error.to_string())?;
            continue;
        }
        if !safe_relative_path(relative) {
            return Err("The selected folder contains an unsafe path.".to_string());
        }
        let output = destination.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(entry.path(), output).map_err(|error| error.to_string())?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn unique_target(parent: &Path, base_name: &str) -> PathBuf {
    let initial = parent.join(base_name);
    if !initial.exists() {
        return initial;
    }
    for index in 2..=10_000 {
        let candidate = parent.join(format!("{base_name}-{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{base_name}-{}", std::process::id()))
}

fn safe_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.'])
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn imports_mod_from_github_style_zip_and_keeps_nested_files() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("community-mod.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("community-mod-main/mod.js", options)
            .unwrap();
        zip.write_all(b"module.exports = {}; ").unwrap();
        zip.start_file("community-mod-main/images/preview.png", options)
            .unwrap();
        zip.write_all(b"preview").unwrap();
        zip.finish().unwrap();

        let mods_dir = temp.path().join("Asset Pack/mods");
        let imported = import_mod(&zip_path, &mods_dir).unwrap();
        assert_eq!(imported, vec!["community-mod-main"]);
        assert_eq!(
            fs::read(mods_dir.join("community-mod-main/images/preview.png")).unwrap(),
            b"preview"
        );
    }

    #[test]
    fn imports_custom_asset_tree_into_overlay_without_changing_source() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("asset-package");
        let payload = source.join("archive/assets/custom/example.png");
        fs::create_dir_all(payload.parent().unwrap()).unwrap();
        fs::write(&payload, b"custom asset").unwrap();
        let destination = temp.path().join("user-data/custom-assets");

        let copied = import_assets(&source, &destination).unwrap();

        assert_eq!(copied, 1);
        assert_eq!(
            fs::read(destination.join("archive/assets/custom/example.png")).unwrap(),
            b"custom asset"
        );
        assert_eq!(fs::read(payload).unwrap(), b"custom asset");
    }

    #[test]
    fn imports_the_asset_pack_assets_directory_with_its_vfs_prefix() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("archive/assets");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("story.css"), b"custom css").unwrap();
        let destination = temp.path().join("user-data/custom-assets");

        assert_eq!(import_assets(&source, &destination).unwrap(), 1);
        assert_eq!(
            fs::read(destination.join("archive/assets/story.css")).unwrap(),
            b"custom css"
        );
    }

    #[test]
    fn rejects_zip_slip_entries() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("unsafe.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("../../outside.txt", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"nope").unwrap();
        zip.finish().unwrap();
        let target = temp.path().join("unpack");
        fs::create_dir_all(&target).unwrap();
        assert!(extract_zip(&zip_path, &target).is_err());
        assert!(!temp.path().join("outside.txt").exists());
    }

    #[test]
    fn recognizes_asset_pack_roots_and_rejects_partial_packs() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("archive/data")).unwrap();
        fs::write(temp.path().join("archive/data/story.json"), "{}").unwrap();
        assert!(!is_asset_pack(temp.path()));
        fs::write(temp.path().join("archive/data/music.json"), "{}").unwrap();
        assert_eq!(
            validate_asset_pack(temp.path()).unwrap(),
            temp.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn safe_relative_path_rejects_parent_and_absolute_paths() {
        assert!(!safe_relative_path(Path::new("../escape")));
        assert!(!safe_relative_path(Path::new("/absolute")));
        assert!(safe_relative_path(Path::new("archive/data/story.json")));
    }
}
