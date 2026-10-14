"""Exercise Admin vision with real GA serializers and an offline HTTP transport.

Usage: python -B cmd/chat_worker_image_install_test.py /path/to/GenericAgent
No profile, secret file, real endpoint, or running service is used.
"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.dont_write_bytecode = True
if len(sys.argv) < 2:
    raise SystemExit("Usage: this_test.py /path/to/GenericAgent")
GA_ROOT = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(GA_ROOT))
import llmcore
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "admin_image_worker", Path(__file__).with_name("chat_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class FakeHTTPResponse:
    headers = {}

    def __init__(self, payload, status=200):
        self.status_code = status
        self.text = "synthetic image limit" if status != 200 else ""
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def close(self):
        pass

    def json(self):
        return self.payload


class RealVisionInstallTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.image = Path(temporary.name) / "sample.png"
        Image.new("RGB", (320, 240), "red").save(self.image)
        self.requests = []
        self.fail_next = False
        self.fail_primary = False
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(llmcore.requests, "post", side_effect=self.post).start()
        # A regression must never silently consult the user's real profiles.
        mock.patch.object(llmcore, "_load_mykeys", side_effect=AssertionError(
            "real profile loading is forbidden in offline tests")).start()

    def post(self, url, **kwargs):
        payload = json.loads(json.dumps(kwargs["json"]))
        self.requests.append((url, payload))
        status = 200
        if self.fail_next or (self.fail_primary and "primary.invalid" in url):
            self.fail_next = False
            status = 413
        endpoint = url.split("?", 1)[0]
        if endpoint.endswith("/messages"):
            result = {"content": [{"type": "text", "text": "ok"}]}
        elif endpoint.endswith("/responses"):
            result = {"output": [{"type": "message", "content": [
                {"type": "output_text", "text": "ok"}]}]}
        else:
            result = {"choices": [{"message": {"content": "ok"}}]}
        return FakeHTTPResponse(result, status)

    def backend(self, protocol, host="offline.invalid"):
        cfg = {"apikey": "synthetic-not-a-secret", "apibase": "https://" + host + "/v1",
               "model": "offline-vision", "stream": False, "max_retries": 0,
               "context_win": 1000000, "name": host}
        if protocol == "claude":
            return llmcore.NativeClaudeSession(cfg)
        cfg["api_mode"] = protocol
        return llmcore.NativeOAISession(cfg)

    @staticmethod
    def image_count(value):
        if isinstance(value, dict):
            own = int(value.get("type") in ("image", "image_url", "input_image"))
            return own + sum(RealVisionInstallTest.image_count(v) for v in value.values())
        if isinstance(value, list):
            return sum(RealVisionInstallTest.image_count(v) for v in value)
        return 0

    def chat(self, client, text):
        return "".join(client.chat([{"role": "user", "content": text}]))

    def test_all_native_protocols_keep_vision_out_of_history_and_allow_continuation(self):
        for protocol in ("chat_completions", "responses", "claude"):
            with self.subTest(protocol=protocol):
                self.requests.clear()
                backend = self.backend(protocol)
                client = llmcore.NativeToolClient(backend)
                agent = SimpleNamespace(llmclient=client)
                restore = worker._install_image_injection(agent, [self.image] * 8)
                try:
                    self.assertEqual(self.chat(client, "inspect [image:sample.png]"), "ok")
                    self.assertEqual(self.image_count(self.requests[-1][1]), 8)
                    self.assertEqual(self.image_count(backend.history), 0)
                    self.assertEqual(self.chat(client, "tool completed; continue inspecting"), "ok")
                    self.assertEqual(self.image_count(self.requests[-1][1]), 8)
                    self.assertEqual(self.image_count(worker._snapshot_backend_history(agent)), 0)
                finally:
                    restore()
                    restore()
                self.assertNotIn("raw_ask", vars(backend))
                self.assertEqual(self.chat(client, "next turn without attachments"), "ok")
                self.assertEqual(self.image_count(self.requests[-1][1]), 0)

    def test_http_rejection_does_not_poison_next_turn(self):
        for protocol in ("chat_completions", "responses", "claude"):
            with self.subTest(protocol=protocol):
                backend = self.backend(protocol)
                client = llmcore.NativeToolClient(backend)
                restore = worker._install_image_injection(
                    SimpleNamespace(llmclient=client), [self.image] * 8)
                self.fail_next = True
                try:
                    self.assertIn("HTTP 413", self.chat(client, "inspect [image:sample.png]"))
                    self.assertEqual(self.image_count(backend.history), 0)
                finally:
                    restore()
                self.assertEqual(self.chat(client, "please continue"), "ok")
                self.assertEqual(self.image_count(self.requests[-1][1]), 0)

    def test_mixin_fallback_receives_images_and_facade_is_restored(self):
        primary = self.backend("chat_completions", "primary.invalid")
        secondary = self.backend("claude", "fallback.invalid")
        backend = llmcore.MixinSession([
            SimpleNamespace(backend=primary), SimpleNamespace(backend=secondary)], {
            "llm_nos": [0, 1], "max_retries": 1, "base_delay": 0})
        client = llmcore.NativeToolClient(backend)
        self.fail_primary = True
        restore = worker._install_image_injection(
            SimpleNamespace(llmclient=client), [self.image] * 2)
        self.assertIn("raw_ask", vars(backend))
        try:
            self.assertEqual(self.chat(client, "inspect [image:sample.png]"), "ok")
            self.assertEqual(len(self.requests), 2)
            self.assertTrue(all(self.image_count(payload) == 2 for _, payload in self.requests))
            self.assertEqual(self.image_count(backend.history), 0)
        finally:
            restore()
            restore()
        self.assertNotIn("raw_ask", vars(backend))
        self.assertTrue(all("raw_ask" not in vars(s) for s in backend._sessions))
        self.assertEqual(self.chat(client, "plain continuation"), "ok")
        self.assertEqual(self.image_count(self.requests[-1][1]), 0)


if __name__ == "__main__":
    unittest.main()
