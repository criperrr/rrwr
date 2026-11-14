"""
Tier 3: Cross-Feature Combinations - Range Streaming on VFS Overlay Assets
Tests HTTP Range requests on base asset vs. mod overlay asset.
"""

from tests.common import RrwrTestCase


class TestRangeStreamingOverlay(RrwrTestCase):

    def test_range_request_on_base_vs_overlay_asset(self):
        # 1. Base asset range request (Mod disabled)
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})

        resp_base = self.client.get(
            "/assets/storyfiles/comic1/00002.gif",
            headers={"Range": "bytes=0-99"}
        )
        self.assertStatus(resp_base, 206)
        self.assertEqual(len(resp_base.data), 100)
        self.assertHeader(resp_base, "Content-Range", "bytes 0-99/332039")

        # 2. Mod overlay range request (Mod enabled)
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": True})

        resp_mod = self.client.get(
            "/assets/storyfiles/comic1/00002.gif",
            headers={"Range": "bytes=0-99"}
        )
        self.assertStatus(resp_mod, 206)
        self.assertEqual(len(resp_mod.data), 100)
        self.assertHeader(resp_mod, "Content-Range", "bytes 0-99/332777")

        # 3. Clean up
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})
