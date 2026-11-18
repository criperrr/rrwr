use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::config::AppConfig;
use crate::data::story::{FootnoteItem, ModDiffPayload, StoryPage, StoryPageSummary};
use crate::data::{TreeChildrenResponse, TreeNode, TreeSearchResponse};
use crate::mods::ModMetadata;
use crate::rpc::DiscordStatus;
use crate::AppState;

#[tauri::command]
pub async fn get_app_info(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let asset_dir = state.0.asset_dir().to_string_lossy().into_owned();
    let first_page_id = state
        .0
        .store
        .get_story_range(0, 1)
        .await
        .first()
        .map(|p| p.page_id.clone());
    let platform = if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": platform,
        "asset_dir": asset_dir,
        "asset_pack_ready": crate::imports::is_asset_pack(&state.0.asset_dir()),
        "custom_asset_dir": crate::imports::custom_asset_dir().to_string_lossy(),
        "asset_port": state.0.asset_port,
        "overlay_generation": state.0.vfs.generation(),
        "overlayGeneration": state.0.vfs.generation(),
        "first_page_id": first_page_id,
    }))
}

#[tauri::command]
pub fn check_asset_pack_path(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    if crate::imports::is_asset_pack(p) {
        return Ok(true);
    }
    if let Ok(canon) = p.canonicalize() {
        if crate::imports::is_asset_pack(&canon) {
            return Ok(true);
        }
    }
    if path.starts_with("/sdcard/") {
        let alt = format!("/storage/emulated/0{}", &path[7..]);
        let alt_p = std::path::Path::new(&alt);
        if crate::imports::is_asset_pack(alt_p) {
            return Ok(true);
        }
    } else if path.starts_with("/storage/emulated/0/") {
        let alt = format!("/sdcard{}", &path[19..]);
        let alt_p = std::path::Path::new(&alt);
        if crate::imports::is_asset_pack(alt_p) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn detect_asset_pack_paths(candidates: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let default_candidates = [
        "/storage/emulated/0/Asset Pack",
        "/sdcard/Asset Pack",
        "/storage/emulated/0/Download/Asset Pack",
        "/sdcard/Download/Asset Pack",
        "/sdcard/Android/data/com.rrwr.app/files/Asset Pack",
        "/data/user/0/com.rrwr.app/files/Asset Pack",
    ];

    let mut to_check = Vec::new();
    if let Some(cands) = candidates {
        for c in cands {
            let trimmed = c.trim().to_string();
            if !trimmed.is_empty() && !to_check.contains(&trimmed) {
                to_check.push(trimmed);
            }
        }
    }
    for def in default_candidates {
        let def_str = def.to_string();
        if !to_check.contains(&def_str) {
            to_check.push(def_str);
        }
    }

    let mut valid_paths = Vec::new();
    let mut seen_canonical = std::collections::HashSet::new();

    for candidate in to_check {
        let p = std::path::Path::new(&candidate);
        let canon_opt = p.canonicalize().ok();

        // Resolve canonical path or normalize /sdcard equivalence
        let physical_path = canon_opt.clone().unwrap_or_else(|| {
            if candidate.starts_with("/sdcard/") {
                std::path::PathBuf::from(format!("/storage/emulated/0{}", &candidate[7..]))
            } else if candidate == "/sdcard" {
                std::path::PathBuf::from("/storage/emulated/0")
            } else {
                p.to_path_buf()
            }
        });

        let is_valid = crate::imports::is_asset_pack(p)
            || canon_opt
                .as_ref()
                .is_some_and(|c| crate::imports::is_asset_pack(c))
            || crate::imports::is_asset_pack(&physical_path);

        if is_valid {
            let key = physical_path.to_string_lossy().into_owned();
            if seen_canonical.insert(key) {
                let display = if p.exists() {
                    candidate
                } else {
                    physical_path.to_string_lossy().into_owned()
                };
                valid_paths.push(display);
            }
        }
    }

    Ok(valid_paths)
}

async fn pick_path(
    app: &tauri::AppHandle,
    folder: bool,
    title: &'static str,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let builder = app.dialog().file().set_title(title);
    #[cfg(desktop)]
    if folder {
        builder.pick_folder(move |selected| {
            let _ = sender.send(selected);
        });
    } else {
        builder
            .add_filter("Importable files", &["zip"])
            .pick_file(move |selected| {
                let _ = sender.send(selected);
            });
    }
    #[cfg(mobile)]
    {
        if folder {
            builder.pick_file(move |selected| {
                let _ = sender.send(selected);
            });
        } else {
            builder
                .add_filter("Importable files", &["zip"])
                .pick_file(move |selected| {
                    let _ = sender.send(selected);
                });
        }
    }
    let selected = receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly.".to_string())?;
    selected
        .map(|file| {
            file.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| format!("Could not read the selected path: {error}"))
        })
        .transpose()
}

#[tauri::command]
pub async fn pick_asset_pack(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = pick_path(
        &app,
        true,
        "Select the extracted Asset Pack folder or file inside it",
    )
    .await?;
    if let Some(ref path_str) = picked {
        let p = std::path::Path::new(path_str);
        if p.is_file() {
            let mut curr = p.parent();
            while let Some(dir) = curr {
                if crate::imports::is_asset_pack(dir) {
                    return Ok(Some(dir.to_string_lossy().into_owned()));
                }
                curr = dir.parent();
            }
            if let Some(parent) = p.parent() {
                return Ok(Some(parent.to_string_lossy().into_owned()));
            }
        }
    }
    Ok(picked)
}

#[tauri::command]
pub async fn pick_import_path(
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<String>, String> {
    let picked = match kind.as_str() {
        "mod_folder" => pick_path(&app, true, "Select a community mod folder").await,
        "mod_archive" => pick_path(&app, false, "Select a community mod ZIP").await,
        "assets_folder" => pick_path(&app, true, "Select an assets folder").await,
        "assets_archive" => pick_path(&app, false, "Select an assets ZIP").await,
        _ => Err("Unknown import type.".to_string()),
    }?;

    if let Some(ref path_str) = picked {
        let p = std::path::Path::new(path_str);
        if p.is_file() && (kind == "mod_folder" || kind == "assets_folder") {
            if let Some(parent) = p.parent() {
                return Ok(Some(parent.to_string_lossy().into_owned()));
            }
        }
    }

    Ok(picked)
}

#[tauri::command]
pub async fn set_asset_pack_path(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    configure_asset_pack(app, state, path).await
}

#[tauri::command]
pub async fn configure_asset_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let selected = crate::imports::validate_asset_pack(std::path::Path::new(&path))?;
    let mut config = state.0.config.read().await.clone();
    config.asset_dir = Some(selected.to_string_lossy().into_owned());

    config
        .save()
        .map_err(|error| format!("Could not save the Asset Pack location: {error}"))?;
    *state.0.config.write().await = config.clone();

    // Dynamically reinitialize backend state without requiring process restart
    *state.0.asset_dir.write().unwrap() = selected.clone();
    state.0.vfs.set_base_dir(selected.clone());
    state.0.store.reload_from_dir(&selected);

    {
        let mut mods = state.0.mods.write().await;
        mods.reload_from_dir(&selected, &config.settings.mod_list_enabled);
    }
    refresh_mod_runtime(&state).await?;
    state.0.vfs.bump_generation();

    #[cfg(desktop)]
    app.restart();

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub async fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

async fn refresh_mod_runtime(state: &AppState) -> Result<(), String> {
    let config = state.0.config.read().await.clone();
    let (descriptors, all_descriptors, patches, static_footnotes) = {
        let mut mods = state.0.mods.write().await;
        mods.rescan(&config.settings.mod_list_enabled);
        (
            mods.get_active_descriptors(),
            mods.get_all_descriptors(),
            mods.load_active_patches(),
            mods.load_static_footnotes(),
        )
    };
    state.0.vfs.set_installed_descriptors(all_descriptors).await;
    state
        .0
        .vfs
        .rebuild_overlay(descriptors)
        .await
        .map_err(|error| format!("Could not refresh the mod asset index: {error}"))?;
    state.0.store.story.reset_to_base().await;
    if !patches.is_empty() {
        state.0.store.story.apply_patches(&patches).await;
    }
    if !static_footnotes.is_empty() {
        state
            .0
            .store
            .story
            .merge_mod_diffs(ModDiffPayload {
                footnotes: static_footnotes,
                ..Default::default()
            })
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn import_community_mod(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Vec<String>, String> {
    let installed = crate::imports::import_mod(
        std::path::Path::new(&path),
        &state.0.asset_dir().join("mods"),
    )?;
    refresh_mod_runtime(&state).await?;
    state.0.vfs.bump_generation();
    Ok(installed)
}

#[tauri::command]
pub async fn import_custom_assets(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<usize, String> {
    let copied = crate::imports::import_assets(
        std::path::Path::new(&path),
        &crate::imports::custom_asset_dir(),
    )?;
    state.0.vfs.bump_generation();
    Ok(copied)
}

#[tauri::command]
pub async fn pick_and_import_asset_pack_zip(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;
    let app_for_pick = app.clone();
    let picked = tokio::task::spawn_blocking(move || {
        app_for_pick
            .dialog()
            .file()
            .add_filter("ZIP Archive", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let zip_path = file_path
        .into_path()
        .map_err(|e| format!("Invalid file path: {e}"))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let packs_dir = crate::imports::managed_asset_packs_dir(&app_data_dir);
    let target = tokio::task::spawn_blocking(move || {
        crate::imports::import_asset_pack_zip(&zip_path, &packs_dir)
    })
    .await
    .map_err(|e| e.to_string())??;

    let target_str = target.to_string_lossy().into_owned();
    configure_asset_pack(app, state, target_str.clone()).await?;
    Ok(Some(target_str))
}

#[tauri::command]
pub async fn pick_and_import_mod_zip(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let app_for_pick = app.clone();
    let picked = tokio::task::spawn_blocking(move || {
        app_for_pick
            .dialog()
            .file()
            .add_filter("ZIP Archive", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(Vec::new());
    };
    let zip_path = file_path
        .into_path()
        .map_err(|e| format!("Invalid file path: {e}"))?;
    let mods_dir = state.0.asset_dir().join("mods");
    let installed =
        tokio::task::spawn_blocking(move || crate::imports::import_mod(&zip_path, &mods_dir))
            .await
            .map_err(|e| e.to_string())??;
    refresh_mod_runtime(&state).await?;
    state.0.vfs.bump_generation();
    Ok(installed)
}

#[tauri::command]
pub async fn list_asset_packs(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let packs_dir = crate::imports::managed_asset_packs_dir(&app_data_dir);
    let active_dir = state.0.asset_dir();
    let packs = crate::imports::list_managed_asset_packs(&packs_dir, &active_dir);
    Ok(packs
        .into_iter()
        .map(|(name, path, active)| serde_json::json!({ "name": name, "path": path, "active": active }))
        .collect())
}

#[tauri::command]
pub async fn get_story_page(
    state: tauri::State<'_, AppState>,
    page_id: String,
) -> Result<StoryPage, String> {
    let trimmed = page_id.trim();
    if trimmed.is_empty() || trimmed == "000000" || trimmed.starts_with('-') {
        return Err("Page not found".to_string());
    }

    let page = state
        .0
        .store
        .get_story_page(trimmed)
        .await
        .ok_or_else(|| format!("Page '{}' not found", trimmed))?;

    if state.0.config.read().await.settings.enable_discord_rpc {
        let _ = state
            .0
            .sync_reading_discord_rpc(&page.page_id, None, Some(&page))
            .await;
    }

    Ok(page)
}

#[tauri::command]
pub async fn get_story_range(
    state: tauri::State<'_, AppState>,
    start: usize,
    count: usize,
) -> Result<Vec<StoryPageSummary>, String> {
    Ok(state.0.store.get_story_range(start, count).await)
}

#[tauri::command]
pub fn get_music_data(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(state.0.store.get_music_raw())
}

#[tauri::command]
pub async fn load_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    let cfg = state.0.config.read().await;
    Ok(cfg.clone())
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, AppState>,
    new_config: Option<AppConfig>,
    config: Option<AppConfig>,
    #[allow(non_snake_case)] newConfig: Option<AppConfig>,
) -> Result<(), String> {
    let mut new_config = new_config.or(config).or(newConfig).ok_or_else(|| {
        "Missing config payload (expected 'new_config', 'config', or 'newConfig')".to_string()
    })?;
    new_config.normalize();

    // Keep enabled_mods and settings.mod_list_enabled in sync
    if new_config.settings.mod_list_enabled.is_empty() {
        if let Some(ref em) = new_config.enabled_mods {
            if !em.is_empty() {
                new_config.settings.mod_list_enabled = em.clone();
            }
        }
    }
    if new_config.enabled_mods.is_none() {
        new_config.enabled_mods = Some(new_config.settings.mod_list_enabled.clone());
    }

    new_config
        .save()
        .map_err(|e| format!("Failed to save config: {}", e))?;

    let rpc_status = state.0.discord_rpc.get_status().await;
    if rpc_status.enabled != new_config.settings.enable_discord_rpc {
        let _ = state
            .0
            .discord_rpc
            .set_enabled(new_config.settings.enable_discord_rpc)
            .await;
    }
    let desired_client_id = new_config.settings.discord_client_id.trim();
    if rpc_status.client_id != desired_client_id {
        let _ = state.0.discord_rpc.set_client_id(desired_client_id).await;
    }

    {
        let mut cfg = state.0.config.write().await;
        *cfg = new_config.clone();
    }

    // Sync active mods and VFS overlay
    {
        let mut mods_lock = state.0.mods.write().await;
        mods_lock.rescan(&new_config.settings.mod_list_enabled);
        let descriptors = mods_lock.get_active_descriptors();
        let _ = state.0.vfs.rebuild_overlay(descriptors).await;
        let patches = mods_lock.load_active_patches();
        let static_footnotes = mods_lock.load_static_footnotes();
        state.0.store.story.reset_to_base().await;
        if !patches.is_empty() {
            state.0.store.story.apply_patches(&patches).await;
        }
        if !static_footnotes.is_empty() {
            state
                .0
                .store
                .story
                .merge_mod_diffs(ModDiffPayload {
                    footnotes: static_footnotes,
                    ..Default::default()
                })
                .await;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_available_mods(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ModMetadata>, String> {
    let mods_guard = state.0.mods.read().await;
    state
        .0
        .vfs
        .set_installed_descriptors(mods_guard.get_all_descriptors())
        .await;
    Ok(mods_guard.get_available_mods())
}

#[tauri::command]
pub async fn toggle_mod(
    state: tauri::State<'_, AppState>,
    mod_id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let (success, descriptors, all_descriptors, patches, static_footnotes) = {
        let mut mods_lock = state.0.mods.write().await;
        mods_lock.toggle_mod(&mod_id, enabled).map(|_| {
            let descriptors = mods_lock.get_active_descriptors();
            let all_descriptors = mods_lock.get_all_descriptors();
            let patches = mods_lock.load_active_patches();
            let static_footnotes = mods_lock.load_static_footnotes();
            (
                true,
                descriptors,
                all_descriptors,
                patches,
                static_footnotes,
            )
        })?
    };

    if success {
        state.0.vfs.set_installed_descriptors(all_descriptors).await;
        let _ = state.0.vfs.rebuild_overlay(descriptors).await;
        state.0.store.story.reset_to_base().await;
        if !patches.is_empty() {
            state.0.store.story.apply_patches(&patches).await;
        }
        if !static_footnotes.is_empty() {
            state
                .0
                .store
                .story
                .merge_mod_diffs(ModDiffPayload {
                    footnotes: static_footnotes,
                    ..Default::default()
                })
                .await;
        }

        // Keep config in sync
        let mut cfg = state.0.config.write().await;
        let list = &mut cfg.settings.mod_list_enabled;
        if enabled {
            if !list.contains(&mod_id) {
                list.push(mod_id.clone());
            }
        } else {
            list.retain(|id| id != &mod_id);
        }
        cfg.enabled_mods = Some(list.clone());
        let _ = cfg.save();
    }

    Ok(serde_json::json!({
        "status": "ok",
        "mod_id": mod_id,
        "enabled": enabled,
        "overlay_generation": state.0.vfs.generation(),
        "overlayGeneration": state.0.vfs.generation(),
    }))
}

#[tauri::command]
pub async fn read_mod_file(
    state: tauri::State<'_, AppState>,
    mod_id: Option<String>,
    #[allow(non_snake_case)] modId: Option<String>,
    path: Option<String>,
    rel_path: Option<String>,
    #[allow(non_snake_case)] relPath: Option<String>,
) -> Result<serde_json::Value, String> {
    let id = mod_id
        .or(modId)
        .ok_or_else(|| "Missing 'mod_id' or 'modId'".to_string())?;
    let rel = path
        .or(rel_path)
        .or(relPath)
        .ok_or_else(|| "Missing 'path' or 'rel_path'".to_string())?;
    let mods_lock = state.0.mods.read().await;
    mods_lock.read_mod_file(&id, &rel)
}

#[tauri::command]
pub async fn get_mod_bundle(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let cfg = state.0.config.read().await.clone();
    let mods_lock = state.0.mods.read().await;
    Ok(mods_lock
        .get_active_mod_bundle(&cfg, &state.0.store, state.0.vfs.generation())
        .await)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn apply_mod_diffs(
    state: tauri::State<'_, AppState>,
    replace: Option<bool>,
    diff: Option<ModDiffPayload>,
    patches: Option<std::collections::HashMap<String, crate::data::story::StoryPagePatch>>,
    added_pages: Option<std::collections::HashMap<String, StoryPage>>,
    #[allow(non_snake_case)] addedPages: Option<std::collections::HashMap<String, StoryPage>>,
    fancomics: Option<std::collections::HashMap<String, serde_json::Value>>,
    mod_home_row_items: Option<Vec<serde_json::Value>>,
    #[allow(non_snake_case)] modHomeRowItems: Option<Vec<serde_json::Value>>,
    footnotes: Option<std::collections::HashMap<String, Vec<FootnoteItem>>>,
    routes: Option<std::collections::HashMap<String, std::collections::HashMap<String, String>>>,
) -> Result<serde_json::Value, String> {
    let mut payload = if let Some(d) = diff {
        d
    } else {
        ModDiffPayload {
            replace: replace.unwrap_or(false),
            patches: patches.unwrap_or_default(),
            added_pages: added_pages.or(addedPages).unwrap_or_default(),
            fancomics: fancomics.unwrap_or_default(),
            mod_home_row_items: mod_home_row_items.or(modHomeRowItems).unwrap_or_default(),
            footnotes: footnotes.unwrap_or_default(),
            routes: routes.unwrap_or_default(),
        }
    };
    if let Some(r) = replace {
        payload.replace = r;
    }

    if !payload.routes.is_empty() {
        let descriptors = {
            let mut mods_lock = state.0.mods.write().await;
            if mods_lock.update_dynamic_routes(&payload.routes) {
                Some(mods_lock.get_active_descriptors())
            } else {
                None
            }
        };
        if let Some(desc) = descriptors {
            let _ = state.0.vfs.rebuild_overlay(desc).await;
        }
    }

    if payload.replace {
        let (static_patches, static_footnotes) = {
            let mods_lock = state.0.mods.read().await;
            (
                mods_lock.load_active_patches(),
                mods_lock.load_static_footnotes(),
            )
        };
        state.0.store.story.reset_to_base().await;
        if !static_patches.is_empty() {
            state.0.store.story.apply_patches(&static_patches).await;
        }
        if !static_footnotes.is_empty() {
            state
                .0
                .store
                .story
                .merge_mod_diffs(ModDiffPayload {
                    footnotes: static_footnotes,
                    ..Default::default()
                })
                .await;
        }
    }

    state.0.store.story.merge_mod_diffs(payload).await;
    let gen = state.0.vfs.bump_generation();

    Ok(serde_json::json!({
        "status": "ok",
        "overlay_generation": gen,
        "overlayGeneration": gen,
    }))
}

#[tauri::command]
pub async fn save_mod_setting(
    state: tauri::State<'_, AppState>,
    mod_id: Option<String>,
    #[allow(non_snake_case)] modId: Option<String>,
    key: String,
    value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = mod_id
        .or(modId)
        .ok_or_else(|| "Missing 'mod_id' or 'modId'".to_string())?;
    let mut cfg = state.0.config.write().await;
    cfg.mod_settings
        .entry(id.clone())
        .or_default()
        .insert(key.clone(), value.clone());
    cfg.save()
        .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(serde_json::json!({
        "status": "ok",
        "modId": id,
        "key": key,
        "value": value,
    }))
}

#[tauri::command]
pub async fn get_page_footnotes(
    state: tauri::State<'_, AppState>,
    page_id: Option<String>,
    #[allow(non_snake_case)] pageId: Option<String>,
) -> Result<Vec<FootnoteItem>, String> {
    let id = page_id
        .or(pageId)
        .ok_or_else(|| "Missing 'page_id' or 'pageId'".to_string())?;
    Ok(state.0.store.story.get_page_footnotes(&id).await)
}

#[tauri::command]
pub async fn get_mod_hooks(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mods_lock = state.0.mods.read().await;
    Ok(serde_json::json!({
        "vueHooks": mods_lock.get_active_vue_hooks(),
        "overlayGeneration": state.0.vfs.generation(),
        "overlay_generation": state.0.vfs.generation(),
    }))
}

#[tauri::command]
pub async fn evaluate_log_button_text(
    state: tauri::State<'_, AppState>,
    content: String,
    log_hidden: Option<bool>,
) -> Result<String, String> {
    let mods_lock = state.0.mods.read().await;
    Ok(mods_lock.evaluate_log_button_text(&content, log_hidden.unwrap_or(true)))
}

#[tauri::command]
pub async fn get_discord_status(
    state: tauri::State<'_, AppState>,
) -> Result<DiscordStatus, String> {
    Ok(state.0.discord_rpc.get_status().await)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_discord_presence(
    state: tauri::State<'_, AppState>,
    mode: Option<String>,
    page_id: Option<String>,
    page_title: Option<String>,
    title: Option<String>,
    track_id: Option<String>,
    track_title: Option<String>,
    track: Option<String>,
    album_name: Option<String>,
    album: Option<String>,
    artist: Option<String>,
    playing: Option<bool>,
) -> Result<DiscordStatus, String> {
    let mode_str = mode.as_deref().unwrap_or("reading");
    match mode_str {
        "reading" => {
            let pid = page_id.unwrap_or_else(|| "000001".to_string());
            let title_override = page_title.or(title);
            Ok(state
                .0
                .sync_reading_discord_rpc(&pid, title_override.as_deref(), None)
                .await)
        }
        "browsing" | "menu" => {
            let page_t = page_title
                .or(title)
                .unwrap_or_else(|| "Main Menu".to_string());
            Ok(state
                .0
                .discord_rpc
                .update_browsing_presence(&page_t, None)
                .await)
        }
        "music" => {
            let track_str = track_title
                .or(track)
                .unwrap_or_else(|| "Audio Player".to_string());
            let album_str = album_name.or(album).unwrap_or_default();
            let is_playing = playing.unwrap_or(true);
            Ok(state
                .0
                .discord_rpc
                .update_music_presence(
                    &track_str,
                    &album_str,
                    artist.as_deref(),
                    track_id,
                    is_playing,
                )
                .await)
        }
        "clear" => Ok(state.0.discord_rpc.clear_presence().await),
        _ => Ok(state.0.discord_rpc.get_status().await),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_discord_music_presence(
    state: tauri::State<'_, AppState>,
    track: Option<String>,
    track_title: Option<String>,
    album: Option<String>,
    album_name: Option<String>,
    artist: Option<String>,
    track_id: Option<String>,
    duration: Option<f64>,
    playing: Option<bool>,
) -> Result<DiscordStatus, String> {
    let _ = duration;
    let title = track
        .or(track_title)
        .unwrap_or_else(|| "Audio Player".to_string());
    let alb = album.or(album_name).unwrap_or_default();
    let is_playing = playing.unwrap_or(true);
    Ok(state
        .0
        .discord_rpc
        .update_music_presence(&title, &alb, artist.as_deref(), track_id, is_playing)
        .await)
}

#[tauri::command]
pub async fn toggle_discord_rpc(
    state: tauri::State<'_, AppState>,
    enabled: Option<bool>,
) -> Result<DiscordStatus, String> {
    let current = state.0.discord_rpc.get_status().await.enabled;
    let target = enabled.unwrap_or(!current);
    let status = state.0.discord_rpc.set_enabled(target).await;
    {
        let mut cfg = state.0.config.write().await;
        cfg.settings.enable_discord_rpc = target;
        let _ = cfg.save();
    }
    Ok(status)
}

#[tauri::command]
pub fn trim_memory() {
    #[cfg(target_os = "linux")]
    unsafe {
        libc::malloc_trim(0);
    }
}

#[tauri::command]
pub fn client_log(level: String, message: String) {
    eprintln!("[WEBVIEW-{}] {}", level.to_uppercase(), message);
}

#[tauri::command]
pub fn win_minimize(window: tauri::Window) {
    #[cfg(desktop)]
    let _ = window.minimize();
    #[cfg(not(desktop))]
    let _ = window;
}

#[tauri::command]
pub fn win_maximize(window: tauri::Window) {
    #[cfg(desktop)]
    {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
    #[cfg(not(desktop))]
    let _ = window;
}

#[tauri::command]
pub fn win_close(window: tauri::Window) {
    let _ = window.close();
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugMetrics {
    pub rss_mb: f64,
    pub cpu_pct: f64,
    pub threads: usize,
    pub uptime_secs: u64,
}

static PROCESS_START_TIME: OnceLock<Instant> = OnceLock::new();

struct CpuTracker {
    last_ticks: u64,
    last_instant: Instant,
    last_pct: f64,
}

static CPU_TRACKER: Mutex<Option<CpuTracker>> = Mutex::new(None);

pub fn collect_debug_metrics() -> DebugMetrics {
    let start_instant = PROCESS_START_TIME.get_or_init(Instant::now);
    let uptime_secs = start_instant.elapsed().as_secs();

    let mut rss_mb = 0.0;
    let mut cpu_pct = 0.0;
    let mut threads = 1;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // 1. Read Resident Set Size from /proc/self/statm
        if let Ok(statm_content) = std::fs::read_to_string("/proc/self/statm") {
            let mut parts = statm_content.split_whitespace();
            // parts: [size, resident, shared, text, lib, data, dt]
            if let Some(resident_str) = parts.nth(1) {
                if let Ok(resident_pages) = resident_str.parse::<u64>() {
                    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
                    let page_size_bytes = if page_size > 0 {
                        page_size as u64
                    } else {
                        4096
                    };
                    let bytes = resident_pages.saturating_mul(page_size_bytes);
                    let mb = (bytes as f64) / (1024.0 * 1024.0);
                    rss_mb = (mb * 10.0).round() / 10.0;
                }
            }
        }

        // 2. Read utime, stime, num_threads from /proc/self/stat
        if let Ok(stat_content) = std::fs::read_to_string("/proc/self/stat") {
            if let Some(idx) = stat_content.rfind(')') {
                let remainder = &stat_content[idx + 1..];
                let tokens: Vec<&str> = remainder.split_whitespace().collect();
                // tokens[0] is state (field 3)
                // tokens[11] is utime (field 14)
                // tokens[12] is stime (field 15)
                // tokens[17] is num_threads (field 20)
                if tokens.len() > 17 {
                    let utime = tokens[11].parse::<u64>().unwrap_or(0);
                    let stime = tokens[12].parse::<u64>().unwrap_or(0);
                    threads = tokens[17].parse::<usize>().unwrap_or(1);

                    let current_ticks = utime.saturating_add(stime);
                    let clk_tck_raw = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
                    let clk_tck = if clk_tck_raw > 0 {
                        clk_tck_raw as f64
                    } else {
                        100.0
                    };

                    let now = Instant::now();
                    if let Ok(mut lock) = CPU_TRACKER.lock() {
                        match *lock {
                            Some(ref mut tracker) => {
                                let elapsed =
                                    now.duration_since(tracker.last_instant).as_secs_f64();
                                if elapsed >= 0.15 {
                                    let ticks_diff =
                                        current_ticks.saturating_sub(tracker.last_ticks);
                                    let cpu_time_secs = (ticks_diff as f64) / clk_tck;
                                    let raw_pct = (cpu_time_secs / elapsed) * 100.0;
                                    tracker.last_ticks = current_ticks;
                                    tracker.last_instant = now;
                                    tracker.last_pct = (raw_pct * 10.0).round() / 10.0;
                                }
                                cpu_pct = tracker.last_pct;
                            }
                            None => {
                                *lock = Some(CpuTracker {
                                    last_ticks: current_ticks,
                                    last_instant: now,
                                    last_pct: 0.0,
                                });
                                cpu_pct = 0.0;
                            }
                        }
                    }
                }
            }
        }
    }

    DebugMetrics {
        rss_mb,
        cpu_pct,
        threads,
        uptime_secs,
    }
}

#[tauri::command]
pub fn get_debug_metrics() -> Result<DebugMetrics, String> {
    Ok(collect_debug_metrics())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://")
        && !trimmed.starts_with("https://")
        && !trimmed.starts_with("mailto:")
    {
        return Err("Invalid protocol for external URL".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL with xdg-open: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(&["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL with rundll32: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL with open: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_archive_tree_roots(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TreeNode>, String> {
    Ok(crate::data::tree::get_archive_tree_roots(&state.0.store, &state.0.vfs).await)
}

#[tauri::command]
pub async fn get_archive_tree_children(
    state: tauri::State<'_, AppState>,
    node_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<TreeChildrenResponse, String> {
    crate::data::tree::get_archive_tree_children(
        &state.0.store,
        &state.0.vfs,
        &node_id,
        offset,
        limit,
    )
    .await
}

#[tauri::command]
pub async fn search_archive_tree(
    state: tauri::State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<TreeSearchResponse, String> {
    Ok(crate::data::tree::search_archive_tree(&state.0.store, &state.0.vfs, &query, limit).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collect_debug_metrics() {
        let metrics = collect_debug_metrics();
        assert!(metrics.threads >= 1);
        #[cfg(target_os = "linux")]
        {
            assert!(metrics.rss_mb >= 0.0);
            assert!(metrics.cpu_pct >= 0.0);
        }
    }
}
