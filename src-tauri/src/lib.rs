pub mod commands;
pub mod config;
pub mod data;
pub mod imports;
pub mod mods;
pub mod rpc;
pub mod server;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

use config::AppConfig;
use data::ArchiveStore;
use mods::ModRegistry;
use rpc::DiscordRpcManager;
use server::{AppStateInner, Vfs};

pub struct AppState(pub Arc<AppStateInner>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_pilot::init());
    }

    builder
        .setup(|app| {
            let mut app_config = AppConfig::load();
            let asset_dir = app_config
                .asset_dir
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| crate::imports::is_asset_pack(p))
                .unwrap_or_else(|| {
                    let discovered = PathBuf::from(config::default_asset_dir());
                    if crate::imports::is_asset_pack(&discovered) {
                        app_config.asset_dir = Some(discovered.to_string_lossy().into_owned());
                        let _ = app_config.save();
                    }
                    discovered
                });

            // Ephemeral loopback port channel
            let (port_tx, port_rx) = tokio::sync::oneshot::channel::<u16>();

            let store = Arc::new(ArchiveStore::load_from_dir(&asset_dir));
            let mod_registry =
                ModRegistry::load_from_dir(&asset_dir, &app_config.settings.mod_list_enabled);
            let vfs_state = Vfs::new(asset_dir.clone());
            vfs_state.set_custom_asset_dir(imports::custom_asset_dir());
            let vfs = Arc::new(vfs_state);
            let discord_rpc = Arc::new(DiscordRpcManager::new(
                app_config.settings.enable_discord_rpc,
                Some(app_config.settings.discord_client_id.clone()),
            ));

            let descriptors = mod_registry.get_active_descriptors();
            let all_descriptors = mod_registry.get_all_descriptors();
            let patches = mod_registry.load_active_patches();
            let static_footnotes = mod_registry.load_static_footnotes();

            let vfs_init = Arc::clone(&vfs);
            let store_init = Arc::clone(&store);

            tauri::async_runtime::block_on(async {
                vfs_init.set_installed_descriptors(all_descriptors).await;
                let _ = vfs_init.rebuild_overlay(descriptors).await;
                if !patches.is_empty() {
                    store_init.story.apply_patches(&patches).await;
                }
                if !static_footnotes.is_empty() {
                    store_init
                        .story
                        .merge_mod_diffs(data::ModDiffPayload {
                            footnotes: static_footnotes,
                            ..Default::default()
                        })
                        .await;
                }
            });

            // Start Axum loopback server on 127.0.0.1:0
            let app_handle = app.handle().clone();
            let app_handle_clone = app_handle.clone();
            let app_config_clone = app_config.clone();
            let asset_dir_rw = Arc::new(std::sync::RwLock::new(asset_dir));
            let asset_dir_clone = Arc::clone(&asset_dir_rw);
            let store_clone = Arc::clone(&store);
            let vfs_clone = Arc::clone(&vfs);
            let mod_registry_arc = Arc::new(RwLock::new(mod_registry));
            let mod_registry_clone = Arc::clone(&mod_registry_arc);
            let discord_rpc_clone = Arc::clone(&discord_rpc);

            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("Failed to bind ephemeral loopback socket on 127.0.0.1:0");

                let port = listener
                    .local_addr()
                    .expect("Failed to read local socket address")
                    .port();

                if let Some(config_dir) = dirs::config_dir() {
                    let dir = config_dir.join("rrwr");
                    let _ = std::fs::create_dir_all(&dir);
                    let _ = std::fs::write(dir.join("server_port"), port.to_string());
                }

                let inner = AppStateInner {
                    config: Arc::new(RwLock::new(app_config_clone)),
                    asset_port: port,
                    asset_dir: asset_dir_clone,
                    store: store_clone,
                    mods: mod_registry_clone,
                    vfs: vfs_clone,
                    discord_rpc: discord_rpc_clone,
                    app_handle: Some(app_handle_clone),
                };

                let _ = port_tx.send(port);

                let app = axum::Router::new()
                    .route("/ipc", axum::routing::post(server::handle_ipc_post))
                    .route("/ipc/{cmd}", axum::routing::get(server::handle_ipc_get))
                    .route("/", axum::routing::get(server::fallback_router))
                    .route("/index.html", axum::routing::get(server::fallback_router))
                    .route(
                        "/styles/{*path}",
                        axum::routing::get(server::fallback_router),
                    )
                    .route("/js/{*path}", axum::routing::get(server::fallback_router))
                    .route(
                        "/assets/{*path}",
                        axum::routing::any(server::fallback_router),
                    )
                    .fallback(server::fallback_router)
                    .layer(axum::middleware::from_fn(server::cors_middleware))
                    .with_state(inner);

                axum::serve(listener, app)
                    .await
                    .expect("Axum server crashed");
            });

            let asset_port = tauri::async_runtime::block_on(async {
                port_rx.await.expect("Failed to receive ephemeral port")
            });

            let inner = Arc::new(AppStateInner {
                config: Arc::new(RwLock::new(app_config)),
                asset_port,
                asset_dir: asset_dir_rw,
                store,
                mods: mod_registry_arc,
                vfs,
                discord_rpc,
                app_handle: Some(app_handle),
            });

            app.manage(AppState(inner));

            // WebKitGTK memory optimization settings
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{SettingsExt, WebContextExt, WebViewExt};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        let inner = webview.inner();
                        if let Some(context) = inner.context() {
                            context.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
                        }
                        if let Some(settings) = inner.settings() {
                            settings.set_enable_page_cache(false);
                            settings.set_enable_offline_web_application_cache(false);
                            settings.set_enable_smooth_scrolling(true);
                            settings.set_hardware_acceleration_policy(
                                webkit2gtk::HardwareAccelerationPolicy::Always,
                            );
                            settings.set_media_playback_requires_user_gesture(false);
                            settings.set_media_playback_allows_inline(true);
                            settings.set_enable_webaudio(true);
                            settings.set_enable_webgl(true);
                            settings.set_enable_developer_extras(true);
                        }
                    });
                }
            }

            // Trim glibc allocator heap pages back to OS kernel
            #[cfg(target_os = "linux")]
            unsafe {
                libc::malloc_trim(0);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::pick_asset_pack,
            commands::pick_and_import_asset_pack_zip,
            commands::pick_and_import_mod_zip,
            commands::list_asset_packs,
            commands::check_asset_pack_path,
            commands::configure_asset_pack,
            commands::set_asset_pack_path,
            commands::pick_import_path,
            commands::import_community_mod,
            commands::import_custom_assets,
            commands::restart_app,
            commands::get_story_page,
            commands::get_story_range,
            commands::get_music_data,
            commands::load_config,
            commands::save_config,
            commands::get_available_mods,
            commands::toggle_mod,
            commands::read_mod_file,
            commands::get_mod_bundle,
            commands::apply_mod_diffs,
            commands::save_mod_setting,
            commands::get_page_footnotes,
            commands::get_mod_hooks,
            commands::evaluate_log_button_text,
            commands::get_discord_status,
            commands::set_discord_presence,
            commands::set_discord_music_presence,
            commands::toggle_discord_rpc,
            commands::trim_memory,
            commands::client_log,
            commands::win_minimize,
            commands::win_maximize,
            commands::win_close,
            commands::get_debug_metrics,
            commands::open_url,
            commands::get_archive_tree_roots,
            commands::get_archive_tree_children,
            commands::search_archive_tree
        ])
        .run(tauri::generate_context!())
        .expect("error while running rrwr application");
}

/// Attempts to deliver a navigation command to an already running RRWR instance via loopback IPC.
pub fn try_send_navigate_to_running(url: &str) -> bool {
    let config_dir = match dirs::config_dir() {
        Some(d) => d,
        None => return false,
    };
    let p_file = config_dir.join("rrwr/server_port");
    let port_str = match std::fs::read_to_string(p_file) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let port: u16 = match port_str.trim().parse() {
        Ok(p) => p,
        Err(_) => return false,
    };

    use std::io::Write;
    use std::net::TcpStream;
    use std::time::Duration;

    let addr_str = format!("127.0.0.1:{}", port);
    let Ok(addr) = addr_str.parse() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };

    let encoded_url = url.replace(' ', "%20");
    let req = format!(
        "GET /ipc/navigate?url={} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        encoded_url, addr_str
    );
    stream.write_all(req.as_bytes()).is_ok()
}
