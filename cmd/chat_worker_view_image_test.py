"""Exercise the Admin view_image tool with real GA serializers and an offline transport.

Usage: python -B cmd/chat_worker_view_image_test.py /path/to/GenericAgent
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
import agentmain
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "admin_view_image_worker", Path(__file__).with_name("chat_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class FakeHTTPResponse:
    headers = {}
    text = ""

    def __init__(self, payload):
        self.status_code = 200
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def close(self):
        pass

    def json(self):
        return self.payload


def image_count(value):
    if isinstance(value, dict):
        own = int(value.get("type") in ("image", "image_url", "input_image"))
        return own + sum(image_count(v) for v in value.values())
    if isinstance(value, list):
        return sum(image_count(v) for v in value)
    return 0


class ViewImageToolTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.dir = Path(temporary.name)
        Image.new("RGB", (320, 240), "red").save(self.dir / "shot.png")
        self.requests = []
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(llmcore.requests, "post", side_effect=self.post).start()
        mock.patch.object(llmcore, "_load_mykeys", side_effect=AssertionError(
            "real profile loading is forbidden in offline tests")).start()
        self.schema = agentmain.TOOLS_SCHEMA
        self.had_attr = "do_view_image" in agentmain.GenericAgentHandler.__dict__

    def post(self, url, **kwargs):
        payload = json.loads(json.dumps(kwargs["json"]))
        self.requests.append((url, payload))
        endpoint = url.split("?", 1)[0]
        if endpoint.endswith("/messages"):
            result = {"content": [{"type": "text", "text": "red square"}]}
        elif endpoint.endswith("/responses"):
            result = {"output": [{"type": "message", "content": [
                {"type": "output_text", "text": "red square"}]}]}
        else:
            result = {"choices": [{"message": {"content": "red square"}}]}
        return FakeHTTPResponse(result)

    def backend(self, protocol):
        cfg = {"apikey": "synthetic-not-a-secret", "apibase": "https://offline.invalid/v1",
               "model": "offline", "stream": False, "max_retries": 0,
               "context_win": 1000000, "name": "offline"}
        if protocol == "claude":
            return llmcore.NativeClaudeSession(cfg)
        cfg["api_mode"] = protocol
        return llmcore.NativeOAISession(cfg)

    def handler(self):
        return SimpleNamespace(_get_abs_path=lambda p: str(self.dir / p))

    def call(self, args):
        method = agentmain.GenericAgentHandler.do_view_image
        return method(self.handler(), args, None).data

    def assertRestored(self):
        self.assertIs(agentmain.TOOLS_SCHEMA, self.schema)
        self.assertEqual("do_view_image" in agentmain.GenericAgentHandler.__dict__, self.had_attr)

    def test_disabled_or_invalid_config_installs_nothing(self):
        for value in (None, {}, {"enabled": False, "mode": "main"},
                      {"enabled": True, "mode": "other"},
                      {"enabled": True, "mode": "vision", "llm_no": -1},
                      {"enabled": True, "mode": "vision", "llm_no": True}):
            restore = worker._install_view_image_tool(SimpleNamespace(), value)
            self.assertIs(agentmain.TOOLS_SCHEMA, self.schema)
            restore()

    def test_main_mode_attaches_once_and_never_persists(self):
        for protocol in ("chat_completions", "responses", "claude"):
            with self.subTest(protocol=protocol):
                self.requests.clear()
                backend = self.backend(protocol)
                client = llmcore.NativeToolClient(backend)
                restore = worker._install_view_image_tool(
                    SimpleNamespace(llmclient=client), {"enabled": True, "mode": "main"})
                try:
                    names = [t["function"]["name"] for t in agentmain.TOOLS_SCHEMA]
                    self.assertEqual(names.count("view_image"), 1)
                    result = self.call({"path": "shot.png"})
                    self.assertEqual(result["status"], "success")
                    "".join(client.chat([{"role": "user", "content": "tool done, look"}]))
                    self.assertEqual(image_count(self.requests[-1][1]), 1)
                    self.assertEqual(image_count(backend.history), 0)
                    "".join(client.chat([{"role": "user", "content": "continue"}]))
                    self.assertEqual(image_count(self.requests[-1][1]), 0)
                finally:
                    restore()
                    restore()
                self.assertNotIn("raw_ask", vars(backend))
                self.assertRestored()

    def test_main_mode_rejects_text_protocol_and_bad_paths(self):
        restore = worker._install_view_image_tool(
            SimpleNamespace(llmclient=object()), {"enabled": True, "mode": "main"})
        try:
            self.assertIn("vision model", self.call({"path": "shot.png"})["msg"])
            self.assertIn("not found", self.call({"path": "missing.png"})["msg"])
            self.assertIn("required", self.call({})["msg"])
        finally:
            restore()
        self.assertRestored()

    def test_vision_mode_returns_text_without_touching_either_history(self):
        for protocol in ("chat_completions", "responses", "claude"):
            with self.subTest(protocol=protocol):
                self.requests.clear()
                main = self.backend("chat_completions")
                vision = self.backend(protocol)
                vision.system = "ORIGINAL"
                agent = SimpleNamespace(llmclient=llmcore.NativeToolClient(main),
                                        llmclients=[SimpleNamespace(backend=main),
                                                    SimpleNamespace(backend=vision)])
                restore = worker._install_view_image_tool(
                    agent, {"enabled": True, "mode": "vision", "llm_no": 1})
                try:
                    result = self.call({"path": "shot.png", "question": "what colour?"})
                    self.assertEqual(result["status"], "success", result)
                    self.assertEqual(result["vision_model_answer"], "red square")
                    self.assertEqual(len(self.requests), 1)
                    self.assertEqual(image_count(self.requests[0][1]), 1)
                    self.assertIn("what colour?", json.dumps(self.requests[0][1]))
                    self.assertEqual(vision.history, [])
                    self.assertEqual(main.history, [])
                    self.assertEqual(vision.system, "ORIGINAL")
                    missing = worker._install_view_image_tool(
                        agent, {"enabled": True, "mode": "vision", "llm_no": 9})
                    try:
                        self.assertIn("unavailable", self.call({"path": "shot.png"})["msg"])
                    finally:
                        missing()
                finally:
                    restore()
                self.assertRestored()


if __name__ == "__main__":
    unittest.main()
