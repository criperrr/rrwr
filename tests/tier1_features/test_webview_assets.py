"""
Tier 1: Feature Coverage - Webview Assets & Shell (F07/F09)
Tests webview entrypoint, HTML shell, styling assets, and CORS preflight.
"""

from tests.common import RrwrTestCase


class TestWebviewAssets(RrwrTestCase):

    def test_webview_loads_index_html(self):
        resp = self.client.get("/")
        self.assertStatus(resp, 200)
        self.assertHeaderContains(resp, "Content-Type", "text/html")
        self.assertIn("Retro Reader with Ruffle", resp.text)

    def test_webview_loads_ruffle_wasm(self):
        resp = self.client.get("/assets/archive/imods/_ruffle_bundle/js/ruffle/e6c08a4d57d1c54d19e9.wasm")
        self.assertStatus(resp, 200)
        self.assertHeader(resp, "Content-Type", "application/wasm")
        self.assertTrue(len(resp.data) > 0)

    def test_webview_loads_static_css(self):
        resp = self.client.get("/styles/main.css")
        self.assertStatus(resp, 200)
        self.assertHeader(resp, "Content-Type", "text/css")
        self.assertIn("font-family", resp.text)

    def test_webview_loads_retro_theme_asset(self):
        resp = self.client.get("/assets/images/bannerframe.png")
        self.assertStatus(resp, 200)
        self.assertHeader(resp, "Content-Type", "image/png")

    def test_webview_options_preflight_cors(self):
        resp = self.client.request("OPTIONS", "/assets/images/bannerframe.png")
        self.assertStatus(resp, 204)
        self.assertHeader(resp, "Access-Control-Allow-Origin", "*")
        self.assertHeaderContains(resp, "Access-Control-Allow-Methods", "GET")
