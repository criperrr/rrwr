use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use rrwr_lib::config::AppConfig;
use rrwr_lib::data::ArchiveStore;
use rrwr_lib::mods::ModRegistry;
use rrwr_lib::server::{AppStateInner, Vfs};

fn create_synthetic_workspace(root: &std::path::Path) {
    let data_dir = root.join("archive/data");
    let media_dir = root.join("media");
    let mod_dir = root.join("mods/Sample Localization");
    let mod_media_dir = mod_dir.join("Assets/media");

    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&media_dir).unwrap();
    std::fs::create_dir_all(&mod_media_dir).unwrap();

    let story_json = serde_json::json!({
        "story": {
            "000001": {
                "pageId": "000001",
                "title": "Sample Comic",
                "timestamp": "1700000000",
                "content": "A character stands in a room.",
                "media": ["/media/00001.gif"],
                "flag": [],
                "next": ["000002"],
                "previous": null
            },
            "000002": {
                "pageId": "000002",
                "title": "Page Two",
                "timestamp": "1700000060",
                "content": "Second panel.",
                "media": ["/media/00002.gif"],
                "flag": [],
                "next": [],
                "previous": "000001"
            }
        }
    });
    std::fs::write(
        data_dir.join("story.json"),
        serde_json::to_string(&story_json).unwrap(),
    )
    .unwrap();
    std::fs::write(
        data_dir.join("music.json"),
        r#"{"albums":{},"tracks":{},"artists":{},"flashes":{}}"#,
    )
    .unwrap();

    std::fs::write(media_dir.join("00001.gif"), b"base1").unwrap();
    std::fs::write(media_dir.join("00002.gif"), b"base2").unwrap();
    std::fs::write(mod_media_dir.join("00002.gif"), b"mod2").unwrap();

    let mod_js = r#"
module.exports = {
    title: "Sample Localization",
    author: "Sample Team",
    version: 1.0,
    edit: true,
    trees: { "./Assets/": "assets://" },
    computed(api) {
        const translation = api.readJson('./translation2.json');
    }
};
"#;
    std::fs::write(mod_dir.join("mod.js"), mod_js).unwrap();
    let translation = serde_json::json!({
        "000001": {
            "title": "Sample Comic Localized",
            "content": "Localized opening panel."
        }
    });
    std::fs::write(
        mod_dir.join("translation2.json"),
        serde_json::to_string(&translation).unwrap(),
    )
    .unwrap();
}

#[tokio::test]
async fn test_rapid_concurrent_mod_toggles_and_page_fetches() {
    let temp_dir = tempfile::tempdir().unwrap();
    std::env::set_var("XDG_CONFIG_HOME", temp_dir.path());

    let asset_dir = temp_dir.path().join("asset-pack");
    create_synthetic_workspace(&asset_dir);

    let app_config = AppConfig {
        asset_dir: Some(asset_dir.to_string_lossy().to_string()),
        ..Default::default()
    };
    let _ = app_config.save();

    let store = Arc::new(ArchiveStore::load_from_dir(&asset_dir));
    let mod_registry =
        ModRegistry::load_from_dir(&asset_dir, &app_config.settings.mod_list_enabled);
    let vfs = Arc::new(Vfs::new(asset_dir.clone()));

    let state = AppStateInner {
        config: Arc::new(RwLock::new(app_config)),
        asset_port: 45100,
        asset_dir: Arc::new(std::sync::RwLock::new(asset_dir.clone())),
        store: store.clone(),
        mods: Arc::new(RwLock::new(mod_registry)),
        vfs: vfs.clone(),
        discord_rpc: Arc::new(rrwr_lib::rpc::DiscordRpcManager::new(true, None)),
        app_handle: None,
    };

    let stop = Arc::new(AtomicBool::new(false));
    let fetch_count = Arc::new(AtomicUsize::new(0));
    let asset_count = Arc::new(AtomicUsize::new(0));
    let toggle_count = Arc::new(AtomicUsize::new(0));
    let inconsistency_count = Arc::new(AtomicUsize::new(0));

    // Spawn 4 background tasks rapidly reading pages and assets
    let mut reader_handles = Vec::new();
    for _reader_id in 0..4 {
        let state_clone = state.clone();
        let stop_clone = Arc::clone(&stop);
        let f_cnt = Arc::clone(&fetch_count);
        let a_cnt = Arc::clone(&asset_count);

        let handle = tokio::spawn(async move {
            while !stop_clone.load(Ordering::Relaxed) {
                if let Some(page) = state_clone.store.get_story_page("000001").await {
                    assert!(
                        page.title == "Sample Comic" || page.title == "Sample Comic Localized",
                        "Page title corrupted: {}",
                        page.title
                    );
                    f_cnt.fetch_add(1, Ordering::Relaxed);
                }

                if let Some(path) = state_clone.vfs.resolve("/media/00002.gif").await {
                    assert!(path.is_file(), "Resolved asset path must exist on disk");
                    a_cnt.fetch_add(1, Ordering::Relaxed);
                }

                tokio::task::yield_now().await;
            }
        });
        reader_handles.push(handle);
    }

    // Spawn 2 tasks rapidly toggling "Sample Localization" on and off
    let mut toggle_handles = Vec::new();
    for task_id in 0..2 {
        let state_clone = state.clone();
        let stop_clone = Arc::clone(&stop);
        let t_cnt = Arc::clone(&toggle_count);

        let handle = tokio::spawn(async move {
            let mut enabled = task_id % 2 == 0;
            for _ in 0..50 {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                enabled = !enabled;

                let (success, descriptors, patches) = {
                    let mut mods_lock = state_clone.mods.write().await;
                    match mods_lock.toggle_mod("Sample Localization", enabled) {
                        Ok(_) => {
                            let descriptors = mods_lock.get_active_descriptors();
                            let patches = mods_lock.load_active_patches();
                            (true, descriptors, patches)
                        }
                        Err(_) => (false, vec![], std::collections::HashMap::new()),
                    }
                };

                if success {
                    let _ = state_clone.vfs.rebuild_overlay(descriptors).await;
                    if patches.is_empty() {
                        state_clone.store.story.reset_to_base().await;
                    } else {
                        state_clone.store.story.apply_patches(&patches).await;
                    }

                    let mut cfg = state_clone.config.write().await;
                    let list = &mut cfg.settings.mod_list_enabled;
                    if enabled {
                        if !list.contains(&"Sample Localization".to_string()) {
                            list.push("Sample Localization".to_string());
                        }
                    } else {
                        list.retain(|id| id != "Sample Localization");
                    }
                    let _ = cfg.save();
                }

                t_cnt.fetch_add(1, Ordering::Relaxed);
                tokio::task::yield_now().await;
            }
        });
        toggle_handles.push(handle);
    }

    for handle in toggle_handles {
        handle.await.unwrap();
    }

    stop.store(true, Ordering::Relaxed);
    for handle in reader_handles {
        handle.await.unwrap();
    }

    let mod_enabled_in_registry = state.mods.read().await.is_enabled("Sample Localization");
    let mod_in_config = state
        .config
        .read()
        .await
        .settings
        .mod_list_enabled
        .contains(&"Sample Localization".to_string());
    let vfs_overlay_count = state.vfs.overlay_count().await;
    let page = state.store.get_story_page("000001").await.unwrap();
    let page_is_translated = page.content.contains("Localized opening panel.");

    if mod_enabled_in_registry != mod_in_config {
        eprintln!("STATE DESYNC: registry_enabled != config_enabled");
        inconsistency_count.fetch_add(1, Ordering::Relaxed);
    }

    if mod_enabled_in_registry && vfs_overlay_count == 0 {
        eprintln!("STATE DESYNC: registry says enabled but vfs overlay is empty");
        inconsistency_count.fetch_add(1, Ordering::Relaxed);
    }

    if !mod_enabled_in_registry && vfs_overlay_count > 0 {
        eprintln!("STATE DESYNC: registry says disabled but vfs overlay is active");
        inconsistency_count.fetch_add(1, Ordering::Relaxed);
    }

    if mod_enabled_in_registry != page_is_translated {
        eprintln!("STATE DESYNC: registry_enabled != page_is_translated");
        inconsistency_count.fetch_add(1, Ordering::Relaxed);
    }

    assert!(fetch_count.load(Ordering::Relaxed) > 0);
    assert!(asset_count.load(Ordering::Relaxed) > 0);
    assert!(toggle_count.load(Ordering::Relaxed) > 0);

    assert_eq!(
        inconsistency_count.load(Ordering::Relaxed),
        0,
        "Mod state desynchronization detected under concurrent toggling!"
    );
}
