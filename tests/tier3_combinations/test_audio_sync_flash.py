"""
Tier 3: Cross-Feature Combinations - Audio Sync Delay Calculations & Flash Assets
Tests cross-referencing between Flash .swf asset delivery and audio delay calibration tables.
"""

from tests.common import RrwrTestCase, load_oracle_flash_props


class TestAudioSyncFlash(RrwrTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.flash_props = load_oracle_flash_props()

    def test_flash_asset_and_negative_seek_delay(self):
        # Page 000007: [S] Chapter 1: Rise up. -> /storyfiles/comic1/scene1/scene1.swf
        swf_path = "storyfiles/comic1/scene1/scene1.swf"
        resp = self.client.get(f"/assets/{swf_path}")
        self.assertStatus(resp, 200)
        self.assertHeader(resp, "Content-Type", "application/x-shockwave-flash")

        # Audio delay lookup for scene1: negative 100ms
        audio_delays = self.flash_props.get("audioDelay", {})
        delay = audio_delays.get("scene1")
        self.assertEqual(delay, -100)

    def test_finale_multi_segment_flash_and_delays(self):
        # Page 000008: [S] Finale. -> /storyfiles/comic1/scene2/scene2.swf
        swf_path = "storyfiles/comic1/scene2/scene2.swf"
        resp = self.client.get(f"/assets/{swf_path}")
        self.assertStatus(resp, 200)
        self.assertHeader(resp, "Content-Type", "application/x-shockwave-flash")

        # Finale multi-segment delay table verification
        audio_delays = self.flash_props.get("audioDelay", {})
        self.assertEqual(audio_delays.get("scene2_1"), -50)
        self.assertEqual(audio_delays.get("scene2_2"), 575)
        self.assertEqual(audio_delays.get("scene2_3"), 1550)
        self.assertEqual(audio_delays.get("scene2_4"), 600)
        self.assertEqual(audio_delays.get("scene2_5"), 1200)
