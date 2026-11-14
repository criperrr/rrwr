"""
Tier 3: Cross-Feature Combinations - Mod PT-BR Overlay + Story Page Fetch
Tests simultaneous JSON translation merging and VFS media overlay.
"""

from tests.common import RrwrTestCase, load_oracle_ptbr_translation


class TestModOverlayStory(RrwrTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.oracle_ptbr = load_oracle_ptbr_translation()

    def test_mod_enabled_overlays_translation_and_vfs_media(self):
        # 1. Enable PT-BR Mod
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": True})

        # 2. Verify translated story page 000001
        resp = self.client.ipc("get_story_page", {"page_id": "000001"})
        self.assertStatus(resp, 200)
        page = resp.json()
        expected_content = self.oracle_ptbr["000001"]["content"]
        self.assertEqual(page["content"], expected_content)
        self.assertIn("Um jovem explorador", page["content"])

        # 3. Verify translated title for page 000002
        resp2 = self.client.ipc("get_story_page", {"page_id": "000002"})
        self.assertStatus(resp2, 200)
        self.assertEqual(resp2.json()["title"], "Escolha um nome.")

        # 4. Verify VFS media overlay for 00002.gif (synthetic localized image is 332,777 bytes)
        asset_resp = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertStatus(asset_resp, 200)
        self.assertEqual(len(asset_resp.data), 332777)

        # 5. Disable PT-BR Mod
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})

        # 6. Verify base story page returns canonical English
        resp_base = self.client.ipc("get_story_page", {"page_id": "000001"})
        self.assertStatus(resp_base, 200)
        self.assertIn("A young explorer stands in a quiet room", resp_base.json()["content"])

        # 7. Verify base asset returns canonical size (332,039 bytes)
        asset_base_resp = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertStatus(asset_base_resp, 200)
        self.assertEqual(len(asset_base_resp.data), 332039)
