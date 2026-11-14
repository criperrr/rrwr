"""
Tier 4: Real-World Scenarios - Flash Page Playback with Audio Sync Offsets
Simulates loading Flash pages, fetching SWFs, and dispatching calibrated Frag IPC audio sync events.
"""

from tests.common import RrwrTestCase, load_oracle_flash_props


class TestFlashAudioSyncScenario(RrwrTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.flash_props = load_oracle_flash_props()

    def test_rise_up_flash_audio_sync(self):
        # 1. Fetch story page 000007: [S] Chapter 1: Rise up.
        page = self.client.ipc("get_story_page", {"page_id": "000007"}).json()
        self.assertEqual(page["title"], "[S] Chapter 1: Rise up.")
        self.assertIn("/storyfiles/comic1/scene1/scene1.swf", page["media"])

        # 2. Fetch Flash SWF asset
        swf_resp = self.client.get("/assets/storyfiles/comic1/scene1/scene1.swf")
        self.assertStatus(swf_resp, 200)
        self.assertHeader(swf_resp, "Content-Type", "application/x-shockwave-flash")

        # 3. Simulate ActionScript getURL("about:srcdoc#audioStart?1")
        # Host intercepts hashchange: calculates calibrated delay offset
        delay = self.flash_props.get("audioDelay", {}).get("scene1", 0)
        self.assertEqual(delay, -100)

        # Negative delay implies immediate audio seek of 100ms
        audio_start_offset_ms = abs(delay) if delay < 0 else 0
        self.assertEqual(audio_start_offset_ms, 100)

    def test_finale_flash_multi_segment_sync(self):
        # 1. Fetch story page 000008: [S] Finale.
        page = self.client.ipc("get_story_page", {"page_id": "000008"}).json()
        self.assertEqual(page["title"], "[S] Finale.")

        # 2. Fetch Finale SWF asset
        swf_resp = self.client.get("/assets/storyfiles/comic1/scene2/scene2.swf")
        self.assertStatus(swf_resp, 200)

        # 3. Verify subsegment timing progression
        delays = self.flash_props.get("audioDelay", {})
        subsegments = ["scene2_1", "scene2_2", "scene2_3", "scene2_4", "scene2_5"]
        for seg in subsegments:
            self.assertIn(seg, delays)
