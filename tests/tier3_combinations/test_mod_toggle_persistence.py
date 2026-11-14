"""
Tier 3: Cross-Feature Combinations - Mod Toggle Runtime Persistence
Tests that runtime mod toggling synchronously updates configuration and asset routing.
"""

from tests.common import RrwrTestCase


class TestModTogglePersistence(RrwrTestCase):

    def test_mod_toggle_updates_config_and_asset_routing(self):
        # Initial state: turn off
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})

        # Verify config reflects disabled
        cfg = self.client.ipc("load_config").json()
        self.assertNotIn("Sample PT-BR", cfg.get("settings", {}).get("modListEnabled", []))

        # Asset should be base size (332,039 bytes)
        resp1 = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertEqual(len(resp1.data), 332039)

        # Toggle ON
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": True})

        # Verify config reflects enabled
        cfg2 = self.client.ipc("load_config").json()
        self.assertIn("Sample PT-BR", cfg2.get("settings", {}).get("modListEnabled", []))

        # Asset should now be mod size (332,777 bytes)
        resp2 = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertEqual(len(resp2.data), 332777)

        # Toggle back OFF
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})
        resp3 = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertEqual(len(resp3.data), 332039)
