use rrwr_lib::data::ArchiveStore;
use std::collections::BTreeMap;

fn create_synthetic_archive_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("archive/data");
    std::fs::create_dir_all(&data_dir).unwrap();

    let mut story = BTreeMap::new();
    for i in 1..=10 {
        let id = format!("{:06}", i);
        story.insert(
            id.clone(),
            serde_json::json!({
                "pageId": id,
                "title": format!("Sample Page {}", i),
                "timestamp": format!("{}", 1700000000 + i * 60),
                "content": format!("Content for page {}", i),
                "media": [format!("/media/{:05}.gif", i)],
                "flag": [],
                "next": if i < 10 { vec![format!("{:06}", i + 1)] } else { vec![] },
                "previous": if i > 1 { Some(format!("{:06}", i - 1)) } else { None::<String> }
            }),
        );
    }

    let non_numeric = [
        ("bonus", "Bonus Scene", "/media/bonus/scene.swf"),
        ("bonus2", "Bonus Scene 2", "/media/bonus/scene2.swf"),
        ("epilogue", "Epilogue", "/media/epilogue/end.gif"),
        ("extra_01", "Extra One", "/media/extra/01.gif"),
        ("interlude", "Interlude", "/media/interlude/01.gif"),
        ("prologue", "Prologue", "/media/prologue/01.gif"),
    ];
    for (id, title, media) in non_numeric {
        story.insert(
            id.to_string(),
            serde_json::json!({
                "pageId": id,
                "title": title,
                "timestamp": "1700005000",
                "content": format!("Content for {}", id),
                "media": [media],
                "flag": [],
                "next": [],
                "previous": null
            }),
        );
    }

    let story_json = serde_json::json!({
        "story": story,
        "extra_stories": {
            "extra_only": {
                "pageId": "extra_only",
                "title": "Extra Story Only",
                "timestamp": "1700006000",
                "content": "Separate collection",
                "media": [],
                "flag": [],
                "next": []
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

    dir
}

#[tokio::test]
async fn test_non_numeric_and_boundary_keys() {
    let dir = create_synthetic_archive_dir();
    let store = ArchiveStore::load_from_dir(dir.path());

    // 1. Verify specific non-numeric keys in story store
    let bonus = store
        .get_story_page("bonus")
        .await
        .expect("Key 'bonus' must be found in story store");
    assert_eq!(bonus.page_id, "bonus");
    assert_eq!(bonus.title, "Bonus Scene");
    assert_eq!(bonus.media, vec!["/media/bonus/scene.swf"]);

    let epilogue = store
        .get_story_page("epilogue")
        .await
        .expect("Key 'epilogue' must be found in story store");
    assert_eq!(epilogue.page_id, "epilogue");
    assert_eq!(epilogue.title, "Epilogue");
    assert_eq!(epilogue.media, vec!["/media/epilogue/end.gif"]);

    // 2. Boundary page lookups
    let p_min_padded = store
        .get_story_page("000001")
        .await
        .expect("000001 must exist");
    assert_eq!(p_min_padded.page_id, "000001");
    assert_eq!(p_min_padded.title, "Sample Page 1");

    let p_min_unpadded = store
        .get_story_page("1")
        .await
        .expect("Unpadded '1' must resolve to 000001");
    assert_eq!(p_min_unpadded.page_id, "000001");

    let p_max_padded = store
        .get_story_page("000010")
        .await
        .expect("000010 must exist");
    assert_eq!(p_max_padded.page_id, "000010");
    assert_eq!(p_max_padded.title, "Sample Page 10");

    let p_max_unpadded = store
        .get_story_page("10")
        .await
        .expect("Unpadded '10' must resolve to 000010");
    assert_eq!(p_max_unpadded.page_id, "000010");

    // Non-existent boundary pages
    assert!(store.get_story_page("000000").await.is_none());
    assert!(store.get_story_page("extra_only").await.is_none());
    assert!(store.get_story_page("000011").await.is_none());
    assert!(store.get_story_page("11").await.is_none());
    assert!(store.get_story_page("999999").await.is_none());
    assert!(store.get_story_page("-1").await.is_none());
    assert!(store.get_story_page("").await.is_none());
    assert!(store.get_story_page("   ").await.is_none());
    assert!(store.get_story_page("undefined").await.is_none());
    assert!(store.get_story_page("null").await.is_none());
    assert!(store.get_story_page("../etc/passwd").await.is_none());

    // 3. Boundary range lookups
    let range_zero = store.get_story_range(0, 5).await;
    assert_eq!(range_zero.len(), 5);
    assert_eq!(range_zero[0].page_id, "000001");
    assert_eq!(range_zero[1].page_id, "000002");

    let range_page2 = store.get_story_range(2, 3).await;
    assert_eq!(range_page2.len(), 3);
    assert_eq!(range_page2[0].page_id, "000002");

    // Range reaching the end of numeric pages and crossing into non-numeric keys
    let range_end = store.get_story_range(10, 10).await;
    assert_eq!(range_end.len(), 7); // 000010 + 6 non-numeric keys
    assert_eq!(range_end[0].page_id, "000010");
    let non_numeric_ids: Vec<String> = range_end[1..].iter().map(|s| s.page_id.clone()).collect();
    assert_eq!(
        non_numeric_ids,
        vec![
            "bonus".to_string(),
            "bonus2".to_string(),
            "epilogue".to_string(),
            "extra_01".to_string(),
            "interlude".to_string(),
            "prologue".to_string(),
        ]
    );

    let range_past_total = store.get_story_range(16, 5).await;
    assert!(range_past_total.is_empty());

    let range_far_beyond = store.get_story_range(999999, 10).await;
    assert!(range_far_beyond.is_empty());

    let range_zero_count = store.get_story_range(1, 0).await;
    assert!(range_zero_count.is_empty());

    // 4. Extreme boundary and usize::MAX resilience
    let range_max_start = store.get_story_range(usize::MAX, 10).await;
    assert!(
        range_max_start.is_empty(),
        "usize::MAX start must return empty without panic"
    );

    let range_max_count = store.get_story_range(0, usize::MAX).await;
    assert_eq!(
        range_max_count.len(),
        16,
        "usize::MAX count must saturate to total without panic"
    );

    let range_both_max = store.get_story_range(usize::MAX, usize::MAX).await;
    assert!(
        range_both_max.is_empty(),
        "usize::MAX start and count must return empty without panic"
    );

    let range_overflow_sum = store.get_story_range(10, usize::MAX).await;
    assert_eq!(
        range_overflow_sum.len(),
        7,
        "page 10 with usize::MAX count must yield remaining 7 pages without overflow"
    );

    let range_near_max = store.get_story_range(usize::MAX - 100, usize::MAX).await;
    assert!(
        range_near_max.is_empty(),
        "near-max start must return empty safely"
    );
}
