pub mod handler;
pub mod vfs;

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Router,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::data::ArchiveStore;
use crate::mods::ModRegistry;
use crate::rpc::DiscordRpcManager;
pub use vfs::{ActiveModDescriptor, Vfs};

#[derive(Clone)]
pub struct AppStateInner {
    pub config: Arc<RwLock<AppConfig>>,
    pub asset_port: u16,
    pub asset_dir: Arc<std::sync::RwLock<PathBuf>>,
    pub store: Arc<ArchiveStore>,
    pub mods: Arc<RwLock<ModRegistry>>,
    pub vfs: Arc<Vfs>,
    pub discord_rpc: Arc<DiscordRpcManager>,
    pub app_handle: Option<tauri::AppHandle>,
}

impl AppStateInner {
    pub fn asset_dir(&self) -> PathBuf {
        self.asset_dir.read().unwrap().clone()
    }
}

pub struct AssetServerHandle {
    pub port: u16,
    pub state: AppStateInner,
}

fn json_response(status: StatusCode, val: serde_json::Value) -> Response {
    let body = match serde_json::to_string(&val) {
        Ok(s) => s,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let mut res = (status, body).into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    handler::add_cors_headers(headers);
    res
}

fn get_frontend_src_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("RRWR_FRONTEND_SRC") {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return p;
        }
    }
    let manifest_parent = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("src"));
    if let Some(p) = manifest_parent {
        if p.is_dir() {
            return p;
        }
    }
    let cur_src = PathBuf::from("src");
    if cur_src.is_dir() {
        return cur_src;
    }
    let parent_src = PathBuf::from("../src");
    if parent_src.is_dir() {
        return parent_src;
    }
    PathBuf::from("src")
}

async fn serve_index_html() -> Response {
    let src_dir = get_frontend_src_dir();
    let index_file = src_dir.join("index.html");
    if let Ok(bytes) = std::fs::read(&index_file) {
        if let Ok(s) = std::str::from_utf8(&bytes) {
            if s.contains("RRWR") {
                let mut res = (StatusCode::OK, bytes).into_response();
                let headers = res.headers_mut();
                headers.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/html; charset=utf-8"),
                );
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
                handler::add_cors_headers(headers);
                return res;
            }
        }
    }

    // Clean built-in fallback shell
    let content = b"<!DOCTYPE html><html><head><meta charset='utf-8'><title>RRWR</title><link rel='stylesheet' href='/styles/main.css'></head><body><div id='app'>RRWR Webview Shell</div></body></html>";
    let mut res = (StatusCode::OK, content.as_slice()).into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content.len().to_string()).unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    handler::add_cors_headers(headers);
    res
}

async fn serve_style_file(style_path: &str) -> Response {
    let clean_rel = style_path.trim_start_matches('/');
    let src_dir = get_frontend_src_dir();
    let file = src_dir.join("styles").join(clean_rel);

    if file.is_file() {
        if let Ok(bytes) = std::fs::read(&file) {
            let mut res = (StatusCode::OK, bytes).into_response();
            let headers = res.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/css; charset=utf-8"),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            handler::add_cors_headers(headers);
            return res;
        }
    }

    // Built-in fallback
    let css_data =
        b"body { font-family: 'Courier New', monospace; background: #000; color: #fff; }";
    let mut res = (StatusCode::OK, css_data.as_slice()).into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/css; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&css_data.len().to_string()).unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    handler::add_cors_headers(headers);
    res
}

async fn serve_js_file(js_path: &str) -> Response {
    let clean_rel = js_path.trim_start_matches('/');
    let src_dir = get_frontend_src_dir();
    let file = src_dir.join("js").join(clean_rel);

    if file.is_file() {
        if let Ok(bytes) = std::fs::read(&file) {
            let mut res = (StatusCode::OK, bytes).into_response();
            let headers = res.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/javascript; charset=utf-8"),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            handler::add_cors_headers(headers);
            return res;
        }
    }

    // Fallback JS
    let js_data = format!(
        "/* fallback {} */\nconsole.log('RRWR dynamic js loaded: {}');",
        clean_rel, clean_rel
    );
    let mut res = (StatusCode::OK, js_data.into_bytes()).into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    handler::add_cors_headers(headers);
    res
}

async fn serve_font_file(font_path: &str) -> Response {
    let clean_rel = font_path.trim_start_matches('/');
    let decoded = percent_encoding::percent_decode_str(clean_rel).decode_utf8_lossy();
    let src_dir = get_frontend_src_dir();
    let file = src_dir.join("fonts").join(decoded.as_ref());

    if file.is_file() {
        if let Ok(bytes) = std::fs::read(&file) {
            let mut res = (StatusCode::OK, bytes).into_response();
            let headers = res.headers_mut();
            let mime = handler::get_mime_type(&file);
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400"),
            );
            handler::add_cors_headers(headers);
            return res;
        }
    }
    (StatusCode::NOT_FOUND, "Font not found").into_response()
}

async fn serve_app_asset_file(asset_path: &str) -> Response {
    let clean_rel = asset_path.trim_start_matches('/');
    let decoded = percent_encoding::percent_decode_str(clean_rel).decode_utf8_lossy();
    let src_dir = get_frontend_src_dir();
    let file = src_dir.join("assets").join(decoded.as_ref());

    if file.is_file() {
        if let Ok(bytes) = std::fs::read(&file) {
            let mut res = (StatusCode::OK, bytes).into_response();
            let headers = res.headers_mut();
            let mime = handler::get_mime_type(&file);
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400"),
            );
            handler::add_cors_headers(headers);
            return res;
        }
    }
    (StatusCode::NOT_FOUND, "Asset not found").into_response()
}

/// Coerces a JSON value (number, positive integer, or string) to u64, or default
fn parse_u64_arg(val: Option<&serde_json::Value>, default: u64) -> usize {
    val.and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_i64().and_then(|n| u64::try_from(n).ok()))
            .or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
    })
    .unwrap_or(default) as usize
}

/// Coerces a JSON value (bool, 0/1 integer, or boolean string) to bool, or default
fn parse_bool_arg(val: Option<&serde_json::Value>, default: bool) -> bool {
    val.and_then(|v| {
        v.as_bool()
            .or_else(|| match v.as_i64() {
                Some(1) => Some(true),
                Some(0) => Some(false),
                _ => None,
            })
            .or_else(|| match v.as_str() {
                Some(s) if s.eq_ignore_ascii_case("true") || s == "1" => Some(true),
                Some(s) if s.eq_ignore_ascii_case("false") || s == "0" => Some(false),
                _ => None,
            })
    })
    .unwrap_or(default)
}

/// Extracts page_id supporting "page_id", "pageId", or "id" as string or positive integer
fn parse_page_id_arg(args: &serde_json::Value) -> Option<String> {
    let raw = args
        .get("page_id")
        .or_else(|| args.get("pageId"))
        .or_else(|| args.get("id"))?;
    if let Some(s) = raw.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') || trimmed == "000000" {
            None
        } else {
            Some(trimmed.to_string())
        }
    } else if let Some(n) = raw.as_i64() {
        if n <= 0 {
            None
        } else {
            Some(format!("{:06}", n))
        }
    } else {
        None
    }
}

pub async fn dispatch_ipc(
    state: &AppStateInner,
    command: &str,
    args: &serde_json::Value,
) -> Response {
    match command {
        "navigate" | "open_page" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !url.is_empty() {
                if let Some(handle) = &state.app_handle {
                    use tauri::Manager;
                    if let Some(window) = handle.get_webview_window("main") {
                        let script = format!(
                            "if (window.__rrwrNavigate) {{ window.__rrwrNavigate({}); }}",
                            serde_json::to_string(url).unwrap_or_default()
                        );
                        let res = window.eval(&script);
                        eprintln!("[IPC] Navigate eval result for '{}': {:?}", url, res);
                    } else {
                        eprintln!("[IPC] Main window not found for navigation!");
                    }
                }
            }
            json_response(
                StatusCode::OK,
                serde_json::json!({"success": true, "url": url}),
            )
        }
        "get_app_info" => {
            let platform = if cfg!(target_os = "android") {
                "android"
            } else if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "macos") {
                "macos"
            } else {
                "linux"
            };
            let asset_dir = state.asset_dir();
            let first_page_id = state
                .store
                .get_story_range(0, 1)
                .await
                .first()
                .map(|p| p.page_id.clone());
            let info = serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "platform": platform,
                "asset_dir": asset_dir.to_string_lossy(),
                "asset_pack_ready": crate::imports::is_asset_pack(&asset_dir),
                "custom_asset_dir": crate::imports::custom_asset_dir().to_string_lossy(),
                "asset_port": state.asset_port,
                "overlay_generation": state.vfs.generation(),
                "overlayGeneration": state.vfs.generation(),
                "first_page_id": first_page_id,
            });
            json_response(StatusCode::OK, info)
        }
        "check_asset_pack_path" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let p = std::path::Path::new(path);
            let valid = crate::imports::is_asset_pack(p)
                || p.canonicalize()
                    .map(|c| crate::imports::is_asset_pack(&c))
                    .unwrap_or(false);
            json_response(StatusCode::OK, serde_json::json!(valid))
        }
        "detect_asset_pack_paths" => {
            let candidates = args.get("candidates").and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect::<Vec<String>>()
                })
            });
            match crate::commands::detect_asset_pack_paths(candidates) {
                Ok(paths) => json_response(StatusCode::OK, serde_json::json!(paths)),
                Err(err) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({ "error": err }),
                ),
            }
        }
        "set_asset_pack_path" | "configure_asset_pack" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if path.is_empty() {
                return json_response(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "Path parameter is required"}),
                );
            }
            let selected = match crate::imports::validate_asset_pack(std::path::Path::new(path)) {
                Ok(p) => p,
                Err(e) => {
                    return json_response(StatusCode::BAD_REQUEST, serde_json::json!({"error": e}));
                }
            };
            let mut config = state.config.read().await.clone();
            config.asset_dir = Some(selected.to_string_lossy().into_owned());
            if let Err(e) = config.save() {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": format!("Could not save Asset Pack location: {}", e)}),
                );
            }
            *state.config.write().await = config.clone();
            *state.asset_dir.write().unwrap() = selected.clone();
            state.vfs.set_base_dir(selected.clone());
            state.store.reload_from_dir(&selected);

            {
                let mut mods = state.mods.write().await;
                mods.reload_from_dir(&selected, &config.settings.mod_list_enabled);
            }
            let (descriptors, all_descriptors, patches, static_footnotes) = {
                let mods = state.mods.read().await;
                (
                    mods.get_active_descriptors(),
                    mods.get_all_descriptors(),
                    mods.load_active_patches(),
                    mods.load_static_footnotes(),
                )
            };
            state.vfs.set_installed_descriptors(all_descriptors).await;
            let _ = state.vfs.rebuild_overlay(descriptors).await;
            state.store.story.reset_to_base().await;
            if !patches.is_empty() {
                state.store.story.apply_patches(&patches).await;
            }
            if !static_footnotes.is_empty() {
                state
                    .store
                    .story
                    .merge_mod_diffs(crate::data::story::ModDiffPayload {
                        footnotes: static_footnotes,
                        ..Default::default()
                    })
                    .await;
            }
            state.vfs.bump_generation();

            json_response(StatusCode::OK, serde_json::json!({"success": true}))
        }
        "get_story_page" => {
            let page_id = match parse_page_id_arg(args) {
                Some(id) => id,
                None => {
                    return json_response(
                        StatusCode::NOT_FOUND,
                        serde_json::json!({"error": "Page not found"}),
                    );
                }
            };

            match state.store.get_story_page(&page_id).await {
                Some(page) => {
                    if state.config.read().await.settings.enable_discord_rpc {
                        let _ = state
                            .discord_rpc
                            .update_reading_presence(&page.page_id, &page.title)
                            .await;
                    }
                    match serde_json::to_value(&page) {
                        Ok(v) => json_response(StatusCode::OK, v),
                        Err(e) => json_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            serde_json::json!({"error": e.to_string()}),
                        ),
                    }
                }
                None => json_response(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({"error": format!("Page '{}' not found", page_id)}),
                ),
            }
        }
        "get_story_range" => {
            let start = parse_u64_arg(args.get("start"), 100);
            let count = parse_u64_arg(args.get("count"), 10);

            let summaries = state.store.get_story_range(start, count).await;
            match serde_json::to_value(&summaries) {
                Ok(v) => json_response(StatusCode::OK, v),
                Err(e) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": e.to_string()}),
                ),
            }
        }
        "get_music_data" => {
            let raw = state.store.get_music_raw();
            json_response(StatusCode::OK, raw)
        }
        "load_config" => {
            let cfg = state.config.read().await;
            match serde_json::to_value(&*cfg) {
                Ok(v) => json_response(StatusCode::OK, v),
                Err(e) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": e.to_string()}),
                ),
            }
        }
        "save_config" => {
            let config_val = if let Some(c) = args.get("config") {
                c
            } else if let Some(c) = args.get("new_config") {
                c
            } else if let Some(c) = args.get("newConfig") {
                c
            } else if args.is_object() && args.get("settings").is_some() {
                args
            } else {
                return json_response(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "Invalid config schema"}),
                );
            };

            let mut new_config: AppConfig = match serde_json::from_value(config_val.clone()) {
                Ok(c) => c,
                Err(e) => {
                    return json_response(
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({"error": format!("Invalid config schema: {}", e)}),
                    )
                }
            };
            new_config.normalize();

            if let Err(e) = new_config.save() {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": format!("Failed to save config: {}", e)}),
                );
            }

            // Sync discord RPC setting if changed
            let rpc_status = state.discord_rpc.get_status().await;
            if rpc_status.enabled != new_config.settings.enable_discord_rpc {
                let _ = state
                    .discord_rpc
                    .set_enabled(new_config.settings.enable_discord_rpc)
                    .await;
            }
            let desired_client_id = new_config.settings.discord_client_id.trim();
            if rpc_status.client_id != desired_client_id {
                let _ = state.discord_rpc.set_client_id(desired_client_id).await;
            }

            {
                let mut cfg = state.config.write().await;
                *cfg = new_config.clone();
            }

            // Sync modListEnabled with active mods
            {
                let mut mods_lock = state.mods.write().await;
                mods_lock.rescan(&new_config.settings.mod_list_enabled);
                let descriptors = mods_lock.get_active_descriptors();
                let all_descriptors = mods_lock.get_all_descriptors();
                state.vfs.set_installed_descriptors(all_descriptors).await;
                let _ = state.vfs.rebuild_overlay(descriptors).await;
                let patches = mods_lock.load_active_patches();
                let static_footnotes = mods_lock.load_static_footnotes();
                state.store.story.reset_to_base().await;
                if !patches.is_empty() {
                    state.store.story.apply_patches(&patches).await;
                }
                if !static_footnotes.is_empty() {
                    state
                        .store
                        .story
                        .merge_mod_diffs(crate::data::ModDiffPayload {
                            footnotes: static_footnotes,
                            ..Default::default()
                        })
                        .await;
                }
            }

            json_response(
                StatusCode::OK,
                serde_json::json!({"status": "ok", "saved": true}),
            )
        }
        "get_available_mods" => {
            let mods_lock = state.mods.read().await;
            state
                .vfs
                .set_installed_descriptors(mods_lock.get_all_descriptors())
                .await;
            let list = mods_lock.get_available_mods();
            match serde_json::to_value(&list) {
                Ok(v) => json_response(StatusCode::OK, v),
                Err(e) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": e.to_string()}),
                ),
            }
        }
        "toggle_mod" => {
            let mod_id = if let Some(m) = args.get("mod_id").and_then(|v| v.as_str()) {
                m.to_string()
            } else if let Some(m) = args.get("modId").and_then(|v| v.as_str()) {
                m.to_string()
            } else if let Some(m) = args.get("id").and_then(|v| v.as_str()) {
                m.to_string()
            } else {
                return json_response(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({"error": "Missing or non-string mod_id"}),
                );
            };

            let enabled = parse_bool_arg(args.get("enabled"), false);

            let (success, descriptors, all_descriptors, patches, static_footnotes) = {
                let mut mods_lock = state.mods.write().await;
                match mods_lock.toggle_mod(&mod_id, enabled) {
                    Ok(_) => {
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
                    }
                    Err(e) => {
                        return json_response(
                            StatusCode::NOT_FOUND,
                            serde_json::json!({"error": e}),
                        )
                    }
                }
            };

            if success {
                state.vfs.set_installed_descriptors(all_descriptors).await;
                let _ = state.vfs.rebuild_overlay(descriptors).await;
                state.store.story.reset_to_base().await;
                if !patches.is_empty() {
                    state.store.story.apply_patches(&patches).await;
                }
                if !static_footnotes.is_empty() {
                    state
                        .store
                        .story
                        .merge_mod_diffs(crate::data::ModDiffPayload {
                            footnotes: static_footnotes,
                            ..Default::default()
                        })
                        .await;
                }

                // Update config
                let mut cfg = state.config.write().await;
                let list = &mut cfg.settings.mod_list_enabled;
                if enabled {
                    if !list.contains(&mod_id) {
                        list.push(mod_id.clone());
                    }
                } else {
                    list.retain(|id| id != &mod_id);
                }
                let _ = cfg.save();
            }

            json_response(
                StatusCode::OK,
                serde_json::json!({
                    "status": "ok",
                    "mod_id": mod_id,
                    "enabled": enabled,
                    "overlay_generation": state.vfs.generation(),
                    "overlayGeneration": state.vfs.generation(),
                }),
            )
        }
        "read_mod_file" => {
            let mod_id = args
                .get("mod_id")
                .or_else(|| args.get("modId"))
                .or_else(|| args.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let rel_path = args
                .get("path")
                .or_else(|| args.get("rel_path"))
                .or_else(|| args.get("relPath"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if mod_id.is_empty() || rel_path.is_empty() {
                return json_response(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "Missing mod_id or path"}),
                );
            }

            let mods_lock = state.mods.read().await;
            match mods_lock.read_mod_file(mod_id, rel_path) {
                Ok(v) => json_response(StatusCode::OK, v),
                Err(e) => {
                    let status = if e.contains("not found") || e.contains("Unknown mod") {
                        StatusCode::NOT_FOUND
                    } else if e.contains("Invalid or unsafe") || e.contains("Path traversal") {
                        StatusCode::FORBIDDEN
                    } else {
                        StatusCode::BAD_REQUEST
                    };
                    json_response(status, serde_json::json!({"error": e}))
                }
            }
        }
        "get_mod_bundle" => {
            let cfg = state.config.read().await.clone();
            let mods_lock = state.mods.read().await;
            let bundle = mods_lock
                .get_active_mod_bundle(&cfg, &state.store, state.vfs.generation())
                .await;
            json_response(StatusCode::OK, bundle)
        }
        "apply_mod_diffs" => {
            let raw_payload = if let Some(d) = args.get("diff") {
                d
            } else {
                args
            };
            let mut diff: crate::data::ModDiffPayload =
                match serde_json::from_value(raw_payload.clone()) {
                    Ok(d) => d,
                    Err(e) => {
                        return json_response(
                            StatusCode::BAD_REQUEST,
                            serde_json::json!({"error": format!("Invalid diff payload: {}", e)}),
                        )
                    }
                };
            if let Some(r) = args.get("replace").and_then(|v| v.as_bool()) {
                diff.replace = r;
            }
            if diff.routes.is_empty() {
                if let Some(routes_val) = args.get("routes").or_else(|| args.get("modRoutes")) {
                    if let Ok(parsed_routes) = serde_json::from_value(routes_val.clone()) {
                        diff.routes = parsed_routes;
                    }
                }
            }

            if !diff.routes.is_empty() {
                let descriptors = {
                    let mut mods_lock = state.mods.write().await;
                    if mods_lock.update_dynamic_routes(&diff.routes) {
                        Some(mods_lock.get_active_descriptors())
                    } else {
                        None
                    }
                };
                if let Some(desc) = descriptors {
                    let _ = state.vfs.rebuild_overlay(desc).await;
                }
            }

            if diff.replace {
                let (static_patches, static_footnotes) = {
                    let mods_lock = state.mods.read().await;
                    (
                        mods_lock.load_active_patches(),
                        mods_lock.load_static_footnotes(),
                    )
                };
                state.store.story.reset_to_base().await;
                if !static_patches.is_empty() {
                    state.store.story.apply_patches(&static_patches).await;
                }
                if !static_footnotes.is_empty() {
                    state
                        .store
                        .story
                        .merge_mod_diffs(crate::data::ModDiffPayload {
                            footnotes: static_footnotes,
                            ..Default::default()
                        })
                        .await;
                }
            }

            state.store.story.merge_mod_diffs(diff).await;
            let gen = state.vfs.bump_generation();
            json_response(
                StatusCode::OK,
                serde_json::json!({
                    "status": "ok",
                    "overlay_generation": gen,
                    "overlayGeneration": gen,
                }),
            )
        }
        "save_mod_setting" => {
            let mod_id = args
                .get("mod_id")
                .or_else(|| args.get("modId"))
                .or_else(|| args.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let key = args
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = args
                .get("value")
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            if mod_id.is_empty() || key.is_empty() {
                return json_response(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "Missing mod_id or key"}),
                );
            }

            let mut cfg = state.config.write().await;
            cfg.mod_settings
                .entry(mod_id.clone())
                .or_default()
                .insert(key.clone(), value.clone());
            if let Err(e) = cfg.save() {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": format!("Failed to save config: {}", e)}),
                );
            }

            json_response(
                StatusCode::OK,
                serde_json::json!({
                    "status": "ok",
                    "modId": mod_id,
                    "key": key,
                    "value": value,
                }),
            )
        }
        "get_page_footnotes" => {
            let page_id = args
                .get("page_id")
                .or_else(|| args.get("pageId"))
                .or_else(|| args.get("id"))
                .and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|n| format!("{:06}", n)))
                })
                .unwrap_or_default();
            let notes = state.store.story.get_page_footnotes(&page_id).await;
            json_response(
                StatusCode::OK,
                serde_json::to_value(notes).unwrap_or_default(),
            )
        }
        "get_mod_hooks" => {
            let mods_lock = state.mods.read().await;
            let hooks = mods_lock.get_active_vue_hooks();
            json_response(
                StatusCode::OK,
                serde_json::json!({
                    "vueHooks": hooks,
                    "overlayGeneration": state.vfs.generation(),
                    "overlay_generation": state.vfs.generation(),
                }),
            )
        }
        "evaluate_log_button_text" => {
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .or_else(|| args.get("raw_content").and_then(|v| v.as_str()))
                .unwrap_or("");
            let log_hidden = parse_bool_arg(
                args.get("log_hidden").or_else(|| args.get("logHidden")),
                true,
            );
            let mods_lock = state.mods.read().await;
            let text = mods_lock.evaluate_log_button_text(content, log_hidden);
            json_response(
                StatusCode::OK,
                serde_json::json!({
                    "text": text,
                    "log_hidden": log_hidden,
                    "logHidden": log_hidden,
                }),
            )
        }
        "get_discord_status" => {
            let status = state.discord_rpc.get_status().await;
            match serde_json::to_value(&status) {
                Ok(v) => json_response(StatusCode::OK, v),
                Err(e) => json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    serde_json::json!({"error": e.to_string()}),
                ),
            }
        }
        "set_discord_presence" => {
            let mode = args
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("reading");

            match mode {
                "reading" => {
                    let page_id = parse_page_id_arg(args).unwrap_or_else(|| "000001".to_string());
                    let page_title = if let Some(t) = args
                        .get("page_title")
                        .or_else(|| args.get("pageTitle"))
                        .or_else(|| args.get("title"))
                        .and_then(|v| v.as_str())
                    {
                        t.to_string()
                    } else {
                        state
                            .store
                            .get_story_page(&page_id)
                            .await
                            .map(|p| p.title)
                            .unwrap_or_else(|| "Reading".to_string())
                    };

                    let status = state
                        .discord_rpc
                        .update_reading_presence(&page_id, &page_title)
                        .await;
                    json_response(
                        StatusCode::OK,
                        serde_json::json!({"status": "ok", "presence": status}),
                    )
                }
                "browsing" | "menu" => {
                    let page_title = args
                        .get("title")
                        .or_else(|| args.get("page_title"))
                        .or_else(|| args.get("pageTitle"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Main Menu");
                    let details = args.get("details").and_then(|v| v.as_str());

                    let status = state
                        .discord_rpc
                        .update_browsing_presence(page_title, details)
                        .await;
                    json_response(
                        StatusCode::OK,
                        serde_json::json!({"status": "ok", "presence": status}),
                    )
                }
                "music" => {
                    let track_title = args
                        .get("track_title")
                        .or_else(|| args.get("trackTitle"))
                        .or_else(|| args.get("track"))
                        .or_else(|| args.get("track_name"))
                        .or_else(|| args.get("trackName"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Audio Player");
                    let album_name = args
                        .get("album_name")
                        .or_else(|| args.get("albumName"))
                        .or_else(|| args.get("album"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let artist = args.get("artist").and_then(|v| v.as_str());
                    let track_id = args
                        .get("track_id")
                        .or_else(|| args.get("trackId"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let playing = parse_bool_arg(args.get("playing"), true);

                    let status = state
                        .discord_rpc
                        .update_music_presence(track_title, album_name, artist, track_id, playing)
                        .await;
                    json_response(
                        StatusCode::OK,
                        serde_json::json!({"status": "ok", "presence": status}),
                    )
                }
                "clear" => {
                    let status = state.discord_rpc.clear_presence().await;
                    json_response(
                        StatusCode::OK,
                        serde_json::json!({"status": "ok", "presence": status}),
                    )
                }
                _ => {
                    let status = state.discord_rpc.get_status().await;
                    json_response(
                        StatusCode::OK,
                        serde_json::json!({"status": "ok", "presence": status}),
                    )
                }
            }
        }
        "set_discord_music_presence" => {
            let track_title = args
                .get("track_title")
                .or_else(|| args.get("trackTitle"))
                .or_else(|| args.get("track"))
                .or_else(|| args.get("track_name"))
                .or_else(|| args.get("trackName"))
                .and_then(|v| v.as_str())
                .unwrap_or("Audio Player");
            let album_name = args
                .get("album_name")
                .or_else(|| args.get("albumName"))
                .or_else(|| args.get("album"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let artist = args.get("artist").and_then(|v| v.as_str());
            let track_id = args
                .get("track_id")
                .or_else(|| args.get("trackId"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let playing = parse_bool_arg(args.get("playing"), true);

            let status = state
                .discord_rpc
                .update_music_presence(track_title, album_name, artist, track_id, playing)
                .await;
            json_response(
                StatusCode::OK,
                serde_json::json!({"status": "ok", "presence": status}),
            )
        }
        "toggle_discord_rpc" => {
            let current = state.discord_rpc.get_status().await.enabled;
            let enabled = parse_bool_arg(args.get("enabled"), !current);
            let status = state.discord_rpc.set_enabled(enabled).await;
            {
                let mut cfg = state.config.write().await;
                cfg.settings.enable_discord_rpc = enabled;
                let _ = cfg.save();
            }
            json_response(
                StatusCode::OK,
                serde_json::json!({"status": "ok", "enabled": enabled, "connected": status.connected}),
            )
        }
        "trim_memory" => {
            crate::commands::trim_memory();
            json_response(StatusCode::OK, serde_json::json!({"status": "ok"}))
        }
        "client_log" => {
            let level = args.get("level").and_then(|v| v.as_str()).unwrap_or("info");
            let message = args.get("message").and_then(|v| v.as_str()).unwrap_or("");
            crate::commands::client_log(level.to_string(), message.to_string());
            json_response(StatusCode::OK, serde_json::json!({"status": "ok"}))
        }
        "get_debug_metrics" => {
            let metrics = crate::commands::collect_debug_metrics();
            json_response(
                StatusCode::OK,
                serde_json::to_value(&metrics).unwrap_or_default(),
            )
        }
        "open_url" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            match crate::commands::open_url(url.to_string()).await {
                Ok(_) => json_response(StatusCode::OK, serde_json::json!({"status": "ok"})),
                Err(e) => json_response(StatusCode::BAD_REQUEST, serde_json::json!({"error": e})),
            }
        }
        "win_minimize" | "win_maximize" | "win_close" => {
            json_response(StatusCode::OK, serde_json::json!({"status": "ok"}))
        }
        "get_archive_tree_roots" => {
            let roots = crate::data::tree::get_archive_tree_roots(&state.store, &state.vfs).await;
            json_response(
                StatusCode::OK,
                serde_json::to_value(&roots).unwrap_or_default(),
            )
        }
        "get_archive_tree_children" => {
            let node_id = args
                .get("nodeId")
                .or_else(|| args.get("node_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let offset = args.get("offset").and_then(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .or_else(|| v.as_str().and_then(|s| s.parse::<usize>().ok()))
            });
            let limit = args.get("limit").and_then(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .or_else(|| v.as_str().and_then(|s| s.parse::<usize>().ok()))
            });
            match crate::data::tree::get_archive_tree_children(
                &state.store,
                &state.vfs,
                node_id,
                offset,
                limit,
            )
            .await
            {
                Ok(resp) => json_response(
                    StatusCode::OK,
                    serde_json::to_value(&resp).unwrap_or_default(),
                ),
                Err(e) => json_response(StatusCode::BAD_REQUEST, serde_json::json!({"error": e})),
            }
        }
        "search_archive_tree" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args.get("limit").and_then(|v| {
                v.as_u64()
                    .map(|n| n as usize)
                    .or_else(|| v.as_str().and_then(|s| s.parse::<usize>().ok()))
            });
            let resp =
                crate::data::tree::search_archive_tree(&state.store, &state.vfs, query, limit)
                    .await;
            json_response(
                StatusCode::OK,
                serde_json::to_value(&resp).unwrap_or_default(),
            )
        }
        _ => json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": format!("Unknown IPC command '{}'", command)}),
        ),
    }
}

pub async fn handle_ipc_post(State(state): State<AppStateInner>, req: Request<Body>) -> Response {
    let bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({"error": "Failed to read request body"}),
            )
        }
    };

    if bytes.is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "Empty request body"}),
        );
    }

    let val: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({"error": "Invalid JSON payload"}),
            )
        }
    };

    let cmd = if let Some(c) = val.get("cmd").and_then(|v| v.as_str()) {
        c.to_string()
    } else if let Some(c) = val.get("command").and_then(|v| v.as_str()) {
        c.to_string()
    } else {
        return json_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "Missing IPC command"}),
        );
    };

    let empty_args = serde_json::json!({});
    let args = if let Some(a) = val.get("args") {
        a
    } else if let Some(a) = val.get("payload") {
        a
    } else {
        &empty_args
    };

    dispatch_ipc(&state, &cmd, args).await
}

pub async fn handle_ipc_get(
    State(state): State<AppStateInner>,
    AxumPath(cmd): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let args = serde_json::to_value(params).unwrap_or(serde_json::Value::Null);
    dispatch_ipc(&state, &cmd, &args).await
}

pub async fn fallback_router(State(state): State<AppStateInner>, req: Request<Body>) -> Response {
    let path = req.uri().path();
    if path == "/" || path == "/index.html" {
        return serve_index_html().await;
    }
    if let Some(style_rel) = path.strip_prefix("/styles/") {
        return serve_style_file(style_rel).await;
    }
    if let Some(js_rel) = path.strip_prefix("/js/") {
        return serve_js_file(js_rel).await;
    }
    if let Some(font_rel) = path.strip_prefix("/fonts/") {
        let res = serve_font_file(font_rel).await;
        if res.status() == StatusCode::OK {
            return res;
        }
    }
    if let Some(asset_rel) = path.strip_prefix("/assets/") {
        let res = serve_app_asset_file(asset_rel).await;
        if res.status() == StatusCode::OK {
            return res;
        }
        return handler::handle_asset_request(&state.vfs, req).await;
    }
    // Single-Page Application (SPA) routing fallback:
    // Any non-asset route without a dot extension (e.g. /story/1, /page/000001, /settings, /music)
    // serves index.html so the client-side router handles navigation seamlessly.
    if !path.contains('.') {
        return serve_index_html().await;
    }
    handler::handle_asset_request(&state.vfs, req).await
}

pub async fn cors_middleware(req: Request<Body>, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        handler::add_cors_headers(res.headers_mut());
        return res;
    }

    let mut res = next.run(req).await;
    handler::add_cors_headers(res.headers_mut());
    res
}

pub async fn start_server(state: AppStateInner, port_tx: tokio::sync::oneshot::Sender<u16>) {
    let app = Router::new()
        .route("/ipc", post(handle_ipc_post))
        .route("/ipc/{cmd}", get(handle_ipc_get))
        .route("/", get(fallback_router))
        .route("/index.html", get(fallback_router))
        .route("/styles/{*path}", get(fallback_router))
        .route("/js/{*path}", get(fallback_router))
        .route("/fonts/{*path}", get(fallback_router))
        .route("/assets/{*path}", any(fallback_router))
        .fallback(fallback_router)
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state);

    let listener = match TcpListener::bind("127.0.0.1:28282").await {
        Ok(l) => l,
        Err(_) => TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind loopback socket"),
    };

    let port = listener
        .local_addr()
        .expect("Failed to read local socket address")
        .port();

    let _ = port_tx.send(port);
    log::info!("Axum asset server started on http://127.0.0.1:{}/", port);

    axum::serve(listener, app)
        .await
        .expect("Axum server crashed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_u64_arg() {
        assert_eq!(parse_u64_arg(Some(&serde_json::json!(0)), 100), 0);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!("0")), 100), 0);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!(100)), 10), 100);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!("100")), 10), 100);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!(" 42 ")), 10), 42);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!(-5)), 100), 100);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!("-5")), 100), 100);
        assert_eq!(parse_u64_arg(Some(&serde_json::json!("abc")), 100), 100);
        assert_eq!(parse_u64_arg(None, 100), 100);
    }

    #[test]
    fn test_parse_bool_arg() {
        assert!(parse_bool_arg(Some(&serde_json::json!(true)), false));
        assert!(!parse_bool_arg(Some(&serde_json::json!(false)), true));
        assert!(parse_bool_arg(Some(&serde_json::json!("true")), false));
        assert!(!parse_bool_arg(Some(&serde_json::json!("False")), true));
        assert!(parse_bool_arg(Some(&serde_json::json!(1)), false));
        assert!(!parse_bool_arg(Some(&serde_json::json!(0)), true));
        assert!(parse_bool_arg(Some(&serde_json::json!("1")), false));
        assert!(!parse_bool_arg(Some(&serde_json::json!("0")), true));
        assert!(!parse_bool_arg(Some(&serde_json::json!("invalid")), false));
        assert!(!parse_bool_arg(None, false));
    }

    #[test]
    fn test_parse_page_id_arg() {
        let m1 = serde_json::json!({"page_id": "000001"});
        assert_eq!(parse_page_id_arg(&m1), Some("000001".to_string()));

        let m1_camel = serde_json::json!({"pageId": "000001"});
        assert_eq!(parse_page_id_arg(&m1_camel), Some("000001".to_string()));

        let m2 = serde_json::json!({"id": 1});
        assert_eq!(parse_page_id_arg(&m2), Some("000001".to_string()));

        let m3 = serde_json::json!({"id": "bonus"});
        assert_eq!(parse_page_id_arg(&m3), Some("bonus".to_string()));

        let m4 = serde_json::json!({"page_id": -1});
        assert_eq!(parse_page_id_arg(&m4), None);

        let m5 = serde_json::json!({"page_id": "000000"});
        assert_eq!(parse_page_id_arg(&m5), None);

        let m6 = serde_json::json!({});
        assert_eq!(parse_page_id_arg(&m6), None);
    }
}
