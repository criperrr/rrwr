use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryPage {
    #[serde(default, alias = "page_id")]
    pub page_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub media: Vec<String>,
    #[serde(default)]
    pub flag: Vec<String>,
    #[serde(default)]
    pub next: Vec<String>,
    #[serde(default)]
    pub previous: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default, alias = "header_banner")]
    pub header_banner: Option<String>,
    #[serde(default, alias = "header_tooltip")]
    pub header_tooltip: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryPageSummary {
    #[serde(rename = "pageId")]
    pub page_id: String,
    pub title: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub media: Vec<String>,
    #[serde(default)]
    pub flag: Vec<String>,
    #[serde(default)]
    pub timestamp: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadingPosition {
    pub position: usize,
    pub total: usize,
    pub division: Option<String>,
    pub section: Option<String>,
    pub chapter: Option<String>,
}

fn is_chapter_heading(title: &str) -> bool {
    let lower = title.trim().to_ascii_lowercase();
    const PREFIXES: &[&str] = &[
        "act ",
        "book ",
        "chapter ",
        "part ",
        "section ",
        "arc ",
        "intermission",
        "prologue",
        "epilogue",
    ];
    PREFIXES.iter().any(|p| lower.starts_with(p))
}

fn default_theme() -> String {
    "default".to_string()
}

impl From<&StoryPage> for StoryPageSummary {
    fn from(p: &StoryPage) -> Self {
        Self {
            page_id: p.page_id.clone(),
            title: p.title.clone(),
            theme: p.theme.clone().unwrap_or_else(|| "default".to_string()),
            media: p.media.clone(),
            flag: p.flag.clone(),
            timestamp: p.timestamp.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoryPagePatch {
    pub title: Option<String>,
    pub content: Option<String>,
    pub media: Option<Vec<String>>,
    pub flag: Option<Vec<String>>,
    pub next: Option<Vec<String>>,
    pub previous: Option<String>,
    pub theme: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl StoryPagePatch {
    pub fn merge(&mut self, other: &StoryPagePatch) {
        if let Some(ref title) = other.title {
            self.title = Some(title.clone());
        }
        if let Some(ref content) = other.content {
            self.content = Some(content.clone());
        }
        if let Some(ref media) = other.media {
            self.media = Some(media.clone());
        }
        if let Some(ref flag) = other.flag {
            self.flag = Some(flag.clone());
        }
        if let Some(ref next) = other.next {
            self.next = Some(next.clone());
        }
        if other.previous.is_some() {
            self.previous = other.previous.clone();
        }
        if other.theme.is_some() {
            self.theme = other.theme.clone();
        }
        for (k, v) in &other.extra {
            self.extra.insert(k.clone(), v.clone());
        }
    }
}

impl StoryPage {
    pub fn apply_patch(&mut self, patch: &StoryPagePatch) {
        if let Some(ref title) = patch.title {
            self.title = title.clone();
        }
        if let Some(ref content) = patch.content {
            self.content = content.clone();
        }
        if let Some(ref media) = patch.media {
            self.media = media.clone();
        }
        if let Some(ref flag) = patch.flag {
            self.flag = flag.clone();
        }
        if let Some(ref next) = patch.next {
            self.next = next.clone();
        }
        if patch.previous.is_some() {
            self.previous = patch.previous.clone();
        }
        if patch.theme.is_some() {
            self.theme = patch.theme.clone();
        }
        for (k, v) in &patch.extra {
            self.extra.insert(k.clone(), v.clone());
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryArchive {
    pub story: HashMap<String, StoryPage>,
    #[serde(default, alias = "extra_stories")]
    pub extra_stories: HashMap<String, StoryPage>,
    #[serde(default, alias = "bonus_pages")]
    pub bonus_pages: HashMap<String, StoryPage>,
    #[serde(default, alias = "alt_stories")]
    pub alt_stories: HashMap<String, StoryPage>,
    #[serde(default)]
    pub faqs: HashMap<String, StoryPage>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, alias = "alt_media")]
    pub alt_media: String,
}

pub struct StoryIndex {
    pub order: Vec<String>,
    pub position_map: HashMap<String, usize>,
}

impl StoryIndex {
    pub fn build(story: &HashMap<String, StoryPage>) -> Self {
        let mut numeric_keys: Vec<(u32, String)> = Vec::new();
        let mut special_keys: Vec<String> = Vec::new();

        for key in story.keys() {
            if let Ok(num) = key.parse::<u32>() {
                numeric_keys.push((num, key.clone()));
            } else {
                special_keys.push(key.clone());
            }
        }
        numeric_keys.sort_by_key(|(n, _)| *n);

        let mut order: Vec<String> = numeric_keys.into_iter().map(|(_, k)| k).collect();
        special_keys.sort();
        order.extend(special_keys);

        let mut position_map = HashMap::with_capacity(order.len());
        for (idx, key) in order.iter().enumerate() {
            position_map.insert(key.clone(), idx);
        }

        Self {
            order,
            position_map,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FootnoteItem {
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(default)]
    pub preface: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModDiffPayload {
    #[serde(default)]
    pub replace: bool,
    #[serde(default)]
    pub patches: HashMap<String, StoryPagePatch>,
    #[serde(default, alias = "added_pages", alias = "addedPages")]
    pub added_pages: HashMap<String, StoryPage>,
    #[serde(default)]
    pub fancomics: HashMap<String, serde_json::Value>,
    #[serde(default, alias = "mod_home_row_items", alias = "modHomeRowItems")]
    pub mod_home_row_items: Vec<serde_json::Value>,
    #[serde(default)]
    pub footnotes: HashMap<String, Vec<FootnoteItem>>,
    #[serde(default, alias = "mod_routes", alias = "modRoutes")]
    pub routes: HashMap<String, HashMap<String, String>>,
}

pub struct StoryStore {
    base: Arc<std::sync::RwLock<Arc<StoryArchive>>>,
    patches: Arc<RwLock<HashMap<String, StoryPagePatch>>>,
    added_pages: Arc<RwLock<HashMap<String, StoryPage>>>,
    fancomics: Arc<RwLock<HashMap<String, serde_json::Value>>>,
    mod_home_row_items: Arc<RwLock<Vec<serde_json::Value>>>,
    footnotes: Arc<RwLock<HashMap<String, Vec<FootnoteItem>>>>,
    index: Arc<std::sync::RwLock<Arc<StoryIndex>>>,
}

impl StoryStore {
    pub fn new(archive: StoryArchive) -> Self {
        let index = Arc::new(StoryIndex::build(&archive.story));
        let base = Arc::new(archive);
        Self {
            base: Arc::new(std::sync::RwLock::new(base)),
            patches: Arc::new(RwLock::new(HashMap::new())),
            added_pages: Arc::new(RwLock::new(HashMap::new())),
            fancomics: Arc::new(RwLock::new(HashMap::new())),
            mod_home_row_items: Arc::new(RwLock::new(Vec::new())),
            footnotes: Arc::new(RwLock::new(HashMap::new())),
            index: Arc::new(std::sync::RwLock::new(index)),
        }
    }

    pub fn reload_base(&self, archive: StoryArchive) {
        let index = Arc::new(StoryIndex::build(&archive.story));
        let base = Arc::new(archive);
        *self.base.write().unwrap() = base;
        *self.index.write().unwrap() = index;
    }

    pub fn base_archive(&self) -> Arc<StoryArchive> {
        self.base.read().unwrap().clone()
    }

    fn apply_patches_on_read(
        page: &mut StoryPage,
        raw_id: &str,
        normalized_id: Option<&str>,
        patches: &HashMap<String, StoryPagePatch>,
    ) {
        if let Some(norm) = normalized_id {
            if norm != raw_id {
                if let Some(patch) = patches.get(norm) {
                    page.apply_patch(patch);
                }
            }
        }
        if let Some(patch) = patches.get(raw_id) {
            page.apply_patch(patch);
        }
    }

    pub async fn get_page(&self, page_id: &str) -> Option<StoryPage> {
        let padded = page_id
            .trim()
            .parse::<u32>()
            .ok()
            .map(|num| format!("{:06}", num));

        let added_guard = self.added_pages.read().await;
        let patches_guard = self.patches.read().await;

        // 1. Check added_pages first (raw key or 6-digit padded key)
        if let Some(added) = added_guard.get(page_id) {
            let mut page = added.clone();
            Self::apply_patches_on_read(&mut page, page_id, padded.as_deref(), &patches_guard);
            return Some(page);
        }
        if let Some(ref pad) = padded {
            if let Some(added) = added_guard.get(pad) {
                let mut page = added.clone();
                Self::apply_patches_on_read(&mut page, page_id, Some(pad.as_str()), &patches_guard);
                return Some(page);
            }
        }
        drop(added_guard);

        let base_guard = self.base.read().unwrap();

        // 2. Direct key lookup in immutable base archive
        if let Some(base_page) = base_guard.story.get(page_id) {
            let mut page = base_page.clone();
            Self::apply_patches_on_read(&mut page, page_id, padded.as_deref(), &patches_guard);
            return Some(page);
        }

        // 3. Numeric normalization to 6-digit zero-padding in base archive
        if let Some(ref pad) = padded {
            if let Some(base_page) = base_guard.story.get(pad) {
                let mut page = base_page.clone();
                Self::apply_patches_on_read(&mut page, page_id, Some(pad.as_str()), &patches_guard);
                return Some(page);
            }
        }

        None
    }

    pub async fn get_range(&self, start: usize, count: usize) -> Vec<StoryPageSummary> {
        let (order, position_map) = {
            let index_guard = self.index.read().unwrap();
            (index_guard.order.clone(), index_guard.position_map.clone())
        };
        let total = order.len();
        if total == 0 {
            return Vec::new();
        }

        // If start looks like a page number (e.g. 100), resolve its position in index
        let resolved_start = if let Some(&pos) = position_map.get(&format!("{:06}", start)) {
            pos
        } else {
            start
        };

        if resolved_start >= total {
            return Vec::new();
        }

        let patches_guard = self.patches.read().await;
        let base_arc = self.base.read().unwrap().clone();
        let end = resolved_start.saturating_add(count).min(total);
        order[resolved_start..end]
            .iter()
            .filter_map(|key| {
                base_arc.story.get(key).map(|base_page| {
                    if let Some(patch) = patches_guard.get(key) {
                        let mut p = base_page.clone();
                        p.apply_patch(patch);
                        StoryPageSummary::from(&p)
                    } else {
                        StoryPageSummary::from(base_page)
                    }
                })
            })
            .collect()
    }

    pub async fn apply_patches(&self, patches: &HashMap<String, StoryPagePatch>) {
        let base_arc = self.base.read().unwrap().clone();
        let mut normalized: HashMap<String, StoryPagePatch> = HashMap::with_capacity(patches.len());
        for (page_id, patch) in patches {
            let canonical_key = if base_arc.story.contains_key(page_id) {
                page_id.clone()
            } else if let Ok(num) = page_id.trim().parse::<u32>() {
                let padded = format!("{:06}", num);
                if base_arc.story.contains_key(&padded) {
                    padded
                } else {
                    page_id.clone()
                }
            } else {
                page_id.clone()
            };

            if let Some(existing) = normalized.get_mut(&canonical_key) {
                existing.merge(patch);
            } else {
                normalized.insert(canonical_key, patch.clone());
            }
        }
        drop(base_arc);
        let mut guard = self.patches.write().await;
        *guard = normalized;
    }

    pub async fn merge_mod_diffs(&self, diff: ModDiffPayload) {
        if !diff.patches.is_empty() {
            let base_arc = self.base.read().unwrap().clone();
            let mut guard = self.patches.write().await;
            for (page_id, patch) in diff.patches {
                let canonical_key = if base_arc.story.contains_key(&page_id) {
                    page_id
                } else if let Ok(num) = page_id.trim().parse::<u32>() {
                    let padded = format!("{:06}", num);
                    if base_arc.story.contains_key(&padded) {
                        padded
                    } else {
                        page_id
                    }
                } else {
                    page_id
                };

                if let Some(existing) = guard.get_mut(&canonical_key) {
                    existing.merge(&patch);
                } else {
                    guard.insert(canonical_key, patch);
                }
            }
        }

        if !diff.added_pages.is_empty() {
            let mut guard = self.added_pages.write().await;
            for (k, mut page) in diff.added_pages {
                if page.page_id.is_empty() {
                    page.page_id = k.clone();
                }
                guard.insert(k, page);
            }
        }

        if !diff.fancomics.is_empty() {
            let mut guard = self.fancomics.write().await;
            for (k, v) in diff.fancomics {
                guard.insert(k, v);
            }
        }

        if !diff.mod_home_row_items.is_empty() {
            let mut guard = self.mod_home_row_items.write().await;
            for item in diff.mod_home_row_items {
                if !guard.contains(&item) {
                    guard.push(item);
                }
            }
        }

        if !diff.footnotes.is_empty() {
            let mut guard = self.footnotes.write().await;
            for (page_id, notes) in diff.footnotes {
                let entry = guard.entry(page_id).or_default();
                for note in notes {
                    if !entry.contains(&note) {
                        entry.push(note);
                    }
                }
            }
        }
    }

    pub async fn get_page_footnotes(&self, page_id: &str) -> Vec<FootnoteItem> {
        let guard = self.footnotes.read().await;
        if let Some(notes) = guard.get(page_id) {
            return notes.clone();
        }
        if let Ok(num) = page_id.trim().parse::<u32>() {
            let padded = format!("{:06}", num);
            if let Some(notes) = guard.get(&padded) {
                return notes.clone();
            }
        }
        Vec::new()
    }

    pub async fn get_all_footnotes(&self) -> HashMap<String, Vec<FootnoteItem>> {
        self.footnotes.read().await.clone()
    }

    pub async fn get_fancomics(&self) -> HashMap<String, serde_json::Value> {
        self.fancomics.read().await.clone()
    }

    pub async fn get_added_pages_count(&self) -> usize {
        self.added_pages.read().await.len()
    }

    pub async fn get_added_pages_snapshot(&self) -> HashMap<String, StoryPage> {
        self.added_pages.read().await.clone()
    }

    pub async fn get_mod_home_row_items(&self) -> Vec<serde_json::Value> {
        self.mod_home_row_items.read().await.clone()
    }

    /// Resolves 1-based reading position, total pages, section, and nearest preceding chapter heading.
    pub async fn get_reading_position(&self, page_id: &str) -> ReadingPosition {
        let idx_arc = self.index.read().unwrap_or_else(|e| e.into_inner()).clone();
        let base = self.base.read().unwrap_or_else(|e| e.into_inner()).clone();

        let total = idx_arc.order.len();
        if let Some(&pos_idx) = idx_arc.position_map.get(page_id) {
            let current_root = base
                .story
                .get(page_id)
                .and_then(crate::data::tree::extract_media_root);

            let (position, div_total, division, chapter_start_idx) = if let Some(ref root) =
                current_root
            {
                let mut div_indices = idx_arc.order.iter().enumerate().filter_map(|(i, k)| {
                    let p = base.story.get(k)?;
                    if crate::data::tree::extract_media_root(p).as_deref() == Some(root.as_str()) {
                        Some((i, p))
                    } else {
                        None
                    }
                });

                let mut div_pos = 0usize;
                let mut count = 0usize;
                let mut div_label: Option<String> = None;
                let mut first_idx = 0usize;

                if let Some((fi, fp)) = div_indices.next() {
                    first_idx = fi;
                    count = 1;
                    if fi == pos_idx {
                        div_pos = 1;
                    }
                    let t = fp.title.trim();
                    if !t.is_empty() && t != "==>" {
                        div_label = Some(t.to_string());
                    }
                    for (i, _) in div_indices {
                        count += 1;
                        if i == pos_idx {
                            div_pos = count;
                        }
                    }
                }

                if div_pos > 0 && count > 0 {
                    (div_pos, count, div_label, first_idx)
                } else {
                    (pos_idx + 1, total, div_label, 0)
                }
            } else {
                (pos_idx + 1, total, None, 0)
            };

            let chapter = (chapter_start_idx..=pos_idx)
                .rev()
                .filter_map(|i| idx_arc.order.get(i))
                .filter_map(|k| base.story.get(k))
                .map(|p| p.title.trim())
                .find(|title| is_chapter_heading(title))
                .map(str::to_string);

            return ReadingPosition {
                position,
                total: div_total,
                division,
                section: None,
                chapter,
            };
        }

        let section = if base.extra_stories.contains_key(page_id) {
            Some("Extra Stories".to_string())
        } else if base.bonus_pages.contains_key(page_id) {
            Some("Bonus Pages".to_string())
        } else if base.alt_stories.contains_key(page_id) {
            Some("Alt Stories".to_string())
        } else if base.faqs.contains_key(page_id) {
            Some("FAQ".to_string())
        } else {
            None
        };

        ReadingPosition {
            position: 0,
            total,
            division: None,
            section,
            chapter: None,
        }
    }

    pub async fn reset_to_base(&self) {
        self.patches.write().await.clear();
        self.added_pages.write().await.clear();
        self.fancomics.write().await.clear();
        self.mod_home_row_items.write().await.clear();
        self.footnotes.write().await.clear();

        #[cfg(target_os = "linux")]
        unsafe {
            libc::malloc_trim(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_real_story_json() {
        if let Ok(asset_dir) = std::env::var("RRWR_ASSET_DIR") {
            let path = std::path::PathBuf::from(asset_dir).join("archive/data/story.json");
            if path.exists() {
                let content = std::fs::read_to_string(path).unwrap();
                let res = serde_json::from_str::<StoryArchive>(&content);
                if let Err(e) = res {
                    panic!("Deserialization error on story.json: {}", e);
                }
            }
        }
    }

    fn create_test_archive() -> StoryArchive {
        let mut story = HashMap::new();
        story.insert(
            "000001".to_string(),
            StoryPage {
                page_id: "000001".to_string(),
                title: "Sample Comic".to_string(),
                timestamp: "1700000000".to_string(),
                content: "A character stands in a room.".to_string(),
                media: vec!["media/00001.gif".to_string()],
                flag: vec![],
                next: vec!["000002".to_string()],
                previous: None,
                theme: Some("default".to_string()),
                header_banner: None,
                header_tooltip: None,
                extra: Default::default(),
            },
        );
        story.insert(
            "000002".to_string(),
            StoryPage {
                page_id: "000002".to_string(),
                title: "Next step.".to_string(),
                timestamp: "1239634260".to_string(),
                content: "Your name is ALEX.".to_string(),
                media: vec!["media/00002.gif".to_string()],
                flag: vec![],
                next: vec!["000003".to_string()],
                previous: Some("000001".to_string()),
                theme: Some("default".to_string()),
                header_banner: None,
                header_tooltip: None,
                extra: Default::default(),
            },
        );
        story.insert(
            "bonus".to_string(),
            StoryPage {
                page_id: "bonus".to_string(),
                title: "BONUS".to_string(),
                timestamp: "1240000000".to_string(),
                content: "Bonus panel!".to_string(),
                media: vec![],
                flag: vec![],
                next: vec![],
                previous: None,
                theme: None,
                header_banner: None,
                header_tooltip: None,
                extra: Default::default(),
            },
        );

        StoryArchive {
            story,
            extra_stories: Default::default(),
            bonus_pages: Default::default(),
            alt_stories: Default::default(),
            faqs: Default::default(),
            tags: Default::default(),
            alt_media: Default::default(),
        }
    }

    #[tokio::test]
    async fn test_story_store_lookups() {
        let store = StoryStore::new(create_test_archive());

        // Exact match
        let p1 = store.get_page("000001").await.unwrap();
        assert_eq!(p1.title, "Sample Comic");

        // Numeric without padding fallback
        let p1_num = store.get_page("1").await.unwrap();
        assert_eq!(p1_num.page_id, "000001");

        // Special alphanumeric key
        let bonus = store.get_page("bonus").await.unwrap();
        assert_eq!(bonus.title, "BONUS");

        // Non-existent
        assert!(store.get_page("999999").await.is_none());
    }

    #[tokio::test]
    async fn test_story_store_range() {
        let store = StoryStore::new(create_test_archive());
        let range = store.get_range(1, 2).await;
        assert_eq!(range.len(), 2);
        assert_eq!(range[0].page_id, "000001");
        assert_eq!(range[1].page_id, "000002");
    }

    #[tokio::test]
    async fn test_story_store_patches() {
        let store = StoryStore::new(create_test_archive());

        let mut patches = HashMap::new();
        patches.insert(
            "000001".to_string(),
            StoryPagePatch {
                title: Some("Sample Comic Localized".to_string()),
                content: Some("Localized panel content.".to_string()),
                media: None,
                flag: None,
                next: None,
                previous: None,
                theme: None,
                extra: Default::default(),
            },
        );

        store.apply_patches(&patches).await;
        let p_patched = store.get_page("000001").await.unwrap();
        assert_eq!(p_patched.title, "Sample Comic Localized");
        assert_eq!(p_patched.content, "Localized panel content.");

        // Reset restores original
        store.reset_to_base().await;
        let p_base = store.get_page("000001").await.unwrap();
        assert_eq!(p_base.title, "Sample Comic");
    }

    #[tokio::test]
    async fn test_story_range_saturating_add_overflow() {
        let store = StoryStore::new(create_test_archive());
        let range = store.get_range(0, usize::MAX).await;
        assert_eq!(range.len(), 3);
    }

    #[tokio::test]
    async fn test_story_store_unpadded_patch_key() {
        let store = StoryStore::new(create_test_archive());
        let mut patches = HashMap::new();
        patches.insert(
            "1".to_string(), // Unpadded key
            StoryPagePatch {
                title: Some("Patched Unpadded".to_string()),
                content: None,
                media: None,
                flag: None,
                next: None,
                previous: None,
                theme: None,
                extra: Default::default(),
            },
        );
        store.apply_patches(&patches).await;
        let p = store.get_page("000001").await.unwrap();
        assert_eq!(p.title, "Patched Unpadded");
    }

    #[tokio::test]
    async fn test_story_store_on_read_dedup_and_mod_diffs() {
        let store = StoryStore::new(create_test_archive());

        // Base archive remains completely unmutated
        assert_eq!(
            store.base_archive().story.get("000001").unwrap().title,
            "Sample Comic"
        );

        let mut patches = HashMap::new();
        patches.insert(
            "000002".to_string(),
            StoryPagePatch {
                title: Some("Patched 2".to_string()),
                ..Default::default()
            },
        );

        let mut added_pages = HashMap::new();
        added_pages.insert(
            "custom_page_1".to_string(),
            StoryPage {
                page_id: "custom_page_1".to_string(),
                title: "Added Mod Page".to_string(),
                timestamp: "1700000000".to_string(),
                content: "Dynamic mod content.".to_string(),
                media: vec!["assets://mod/panel.gif".to_string()],
                flag: vec![],
                next: vec!["000001".to_string()],
                previous: None,
                theme: Some("alt".to_string()),
                header_banner: None,
                header_tooltip: None,
                extra: Default::default(),
            },
        );

        let mut footnotes = HashMap::new();
        footnotes.insert(
            "000001".to_string(),
            vec![FootnoteItem {
                content: "Author commentary on page 1".to_string(),
                author: Some("Author".to_string()),
                class: Some("commentary".to_string()),
                preface: false,
            }],
        );

        let mut fancomics = HashMap::new();
        fancomics.insert(
            "cool_adventure".to_string(),
            serde_json::json!({ "name": "Cool Sample Comic" }),
        );

        store
            .merge_mod_diffs(ModDiffPayload {
                patches,
                added_pages,
                fancomics,
                mod_home_row_items: vec![serde_json::json!({ "title": "Mod Item" })],
                footnotes,
                routes: HashMap::new(),
                replace: false,
            })
            .await;

        // Verify base archive was never mutated in place
        assert_eq!(
            store.base_archive().story.get("000002").unwrap().title,
            "Next step."
        );

        // Verify on-read patch on get_page and get_range
        let p2 = store.get_page("000002").await.unwrap();
        assert_eq!(p2.title, "Patched 2");
        let range = store.get_range(1, 2).await;
        assert_eq!(range[1].title, "Patched 2");

        // Verify added page lookup
        let custom = store.get_page("custom_page_1").await.unwrap();
        assert_eq!(custom.title, "Added Mod Page");

        // Verify footnotes (both padded and unpadded lookup)
        let notes = store.get_page_footnotes("1").await;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].content, "Author commentary on page 1");
        assert_eq!(notes[0].author.as_deref(), Some("Author"));

        // Verify fancomics & mod_home_row_items
        assert!(store.get_fancomics().await.contains_key("cool_adventure"));
        assert_eq!(store.get_mod_home_row_items().await.len(), 1);

        // Reset clears all overlays
        store.reset_to_base().await;
        assert!(store.get_page("custom_page_1").await.is_none());
        assert!(store.get_page_footnotes("000001").await.is_empty());
        assert_eq!(store.get_page("000002").await.unwrap().title, "Next step.");
    }
}
