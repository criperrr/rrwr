use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use rrwr_lib::config::AppConfig;
use rrwr_lib::data::ArchiveStore;
use rrwr_lib::mods::ModRegistry;
use rrwr_lib::server::{AppStateInner, Vfs};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = args.get(1).and_then(|p| p.parse().ok()).unwrap_or(0);

    let app_config = AppConfig::load();
    let configured_asset_dir = app_config
        .asset_dir
        .as_ref()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(rrwr_lib::config::default_asset_dir()));
    let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("tests/fixtures");
    let asset_dir = if rrwr_lib::imports::is_asset_pack(&configured_asset_dir) {
        configured_asset_dir
    } else if rrwr_lib::imports::is_asset_pack(&fixture_dir) {
        fixture_dir
    } else {
        configured_asset_dir
    };

    let store = Arc::new(ArchiveStore::load_from_dir(&asset_dir));
    let mod_registry =
        ModRegistry::load_from_dir(&asset_dir, &app_config.settings.mod_list_enabled);
    let vfs_state = Vfs::new(asset_dir.clone());
    vfs_state.set_custom_asset_dir(rrwr_lib::imports::custom_asset_dir());
    let vfs = Arc::new(vfs_state);
    let discord_rpc = Arc::new(rrwr_lib::rpc::DiscordRpcManager::new(
        app_config.settings.enable_discord_rpc,
        Some(app_config.settings.discord_client_id.clone()),
    ));

    let descriptors = mod_registry.get_active_descriptors();
    let all_descriptors = mod_registry.get_all_descriptors();
    let patches = mod_registry.load_active_patches();
    let static_footnotes = mod_registry.load_static_footnotes();

    vfs.set_installed_descriptors(all_descriptors).await;
    let _ = vfs.rebuild_overlay(descriptors).await;
    if !patches.is_empty() {
        store.story.apply_patches(&patches).await;
    }
    if !static_footnotes.is_empty() {
        store
            .story
            .merge_mod_diffs(rrwr_lib::data::ModDiffPayload {
                footnotes: static_footnotes,
                ..Default::default()
            })
            .await;
    }

    let bind_addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind on {}: {}", bind_addr, e));

    let actual_port = listener.local_addr().unwrap().port();

    let inner = AppStateInner {
        config: Arc::new(RwLock::new(app_config)),
        asset_port: actual_port,
        asset_dir: Arc::new(std::sync::RwLock::new(asset_dir)),
        store,
        mods: Arc::new(RwLock::new(mod_registry)),
        vfs,
        discord_rpc,
        app_handle: None,
    };

    println!(
        "[*] RRWR Backend Server listening on http://127.0.0.1:{}",
        actual_port
    );

    let app = axum::Router::new()
        .route(
            "/ipc",
            axum::routing::post(rrwr_lib::server::handle_ipc_post),
        )
        .route(
            "/ipc/{cmd}",
            axum::routing::get(rrwr_lib::server::handle_ipc_get),
        )
        .route(
            "/assets/{*path}",
            axum::routing::any(rrwr_lib::server::fallback_router),
        )
        .fallback(rrwr_lib::server::fallback_router)
        .layer(axum::middleware::from_fn(rrwr_lib::server::cors_middleware))
        .with_state(inner);

    axum::serve(listener, app).await.unwrap();
}
