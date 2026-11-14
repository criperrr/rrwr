"""
Tier 1: Feature Coverage - In-Memory Monolithic Store (F04)
Tests story.json and music.json loading, querying, and range indexing.
"""

from tests.common import RrwrTestCase, load_oracle_story, load_oracle_music


class TestMonolithicStore(RrwrTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.oracle_story = load_oracle_story()
        cls.oracle_music = load_oracle_music()

    def test_store_loads_first_story_page(self):
        expected = self.oracle_story["story"]["000001"]
        resp = self.client.ipc("get_story_page", {"page_id": "000001"})
        self.assertStatus(resp, 200)
        data = resp.json()
        self.assertEqual(data.get("pageId"), "000001")
        self.assertEqual(data.get("title"), expected["title"])
        self.assertEqual(data.get("media"), expected["media"])
        self.assertEqual(data.get("next"), expected["next"])

    def test_store_loads_second_story_page(self):
        expected = self.oracle_story["story"]["000002"]
        resp = self.client.ipc("get_story_page", {"page_id": "000002"})
        self.assertStatus(resp, 200)
        data = resp.json()
        self.assertEqual(data.get("pageId"), "000002")
        self.assertEqual(data.get("title"), expected["title"])
        self.assertEqual(data.get("media"), expected["media"])

    def test_store_loads_chatlog_page(self):
        expected = self.oracle_story["story"]["000006"]
        resp = self.client.ipc("get_story_page", {"page_id": "000006"})
        self.assertStatus(resp, 200)
        data = resp.json()
        self.assertEqual(data.get("pageId"), "000006")
        self.assertIn("CHATLOG", data.get("content", ""))

    def test_store_returns_story_range(self):
        resp = self.client.ipc("get_story_range", {"start": 1, "count": 5})
        self.assertStatus(resp, 200)
        items = resp.json()
        self.assertEqual(len(items), 5)
        self.assertEqual(items[0]["pageId"], "000001")
        self.assertEqual(items[4]["pageId"], "000005")
        for i, item in enumerate(items):
            pid = str(1 + i).zfill(6)
            self.assertEqual(item["title"], self.oracle_story["story"][pid]["title"])

    def test_store_loads_music_archive(self):
        resp = self.client.ipc("get_music_data")
        self.assertStatus(resp, 200)
        music_data = resp.json()
        self.assertIn("albums", music_data)
        self.assertIn("tracks", music_data)
        self.assertEqual(len(music_data["albums"]), len(self.oracle_music["albums"]))
        self.assertEqual(len(music_data["tracks"]), len(self.oracle_music["tracks"]))

    def test_store_queries_specific_track(self):
        expected_track = self.oracle_music["tracks"]["opening-theme"]
        resp = self.client.ipc("get_music_data")
        self.assertStatus(resp, 200)
        music_data = resp.json()
        track = music_data["tracks"].get("opening-theme")
        self.assertIsNotNone(track)
        self.assertEqual(track["name"], expected_track["name"])
        self.assertEqual(track["duration"], expected_track["duration"])
