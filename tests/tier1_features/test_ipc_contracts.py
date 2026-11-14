"""
Tier 1: Feature Coverage - Tauri Core IPC APIs (F06)
Tests IPC command dispatcher and response contracts.
"""

from tests.common import RrwrTestCase, ASSET_PACK_DIR


class TestIpcContracts(RrwrTestCase):

    def test_ipc_get_app_info(self):
        resp = self.client.ipc("get_app_info")
        self.assertStatus(resp, 200)
        info = resp.json()
        self.assertIn("version", info)
        self.assertIn("asset_dir", info)
        self.assertIn("asset_port", info)
        self.assertEqual(info["asset_dir"], ASSET_PACK_DIR)
        self.assertIsInstance(info["asset_port"], int)

    def test_ipc_get_story_page(self):
        resp = self.client.ipc("get_story_page", {"page_id": "000001"})
        self.assertStatus(resp, 200)
        page = resp.json()
        self.assertEqual(page["pageId"], "000001")
        self.assertEqual(page["title"], "Sample WebComic")

    def test_ipc_get_story_range(self):
        resp = self.client.ipc("get_story_range", {"start": 1, "count": 3})
        self.assertStatus(resp, 200)
        items = resp.json()
        self.assertEqual(len(items), 3)

    def test_ipc_get_music_data(self):
        resp = self.client.ipc("get_music_data")
        self.assertStatus(resp, 200)
        data = resp.json()
        self.assertIn("albums", data)
        self.assertIn("tracks", data)

    def test_ipc_get_available_mods(self):
        resp = self.client.ipc("get_available_mods")
        self.assertStatus(resp, 200)
        mods = resp.json()
        self.assertTrue(isinstance(mods, list))
        mod_ids = [m["id"] for m in mods]
        self.assertIn("Sample PT-BR", mod_ids)

    def test_ipc_toggle_mod(self):
        # Enable mod
        resp_on = self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": True})
        self.assertStatus(resp_on, 200)
        self.assertTrue(resp_on.json()["enabled"])

        # Disable mod
        resp_off = self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})
        self.assertStatus(resp_off, 200)
        self.assertFalse(resp_off.json()["enabled"])
