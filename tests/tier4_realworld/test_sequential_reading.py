"""
Tier 4: Real-World Scenarios - Sequential Story Reader Walkthrough
Simulates an end-to-end user reading session traversing consecutive story pages with history tracking.
"""

from tests.common import RrwrTestCase


class TestSequentialReadingScenario(RrwrTestCase):

    def test_sequential_reading_walkthrough(self):
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})
        history = []
        current_page_id = "000001"

        expected_sequence = [
            ("000001", "Sample WebComic", "/storyfiles/comic1/00001.gif"),
            ("000002", "Choose a name.", "/storyfiles/comic1/00002.gif"),
            ("000003", "Look around.", "/storyfiles/comic1/00003.gif"),
            ("000004", "Inspect the desk.", "/storyfiles/comic1/00004.gif"),
        ]

        for pid, expected_title, expected_media in expected_sequence:
            resp = self.client.ipc("get_story_page", {"page_id": pid})
            self.assertStatus(resp, 200)
            page_data = resp.json()

            # Verify page metadata
            self.assertEqual(page_data["pageId"], pid)
            self.assertEqual(page_data["title"], expected_title)
            self.assertIn(expected_media, page_data["media"])

            # Verify asset server can serve the page media
            media_rel = expected_media.lstrip("/")
            asset_resp = self.client.get(f"/assets/{media_rel}")
            self.assertStatus(asset_resp, 200)

            # Record history
            history.append(pid)

        self.assertEqual(history, ["000001", "000002", "000003", "000004"])

        # Backward navigation check
        last_page = self.client.ipc("get_story_page", {"page_id": "000004"}).json()
        self.assertEqual(last_page.get("previous"), "000003")
