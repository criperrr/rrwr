"""
Tier 4: Real-World Scenarios - Full Sample PT-BR Localized Reading Session
Simulates enabling the PT-BR community mod, reading translated pages, verifying chatlog hooks, and loading localized media.
"""

from tests.common import RrwrTestCase, evaluate_ptbr_log_button_text


class TestPtBrReadingSessionScenario(RrwrTestCase):

    def test_complete_ptbr_reading_session(self):
        # 1. Enable PT-BR mod
        toggle_resp = self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": True})
        self.assertStatus(toggle_resp, 200)

        # 2. Read translated Act 1 opener (000001)
        p1 = self.client.ipc("get_story_page", {"page_id": "000001"}).json()
        self.assertIn("Um jovem explorador está em um quarto silencioso", p1["content"])
        self.assertIn("Hoje é um dia especial", p1["content"])

        # 3. Read translated page 000002 and verify localized media
        p2 = self.client.ipc("get_story_page", {"page_id": "000002"}).json()
        self.assertEqual(p2["title"], "Escolha um nome.")

        # Localized 00002.gif asset served via VFS
        img_resp = self.client.get("/assets/storyfiles/comic1/00002.gif")
        self.assertStatus(img_resp, 200)
        self.assertEqual(len(img_resp.data), 332777)

        # 4. Read chatlog page 000006
        p6 = self.client.ipc("get_story_page", {"page_id": "000006"}).json()
        self.assertEqual(p6["title"], "Alex: Vá para a sacada.")
        self.assertIn("AL: ei, eu tô na sacada agora.", p6["content"])

        # 5. Verify vueHooks dynamic logButtonText evaluation
        btn_closed = evaluate_ptbr_log_button_text(p6["content"], log_hidden=True)
        self.assertEqual(btn_closed, "Abrir chatlog")

        btn_opened = evaluate_ptbr_log_button_text(p6["content"], log_hidden=False)
        self.assertEqual(btn_opened, "Fechar chatlog")

        # 6. Clean up: disable mod
        self.client.ipc("toggle_mod", {"mod_id": "Sample PT-BR", "enabled": False})
