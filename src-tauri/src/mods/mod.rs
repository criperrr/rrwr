pub mod parser;
pub mod patcher;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::config::AppConfig;
use crate::data::story::{FootnoteItem, StoryPagePatch};
use crate::data::ArchiveStore;
use crate::server::vfs::{ActiveModDescriptor, Vfs};
pub use parser::{
    evaluate_log_button_text as evaluate_log_button_text_fn, ModStyleDescriptor,
    ModThemeDescriptor, VueHookDescriptor,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModMetadata {
    pub id: String,
    pub title: String,
    pub author: String,
    pub version: f64,
    pub description: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<String>,
    #[serde(default)]
    pub has_trees: bool,
    #[serde(default)]
    pub has_edit: bool,
    #[serde(default)]
    pub has_hooks: bool,
    #[serde(default)]
    pub vue_hooks: Vec<VueHookDescriptor>,
    #[serde(default)]
    pub styles: Vec<ModStyleDescriptor>,
    #[serde(default)]
    pub themes: Vec<ModThemeDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footnotes_raw: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
}

#[derive(Clone)]
struct ModEntry {
    meta: ModMetadata,
    root_dir: PathBuf,
    mod_js_path: PathBuf,
    is_singlefile: bool,
    raw_code: String,
    trees: HashMap<String, String>,
    routes: HashMap<String, String>,
    translation_files: Vec<String>,
}

pub struct ModRegistry {
    mods_dir: PathBuf,
    mods: Vec<ModEntry>,
    enabled_order: Vec<String>,
}

impl ModRegistry {
    pub fn load_from_dir(asset_dir: &Path, enabled_list: &[String]) -> Self {
        let mods_dir = asset_dir.join("mods");
        let effective_enabled = enabled_list.to_vec();
        let mut registry = Self {
            mods_dir,
            mods: Vec::new(),
            enabled_order: effective_enabled.clone(),
        };
        registry.rescan(&effective_enabled);
        registry
    }

    pub fn reload_from_dir(&mut self, asset_dir: &Path, enabled_list: &[String]) {
        self.mods_dir = asset_dir.join("mods");
        let effective_enabled = enabled_list.to_vec();
        self.rescan(&effective_enabled);
    }

    pub fn rescan(&mut self, enabled_list: &[String]) {
        self.enabled_order = enabled_list.to_vec();
        self.mods.clear();
        if !self.mods_dir.is_dir() {
            return;
        }

        if let Ok(entries) = std::fs::read_dir(&self.mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let id = entry.file_name().to_string_lossy().to_string();
                    let mod_js = path.join("mod.js");
                    if mod_js.is_file() {
                        if let Some(parsed) = parser::parse_mod_js(&mod_js) {
                            self.register_parsed_mod(id, path, mod_js, false, parsed, enabled_list);
                        }
                    } else if let Some(alt_js) = Self::find_subdir_mod_js(&path, &id) {
                        if let Some(parsed) = parser::parse_mod_js(&alt_js) {
                            self.register_parsed_mod(id, path, alt_js, false, parsed, enabled_list);
                        }
                    } else if let Ok(sub_entries) = std::fs::read_dir(&path) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.is_dir() {
                                let sub_id = sub_entry.file_name().to_string_lossy().to_string();
                                if sub_id.starts_with('.') {
                                    continue;
                                }
                                let sub_mod_js = sub_path.join("mod.js");
                                if sub_mod_js.is_file() {
                                    if let Some(parsed) = parser::parse_mod_js(&sub_mod_js) {
                                        self.register_parsed_mod(
                                            sub_id,
                                            sub_path,
                                            sub_mod_js,
                                            false,
                                            parsed,
                                            enabled_list,
                                        );
                                    }
                                } else if let Some(alt_sub_js) =
                                    Self::find_subdir_mod_js(&sub_path, &sub_id)
                                {
                                    if let Some(parsed) = parser::parse_mod_js(&alt_sub_js) {
                                        self.register_parsed_mod(
                                            sub_id,
                                            sub_path,
                                            alt_sub_js,
                                            false,
                                            parsed,
                                            enabled_list,
                                        );
                                    }
                                }
                            }
                        }
                    }
                } else if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("js")
                {
                    let id = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if !id.is_empty() {
                        if let Some(parsed) = parser::parse_mod_js(&path) {
                            let root = path
                                .parent()
                                .map(PathBuf::from)
                                .unwrap_or_else(|| self.mods_dir.clone());
                            self.register_parsed_mod(id, root, path, true, parsed, enabled_list);
                        }
                    }
                }
            }
        }
    }

    fn find_subdir_mod_js(dir: &Path, dir_name: &str) -> Option<PathBuf> {
        let norm_dir: String = dir_name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect();
        let entries = std::fs::read_dir(dir).ok()?;
        let mut js_files = Vec::new();
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("js") {
                js_files.push(p);
            }
        }
        if let Some(matched) = js_files.iter().find(|p| {
            p.file_stem()
                .map(|s| {
                    let norm_stem: String = s
                        .to_string_lossy()
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric())
                        .flat_map(|c| c.to_lowercase())
                        .collect();
                    norm_stem == norm_dir
                })
                .unwrap_or(false)
        }) {
            return Some(matched.clone());
        }
        if js_files.len() == 1 {
            return js_files.into_iter().next();
        }
        None
    }

    fn register_parsed_mod(
        &mut self,
        id: String,
        root_dir: PathBuf,
        mod_js_path: PathBuf,
        is_singlefile: bool,
        parsed: parser::ParsedModInfo,
        enabled_list: &[String],
    ) {
        let enabled = enabled_list.iter().any(|e| {
            e == &id
                || e.eq_ignore_ascii_case(&id)
                || e.replace('_', " ").eq_ignore_ascii_case(&id)
                || e.replace(' ', "_").eq_ignore_ascii_case(&id)
        });
        let has_trees = !parsed.trees.is_empty();
        let has_hooks = !parsed.vue_hooks.is_empty();
        let has_edit = parsed.edit
            || !parsed.translation_files.is_empty()
            || root_dir.join("translation2.json").is_file();
        let desc = parsed
            .description
            .clone()
            .or_else(|| parsed.summary.clone())
            .unwrap_or_else(|| format!("{} mod", parsed.title));

        let meta = ModMetadata {
            id: id.clone(),
            title: parsed.title,
            author: parsed
                .author
                .unwrap_or_else(|| "Unknown Author".to_string()),
            version: parsed.version,
            description: desc,
            summary: parsed.summary,
            enabled,
            locked: parsed.locked,
            has_trees,
            has_edit,
            has_hooks,
            vue_hooks: parsed.vue_hooks,
            styles: parsed.styles,
            themes: parsed.themes,
            footnotes_raw: parsed.footnotes_raw,
            settings: parsed.settings,
        };

        self.mods.push(ModEntry {
            meta,
            root_dir,
            mod_js_path,
            is_singlefile,
            raw_code: parsed.raw_code,
            trees: parsed.trees,
            routes: parsed.routes,
            translation_files: parsed.translation_files,
        });
    }

    pub fn get_available_mods(&self) -> Vec<ModMetadata> {
        self.mods.iter().map(|m| m.meta.clone()).collect()
    }

    pub fn is_enabled(&self, mod_id: &str) -> bool {
        self.mods
            .iter()
            .any(|m| m.meta.id == mod_id && m.meta.enabled)
    }

    pub fn toggle_mod(&mut self, mod_id: &str, enabled: bool) -> Result<bool, String> {
        if let Some(m) = self.mods.iter_mut().find(|m| {
            m.meta.id == mod_id
                || m.meta.id.eq_ignore_ascii_case(mod_id)
                || m.meta.id.replace('_', " ").eq_ignore_ascii_case(mod_id)
                || m.meta.id.replace(' ', "_").eq_ignore_ascii_case(mod_id)
        }) {
            let actual_id = m.meta.id.clone();
            m.meta.enabled = enabled;
            if enabled {
                if !self.enabled_order.iter().any(|id| id == &actual_id) {
                    self.enabled_order.push(actual_id);
                }
            } else {
                self.enabled_order.retain(|id| id != &actual_id);
            }
            Ok(enabled)
        } else {
            Err(format!("Unknown mod '{}'", mod_id))
        }
    }

    fn sorted_active_mods(&self) -> Vec<&ModEntry> {
        let mut active: Vec<&ModEntry> = self.mods.iter().filter(|m| m.meta.enabled).collect();
        active.sort_by_key(|m| {
            self.enabled_order
                .iter()
                .position(|id| id == &m.meta.id)
                .unwrap_or(usize::MAX)
        });
        active
    }

    pub fn get_enabled_mod_ids(&self) -> Vec<String> {
        self.sorted_active_mods()
            .iter()
            .map(|m| m.meta.id.clone())
            .collect()
    }

    pub fn get_active_descriptors(&self) -> Vec<ActiveModDescriptor> {
        self.sorted_active_mods()
            .iter()
            .map(|m| ActiveModDescriptor {
                id: m.meta.id.clone(),
                root_dir: m.root_dir.clone(),
                trees: m.trees.clone(),
                routes: m.routes.clone(),
            })
            .collect()
    }

    pub fn get_all_descriptors(&self) -> Vec<ActiveModDescriptor> {
        self.mods
            .iter()
            .map(|m| ActiveModDescriptor {
                id: m.meta.id.clone(),
                root_dir: m.root_dir.clone(),
                trees: m.trees.clone(),
                routes: m.routes.clone(),
            })
            .collect()
    }

    pub fn update_dynamic_routes(
        &mut self,
        dynamic_routes: &HashMap<String, HashMap<String, String>>,
    ) -> bool {
        let mut changed = false;
        for (mod_id, routes_map) in dynamic_routes {
            if let Some(m) = self.mods.iter_mut().find(|m| {
                &m.meta.id == mod_id
                    || m.meta.id.eq_ignore_ascii_case(mod_id)
                    || m.meta.id.replace('_', " ").eq_ignore_ascii_case(mod_id)
                    || m.meta.id.replace(' ', "_").eq_ignore_ascii_case(mod_id)
            }) {
                for (k, v) in routes_map {
                    if m.routes.get(k) != Some(v) {
                        m.routes.insert(k.clone(), v.clone());
                        changed = true;
                    }
                }
            }
        }
        changed
    }

    pub fn get_active_vue_hooks(&self) -> Vec<VueHookDescriptor> {
        self.sorted_active_mods()
            .iter()
            .flat_map(|m| m.meta.vue_hooks.clone())
            .collect()
    }

    pub fn has_active_page_text_hooks(&self) -> bool {
        self.mods.iter().filter(|m| m.meta.enabled).any(|m| {
            m.meta
                .vue_hooks
                .iter()
                .any(|h| h.match_name == "pageText" && h.log_button_open_prefix.is_some())
        })
    }

    pub fn evaluate_log_button_text(&self, content: &str, log_hidden: bool) -> String {
        let active = self.has_active_page_text_hooks();
        evaluate_log_button_text_fn(content, log_hidden, active)
    }

    pub fn load_active_patches(&self) -> HashMap<String, StoryPagePatch> {
        let mut combined: HashMap<String, StoryPagePatch> = HashMap::new();
        // Load in reverse order so higher-priority (earlier in enabled_order) overrides lower-priority
        for m in self.sorted_active_mods().into_iter().rev() {
            let mut files_to_load = m.translation_files.clone();
            if files_to_load.is_empty() {
                let default_tp = m.root_dir.join("translation2.json");
                if default_tp.is_file() {
                    files_to_load.push("translation2.json".to_string());
                }
            }

            for file in files_to_load {
                let p = m.root_dir.join(file);
                if p.is_file() {
                    if let Ok(patches) = patcher::load_translation_patches(&p) {
                        for (key, patch) in patches {
                            if let Some(existing) = combined.get_mut(&key) {
                                existing.merge(&patch);
                            } else {
                                combined.insert(key, patch);
                            }
                        }
                    }
                }
            }
        }
        combined
    }

    fn find_mod(&self, mod_id: &str) -> Option<&ModEntry> {
        self.mods.iter().find(|m| {
            m.meta.id == mod_id
                || m.meta.id.eq_ignore_ascii_case(mod_id)
                || m.meta.id.replace('_', " ").eq_ignore_ascii_case(mod_id)
                || m.meta.id.replace(' ', "_").eq_ignore_ascii_case(mod_id)
        })
    }

    pub fn read_mod_file(&self, mod_id: &str, rel_path: &str) -> Result<serde_json::Value, String> {
        let m = self
            .find_mod(mod_id)
            .ok_or_else(|| format!("Unknown mod '{}'", mod_id))?;

        let trimmed = rel_path.trim().trim_start_matches("./");
        let clean = Vfs::sanitize_path(trimmed)
            .ok_or_else(|| format!("Invalid or unsafe mod file path '{}'", rel_path))?;

        let target_path = if m.is_singlefile && clean == "mod.js" {
            m.mod_js_path.clone()
        } else {
            let candidate = m.root_dir.join(&clean);
            if !candidate.starts_with(&m.root_dir) {
                return Err(format!("Path traversal blocked for '{}'", rel_path));
            }
            candidate
        };

        if !target_path.is_file() {
            return Err(format!("Mod file '{}' not found", clean));
        }

        let raw = std::fs::read_to_string(&target_path)
            .map_err(|e| format!("Failed to read mod file '{}': {}", clean, e))?;

        let lower = clean.to_lowercase();
        if lower.ends_with(".json") {
            let parsed: serde_json::Value = serde_json::from_str(&raw)
                .map_err(|e| format!("Invalid JSON in '{}': {}", clean, e))?;
            let content_field = if raw.len() > 262_144 {
                String::new()
            } else {
                raw
            };
            Ok(serde_json::json!({
                "content": content_field,
                "json": parsed,
                "format": "json"
            }))
        } else if lower.ends_with(".yaml") || lower.ends_with(".yml") {
            let parsed = parse_simple_yaml(&raw);
            let content_field = if raw.len() > 262_144 {
                String::new()
            } else {
                raw
            };
            Ok(serde_json::json!({
                "content": content_field,
                "json": parsed,
                "format": "yaml"
            }))
        } else {
            Ok(serde_json::json!({
                "content": raw,
                "format": "text"
            }))
        }
    }

    pub fn load_static_footnotes(&self) -> HashMap<String, Vec<FootnoteItem>> {
        let mut combined: HashMap<String, Vec<FootnoteItem>> = HashMap::new();
        for m in self.sorted_active_mods().into_iter().rev() {
            if let Some(ref fn_rel) = m.meta.footnotes_raw {
                if let Some(clean) = Vfs::sanitize_path(fn_rel.trim_start_matches("./")) {
                    let p = m.root_dir.join(clean);
                    if p.is_file() {
                        if let Ok(content) = std::fs::read_to_string(&p) {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                extract_footnotes_from_value(&val, &mut combined);
                            }
                        }
                    }
                }
            }
        }
        combined
    }

    pub async fn get_active_mod_bundle(
        &self,
        config: &AppConfig,
        store: &ArchiveStore,
        vfs_gen: u64,
    ) -> serde_json::Value {
        let mut active_mods_list = Vec::new();

        // Keep priority order (index 0 = highest priority, end = lowest priority)
        // so frontend loadActiveMods (which iterates from end to 0) runs highest priority last
        for m in self.sorted_active_mods() {
            let mut resolved_styles = Vec::new();
            for style in &m.meta.styles {
                let mut body = style.body.clone();
                if body.is_none() {
                    if let Some(ref src) = style.source {
                        if let Some(clean) = Vfs::sanitize_path(src.trim_start_matches("./")) {
                            let p = m.root_dir.join(clean);
                            if let Ok(css) = std::fs::read_to_string(&p) {
                                body = Some(css);
                            }
                        }
                    }
                }
                let compiled_body = body
                    .map(|raw_css| compile_scss_to_css(&raw_css, None))
                    .unwrap_or_default();
                resolved_styles.push(serde_json::json!({
                    "source": style.source,
                    "body": compiled_body,
                }));
            }

            let sanitized_mod_id: String = m
                .meta
                .id
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();

            let mut resolved_themes = Vec::new();
            for (idx, theme) in m.meta.themes.iter().enumerate() {
                let theme_class = if theme.value.trim().is_empty() {
                    format!("theme-{}-{}", sanitized_mod_id, idx)
                } else {
                    theme.value.clone()
                };
                let mut css_body = String::new();
                if let Some(clean) = Vfs::sanitize_path(theme.source.trim_start_matches("./")) {
                    let p = m.root_dir.join(clean);
                    if let Ok(raw_css) = std::fs::read_to_string(&p) {
                        css_body = scope_theme_css(&raw_css, &theme_class);
                    }
                }
                resolved_themes.push(serde_json::json!({
                    "id": theme_class,
                    "label": theme.label,
                    "source": theme.source,
                    "value": theme_class,
                    "css": css_body,
                    "body": css_body,
                }));
            }

            let mod_settings_entry = config
                .mod_settings
                .get(&m.meta.id)
                .cloned()
                .unwrap_or_default();

            active_mods_list.push(serde_json::json!({
                "id": m.meta.id,
                "title": m.meta.title,
                "author": m.meta.author,
                "version": m.meta.version,
                "description": m.meta.description,
                "summary": m.meta.summary,
                "locked": m.meta.locked,
                "hasTrees": m.meta.has_trees,
                "hasEdit": m.meta.has_edit,
                "hasHooks": m.meta.has_hooks,
                "vueHooks": m.meta.vue_hooks,
                "styles": resolved_styles,
                "themes": resolved_themes,
                "footnotesRaw": m.meta.footnotes_raw,
                "settings": m.meta.settings,
                "storeSettings": mod_settings_entry,
                "storeData": mod_settings_entry,
                "rawCode": m.raw_code,
            }));
        }

        let static_footnotes = self.load_static_footnotes();
        let mut footnotes = static_footnotes.clone();
        let dynamic_footnotes = store.story.get_all_footnotes().await;
        for (page_id, notes) in dynamic_footnotes {
            let entry = footnotes.entry(page_id).or_default();
            for n in notes {
                if !entry.contains(&n) {
                    entry.push(n);
                }
            }
        }

        let fancomics = store.story.get_fancomics().await;
        let mod_home_row_items = store.story.get_mod_home_row_items().await;

        serde_json::json!({
            "mods": active_mods_list,
            "vueHooks": self.get_active_vue_hooks(),
            "staticFootnotes": static_footnotes,
            "footnotes": footnotes,
            "fancomics": fancomics,
            "modHomeRowItems": mod_home_row_items,
            "modSettings": config.mod_settings,
            "overlayGeneration": vfs_gen,
            "overlay_generation": vfs_gen,
        })
    }
}

fn scope_theme_css(raw_css: &str, theme_class: &str) -> String {
    let cls = if theme_class.starts_with("theme-") {
        theme_class.to_string()
    } else {
        format!("theme-{}", theme_class)
    };
    let scope_prefix = format!("#app.{}", cls);
    if raw_css.contains(&scope_prefix) {
        return compile_scss_to_css(raw_css, None);
    }
    compile_scss_to_css(raw_css, Some(&scope_prefix))
}

#[derive(Default)]
struct ScssBlock {
    declarations: Vec<String>,
    children: Vec<(String, ScssBlock)>,
}

fn compile_scss_to_css(raw_scss: &str, scope_prefix: Option<&str>) -> String {
    let cleaned = strip_scss_comments_and_vue_attrs(raw_scss);
    let mut vars: Vec<(String, String)> = Vec::new();
    let root = parse_scss_block(&cleaned, &mut vars);
    // Sort variables longest-name-first so $border-width replaces before $border
    vars.sort_by_key(|a| std::cmp::Reverse(a.0.len()));

    let mut top_level_at_rules: Vec<String> = Vec::new();
    let mut rules_out: Vec<String> = Vec::new();

    let initial_parents: Vec<String> = match scope_prefix {
        Some(prefix) if !prefix.trim().is_empty() => vec![prefix.trim().to_string()],
        _ => Vec::new(),
    };

    emit_scss_block(
        &root,
        &initial_parents,
        &vars,
        &mut top_level_at_rules,
        &mut rules_out,
    );

    let mut final_css = String::new();
    for at_rule in top_level_at_rules {
        final_css.push_str(&at_rule);
        final_css.push('\n');
    }
    for rule in rules_out {
        final_css.push_str(&rule);
        final_css.push('\n');
    }
    final_css.trim().to_string()
}

fn strip_scss_comments_and_vue_attrs(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut out = String::with_capacity(len);
    let mut i = 0;
    let mut in_single = false;
    let mut in_double = false;

    while i < len {
        let c = chars[i];
        if c == '\\' && (in_single || in_double) && i + 1 < len {
            out.push(c);
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            out.push(c);
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            out.push(c);
            i += 1;
            continue;
        }

        if !in_single && !in_double {
            // Block comment /* ... */
            if c == '/' && i + 1 < len && chars[i + 1] == '*' {
                i += 2;
                while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
                continue;
            }
            // Line comment // ... (avoiding :// in URLs)
            if c == '/' && i + 1 < len && chars[i + 1] == '/' && (i == 0 || chars[i - 1] != ':') {
                while i < len && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            // Strip Vue 2 scoped attributes like [data-v-516a5a60]
            if c == '[' && i + 8 < len {
                let rest: String = chars[i..std::cmp::min(len, i + 24)].iter().collect();
                if let Some(after_prefix) = rest.strip_prefix("[data-v-") {
                    if let Some(close_pos) = after_prefix.find(']') {
                        if after_prefix[..close_pos]
                            .chars()
                            .all(|ch| ch.is_ascii_hexdigit() || ch == '-')
                        {
                            i += 8 + close_pos + 1;
                            continue;
                        }
                    }
                }
            }
            // Strip trailing comma right before closing paren: `, )` or `,)` -> `)`
            if c == ',' {
                let mut look = i + 1;
                while look < len && chars[look].is_whitespace() {
                    look += 1;
                }
                if look < len && chars[look] == ')' {
                    i = look;
                    continue;
                }
            }
        }

        out.push(c);
        i += 1;
    }

    out
}

fn parse_scss_block(body: &str, vars: &mut Vec<(String, String)>) -> ScssBlock {
    let mut block = ScssBlock::default();
    let chars: Vec<char> = body.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut token = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut paren_depth: i32 = 0;

    while i < len {
        let c = chars[i];
        if c == '\\' && (in_single || in_double) && i + 1 < len {
            token.push(c);
            token.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            token.push(c);
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            token.push(c);
            i += 1;
            continue;
        }
        if !in_single && !in_double {
            if c == '(' {
                paren_depth += 1;
            } else if c == ')' && paren_depth > 0 {
                paren_depth -= 1;
            } else if c == ';' && paren_depth == 0 {
                let decl = token.trim().to_string();
                token.clear();
                if !decl.is_empty() {
                    if let Some(rest) = decl.strip_prefix('$') {
                        if let Some((var_name, var_val)) = rest.split_once(':') {
                            vars.push((
                                format!("${}", var_name.trim()),
                                var_val.trim().to_string(),
                            ));
                        }
                    } else {
                        block.declarations.push(decl);
                    }
                }
                i += 1;
                continue;
            } else if c == '{' && paren_depth == 0 {
                let selector = token.trim().to_string();
                token.clear();
                i += 1;
                let start_inner = i;
                let mut brace_depth = 1;
                let mut inner_single = false;
                let mut inner_double = false;
                while i < len && brace_depth > 0 {
                    let ic = chars[i];
                    if ic == '\\' && (inner_single || inner_double) && i + 1 < len {
                        i += 2;
                        continue;
                    }
                    if ic == '\'' && !inner_double {
                        inner_single = !inner_single;
                    } else if ic == '"' && !inner_single {
                        inner_double = !inner_double;
                    } else if !inner_single && !inner_double {
                        if ic == '{' {
                            brace_depth += 1;
                        } else if ic == '}' {
                            brace_depth -= 1;
                        }
                    }
                    i += 1;
                }
                let end_inner = if brace_depth == 0 { i - 1 } else { i };
                let inner_str: String = chars[start_inner..end_inner].iter().collect();
                let child_block = parse_scss_block(&inner_str, vars);
                if !selector.is_empty() {
                    block.children.push((selector, child_block));
                }
                continue;
            }
        }
        token.push(c);
        i += 1;
    }

    let trailing = token.trim().to_string();
    if !trailing.is_empty() && trailing.contains(':') {
        if let Some(rest) = trailing.strip_prefix('$') {
            if let Some((var_name, var_val)) = rest.split_once(':') {
                vars.push((format!("${}", var_name.trim()), var_val.trim().to_string()));
            }
        } else {
            block.declarations.push(trailing);
        }
    }

    block
}

fn emit_scss_block(
    block: &ScssBlock,
    parents: &[String],
    vars: &[(String, String)],
    top_level_at_rules: &mut Vec<String>,
    rules_out: &mut Vec<String>,
) {
    if !block.declarations.is_empty() {
        let mut rendered_decls = Vec::with_capacity(block.declarations.len());
        for d in &block.declarations {
            let mut resolved = d.clone();
            for (k, v) in vars {
                if resolved.contains(k) {
                    resolved = resolved.replace(k, v);
                }
            }
            rendered_decls.push(format!("  {};", resolved));
        }
        let sel = if parents.is_empty() {
            ":root".to_string()
        } else {
            parents.join(", ")
        };
        rules_out.push(format!("{} {{\n{}\n}}", sel, rendered_decls.join("\n")));
    }

    for (raw_sel, child) in &block.children {
        let sel_trimmed = raw_sel.trim();
        let lower_sel = sel_trimmed.to_lowercase();
        if lower_sel.starts_with("@font-face") || lower_sel.starts_with("@keyframes") {
            let mut inner_rules = Vec::new();
            emit_scss_block(child, &[], vars, top_level_at_rules, &mut inner_rules);
            if !child.declarations.is_empty() && child.children.is_empty() {
                let mut rendered_decls = Vec::new();
                for d in &child.declarations {
                    let mut resolved = d.clone();
                    for (k, v) in vars {
                        if resolved.contains(k) {
                            resolved = resolved.replace(k, v);
                        }
                    }
                    rendered_decls.push(format!("  {};", resolved));
                }
                top_level_at_rules.push(format!(
                    "{} {{\n{}\n}}",
                    sel_trimmed,
                    rendered_decls.join("\n")
                ));
            }
            continue;
        }

        let combined_parents = combine_scss_selectors(parents, sel_trimmed);
        emit_scss_block(
            child,
            &combined_parents,
            vars,
            top_level_at_rules,
            rules_out,
        );
    }
}

fn normalize_legacy_selector_part(sel: &str) -> String {
    let mut s = sel.trim().to_string();
    if s.contains("#tabSection") {
        s = s.replace("#tabSection", "#tab-bar.tabSection");
    }
    if s.contains("#tabBar") {
        s = s.replace("#tabBar", "#address-bar.tabBar");
    }
    s
}

fn combine_scss_selectors(parents: &[String], child_raw: &str) -> Vec<String> {
    let child_parts: Vec<String> = child_raw
        .split(',')
        .map(normalize_legacy_selector_part)
        .filter(|s| !s.is_empty())
        .collect();

    if parents.is_empty() {
        return child_parts
            .into_iter()
            .map(|c| {
                if let Some(stripped) = c.strip_prefix('&') {
                    stripped.trim().to_string()
                } else {
                    c
                }
            })
            .filter(|s| !s.is_empty())
            .collect();
    }

    let mut out = Vec::new();
    for p in parents {
        for c in &child_parts {
            let combined = if c.contains('&') {
                if p.starts_with("#app") && c.starts_with("&#app") {
                    c.replacen("&#app", p, 1)
                } else {
                    c.replace('&', p)
                }
            } else if p.starts_with("#app")
                && (c == "#app" || c.starts_with("#app.") || c.starts_with("#app "))
            {
                c.replacen("#app", p, 1)
            } else {
                format!("{} {}", p, c)
            };
            if !out.contains(&combined) {
                out.push(combined);
            }
        }
    }
    out
}

fn extract_footnotes_from_value(
    val: &serde_json::Value,
    target: &mut HashMap<String, Vec<FootnoteItem>>,
) {
    if let Some(arr) = val.as_array() {
        for item in arr {
            extract_footnotes_from_value(item, target);
        }
        return;
    }

    if let Some(obj) = val.as_object() {
        let default_author = obj
            .get("author")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let default_class = obj
            .get("class")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let is_preface = obj
            .get("preface")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if let Some(story_obj) = obj.get("story").and_then(|v| v.as_object()) {
            for (page_id, notes_val) in story_obj {
                parse_page_footnotes_list(
                    page_id,
                    notes_val,
                    default_author.as_deref(),
                    default_class.as_deref(),
                    is_preface,
                    target,
                );
            }
        } else {
            for (key, notes_val) in obj {
                if key == "author" || key == "class" || key == "preface" {
                    continue;
                }
                if notes_val.is_array() {
                    parse_page_footnotes_list(
                        key,
                        notes_val,
                        default_author.as_deref(),
                        default_class.as_deref(),
                        is_preface,
                        target,
                    );
                }
            }
        }
    }
}

fn parse_page_footnotes_list(
    page_id: &str,
    notes_val: &serde_json::Value,
    default_author: Option<&str>,
    default_class: Option<&str>,
    default_preface: bool,
    target: &mut HashMap<String, Vec<FootnoteItem>>,
) {
    if let Some(arr) = notes_val.as_array() {
        let canonical = if let Ok(num) = page_id.trim().parse::<u32>() {
            format!("{:06}", num)
        } else {
            page_id.to_string()
        };
        let entry = target.entry(canonical).or_default();
        for item in arr {
            if let Some(item_obj) = item.as_object() {
                if let Some(content) = item_obj.get("content").and_then(|v| v.as_str()) {
                    let author = item_obj
                        .get("author")
                        .and_then(|v| v.as_str())
                        .or(default_author)
                        .map(|s| s.to_string());
                    let class = item_obj
                        .get("class")
                        .and_then(|v| v.as_str())
                        .or(default_class)
                        .map(|s| s.to_string());
                    let preface = item_obj
                        .get("preface")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(default_preface);
                    let note = FootnoteItem {
                        content: content.to_string(),
                        author,
                        class,
                        preface,
                    };
                    if !entry.contains(&note) {
                        entry.push(note);
                    }
                }
            } else if let Some(s) = item.as_str() {
                let note = FootnoteItem {
                    content: s.to_string(),
                    author: default_author.map(|a| a.to_string()),
                    class: default_class.map(|c| c.to_string()),
                    preface: default_preface,
                };
                if !entry.contains(&note) {
                    entry.push(note);
                }
            }
        }
    }
}

fn parse_simple_yaml(raw: &str) -> serde_json::Value {
    let trimmed = raw.trim();
    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return json_val;
    }

    let lines: Vec<&str> = raw.lines().collect();
    let mut idx = 0;
    yaml_skip_ignorable(&lines, &mut idx);
    if idx >= lines.len() {
        return serde_json::Value::Object(serde_json::Map::new());
    }
    let first_indent = yaml_line_indent(lines[idx]);
    parse_yaml_node(&lines, &mut idx, first_indent)
}

fn yaml_line_indent(line: &str) -> usize {
    line.chars().take_while(|&c| c == ' ').count()
}

fn yaml_is_ignorable(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#') || t == "---" || t == "..."
}

fn yaml_skip_ignorable(lines: &[&str], idx: &mut usize) {
    while *idx < lines.len() && yaml_is_ignorable(lines[*idx]) {
        *idx += 1;
    }
}

fn split_yaml_key_val(trimmed: &str) -> Option<(String, String)> {
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    if len == 0 {
        return None;
    }
    if chars[0] == '"' || chars[0] == '\'' {
        let quote = chars[0];
        let mut i = 1;
        while i < len {
            if chars[i] == '\\' && quote == '"' && i + 1 < len {
                i += 2;
                continue;
            }
            if chars[i] == quote {
                i += 1;
                break;
            }
            i += 1;
        }
        let rest: String = chars[i..].iter().collect();
        let rest_trimmed = rest.trim_start();
        if let Some(after_colon) = rest_trimmed.strip_prefix(':') {
            if after_colon.is_empty() || after_colon.starts_with(char::is_whitespace) {
                let key: String = chars[1..i.saturating_sub(1)].iter().collect();
                return Some((key, after_colon.trim().to_string()));
            }
        }
        return None;
    }

    for i in 0..len {
        if chars[i] == ':' && (i + 1 == len || chars[i + 1].is_whitespace()) {
            let key: String = chars[..i].iter().collect();
            let val: String = chars[i + 1..].iter().collect();
            return Some((key.trim().to_string(), val.trim().to_string()));
        }
    }
    None
}

fn parse_yaml_node(lines: &[&str], idx: &mut usize, min_indent: usize) -> serde_json::Value {
    yaml_skip_ignorable(lines, idx);
    if *idx >= lines.len() {
        return serde_json::Value::Null;
    }
    let indent = yaml_line_indent(lines[*idx]);
    if indent < min_indent {
        return serde_json::Value::Null;
    }
    let trimmed = lines[*idx].trim_start();
    if trimmed == "-" || trimmed.starts_with("- ") {
        parse_yaml_seq(lines, idx, indent)
    } else {
        parse_yaml_map(lines, idx, indent)
    }
}

fn parse_yaml_map(lines: &[&str], idx: &mut usize, base_indent: usize) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    while *idx < lines.len() {
        yaml_skip_ignorable(lines, idx);
        if *idx >= lines.len() {
            break;
        }
        let line = lines[*idx];
        let indent = yaml_line_indent(line);
        let trimmed = line.trim_start();
        if indent < base_indent || trimmed == "-" || trimmed.starts_with("- ") {
            break;
        }
        if let Some((key, val_str)) = split_yaml_key_val(trimmed) {
            *idx += 1;
            let val = parse_yaml_value(&val_str, lines, idx, indent);
            map.insert(key, val);
        } else {
            *idx += 1;
        }
    }
    serde_json::Value::Object(map)
}

fn parse_yaml_seq(lines: &[&str], idx: &mut usize, seq_indent: usize) -> serde_json::Value {
    let mut arr = Vec::new();
    while *idx < lines.len() {
        yaml_skip_ignorable(lines, idx);
        if *idx >= lines.len() {
            break;
        }
        let line = lines[*idx];
        let indent = yaml_line_indent(line);
        let trimmed = line.trim_start();
        if indent != seq_indent || !(trimmed == "-" || trimmed.starts_with("- ")) {
            break;
        }
        let rest = trimmed.strip_prefix('-').unwrap_or("").trim_start();
        let item_indent = indent + 2;
        if rest.is_empty() {
            *idx += 1;
            let child = parse_yaml_node(lines, idx, indent + 1);
            arr.push(child);
        } else if let Some((k, v)) = split_yaml_key_val(rest) {
            let mut item_map = serde_json::Map::new();
            *idx += 1;
            let first_val = parse_yaml_value(&v, lines, idx, item_indent);
            item_map.insert(k, first_val);
            while *idx < lines.len() {
                yaml_skip_ignorable(lines, idx);
                if *idx >= lines.len() {
                    break;
                }
                let sub_line = lines[*idx];
                let sub_indent = yaml_line_indent(sub_line);
                let sub_trimmed = sub_line.trim_start();
                if sub_indent < item_indent || sub_trimmed == "-" || sub_trimmed.starts_with("- ") {
                    break;
                }
                if let Some((sk, sv)) = split_yaml_key_val(sub_trimmed) {
                    *idx += 1;
                    let sval = parse_yaml_value(&sv, lines, idx, sub_indent);
                    item_map.insert(sk, sval);
                } else {
                    *idx += 1;
                }
            }
            arr.push(serde_json::Value::Object(item_map));
        } else {
            *idx += 1;
            let val = parse_yaml_value(rest, lines, idx, item_indent);
            arr.push(val);
        }
    }
    serde_json::Value::Array(arr)
}

fn parse_yaml_value(
    val_str: &str,
    lines: &[&str],
    idx: &mut usize,
    key_indent: usize,
) -> serde_json::Value {
    let v = val_str.trim();
    if v.is_empty() {
        let mut peek = *idx;
        yaml_skip_ignorable(lines, &mut peek);
        if peek < lines.len() {
            let next_indent = yaml_line_indent(lines[peek]);
            let next_trimmed = lines[peek].trim_start();
            if next_indent > key_indent {
                *idx = peek;
                return parse_yaml_node(lines, idx, next_indent);
            } else if next_indent == key_indent
                && (next_trimmed == "-" || next_trimmed.starts_with("- "))
            {
                *idx = peek;
                return parse_yaml_seq(lines, idx, next_indent);
            }
        }
        return serde_json::Value::Null;
    }

    if matches!(v, "|" | "|-" | "|+" | ">" | ">-" | ">+") {
        let folded = v.starts_with('>');
        let chomp_strip = v.ends_with('-');
        let mut block_lines: Vec<&str> = Vec::new();
        let mut block_indent: Option<usize> = None;

        while *idx < lines.len() {
            let line = lines[*idx];
            if line.trim().is_empty() {
                block_lines.push("");
                *idx += 1;
                continue;
            }
            let ind = yaml_line_indent(line);
            if let Some(bi) = block_indent {
                if ind < bi && ind <= key_indent {
                    break;
                }
            } else if ind <= key_indent {
                break;
            } else {
                block_indent = Some(ind);
            }
            let bi = block_indent.unwrap_or(ind);
            let slice = if line.len() >= bi {
                &line[bi..]
            } else {
                line.trim_start()
            };
            block_lines.push(slice);
            *idx += 1;
        }

        if chomp_strip {
            while block_lines.last().map(|s| s.is_empty()).unwrap_or(false) {
                block_lines.pop();
            }
        }

        let joined = if folded {
            block_lines.join(" ")
        } else {
            block_lines.join("\n")
        };
        return serde_json::Value::String(joined);
    }

    if let Some(stripped) = v.strip_prefix('"') {
        let mut combined = stripped.to_string();
        while !ends_with_unescaped_quote(&combined) && *idx < lines.len() {
            let next_line = lines[*idx].trim();
            *idx += 1;
            if !combined.ends_with(' ') && !next_line.is_empty() {
                combined.push(' ');
            }
            combined.push_str(next_line);
        }
        if combined.ends_with('"') {
            combined.pop();
        }
        return serde_json::Value::String(unescape_yaml_double_quoted(&combined));
    }

    if let Some(stripped) = v.strip_prefix('\'') {
        let mut combined = stripped.to_string();
        while !combined.ends_with('\'') && *idx < lines.len() {
            let next_line = lines[*idx].trim();
            *idx += 1;
            if !combined.ends_with(' ') && !next_line.is_empty() {
                combined.push(' ');
            }
            combined.push_str(next_line);
        }
        if combined.ends_with('\'') {
            combined.pop();
        }
        return serde_json::Value::String(combined.replace("''", "'"));
    }

    parse_yaml_scalar(v)
}

fn ends_with_unescaped_quote(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes[bytes.len() - 1] != b'"' {
        return false;
    }
    let mut backslashes = 0;
    let mut i = bytes.len() - 1;
    while i > 0 && bytes[i - 1] == b'\\' {
        backslashes += 1;
        i -= 1;
    }
    backslashes % 2 == 0
}

fn unescape_yaml_double_quoted(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut out = String::with_capacity(len);
    let mut i = 0;
    while i < len {
        if chars[i] == '\\' && i + 1 < len {
            match chars[i + 1] {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                other => {
                    out.push('\\');
                    out.push(other);
                }
            }
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn parse_yaml_scalar(s: &str) -> serde_json::Value {
    let clean = s.split(" #").next().unwrap_or(s).trim();
    let unquoted = clean.trim_matches('"').trim_matches('\'');
    if clean.starts_with('"') || clean.starts_with('\'') {
        return serde_json::Value::String(unquoted.to_string());
    }
    match unquoted {
        "true" | "True" | "TRUE" => serde_json::Value::Bool(true),
        "false" | "False" | "FALSE" => serde_json::Value::Bool(false),
        "null" | "Null" | "NULL" | "~" => serde_json::Value::Null,
        _ => {
            if let Ok(i) = unquoted.parse::<i64>() {
                serde_json::Value::Number(i.into())
            } else if let Ok(f) = unquoted.parse::<f64>() {
                serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or_else(|| serde_json::Value::String(unquoted.to_string()))
            } else {
                serde_json::Value::String(unquoted.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mod_registry_discovery_and_priority_ordering() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mods_dir = temp_dir.path().join("mods");
        std::fs::create_dir_all(&mods_dir).unwrap();

        // 1. Directory mod "ModA" (Higher Priority)
        let mod_a_dir = mods_dir.join("ModA");
        std::fs::create_dir_all(&mod_a_dir).unwrap();
        let mod_a_js = r#"
module.exports = {
    title: "Mod A High Priority",
    author: "Author A",
    version: 1.0,
    edit: true,
    trees: { "./Assets/": "assets://" },
    computed(api) {
        const t = api.readJson('./translation2.json');
    }
};
"#;
        std::fs::write(mod_a_dir.join("mod.js"), mod_a_js).unwrap();
        let mod_a_trans = serde_json::json!({
            "000001": {
                "title": "Mod A Title Overwrite"
            }
        });
        std::fs::write(
            mod_a_dir.join("translation2.json"),
            serde_json::to_string(&mod_a_trans).unwrap(),
        )
        .unwrap();

        // 2. Single-file mod "ModB.js" (Lower Priority)
        let mod_b_js = r#"
module.exports = {
    title: "Mod B Low Priority",
    author: "Author B",
    version: 2.0,
    edit: true,
    computed(api) {
        const t = api.readJson('./b_trans.json');
    }
};
"#;
        std::fs::write(mods_dir.join("ModB.js"), mod_b_js).unwrap();
        let mod_b_trans = serde_json::json!({
            "000001": {
                "title": "Mod B Title (Should be overwritten)",
                "content": "Mod B Content (Should be preserved)"
            }
        });
        std::fs::write(
            mods_dir.join("b_trans.json"),
            serde_json::to_string(&mod_b_trans).unwrap(),
        )
        .unwrap();

        // Enabled order: ModA is first (priority 0), ModB is second (priority 1)
        let enabled = vec!["ModA".to_string(), "ModB".to_string()];
        let mut registry = ModRegistry::load_from_dir(temp_dir.path(), &enabled);

        let available = registry.get_available_mods();
        assert_eq!(available.len(), 2);
        assert!(available.iter().any(|m| m.id == "ModA" && m.has_trees));
        assert!(available.iter().any(|m| m.id == "ModB" && !m.has_trees));

        let enabled_ids = registry.get_enabled_mod_ids();
        assert_eq!(enabled_ids, vec!["ModA".to_string(), "ModB".to_string()]);

        // Verify patch priority: Mod A's title wins, Mod B's content is preserved
        let patches = registry.load_active_patches();
        let p1 = patches.get("000001").expect("Page 000001 must be patched");
        assert_eq!(p1.title.as_deref(), Some("Mod A Title Overwrite"));
        assert_eq!(
            p1.content.as_deref(),
            Some("Mod B Content (Should be preserved)")
        );

        // Reverse priority order: ModB first, ModA second
        registry.rescan(&["ModB".to_string(), "ModA".to_string()]);
        let patches_rev = registry.load_active_patches();
        let p1_rev = patches_rev.get("000001").unwrap();
        assert_eq!(
            p1_rev.title.as_deref(),
            Some("Mod B Title (Should be overwritten)")
        );
        assert_eq!(
            p1_rev.content.as_deref(),
            Some("Mod B Content (Should be preserved)")
        );

        // Toggle ModB off
        let _ = registry.toggle_mod("ModB", false);
        assert_eq!(registry.get_enabled_mod_ids(), vec!["ModA".to_string()]);
        let patches_a_only = registry.load_active_patches();
        let p1_a = patches_a_only.get("000001").unwrap();
        assert_eq!(p1_a.title.as_deref(), Some("Mod A Title Overwrite"));
        assert!(p1_a.content.is_none());
    }

    #[test]
    fn test_localization_patch_application() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mods_dir = temp_dir.path().join("mods");
        let loc_dir = mods_dir.join("Sample Localization");
        std::fs::create_dir_all(&loc_dir).unwrap();

        let mod_js = r#"
module.exports = {
    title: "Sample Localization",
    author: "Localization Team",
    version: 2.0,
    edit: true,
    computed(api) {
        const translation = api.readJson('./translation2.json');
    }
};
"#;
        std::fs::write(loc_dir.join("mod.js"), mod_js).unwrap();

        let translation2 = serde_json::json!({
            "000001": {
                "content": "Localized opening panel..."
            },
            "000002": {
                "title": "Localized page two."
            },
            "000003": {
                "title": "Localized page three."
            }
        });
        std::fs::write(
            loc_dir.join("translation2.json"),
            serde_json::to_string(&translation2).unwrap(),
        )
        .unwrap();

        let enabled = vec!["Sample Localization".to_string()];
        let registry = ModRegistry::load_from_dir(temp_dir.path(), &enabled);
        assert!(registry.is_enabled("Sample Localization"));

        let patches = registry.load_active_patches();
        assert_eq!(patches.len(), 3);
        assert_eq!(
            patches.get("000002").unwrap().title.as_deref(),
            Some("Localized page two.")
        );
        assert_eq!(
            patches.get("000003").unwrap().title.as_deref(),
            Some("Localized page three.")
        );
    }

    #[test]
    fn test_read_mod_file_and_traversal_blocking() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mods_dir = temp_dir.path().join("mods");
        let mod_dir = mods_dir.join("TestMod");
        std::fs::create_dir_all(&mod_dir).unwrap();

        let mod_js = r#"
module.exports = {
    title: "Test Mod",
    author: "Tester",
    version: 1.2,
    treeroute: "./tree_root/",
    footnotes: "./notes.json",
    styles: [
        { source: "./custom.css" },
        { body: ".inline { color: red; }" }
    ],
    themes: [
        { label: "Dark Theme", source: "./dark.scss" }
    ]
};
"#;
        std::fs::write(mod_dir.join("mod.js"), mod_js).unwrap();
        std::fs::write(mod_dir.join("data.json"), r#"{"hello": "world"}"#).unwrap();
        std::fs::write(mod_dir.join("config.yaml"), "enabled: true\ncount: 42\n").unwrap();
        std::fs::write(mod_dir.join("secret.txt"), "top secret").unwrap();
        std::fs::write(
            mod_dir.join("notes.json"),
            r#"[{"author": "Tester", "story": {"000001": [{"content": "Note 1"}]}}]"#,
        )
        .unwrap();

        let registry = ModRegistry::load_from_dir(temp_dir.path(), &["TestMod".to_string()]);
        let available = registry.get_available_mods();
        assert_eq!(available.len(), 1);
        assert!(available[0].has_trees);
        assert_eq!(available[0].styles.len(), 2);
        assert_eq!(available[0].themes.len(), 1);

        // Valid JSON read
        let json_res = registry.read_mod_file("TestMod", "./data.json").unwrap();
        assert_eq!(json_res["format"], "json");
        assert_eq!(json_res["json"]["hello"], "world");

        // Valid YAML read
        let yaml_res = registry.read_mod_file("TestMod", "config.yaml").unwrap();
        assert_eq!(yaml_res["format"], "yaml");
        assert_eq!(yaml_res["json"]["enabled"], true);
        assert_eq!(yaml_res["json"]["count"], 42);

        // Path traversal must be blocked
        assert!(registry.read_mod_file("TestMod", "../secret.txt").is_err());
        assert!(registry
            .read_mod_file("TestMod", "../../etc/passwd")
            .is_err());
        assert!(registry
            .read_mod_file("TestMod", "%2e%2e/secret.txt")
            .is_err());
        assert!(registry
            .read_mod_file("TestMod", "data.json\0.txt")
            .is_err());

        // Static footnotes extraction
        let notes = registry.load_static_footnotes();
        assert_eq!(notes.get("000001").unwrap()[0].content, "Note 1");
    }

    #[test]
    fn test_subdir_non_standard_js_discovery_and_dynamic_routes() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mods_dir = temp_dir.path().join("mods");

        // 1. Directory mod with <foldername_lowercase>.js instead of mod.js
        let sample_dir = mods_dir.join("Sample-Mod");
        std::fs::create_dir_all(&sample_dir).unwrap();
        std::fs::write(
            sample_dir.join("samplemod.js"),
            r#"
module.exports = {
  title: "Sample Mod",
  author: "Mod Author",
  modVersion: 1.0,
  summary: "Replaces character names with alternate names",
  edit(archive) {}
}
"#,
        )
        .unwrap();

        // 2. sample-addon style directory mod with dynamic routes registered via update_dynamic_routes
        let addon_dir = mods_dir.join("sample-addon");
        std::fs::create_dir_all(&addon_dir).unwrap();
        std::fs::write(
            addon_dir.join("mod.js"),
            r#"
module.exports = {
  title: "Sample Addon",
  author: "Sample Author",
  modVersion: 0.1,
  computed(api) {
    let routes = []
    routes['assets://pseudo/v1_compressed.png'] = './collection_logo.png'
    return { routes }
  }
}
"#,
        )
        .unwrap();

        let enabled = vec!["Sample-Mod".to_string(), "sample-addon".to_string()];
        let mut registry = ModRegistry::load_from_dir(temp_dir.path(), &enabled);
        let available = registry.get_available_mods();
        assert_eq!(available.len(), 2);
        assert!(available
            .iter()
            .any(|m| m.id == "Sample-Mod" && m.title == "Sample Mod"));
        assert!(available
            .iter()
            .any(|m| m.id == "sample-addon" && m.title == "Sample Addon"));

        // Initially sample-addon has no static routes in its descriptor
        let initial_descriptors = registry.get_active_descriptors();
        let addon_initial = initial_descriptors
            .iter()
            .find(|d| d.id == "sample-addon")
            .unwrap();
        assert!(addon_initial.routes.is_empty());

        // After runtime computed(api) reports dynamic routes:
        let mut dyn_routes = HashMap::new();
        let mut addon_routes = HashMap::new();
        addon_routes.insert(
            "assets://pseudo/v1_compressed.png".to_string(),
            "./collection_logo.png".to_string(),
        );
        dyn_routes.insert("sample-addon".to_string(), addon_routes);
        registry.update_dynamic_routes(&dyn_routes);

        let descriptors = registry.get_active_descriptors();
        let addon_desc = descriptors.iter().find(|d| d.id == "sample-addon").unwrap();
        assert_eq!(
            addon_desc
                .routes
                .get("assets://pseudo/v1_compressed.png")
                .map(|s| s.as_str()),
            Some("./collection_logo.png")
        );
    }

    #[test]
    fn test_wave2_yaml_scss_and_nested_mod_discovery() {
        // 1. Test fancomic story.yaml parsing (block scalars, lists of objects, multi-line strings)
        let fancomic_yaml = r#""a": "sampleauthor "
"b": 1
"n": "Sample Fancomic"
"p":
- "d": 1605832682064
  "c": "Sample Fancomic"
  "b": "[img]assets://fancomics/Sample Fancomic/1.gif[/img]\n\nSpeedrunning!"
  "n":
  - 2
- "d": 1605839930538
  "c": "==>"
  "b": |-
    [img]assets://fancomics/Sample Fancomic/2.gif[/img]

    Well you can't just jump into the game without any plan!
  "n":
  - 3
"r": "Two players aim to beat a game as fast as possible.\nNo filler,
  just exploiting and breaking the game in whatever ways\nnecessary. "
"#;
        let parsed = parse_simple_yaml(fancomic_yaml);
        assert_eq!(parsed["n"], "Sample Fancomic");
        assert_eq!(parsed["a"], "sampleauthor ");
        let pages = parsed["p"].as_array().expect("p must be an array");
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0]["c"], "Sample Fancomic");
        assert_eq!(pages[0]["n"][0], 2);
        assert!(pages[1]["b"]
            .as_str()
            .unwrap()
            .contains("Well you can't just jump into the game"));
        assert!(parsed["r"]
            .as_str()
            .unwrap()
            .contains("just exploiting and breaking the game"));

        // 2. Test SCSS compilation (variables, &#app, nested &, @font-face hoisting, Vue attrs, trailing commas)
        let raw_theme_scss = r#"
@font-face {
  font-family: 'Sample-Regular';
  src: url(assets://mods/SampleThemes/sample.ttf);
}
$accent: #fa9805;
&#app {
  --font-default: #000000; // inline comment
  #tabSection {
    background: linear-gradient(to right, #970203 0%, $accent 100%,);
  }
  .jumpBoxWrapper[data-v-516a5a60] input {
    color: $accent;
  }
  .tabShell {
    .tab {
      &.activeTab {
        border: 1px solid $accent;
      }
    }
  }
}
"#;
        let compiled_css = scope_theme_css(raw_theme_scss, "theme-samplethemes-0");
        assert!(compiled_css.starts_with("@font-face {"));
        assert!(compiled_css.contains("#app.theme-samplethemes-0 #tab-bar.tabSection"));
        assert!(compiled_css.contains("linear-gradient(to right, #970203 0%, #fa9805 100%)"));
        assert!(compiled_css.contains("#app.theme-samplethemes-0 .jumpBoxWrapper input"));
        assert!(!compiled_css.contains("[data-v-516a5a60]"));
        assert!(compiled_css.contains("#app.theme-samplethemes-0 .tabShell .tab.activeTab"));

        // 3. Test nested mod directory scanning (sample-themes/{win95theme,winXPtheme})
        let temp_dir = tempfile::tempdir().unwrap();
        let pack_dir = temp_dir.path().join("mods").join("sample-themes");
        std::fs::create_dir_all(pack_dir.join("win95theme")).unwrap();
        std::fs::create_dir_all(pack_dir.join("winXPtheme")).unwrap();
        std::fs::write(
            pack_dir.join("win95theme/mod.js"),
            r#"module.exports = { title: "Windows 95 Theme", author: "Theme Author", modVersion: 1.0 }"#,
        )
        .unwrap();
        std::fs::write(
            pack_dir.join("winXPtheme/mod.js"),
            r#"module.exports = { title: "Windows XP Theme", author: "Theme Author", modVersion: 1.0 }"#,
        )
        .unwrap();

        let registry = ModRegistry::load_from_dir(temp_dir.path(), &["win95theme".to_string()]);
        let avail = registry.get_available_mods();
        assert_eq!(avail.len(), 2);
        assert!(avail.iter().any(|m| m.id == "win95theme" && m.enabled));
        assert!(avail.iter().any(|m| m.id == "winXPtheme" && !m.enabled));

        // 4. Test reload_from_dir with new pack directory
        let temp_dir2 = tempfile::tempdir().unwrap();
        let pack_dir2 = temp_dir2.path().join("mods");
        std::fs::create_dir_all(pack_dir2.join("cool-mod")).unwrap();
        std::fs::write(
            pack_dir2.join("cool-mod/mod.js"),
            r#"module.exports = { title: "Cool Mod", author: "Tester", modVersion: 1.0 }"#,
        )
        .unwrap();

        let mut reg_mut = registry;
        reg_mut.reload_from_dir(temp_dir2.path(), &["cool-mod".to_string()]);
        let avail2 = reg_mut.get_available_mods();
        assert_eq!(avail2.len(), 1);
        assert_eq!(avail2[0].id, "cool-mod");
        assert!(avail2[0].enabled);
    }
}
