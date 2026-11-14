pub mod music;
pub mod story;
pub mod tree;

use std::fs;
use std::path::Path;
use std::sync::Arc;

pub use music::MusicArchive;
pub use story::{
    FootnoteItem, ModDiffPayload, StoryArchive, StoryPage, StoryPagePatch, StoryPageSummary,
    StoryStore,
};
pub use tree::{TreeChildrenResponse, TreeNode, TreeSearchResponse};

pub struct ArchiveStore {
    pub story: Arc<StoryStore>,
    pub music: Arc<std::sync::RwLock<Arc<MusicArchive>>>,
    pub music_raw: Arc<std::sync::RwLock<Arc<serde_json::Value>>>,
}

impl ArchiveStore {
    pub fn load_story_archive(story_path: &Path) -> StoryArchive {
        if story_path.is_file() {
            match fs::read_to_string(story_path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(arc) => arc,
                    Err(e) => {
                        log::error!("Failed to parse story.json: {}", e);
                        StoryArchive {
                            story: Default::default(),
                            extra_stories: Default::default(),
                            bonus_pages: Default::default(),
                            alt_stories: Default::default(),
                            faqs: Default::default(),
                            tags: Default::default(),
                            alt_media: Default::default(),
                        }
                    }
                },
                Err(e) => {
                    log::error!("Failed to read story.json: {}", e);
                    StoryArchive {
                        story: Default::default(),
                        extra_stories: Default::default(),
                        bonus_pages: Default::default(),
                        alt_stories: Default::default(),
                        faqs: Default::default(),
                        tags: Default::default(),
                        alt_media: Default::default(),
                    }
                }
            }
        } else {
            log::warn!("story.json not found at {:?}", story_path);
            StoryArchive {
                story: Default::default(),
                extra_stories: Default::default(),
                bonus_pages: Default::default(),
                alt_stories: Default::default(),
                faqs: Default::default(),
                tags: Default::default(),
                alt_media: Default::default(),
            }
        }
    }

    pub fn load_music_archive(music_path: &Path) -> (MusicArchive, serde_json::Value) {
        if music_path.is_file() {
            match fs::read_to_string(music_path) {
                Ok(content) => {
                    let raw: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
                    let arc: MusicArchive = serde_json::from_str(&content).unwrap_or_else(|e| {
                        log::error!("Failed to parse music.json into struct: {}", e);
                        MusicArchive {
                            albums: Default::default(),
                            tracks: Default::default(),
                            artists: Default::default(),
                            flashes: Default::default(),
                        }
                    });
                    (arc, raw)
                }
                Err(e) => {
                    log::error!("Failed to read music.json: {}", e);
                    (
                        MusicArchive {
                            albums: Default::default(),
                            tracks: Default::default(),
                            artists: Default::default(),
                            flashes: Default::default(),
                        },
                        serde_json::Value::Null,
                    )
                }
            }
        } else {
            log::warn!("music.json not found at {:?}", music_path);
            (
                MusicArchive {
                    albums: Default::default(),
                    tracks: Default::default(),
                    artists: Default::default(),
                    flashes: Default::default(),
                },
                serde_json::Value::Null,
            )
        }
    }

    pub fn load_from_dir(asset_dir: &Path) -> Self {
        let data_dir = asset_dir.join("archive").join("data");
        let (story_path, music_path) = crate::imports::find_archive_data_files(asset_dir)
            .unwrap_or_else(|| (data_dir.join("story.json"), data_dir.join("music.json")));
        let story_archive = Self::load_story_archive(&story_path);
        let (music_archive, music_raw) = Self::load_music_archive(&music_path);

        Self {
            story: Arc::new(StoryStore::new(story_archive)),
            music: Arc::new(std::sync::RwLock::new(Arc::new(music_archive))),
            music_raw: Arc::new(std::sync::RwLock::new(Arc::new(music_raw))),
        }
    }

    pub fn reload_from_dir(&self, asset_dir: &Path) {
        let data_dir = asset_dir.join("archive").join("data");
        let (story_path, music_path) = crate::imports::find_archive_data_files(asset_dir)
            .unwrap_or_else(|| (data_dir.join("story.json"), data_dir.join("music.json")));
        let story_archive = Self::load_story_archive(&story_path);
        self.story.reload_base(story_archive);

        let (music_archive, music_raw) = Self::load_music_archive(&music_path);
        *self.music.write().unwrap() = Arc::new(music_archive);
        *self.music_raw.write().unwrap() = Arc::new(music_raw);
    }

    pub async fn get_story_page(&self, page_id: &str) -> Option<StoryPage> {
        self.story.get_page(page_id).await
    }

    pub async fn get_story_range(&self, start: usize, count: usize) -> Vec<StoryPageSummary> {
        self.story.get_range(start, count).await
    }

    pub fn get_music_raw(&self) -> serde_json::Value {
        (**self.music_raw.read().unwrap()).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_archive_store_and_vfs_dynamic_reload() {
        let temp_dir1 = tempdir().unwrap();
        let path1 = temp_dir1.path();
        std::fs::create_dir_all(path1.join("archive/data")).unwrap();
        let story1 = r#"{
            "story": {
                "000001": {
                    "pageId": "000001",
                    "title": "Initial Title",
                    "content": "Initial Content",
                    "media": [],
                    "flag": [],
                    "next": []
                }
            }
        }"#;
        std::fs::write(path1.join("archive/data/story.json"), story1).unwrap();
        std::fs::write(
            path1.join("archive/data/music.json"),
            r#"{"albums":[],"tracks":[],"artists":[],"flashes":[]}"#,
        )
        .unwrap();

        let store = ArchiveStore::load_from_dir(path1);
        let p1 = store.get_story_page("000001").await.unwrap();
        assert_eq!(p1.title, "Initial Title");

        let temp_dir2 = tempdir().unwrap();
        let path2 = temp_dir2.path();
        std::fs::create_dir_all(path2.join("archive/data")).unwrap();
        let story2 = r#"{
            "story": {
                "000001": {
                    "pageId": "000001",
                    "title": "Reloaded Title",
                    "content": "Reloaded Content",
                    "media": [],
                    "flag": [],
                    "next": []
                }
            }
        }"#;
        std::fs::write(path2.join("archive/data/story.json"), story2).unwrap();
        std::fs::write(
            path2.join("archive/data/music.json"),
            r#"{"albums":[],"tracks":[],"artists":[],"flashes":[]}"#,
        )
        .unwrap();

        store.reload_from_dir(path2);
        let p2 = store.get_story_page("000001").await.unwrap();
        assert_eq!(p2.title, "Reloaded Title");
    }
}
