use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VueHookDescriptor {
    pub match_name: String,
    pub computed_keys: Vec<String>,
    pub log_button_open_prefix: Option<String>,
    pub log_button_close_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModStyleDescriptor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModThemeDescriptor {
    pub label: String,
    pub source: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct ParsedModInfo {
    pub title: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub version: f64,
    pub locked: Option<String>,
    pub edit: bool,
    pub translation_files: Vec<String>,
    pub trees: HashMap<String, String>,
    pub routes: HashMap<String, String>,
    pub vue_hooks: Vec<VueHookDescriptor>,
    pub styles: Vec<ModStyleDescriptor>,
    pub themes: Vec<ModThemeDescriptor>,
    pub footnotes_raw: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub raw_code: String,
}

fn extract_js_string_field(content: &str, field: &str) -> Option<String> {
    let pattern = format!(
        r#"(?:^|[,{{\s]){}\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)"#,
        regex::escape(field)
    );
    let re = Regex::new(&pattern).ok()?;
    let caps = re.captures(content)?;
    let raw = caps
        .get(1)
        .or_else(|| caps.get(2))
        .or_else(|| caps.get(3))?
        .as_str();
    Some(raw.replace(r#"\""#, "\"").replace(r#"\'"#, "'"))
}

pub fn parse_mod_js(path: &Path) -> Option<ParsedModInfo> {
    let content = std::fs::read_to_string(path).ok()?;

    let version_re =
        Regex::new(r#"(?i)(?:modVersion|version)\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)"#).ok()?;

    let title = extract_js_string_field(&content, "title").unwrap_or_else(|| {
        if path.is_file() && path.file_name().map(|f| f == "mod.js").unwrap_or(false) {
            path.parent()
                .and_then(|p| p.file_name())
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown Mod".to_string())
        } else {
            path.file_stem()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown Mod".to_string())
        }
    });

    let summary = extract_js_string_field(&content, "summary");
    let description = extract_js_string_field(&content, "description");
    let author = extract_js_string_field(&content, "author");

    let version = version_re
        .captures(&content)
        .and_then(|c| c.get(1).and_then(|m| m.as_str().parse::<f64>().ok()))
        .unwrap_or(1.0);

    let edit_re = Regex::new(
        r#"(?:edit\s*:\s*true\b|\bedit\s*\(\s*archive|\bedit\s*:\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>))"#,
    )
    .ok();
    let has_explicit_edit = edit_re
        .as_ref()
        .map(|r| r.is_match(&content))
        .unwrap_or_else(|| {
            content.contains("edit: true")
                || content.contains("edit:true")
                || content.contains("edit(archive)")
                || content.contains("edit (archive)")
        });
    let has_boolean_footnotes =
        content.contains("footnotes: true") || content.contains("footnotes:true");

    let mut translation_files = Vec::new();
    if has_explicit_edit && !has_boolean_footnotes {
        if let Ok(read_json_re) =
            Regex::new(r#"api\.readJson(?:Async)?\s*\(\s*["']([^"']+)["']\s*\)"#)
        {
            for cap in read_json_re.captures_iter(&content) {
                if let Some(m) = cap.get(1) {
                    let raw_path = m.as_str().trim();
                    let clean = raw_path
                        .trim_start_matches('.')
                        .trim_start_matches('/')
                        .to_string();
                    if !clean.contains("..")
                        && !clean.is_empty()
                        && !translation_files.contains(&clean)
                    {
                        translation_files.push(clean);
                    }
                }
            }
        }
    }

    if translation_files.is_empty() {
        if let Some(parent) = path.parent() {
            if parent.join("translation2.json").is_file() {
                translation_files.push("translation2.json".to_string());
            }
        }
    }

    let edit = has_explicit_edit || !translation_files.is_empty();

    let mut trees = HashMap::new();
    let trees_block_re = Regex::new(r#"trees\s*:\s*\{([^}]+)\}"#).ok()?;
    let pair_re = Regex::new(r#"["']([^"']+)["']\s*:\s*["']([^"']+)["']"#).ok()?;

    if let Some(caps) = trees_block_re.captures(&content) {
        if let Some(block) = caps.get(1) {
            for pair in pair_re.captures_iter(block.as_str()) {
                if let (Some(k), Some(v)) = (pair.get(1), pair.get(2)) {
                    trees.insert(k.as_str().to_string(), v.as_str().to_string());
                }
            }
        }
    }

    if let Ok(treeroute_re) = Regex::new(r#"treeroute\s*:\s*["']([^"']+)["']"#) {
        if let Some(caps) = treeroute_re.captures(&content) {
            if let Some(m) = caps.get(1) {
                trees.insert(m.as_str().to_string(), "assets://".to_string());
            }
        }
    }

    let locked = Regex::new(r#"locked\s*:\s*(?:["']([^"']+)["']|(true))"#)
        .ok()
        .and_then(|re| re.captures(&content))
        .and_then(|c| {
            c.get(1)
                .map(|m| m.as_str().to_string())
                .or_else(|| c.get(2).map(|_| "true".to_string()))
        });

    let mut styles = Vec::new();
    if let Ok(styles_block_re) = Regex::new(r#"styles\s*:\s*\[([\s\S]*?)\]"#) {
        if let Some(caps) = styles_block_re.captures(&content) {
            if let Some(block) = caps.get(1) {
                let block_str = block.as_str();
                if let Ok(src_re) = Regex::new(r#"source\s*:\s*["']([^"']+)["']"#) {
                    for cap in src_re.captures_iter(block_str) {
                        if let Some(m) = cap.get(1) {
                            styles.push(ModStyleDescriptor {
                                source: Some(m.as_str().to_string()),
                                body: None,
                            });
                        }
                    }
                }
                if let Ok(body_re) = Regex::new(r#"body\s*:\s*["'`]([\s\S]*?)["'`]"#) {
                    for cap in body_re.captures_iter(block_str) {
                        if let Some(m) = cap.get(1) {
                            styles.push(ModStyleDescriptor {
                                source: None,
                                body: Some(m.as_str().to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    let mut themes = Vec::new();
    if let Ok(themes_block_re) = Regex::new(r#"themes\s*:\s*\[([\s\S]*?)\]"#) {
        if let Some(caps) = themes_block_re.captures(&content) {
            if let Some(block) = caps.get(1) {
                let block_str = block.as_str();
                if let Ok(obj_re) = Regex::new(r#"\{([^}]+)\}"#) {
                    let label_re = Regex::new(r#"label\s*:\s*["']([^"']+)["']"#).ok();
                    let src_re = Regex::new(r#"source\s*:\s*["']([^"']+)["']"#).ok();
                    let val_re = Regex::new(r#"value\s*:\s*["']([^"']+)["']"#).ok();
                    for obj_cap in obj_re.captures_iter(block_str) {
                        if let Some(obj_inner) = obj_cap.get(1) {
                            let s = obj_inner.as_str();
                            let label = label_re
                                .as_ref()
                                .and_then(|r| r.captures(s))
                                .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
                            let source = src_re
                                .as_ref()
                                .and_then(|r| r.captures(s))
                                .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
                            let value = val_re
                                .as_ref()
                                .and_then(|r| r.captures(s))
                                .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
                                .unwrap_or_default();
                            if let (Some(label), Some(source)) = (label, source) {
                                themes.push(ModThemeDescriptor {
                                    label,
                                    source,
                                    value,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let footnotes_raw = Regex::new(r#"footnotes\s*:\s*["']([^"']+)["']"#)
        .ok()
        .and_then(|re| re.captures(&content))
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));

    let settings = if content.contains("settings") {
        Some(serde_json::json!({ "hasSettings": true }))
    } else {
        None
    };

    let mut routes = HashMap::new();
    if let Ok(routes_block_re) = Regex::new(r#"routes\s*:\s*\{([^}]+)\}"#) {
        if let Some(caps) = routes_block_re.captures(&content) {
            if let Some(block) = caps.get(1) {
                for pair in pair_re.captures_iter(block.as_str()) {
                    if let (Some(k), Some(v)) = (pair.get(1), pair.get(2)) {
                        routes.insert(k.as_str().to_string(), v.as_str().to_string());
                    }
                }
            }
        }
    }

    let mut vue_hooks = Vec::new();
    if content.contains("vueHooks") {
        let match_name_re = Regex::new(r#"matchName\s*:\s*["']([^"']+)["']"#).ok();
        let match_name = match_name_re
            .and_then(|r| r.captures(&content))
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .unwrap_or_else(|| "pageText".to_string());

        let mut computed_keys = Vec::new();
        let mut log_button_open_prefix = None;
        let mut log_button_close_prefix = None;

        if content.contains("logButtonText") {
            computed_keys.push("logButtonText".to_string());
            let ternary_re =
                Regex::new(r#"logHidden\s*\)?\s*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']"#)
                    .ok();
            if let Some(re) = ternary_re {
                if let Some(cap) = re.captures(&content) {
                    log_button_open_prefix = cap.get(1).map(|m| m.as_str().to_string());
                    log_button_close_prefix = cap.get(2).map(|m| m.as_str().to_string());
                }
            }
            if log_button_open_prefix.is_none()
                && content.contains("'Abrir '")
                && content.contains("'Fechar '")
            {
                log_button_open_prefix = Some("Abrir ".to_string());
                log_button_close_prefix = Some("Fechar ".to_string());
            }
        }

        vue_hooks.push(VueHookDescriptor {
            match_name,
            computed_keys,
            log_button_open_prefix,
            log_button_close_prefix,
            raw_body: None,
        });
    }

    Some(ParsedModInfo {
        title,
        summary,
        description,
        author,
        version,
        locked,
        edit,
        translation_files,
        trees,
        routes,
        vue_hooks,
        styles,
        themes,
        footnotes_raw,
        settings,
        raw_code: content,
    })
}

pub fn evaluate_log_button_text(
    raw_content: &str,
    log_hidden: bool,
    vue_hooks_active: bool,
) -> String {
    let re = match Regex::new(r#"\|(.*?)\|"#) {
        Ok(r) => r,
        Err(_) => {
            return if log_hidden {
                "Show log".to_string()
            } else {
                "Hide log".to_string()
            }
        }
    };

    let text = if let Some(caps) = re.captures(raw_content) {
        caps.get(1)
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "log".to_string())
    } else {
        "log".to_string()
    };

    let normalized_text = text.to_lowercase();

    let prefix = if vue_hooks_active {
        if log_hidden {
            "Open "
        } else {
            "Close "
        }
    } else if log_hidden {
        "Show "
    } else {
        "Hide "
    };

    format!("{}{}", prefix, normalized_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_legacy_mod_js() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
module.exports = {
  title: "Sample Localization",
  summary: "A localized story pack...",
  author: "Localization Team",
  modVersion: 2.0,
  edit: true,
  trees: {
    "./Assets/": "assets://"
  },
  vueHooks: [{
    matchName: "pageText",
    computed: {
      logButtonText() {
        let text = this.content.match(/\|(.*?)\|/)[1]
        const state = (this.logHidden) ? 'Open ' : 'Close '
        return state + text.toLowerCase()
      }
    }
  }],
  computed(api) {
    const translation = api.readJson('./translation2.json')
    api.logger.info(translation)
  }
}
        "#;
        std::fs::write(temp.path(), content).unwrap();

        let parsed = parse_mod_js(temp.path()).unwrap();
        assert_eq!(parsed.title, "Sample Localization");
        assert_eq!(parsed.author.as_deref(), Some("Localization Team"));
        assert_eq!(parsed.version, 2.0);
        assert!(parsed.edit);
        assert_eq!(
            parsed.trees.get("./Assets/").map(|s| s.as_str()),
            Some("assets://")
        );
        assert_eq!(parsed.translation_files, vec!["translation2.json"]);
        assert_eq!(parsed.vue_hooks.len(), 1);
        let hook = &parsed.vue_hooks[0];
        assert_eq!(hook.match_name, "pageText");
        assert_eq!(hook.log_button_open_prefix.as_deref(), Some("Open "));
        assert_eq!(hook.log_button_close_prefix.as_deref(), Some("Close "));
    }

    #[test]
    fn test_evaluate_log_button_text_table() {
        // Default / inactive
        assert_eq!(
            evaluate_log_button_text("|DIALOGLOG|\nHello", true, false),
            "Show dialoglog"
        );
        assert_eq!(
            evaluate_log_button_text("|DIALOGLOG|\nHello", false, false),
            "Hide dialoglog"
        );
        assert_eq!(
            evaluate_log_button_text("Plain text without marker", true, false),
            "Show log"
        );
        assert_eq!(
            evaluate_log_button_text("Plain text without marker", false, false),
            "Hide log"
        );

        // Hook active
        assert_eq!(
            evaluate_log_button_text("|CHATLOG|\nHello", true, true),
            "Open chatlog"
        );
        assert_eq!(
            evaluate_log_button_text("|CHATLOG|\nHello", false, true),
            "Close chatlog"
        );
        assert_eq!(
            evaluate_log_button_text("|NOTESLOG|\nHello", true, true),
            "Open noteslog"
        );
    }

    #[test]
    fn test_parse_real_community_mods_metadata_and_quotes() {
        // 1. Commentary style: apostrophe inside double quotes, escaped quotes in description,
        // footnotes: true, asyncComputed(api) with readJsonAsync (should NOT be treated as translation2)
        let temp_comm = tempfile::NamedTempFile::new().unwrap();
        let commentary_js = r#"
module.exports = {
  title: "Sample Commentary Mod",
  summary: "Adds author's commentary",
  author: "SampleAuthor",
  modVersion: 0.1,
  description: "Adds the commentary from the printed books as footnotes, plus a few selections from the author's <i>Sample</i> blog.",
  footnotes: true,
  settings: {
    boolean: [{
      model: "ExtraNotes",
      label: "Include extra blog commentary",
      desc: "Check to turn on selected commentary from example.com."
    }]
  },
  async asyncComputed(api) {
    const story = await api.readJsonAsync('./authornotes.json')
    const archivist = await api.readJsonAsync('./notes.json')
    return { footnotes: [story, archivist] }
  }
}
"#;
        std::fs::write(temp_comm.path(), commentary_js).unwrap();
        let parsed_comm = parse_mod_js(temp_comm.path()).unwrap();
        assert_eq!(parsed_comm.title, "Sample Commentary Mod");
        assert_eq!(
            parsed_comm.summary.as_deref(),
            Some("Adds author's commentary")
        );
        assert_eq!(parsed_comm.author.as_deref(), Some("SampleAuthor"));
        assert!((parsed_comm.version - 0.1).abs() < f64::EPSILON);
        assert!(!parsed_comm.edit);
        assert!(parsed_comm.translation_files.is_empty());

        // 2. Transcript style: string modVersion: "1.0", footnotes: true, styles: []
        let temp_tr = tempfile::NamedTempFile::new().unwrap();
        let transcripts_js = r#"
module.exports = {
  title: "Reader Transcripts",
  summary: "Transcripts & Alt Text for Archive",
  author: "SampleAuthor",
  modVersion: "1.0",
  footnotes: true,
  styles: [],
  async asyncComputed(api) {
    const transcripts = await api.readJsonAsync('./data/transcripts.json')
    return { footnotes: [transcripts] }
  }
}
"#;
        std::fs::write(temp_tr.path(), transcripts_js).unwrap();
        let parsed_tr = parse_mod_js(temp_tr.path()).unwrap();
        assert_eq!(parsed_tr.title, "Reader Transcripts");
        assert_eq!(
            parsed_tr.summary.as_deref(),
            Some("Transcripts & Alt Text for Archive")
        );
        assert_eq!(parsed_tr.version, 1.0);
        assert!(parsed_tr.translation_files.is_empty());

        // 3. Single-quoted HTML attributes inside double-quoted author/description, edit(archive)
        let temp_alt = tempfile::NamedTempFile::new().unwrap();
        let alt_js = r#"
module.exports = {
  title: "Alternate Names Mod",
  author: "Contributor (<a href='https://example.com/portfolio/'>Portfolio site!</a>)",
  modVersion: 1.0,
  summary: "Replaces the character names with alternate names",
  description: "Wait, hold on. You're telling me their names aren't Placeholder One and Placeholder Two?",
  edit(archive) {
    archive.story['000001'].title = 'Alternate Title'
  }
}
"#;
        std::fs::write(temp_alt.path(), alt_js).unwrap();
        let parsed_alt = parse_mod_js(temp_alt.path()).unwrap();
        assert_eq!(parsed_alt.title, "Alternate Names Mod");
        assert_eq!(
            parsed_alt.author.as_deref(),
            Some("Contributor (<a href='https://example.com/portfolio/'>Portfolio site!</a>)")
        );
        assert!(parsed_alt
            .description
            .as_deref()
            .unwrap()
            .contains("You're telling me their names aren't"));
        assert!(parsed_alt.edit);
    }

    #[test]
    fn test_parse_non_theme_community_mods_edge_cases() {
        // 1. chinese-localization style: Version: 0.1
        let temp_cn = tempfile::NamedTempFile::new().unwrap();
        let cn_js = r#"
module.exports = {
  title: "Chinese Localization",
  author: "Archive CN Team",
  Version: 0.1,
  summary: "Chinese translation patch",
  edit(archive) {
    archive.story['000001'].title = "示例标题";
  }
}
"#;
        std::fs::write(temp_cn.path(), cn_js).unwrap();
        let parsed_cn = parse_mod_js(temp_cn.path()).unwrap();
        assert_eq!(parsed_cn.title, "Chinese Localization");
        assert_eq!(parsed_cn.version, 0.1);
        assert!(parsed_cn.edit);

        // 2. bilingual style: modVersion: '1.1.2'
        let temp_bi = tempfile::NamedTempFile::new().unwrap();
        let bi_js = r#"
module.exports = {
  title: "Chinese Bilingual",
  author: "Bilingual Team",
  modVersion: '1.1.2',
  description: "Bilingual mod support",
  edit: async function(archive) {
    // async edit function
  }
}
"#;
        std::fs::write(temp_bi.path(), bi_js).unwrap();
        let parsed_bi = parse_mod_js(temp_bi.path()).unwrap();
        assert_eq!(parsed_bi.title, "Chinese Bilingual");
        assert_eq!(parsed_bi.version, 1.1);
        assert!(parsed_bi.edit);

        // 3. vueHooks with custom ternary prefixes
        let temp_vue = tempfile::NamedTempFile::new().unwrap();
        let vue_js = r#"
module.exports = {
  title: "Chinese Logs",
  modVersion: 1.0,
  vueHooks: [{
    matchName: "pageText",
    computed: {
      logButtonText() {
        const state = (this.logHidden) ? '显示 ' : '隐藏 '
        return state + 'log'
      }
    }
  }]
}
"#;
        std::fs::write(temp_vue.path(), vue_js).unwrap();
        let parsed_vue = parse_mod_js(temp_vue.path()).unwrap();
        assert_eq!(parsed_vue.vue_hooks.len(), 1);
        assert_eq!(
            parsed_vue.vue_hooks[0].log_button_open_prefix.as_deref(),
            Some("显示 ")
        );
        assert_eq!(
            parsed_vue.vue_hooks[0].log_button_close_prefix.as_deref(),
            Some("隐藏 ")
        );

        // 4. evaluate_log_button_text standard behavior
        let open_en = evaluate_log_button_text("|DIALOGLOG|", true, false);
        let close_en = evaluate_log_button_text("|DIALOGLOG|", false, false);
        assert_eq!(open_en, "Show dialoglog");
        assert_eq!(close_en, "Hide dialoglog");

        let open_hook = evaluate_log_button_text("|DIALOGLOG|", true, true);
        let close_hook = evaluate_log_button_text("|DIALOGLOG|", false, true);
        assert_eq!(open_hook, "Open dialoglog");
        assert_eq!(close_hook, "Close dialoglog");
    }
}
