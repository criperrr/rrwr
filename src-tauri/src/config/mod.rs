use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub key: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, alias = "has_embed")]
    pub has_embed: bool,
    #[serde(default)]
    pub history: Vec<String>,
    #[serde(default)]
    pub future: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedTab {
    pub key: String,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabData {
    #[serde(alias = "active_tab_key")]
    pub active_tab_key: String,
    pub tabs: HashMap<String, Tab>,
    #[serde(alias = "tab_list")]
    pub tab_list: Vec<String>,
    #[serde(default, alias = "sorted_tab_list")]
    pub sorted_tab_list: Vec<String>,
    #[serde(default, alias = "closed_tab_list")]
    pub closed_tab_list: Vec<ClosedTab>,
}

impl Default for TabData {
    fn default() -> Self {
        let mut tabs = HashMap::new();
        tabs.insert(
            "000".to_string(),
            Tab {
                key: "000".to_string(),
                url: "/".to_string(),
                title: "RRWR".to_string(),
                has_embed: false,
                history: Vec::new(),
                future: Vec::new(),
            },
        );
        Self {
            active_tab_key: "000".to_string(),
            tabs,
            tab_list: vec!["000".to_string()],
            sorted_tab_list: vec!["000".to_string()],
            closed_tab_list: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    #[serde(default, alias = "id")]
    pub key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveData {
    #[serde(default)]
    pub saves: HashMap<String, Bookmark>,
    #[serde(default, alias = "save_list")]
    pub save_list: Vec<String>,
    #[serde(default)]
    pub flash_storage: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgressSettings {
    #[serde(default = "default_reader_current")]
    pub current: String,
    #[serde(default = "default_reader_limit")]
    pub limit: String,
}

fn default_reader_current() -> String {
    "000001".to_string()
}
fn default_reader_limit() -> String {
    "000002".to_string()
}

impl Default for ReadingProgressSettings {
    fn default() -> Self {
        Self {
            current: default_reader_current(),
            limit: default_reader_limit(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverrideSettings {
    #[serde(default, alias = "font_family")]
    pub font_family: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default = "default_font_size", alias = "font_size")]
    pub font_size: f64,
    #[serde(default = "default_font_size", alias = "line_height")]
    pub line_height: f64,
    #[serde(default, alias = "paragraph_spacing")]
    pub paragraph_spacing: bool,
    #[serde(default, alias = "high_contrast")]
    pub high_contrast: bool,
}

fn default_font_size() -> f64 {
    1.0
}

impl Default for TextOverrideSettings {
    fn default() -> Self {
        Self {
            font_family: String::new(),
            bold: false,
            font_size: 1.0,
            line_height: 1.0,
            paragraph_spacing: false,
            high_contrast: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnimationCategories {
    #[serde(default = "default_true")]
    pub tabs: bool,
    #[serde(default = "default_true")]
    pub menus: bool,
    #[serde(default = "default_true", alias = "boot_splash")]
    pub boot_splash: bool,
    #[serde(default = "default_true", alias = "mod_loading")]
    pub mod_loading: bool,
    #[serde(default = "default_true", alias = "reload_icon")]
    pub reload_icon: bool,
    #[serde(default = "default_true", alias = "ui_micro")]
    pub ui_micro: bool,
    #[serde(default, alias = "page_transitions")]
    pub page_transitions: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for AnimationCategories {
    fn default() -> Self {
        Self {
            tabs: true,
            menus: true,
            boot_splash: true,
            mod_loading: true,
            reload_icon: true,
            ui_micro: true,
            page_transitions: false,
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub key: String,
    pub code: String,
    #[serde(default, alias = "key_code")]
    pub key_code: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionButtonBinding {
    pub id: String,
    pub label: String,
    pub key: String,
    pub code: String,
    #[serde(default, alias = "key_code")]
    pub key_code: u32,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

fn default_dir_up() -> KeyBinding {
    KeyBinding {
        key: "ArrowUp".to_string(),
        code: "ArrowUp".to_string(),
        key_code: 38,
    }
}

fn default_dir_down() -> KeyBinding {
    KeyBinding {
        key: "ArrowDown".to_string(),
        code: "ArrowDown".to_string(),
        key_code: 40,
    }
}

fn default_dir_left() -> KeyBinding {
    KeyBinding {
        key: "ArrowLeft".to_string(),
        code: "ArrowLeft".to_string(),
        key_code: 37,
    }
}

fn default_dir_right() -> KeyBinding {
    KeyBinding {
        key: "ArrowRight".to_string(),
        code: "ArrowRight".to_string(),
        key_code: 39,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectionBindings {
    #[serde(default = "default_dir_up")]
    pub up: KeyBinding,
    #[serde(default = "default_dir_down")]
    pub down: KeyBinding,
    #[serde(default = "default_dir_left")]
    pub left: KeyBinding,
    #[serde(default = "default_dir_right")]
    pub right: KeyBinding,
}

impl Default for DirectionBindings {
    fn default() -> Self {
        Self {
            up: default_dir_up(),
            down: default_dir_down(),
            left: default_dir_left(),
            right: default_dir_right(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerClusterPosition {
    pub x: f64,
    pub y: f64,
}

fn default_dpad_position() -> ControllerClusterPosition {
    ControllerClusterPosition { x: 4.0, y: 62.0 }
}

fn default_actions_position() -> ControllerClusterPosition {
    ControllerClusterPosition { x: 72.0, y: 60.0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerPositions {
    #[serde(default = "default_dpad_position")]
    pub dpad: ControllerClusterPosition,
    #[serde(default = "default_actions_position")]
    pub actions: ControllerClusterPosition,
}

impl Default for ControllerPositions {
    fn default() -> Self {
        Self {
            dpad: default_dpad_position(),
            actions: default_actions_position(),
        }
    }
}

fn default_direction_preset() -> String {
    "arrows".to_string()
}

fn default_action_buttons() -> Vec<ActionButtonBinding> {
    vec![
        ActionButtonBinding {
            id: "act-space".to_string(),
            label: "SPACE".to_string(),
            key: " ".to_string(),
            code: "Space".to_string(),
            key_code: 32,
            x: None,
            y: None,
        },
        ActionButtonBinding {
            id: "act-enter".to_string(),
            label: "ENTER".to_string(),
            key: "Enter".to_string(),
            code: "Enter".to_string(),
            key_code: 13,
            x: None,
            y: None,
        },
        ActionButtonBinding {
            id: "act-z".to_string(),
            label: "Z".to_string(),
            key: "z".to_string(),
            code: "KeyZ".to_string(),
            key_code: 90,
            x: None,
            y: None,
        },
        ActionButtonBinding {
            id: "act-x".to_string(),
            label: "X".to_string(),
            key: "x".to_string(),
            code: "KeyX".to_string(),
            key_code: 88,
            x: None,
            y: None,
        },
        ActionButtonBinding {
            id: "act-shift".to_string(),
            label: "SHIFT".to_string(),
            key: "Shift".to_string(),
            code: "ShiftLeft".to_string(),
            key_code: 16,
            x: None,
            y: None,
        },
        ActionButtonBinding {
            id: "act-m".to_string(),
            label: "M".to_string(),
            key: "m".to_string(),
            code: "KeyM".to_string(),
            key_code: 77,
            x: None,
            y: None,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerBindings {
    #[serde(default = "default_direction_preset", alias = "direction_preset")]
    pub direction_preset: String,
    #[serde(default)]
    pub directions: DirectionBindings,
    #[serde(default = "default_action_buttons")]
    pub actions: Vec<ActionButtonBinding>,
}

impl Default for ControllerBindings {
    fn default() -> Self {
        Self {
            direction_preset: default_direction_preset(),
            directions: DirectionBindings::default(),
            actions: default_action_buttons(),
        }
    }
}

fn default_vc_mode() -> String {
    "auto".to_string()
}

fn default_vc_layout() -> String {
    "joystick-round".to_string()
}

fn default_vc_opacity() -> f64 {
    0.78
}

fn default_vc_scale() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualControllerSettings {
    #[serde(default = "default_vc_mode")]
    pub mode: String,
    #[serde(default = "default_vc_layout")]
    pub layout: String,
    #[serde(default = "default_vc_opacity")]
    pub opacity: f64,
    #[serde(default = "default_vc_scale")]
    pub scale: f64,
    #[serde(default)]
    pub positions: ControllerPositions,
    #[serde(default)]
    pub bindings: ControllerBindings,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for VirtualControllerSettings {
    fn default() -> Self {
        Self {
            mode: default_vc_mode(),
            layout: default_vc_layout(),
            opacity: default_vc_opacity(),
            scale: default_vc_scale(),
            positions: ControllerPositions::default(),
            bindings: ControllerBindings::default(),
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default, alias = "reading_progress")]
    pub reading_progress: ReadingProgressSettings,
    #[serde(default = "default_true")]
    pub notifications: bool,
    #[serde(default, alias = "sub_notifications")]
    pub sub_notifications: bool,
    #[serde(default = "default_true", alias = "show_address_bar")]
    pub show_address_bar: bool,
    #[serde(default = "default_true", alias = "url_tooltip")]
    pub url_tooltip: bool,
    #[serde(default, alias = "switch_to_new_tabs")]
    pub switch_to_new_tabs: bool,
    #[serde(default = "default_true", alias = "force_scroll_bar")]
    pub force_scroll_bar: bool,
    #[serde(default, alias = "hide_fullscreen_header")]
    pub hide_fullscreen_header: bool,
    #[serde(default = "default_true", alias = "smooth_scrolling")]
    pub smooth_scrolling: bool,
    #[serde(default = "default_true", alias = "pixel_scaling")]
    pub pixel_scaling: bool,
    #[serde(default, alias = "story_mode")]
    pub story_mode: bool,
    #[serde(default = "default_true", alias = "bandcamp_embed")]
    pub bandcamp_embed: bool,
    #[serde(default = "default_true", alias = "allow_sys_update_notifs")]
    pub allow_sys_update_notifs: bool,
    #[serde(default, alias = "last_checked_update")]
    pub last_checked_update: String,
    #[serde(default, alias = "dev_mode")]
    pub dev_mode: bool,
    #[serde(default, alias = "enable_hardware_acceleration")]
    pub enable_hardware_acceleration: bool,
    #[serde(default, alias = "use_system_window_decorations")]
    pub use_system_window_decorations: bool,
    #[serde(default = "default_true", alias = "use_tabbed_browsing")]
    pub use_tabbed_browsing: bool,
    #[serde(default = "default_theme", alias = "theme_override")]
    pub theme_override: String,
    #[serde(
        default = "default_theme",
        rename = "themeOverrideUI",
        alias = "themeOverrideUi",
        alias = "theme_override_ui"
    )]
    pub theme_override_ui: String,
    #[serde(default, alias = "force_theme_override")]
    pub force_theme_override: bool,
    #[serde(
        default,
        rename = "forceThemeOverrideUI",
        alias = "forceThemeOverrideUi",
        alias = "force_theme_override_ui"
    )]
    pub force_theme_override_ui: bool,
    #[serde(default, alias = "text_override")]
    pub text_override: TextOverrideSettings,
    #[serde(default = "default_true", alias = "arrow_nav")]
    pub arrow_nav: bool,
    #[serde(default, alias = "open_logs")]
    pub open_logs: bool,
    #[serde(default = "default_true", alias = "hq_audio")]
    pub hq_audio: bool,
    #[serde(default = "default_true", alias = "auto_show_audio_player")]
    pub auto_show_audio_player: bool,
    #[serde(
        default = "default_audio_player_corner",
        deserialize_with = "deserialize_audio_player_corner",
        alias = "audio_player_corner"
    )]
    pub audio_player_corner: String,
    #[serde(default, alias = "audio_player_minimized")]
    pub audio_player_minimized: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_audio_player_width",
        alias = "audio_player_width"
    )]
    pub audio_player_width: Option<u32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_audio_player_height",
        alias = "audio_player_height"
    )]
    pub audio_player_height: Option<u32>,
    #[serde(default = "default_true", alias = "media_expand_button")]
    pub media_expand_button: bool,
    #[serde(default = "default_true", alias = "panel_fill_width")]
    pub panel_fill_width: bool,
    #[serde(default = "default_true", alias = "media_viewer_gestures")]
    pub media_viewer_gestures: bool,
    #[serde(default = "default_true", alias = "swf_auto_landscape")]
    pub swf_auto_landscape: bool,
    #[serde(
        default = "default_master_volume",
        deserialize_with = "deserialize_master_volume",
        alias = "master_volume"
    )]
    pub master_volume: f64,
    #[serde(default, alias = "master_muted")]
    pub master_muted: bool,
    #[serde(default = "default_true", alias = "js_flashes")]
    pub js_flashes: bool,
    #[serde(default, alias = "reduced_motion")]
    pub reduced_motion: bool,
    #[serde(default = "default_true")]
    pub credits: bool,
    #[serde(default, alias = "fast_forward")]
    pub fast_forward: bool,
    #[serde(default = "default_true")]
    pub variant1: bool,
    #[serde(default = "default_true")]
    pub variant2: bool,
    #[serde(default = "default_true")]
    pub variant3: bool,
    #[serde(default = "default_true")]
    pub variant4: bool,
    #[serde(default = "default_true")]
    pub variant5: bool,
    #[serde(default = "default_true")]
    pub variant6: bool,
    #[serde(default, alias = "alt_audio")]
    pub alt_audio: bool,
    #[serde(default, alias = "alt_track_set")]
    pub alt_track_set: bool,
    #[serde(default, alias = "alt_variant")]
    pub alt_variant: bool,
    #[serde(default, alias = "extra_comic_flag")]
    pub extra_comic_flag: bool,
    #[serde(default, alias = "cursed_history")]
    pub cursed_history: bool,
    #[serde(default, alias = "ruffle_fallback")]
    pub ruffle_fallback: bool,
    #[serde(default = "default_true", alias = "enable_discord_rpc")]
    pub enable_discord_rpc: bool,
    #[serde(
        default = "default_discord_client_id",
        skip_serializing_if = "String::is_empty",
        alias = "discord_client_id",
        alias = "discordClientId"
    )]
    pub discord_client_id: String,
    #[serde(default = "default_true", alias = "animations_enabled")]
    pub animations_enabled: bool,
    #[serde(default = "default_animation_fps", alias = "animation_fps")]
    pub animation_fps: String,
    #[serde(default, alias = "animation_categories")]
    pub animation_categories: AnimationCategories,
    #[serde(default, alias = "mod_list_enabled")]
    pub mod_list_enabled: Vec<String>,
    #[serde(default, alias = "virtual_controller")]
    pub virtual_controller: VirtualControllerSettings,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_discord_client_id() -> String {
    String::new()
}

fn default_animation_fps() -> String {
    "native".to_string()
}

fn default_true() -> bool {
    true
}
fn default_master_volume() -> f64 {
    1.0
}
fn clamp_master_volume(val: f64) -> f64 {
    if val.is_nan() {
        1.0
    } else {
        val.clamp(0.0, 1.0)
    }
}
fn deserialize_master_volume<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<f64>::deserialize(deserializer)?;
    Ok(raw
        .map(clamp_master_volume)
        .unwrap_or_else(default_master_volume))
}
fn default_theme() -> String {
    "default".to_string()
}
fn default_audio_player_corner() -> String {
    "bottom-right".to_string()
}
fn deserialize_audio_player_corner<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    let normalized = raw
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .unwrap_or_default();
    match normalized.as_str() {
        "top-left" | "top-right" | "bottom-left" | "bottom-right" => Ok(normalized),
        "left" => Ok("bottom-left".to_string()),
        "right" => Ok("bottom-right".to_string()),
        _ => Ok(default_audio_player_corner()),
    }
}
fn deserialize_optional_clamped_u32<'de, D>(
    deserializer: D,
    min: u32,
    max: u32,
) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<f64>::deserialize(deserializer)?;
    Ok(raw.and_then(|v| {
        if v.is_finite() {
            Some((v.round() as i64).clamp(min as i64, max as i64) as u32)
        } else {
            None
        }
    }))
}
fn deserialize_audio_player_width<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_optional_clamped_u32(deserializer, 204, 520)
}
fn deserialize_audio_player_height<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_optional_clamped_u32(deserializer, 96, 290)
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            reading_progress: ReadingProgressSettings::default(),
            notifications: true,
            sub_notifications: false,
            show_address_bar: true,
            url_tooltip: true,
            switch_to_new_tabs: false,
            force_scroll_bar: true,
            hide_fullscreen_header: false,
            smooth_scrolling: true,
            pixel_scaling: true,
            story_mode: false,
            bandcamp_embed: true,
            allow_sys_update_notifs: true,
            last_checked_update: String::new(),
            dev_mode: false,
            enable_hardware_acceleration: false,
            use_system_window_decorations: false,
            use_tabbed_browsing: true,
            theme_override: default_theme(),
            theme_override_ui: default_theme(),
            force_theme_override: false,
            force_theme_override_ui: false,
            text_override: TextOverrideSettings::default(),
            arrow_nav: true,
            open_logs: false,
            hq_audio: true,
            auto_show_audio_player: true,
            audio_player_corner: default_audio_player_corner(),
            audio_player_minimized: false,
            audio_player_width: None,
            audio_player_height: None,
            media_expand_button: true,
            panel_fill_width: true,
            media_viewer_gestures: true,
            swf_auto_landscape: true,
            master_volume: default_master_volume(),
            master_muted: false,
            js_flashes: true,
            reduced_motion: false,
            credits: true,
            fast_forward: false,
            variant1: true,
            variant2: true,
            variant3: true,
            variant4: true,
            variant5: true,
            variant6: true,
            alt_audio: false,
            alt_track_set: false,
            alt_variant: false,
            extra_comic_flag: false,
            cursed_history: false,
            ruffle_fallback: false,
            enable_discord_rpc: !cfg!(target_os = "android"),
            discord_client_id: default_discord_client_id(),
            animations_enabled: true,
            animation_fps: default_animation_fps(),
            animation_categories: AnimationCategories::default(),
            mod_list_enabled: Vec::new(),
            virtual_controller: VirtualControllerSettings::default(),
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default, rename = "__internal__")]
    pub internal: serde_json::Value,
    #[serde(default, alias = "last_migrated_version")]
    pub last_migrated_version: Option<String>,
    #[serde(default)]
    pub timestamp: Option<u64>,
    #[serde(default, alias = "asset_dir")]
    pub asset_dir: Option<String>,
    #[serde(default, alias = "tab_data")]
    pub tab_data: TabData,
    #[serde(default, alias = "save_data")]
    pub save_data: SaveData,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default = "default_app_version", alias = "app_version")]
    pub app_version: String,
    #[serde(default, alias = "enabled_mods")]
    pub enabled_mods: Option<Vec<String>>,
    #[serde(default, alias = "mod_settings")]
    pub mod_settings: HashMap<String, HashMap<String, serde_json::Value>>,
}

fn default_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn default_asset_dir() -> String {
    if let Ok(env_dir) = std::env::var("RRWR_ASSET_DIR") {
        let p = PathBuf::from(&env_dir);
        if crate::imports::is_asset_pack(&p) {
            return env_dir;
        }
    }

    let mut candidates = Vec::new();
    #[cfg(target_os = "android")]
    {
        candidates.push(PathBuf::from(
            "/sdcard/Android/data/com.rrwr.app/files/Asset Pack",
        ));
        candidates.push(PathBuf::from(
            "/storage/emulated/0/Android/data/com.rrwr.app/files/Asset Pack",
        ));
        candidates.push(PathBuf::from("/sdcard/Asset Pack"));
        candidates.push(PathBuf::from("/storage/emulated/0/Asset Pack"));
        candidates.push(PathBuf::from("/sdcard/Download/Asset Pack"));
        candidates.push(PathBuf::from("/storage/emulated/0/Download/Asset Pack"));
        candidates.push(PathBuf::from("/data/user/0/com.rrwr.app/files/Asset Pack"));
        candidates.push(PathBuf::from("/data/data/com.rrwr.app/files/Asset Pack"));
        candidates.push(PathBuf::from("/data/user/0/com.rrwr.app/Asset Pack"));
        candidates.push(PathBuf::from("/data/data/com.rrwr.app/Asset Pack"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Downloads/Asset Pack"));
        candidates.push(home.join("Asset Pack"));
    }
    let managed_default = dirs::data_local_dir()
        .unwrap_or_else(|| {
            #[cfg(target_os = "android")]
            return PathBuf::from("/sdcard/Android/data/com.rrwr.app/files");
            #[cfg(not(target_os = "android"))]
            PathBuf::from(".")
        })
        .join("rrwr")
        .join("Asset Pack");
    candidates.push(managed_default.clone());
    if let Some(found) = candidates
        .iter()
        .find(|path| crate::imports::is_asset_pack(path))
    {
        return found.to_string_lossy().into_owned();
    }
    #[cfg(target_os = "android")]
    {
        return "/sdcard/Android/data/com.rrwr.app/files/Asset Pack".to_string();
    }
    #[cfg(not(target_os = "android"))]
    managed_default.to_string_lossy().into_owned()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            internal: serde_json::json!({ "migrations": { "version": env!("CARGO_PKG_VERSION") } }),
            last_migrated_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            timestamp: Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            ),
            asset_dir: Some(default_asset_dir()),
            tab_data: TabData::default(),
            save_data: SaveData::default(),
            settings: AppSettings::default(),
            app_version: default_app_version(),
            enabled_mods: Some(Vec::new()),
            mod_settings: HashMap::new(),
        }
    }
}

impl AppConfig {
    pub fn normalize(&mut self) -> bool {
        let mut changed = false;
        let clamped_vol = clamp_master_volume(self.settings.master_volume);
        if (self.settings.master_volume - clamped_vol).abs() > f64::EPSILON
            || self.settings.master_volume.is_nan()
        {
            self.settings.master_volume = clamped_vol;
            changed = true;
        }
        let vc = &mut self.settings.virtual_controller;
        let clamped_opacity = if vc.opacity.is_nan() {
            default_vc_opacity()
        } else {
            vc.opacity.clamp(0.15, 1.0)
        };
        if (vc.opacity - clamped_opacity).abs() > f64::EPSILON || vc.opacity.is_nan() {
            vc.opacity = clamped_opacity;
            changed = true;
        }
        let clamped_scale = if vc.scale.is_nan() {
            default_vc_scale()
        } else {
            vc.scale.clamp(0.5, 1.8)
        };
        if (vc.scale - clamped_scale).abs() > f64::EPSILON || vc.scale.is_nan() {
            vc.scale = clamped_scale;
            changed = true;
        }
        changed
    }

    pub fn config_path() -> PathBuf {
        #[cfg(target_os = "android")]
        {
            let candidates = [
                PathBuf::from("/sdcard/Android/data/com.rrwr.app/files/config.json"),
                PathBuf::from("/storage/emulated/0/Android/data/com.rrwr.app/files/config.json"),
                PathBuf::from("/data/user/0/com.rrwr.app/files/config.json"),
                PathBuf::from("/data/data/com.rrwr.app/files/config.json"),
                PathBuf::from("/data/user/0/com.rrwr.app/rrwr/config.json"),
                PathBuf::from("/data/data/com.rrwr.app/rrwr/config.json"),
            ];
            for c in &candidates {
                if c.exists() {
                    return c.clone();
                }
            }
            let ext_dir = PathBuf::from("/sdcard/Android/data/com.rrwr.app/files");
            if ext_dir.exists() || fs::create_dir_all(&ext_dir).is_ok() {
                return ext_dir.join("config.json");
            }
            return PathBuf::from("/data/user/0/com.rrwr.app/files/config.json");
        }
        #[cfg(not(target_os = "android"))]
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("rrwr")
            .join("config.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if !path.exists() {
            let default_config = Self::default();
            let _ = default_config.save();
            return default_config;
        }

        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                Ok(mut cfg) => {
                    let normalized = cfg.normalize();
                    if cfg.settings.mod_list_enabled.is_empty() {
                        if let Some(ref em) = cfg.enabled_mods {
                            if !em.is_empty() {
                                cfg.settings.mod_list_enabled = em.clone();
                            }
                        }
                    }
                    if cfg.enabled_mods.is_none() {
                        cfg.enabled_mods = Some(cfg.settings.mod_list_enabled.clone());
                    }
                    if normalized {
                        if let Err(e) = cfg.save() {
                            log::warn!("Could not save normalized config: {}", e);
                        }
                    }
                    cfg
                }
                Err(e) => {
                    log::error!("Failed to parse config.json, using defaults: {}", e);
                    Self::default()
                }
            },
            Err(e) => {
                log::error!("Failed to read config.json: {}", e);
                Self::default()
            }
        }
    }

    pub fn save(&self) -> Result<(), std::io::Error> {
        use std::io::Write;
        let path = Self::config_path();
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "Missing parent directory")
        })?;
        fs::create_dir_all(parent)?;

        let mut normalized = self.clone();
        normalized.normalize();
        let json_str = serde_json::to_string_pretty(&normalized)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        if let Ok(mut temp_file) = tempfile::Builder::new()
            .prefix("config-")
            .suffix(".tmp")
            .tempfile_in(parent)
        {
            if temp_file.write_all(json_str.as_bytes()).is_ok()
                && temp_file.flush().is_ok()
                && temp_file.as_file().sync_all().is_ok()
                && temp_file.persist(&path).is_ok()
            {
                return Ok(());
            }
        }

        // Direct write fallback for filesystems where atomic tempfile rename is unsupported
        fs::write(&path, json_str.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults_and_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.settings.mod_list_enabled.push("test-mod".to_string());
        cfg.tab_data.active_tab_key = "001".to_string();

        let json = serde_json::to_string(&cfg).unwrap();
        let loaded: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(loaded.tab_data.active_tab_key, "001");
        assert_eq!(loaded.settings.mod_list_enabled, vec!["test-mod"]);
        assert!(loaded.settings.notifications);
        assert!(loaded.settings.enable_discord_rpc);
        assert_eq!(loaded.app_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn test_enable_discord_rpc_aliases() {
        let json_camel = r#"{"enableDiscordRpc": false}"#;
        let s1: AppSettings = serde_json::from_str(json_camel).unwrap();
        assert!(!s1.enable_discord_rpc);

        let json_snake = r#"{"enable_discord_rpc": false}"#;
        let s2: AppSettings = serde_json::from_str(json_snake).unwrap();
        assert!(!s2.enable_discord_rpc);

        let json_default = r#"{}"#;
        let s3: AppSettings = serde_json::from_str(json_default).unwrap();
        assert!(s3.enable_discord_rpc);
        assert!(s3.discord_client_id.is_empty());

        let json_custom_id = r#"{"discordClientId": "987654321012345678"}"#;
        let s4: AppSettings = serde_json::from_str(json_custom_id).unwrap();
        assert_eq!(s4.discord_client_id, "987654321012345678");
        assert!(serde_json::to_string(&s3)
            .unwrap()
            .contains("enableDiscordRpc"));
        assert!(!serde_json::to_string(&s3)
            .unwrap()
            .contains("discordClientId"));
    }

    #[test]
    fn test_animation_settings_defaults_and_aliases() {
        let s_default = AppSettings::default();
        assert!(s_default.animations_enabled);
        assert_eq!(s_default.animation_fps, "native");
        assert!(s_default.animation_categories.tabs);
        assert!(s_default.animation_categories.menus);
        assert!(s_default.animation_categories.boot_splash);
        assert!(s_default.animation_categories.mod_loading);
        assert!(s_default.animation_categories.reload_icon);
        assert!(s_default.animation_categories.ui_micro);
        assert!(!s_default.animation_categories.page_transitions);

        let legacy_empty: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(legacy_empty.animations_enabled);
        assert_eq!(legacy_empty.animation_fps, "native");
        assert!(legacy_empty.animation_categories.tabs);
        assert!(!legacy_empty.animation_categories.page_transitions);

        let legacy_24fps: AppSettings =
            serde_json::from_str(r#"{"animationFps":"24fps"}"#).unwrap();
        assert_eq!(legacy_24fps.animation_fps, "24fps");

        let json_camel = r#"{
            "animationsEnabled": false,
            "animationFps": "native",
            "animationCategories": {
                "tabs": true,
                "menus": false,
                "bootSplash": false,
                "modLoading": true,
                "reloadIcon": false,
                "uiMicro": false,
                "pageTransitions": true
            }
        }"#;
        let s_camel: AppSettings = serde_json::from_str(json_camel).unwrap();
        assert!(!s_camel.animations_enabled);
        assert_eq!(s_camel.animation_fps, "native");
        assert!(s_camel.animation_categories.tabs);
        assert!(!s_camel.animation_categories.menus);
        assert!(!s_camel.animation_categories.boot_splash);
        assert!(s_camel.animation_categories.mod_loading);
        assert!(!s_camel.animation_categories.reload_icon);
        assert!(!s_camel.animation_categories.ui_micro);
        assert!(s_camel.animation_categories.page_transitions);

        let json_snake = r#"{
            "animations_enabled": false,
            "animation_fps": "native",
            "animation_categories": {
                "tabs": false,
                "menus": true,
                "boot_splash": false,
                "mod_loading": false,
                "reload_icon": true,
                "ui_micro": false,
                "page_transitions": true
            }
        }"#;
        let s_snake: AppSettings = serde_json::from_str(json_snake).unwrap();
        assert!(!s_snake.animations_enabled);
        assert_eq!(s_snake.animation_fps, "native");
        assert!(!s_snake.animation_categories.tabs);
        assert!(s_snake.animation_categories.menus);
        assert!(!s_snake.animation_categories.boot_splash);
        assert!(!s_snake.animation_categories.mod_loading);
        assert!(s_snake.animation_categories.reload_icon);
        assert!(!s_snake.animation_categories.ui_micro);
        assert!(s_snake.animation_categories.page_transitions);
    }

    #[test]
    fn test_animation_settings_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.settings.animations_enabled = false;
        cfg.settings.animation_fps = "native".to_string();
        cfg.settings.animation_categories.tabs = true;
        cfg.settings.animation_categories.menus = false;
        cfg.settings.animation_categories.page_transitions = true;

        let serialized = serde_json::to_string(&cfg).unwrap();
        assert!(serialized.contains("\"animationsEnabled\":false"));
        assert!(serialized.contains("\"animationFps\":\"native\""));
        assert!(serialized.contains("\"animationCategories\""));
        assert!(serialized.contains("\"bootSplash\":true"));
        assert!(serialized.contains("\"pageTransitions\":true"));

        let roundtripped: AppConfig = serde_json::from_str(&serialized).unwrap();
        assert!(!roundtripped.settings.animations_enabled);
        assert_eq!(roundtripped.settings.animation_fps, "native");
        assert_eq!(
            roundtripped.settings.animation_categories,
            cfg.settings.animation_categories
        );
    }

    #[test]
    fn test_master_volume_defaults() {
        let settings = AppSettings::default();
        assert!((settings.master_volume - 1.0).abs() < f64::EPSILON);
        assert!(!settings.master_muted);
    }

    #[test]
    fn test_master_volume_clamping_and_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.settings.master_volume = 1.75;
        cfg.settings.master_muted = true;
        assert!(cfg.normalize());
        assert!((cfg.settings.master_volume - 1.0).abs() < f64::EPSILON);

        cfg.settings.master_volume = -0.35;
        assert!(cfg.normalize());
        assert!((cfg.settings.master_volume - 0.0).abs() < f64::EPSILON);

        cfg.settings.master_volume = 0.42;
        assert!(!cfg.normalize());
        let serialized = serde_json::to_string(&cfg).unwrap();
        assert!(serialized.contains("\"masterVolume\":0.42"));
        assert!(serialized.contains("\"masterMuted\":true"));

        let roundtripped: AppConfig = serde_json::from_str(&serialized).unwrap();
        assert!((roundtripped.settings.master_volume - 0.42).abs() < f64::EPSILON);
        assert!(roundtripped.settings.master_muted);
    }

    #[test]
    fn test_master_volume_camel_and_snake_case_deserialization() {
        let camel_json = r#"{"masterVolume": 0.35, "masterMuted": true}"#;
        let camel_settings: AppSettings = serde_json::from_str(camel_json).unwrap();
        assert!((camel_settings.master_volume - 0.35).abs() < f64::EPSILON);
        assert!(camel_settings.master_muted);

        let snake_json = r#"{"master_volume": 0.65, "master_muted": false}"#;
        let snake_settings: AppSettings = serde_json::from_str(snake_json).unwrap();
        assert!((snake_settings.master_volume - 0.65).abs() < f64::EPSILON);
        assert!(!snake_settings.master_muted);

        let clamped_json = r#"{"master_volume": 2.5, "masterMuted": false}"#;
        let clamped_settings: AppSettings = serde_json::from_str(clamped_json).unwrap();
        assert!((clamped_settings.master_volume - 1.0).abs() < f64::EPSILON);

        let neg_json = r#"{"masterVolume": -0.8}"#;
        let neg_settings: AppSettings = serde_json::from_str(neg_json).unwrap();
        assert!((neg_settings.master_volume - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_audio_player_size_defaults_aliases_and_clamping() {
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(legacy.audio_player_width, None);
        assert_eq!(legacy.audio_player_height, None);

        let camel: AppSettings =
            serde_json::from_str(r#"{"audioPlayerWidth": 420, "audioPlayerHeight": 230}"#).unwrap();
        assert_eq!(camel.audio_player_width, Some(420));
        assert_eq!(camel.audio_player_height, Some(230));

        let snake_clamped: AppSettings =
            serde_json::from_str(r#"{"audio_player_width": 999, "audio_player_height": 12}"#)
                .unwrap();
        assert_eq!(snake_clamped.audio_player_width, Some(520));
        assert_eq!(snake_clamped.audio_player_height, Some(96));
    }
}
