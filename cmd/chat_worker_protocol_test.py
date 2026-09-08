import importlib.util
import os
import queue
import sys
import tempfile
import threading
import unittest
from unittest import mock
from pathlib import Path
from types import ModuleType, SimpleNamespace


# Import production worker code without rewriting its pre-existing tracked cache.
sys.dont_write_bytecode = True
GA_ROOT = Path(__file__).resolve().parents[4]
if str(GA_ROOT) not in sys.path:
    sys.path.insert(0, str(GA_ROOT))
WORKER_PATH = Path(__file__).with_name("chat_worker.py")
SPEC = importlib.util.spec_from_file_location("ga_admin_chat_worker_under_test", WORKER_PATH)
chat_worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(chat_worker)


REAL_ENSURE_WORLDLINE = chat_worker._ensure_worldline_store
REAL_COMMIT_WORLDLINE = chat_worker._commit_worldline


class FakeWorker:
    def is_alive(self):
        return True


class FakeAgent:
    def __init__(self, fail=False):
        self.fail = fail
        self.prompts = []
        self.llm_no = 0
        self.history = []
        self.handler = SimpleNamespace(working={})
        backend = SimpleNamespace(history=[], model="official-model", reasoning_effort=None)
        self.llmclient = SimpleNamespace(backend=backend, last_tools="cached")

    def next_llm(self, llm_no):
        self.llm_no = llm_no

    def put_task(self, prompt, source=None):
        self.prompts.append((prompt, source))
        if self.fail:
            raise RuntimeError("official task failed")
        self.llmclient.backend.history.append(
            {"role": "assistant", "content": [{"type": "text", "text": "resumed"}]}
        )
        self.history = [{"role": "assistant", "summary": "official resume state"}]
        self.handler = SimpleNamespace(working={"checkpoint": "restored"})
        output = queue.Queue()
        output.put({"next": "res"})
        output.put({"done": "resumed", "outputs": ["segment one", "segment two"]})
        return output


class ToolTimerTests(unittest.TestCase):
    def setUp(self):
        self.old_installed = chat_worker._TOOL_TIMER_HOOK_INSTALLED
        with chat_worker._TOOL_TIMER_LOCK:
            self.old_active = chat_worker._TOOL_TIMER_ACTIVE.copy()
            self.old_total = chat_worker._TOOL_TIMER_TOTAL_SECONDS
            chat_worker._TOOL_TIMER_ACTIVE.clear()
            chat_worker._TOOL_TIMER_TOTAL_SECONDS = 0.0
        chat_worker._TOOL_TIMER_HOOK_INSTALLED = False

    def tearDown(self):
        with chat_worker._TOOL_TIMER_LOCK:
            chat_worker._TOOL_TIMER_ACTIVE.clear()
            chat_worker._TOOL_TIMER_ACTIVE.update(self.old_active)
            chat_worker._TOOL_TIMER_TOTAL_SECONDS = self.old_total
        chat_worker._TOOL_TIMER_HOOK_INSTALLED = self.old_installed

    @staticmethod
    def fake_plugins():
        registry = {}
        hooks = ModuleType("plugins.hooks")

        def register(event):
            def decorator(callback):
                registry.setdefault(event, []).append(callback)
                return callback
            return decorator

        def trigger(event, ctx=None):
            value = ctx or {}
            for callback in registry.get(event, []):
                value = callback(value)
            return value

        hooks.register = register
        hooks.trigger = trigger
        package = ModuleType("plugins")
        package.hooks = hooks
        return package, hooks, registry

    def install_fake_hooks(self):
        package, hooks, registry = self.fake_plugins()
        with mock.patch.dict(sys.modules, {
            "plugins": package,
            "plugins.hooks": hooks,
        }):
            chat_worker._reset_tool_elapsed()
        return hooks, registry

    def test_tool_hooks_accumulate_and_consume_elapsed_ms(self):
        hooks, registry = self.install_fake_hooks()
        self.assertEqual(len(registry["tool_before"]), 1)
        self.assertEqual(len(registry["tool_after"]), 1)

        with mock.patch.object(
            chat_worker.time, "perf_counter",
            side_effect=[10.0, 10.0, 10.125, 10.125, 10.125, 10.125],
        ):
            hooks.trigger("tool_before", {"tool_name": "file_read"})
            hooks.trigger("tool_after", {"tool_name": "file_read"})
            self.assertEqual(chat_worker._consume_tool_elapsed_ms(), 125)
            self.assertEqual(chat_worker._consume_tool_elapsed_ms(), 0)

    def test_consume_closes_unfinished_tool_from_worker_thread(self):
        hooks, _ = self.install_fake_hooks()
        started = threading.Event()

        def begin_tool():
            hooks.trigger("tool_before", {"tool_name": "code_run"})
            started.set()

        with mock.patch.object(
            chat_worker.time, "perf_counter",
            side_effect=[20.0, 20.0, 20.4, 20.4],
        ):
            worker = threading.Thread(target=begin_tool)
            worker.start()
            self.assertTrue(started.wait(timeout=1))
            worker.join(timeout=1)
            self.assertFalse(worker.is_alive())
            self.assertEqual(chat_worker._consume_tool_elapsed_ms(), 400)
            self.assertEqual(chat_worker._consume_tool_elapsed_ms(), 0)

    def test_reset_installs_hooks_only_once_and_clears_elapsed_time(self):
        package, hooks, registry = self.fake_plugins()
        modules = {"plugins": package, "plugins.hooks": hooks}
        with mock.patch.dict(sys.modules, modules):
            chat_worker._reset_tool_elapsed()
            hooks.trigger("tool_before", {})
            chat_worker._reset_tool_elapsed()

        self.assertEqual(len(registry["tool_before"]), 1)
        self.assertEqual(len(registry["tool_after"]), 1)
        self.assertEqual(chat_worker._consume_tool_elapsed_ms(), 0)


class ChatWorkerProtocolTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.old_emit = chat_worker.emit
        self.old_cwd = os.getcwd()
        chat_worker.emit = self.events.append
        self.worldline_store = object()

        def activate_worldline(agent, ga_root, workspace):
            agent._admin_worldline_store = self.worldline_store
            return self.worldline_store

        ensure_patcher = mock.patch.object(
            chat_worker, "_ensure_worldline_store", side_effect=activate_worldline,
        )
        commit_patcher = mock.patch.object(
            chat_worker, "_commit_worldline", return_value="node-1",
        )
        self.ensure_worldline = ensure_patcher.start()
        self.commit_worldline = commit_patcher.start()
        self.addCleanup(commit_patcher.stop)
        self.addCleanup(ensure_patcher.stop)

    def tearDown(self):
        chat_worker.emit = self.old_emit
        os.chdir(self.old_cwd)

    def request(self, prompt="/resume"):
        return {
            "prompt": prompt,
            "history": [{"role": "user", "content": "before"}],
            "raw_history": [{"role": "user", "content": [{"type": "text", "text": "raw-before"}]}],
            "history_info": [{"role": "user", "summary": "before"}],
            "working": {"checkpoint": "before"},
            "llm_no": 0,
            "ga_root": str(WORKER_PATH.parents[1]),
            "project_mode": "",
            "reasoning_effort": "high",
        }

    def test_default_reasoning_effort_inherits_configured_backend_value(self):
        backend = SimpleNamespace(reasoning_effort="medium")
        agent = SimpleNamespace(llmclient=SimpleNamespace(backend=backend))

        chat_worker._apply_reasoning_effort_setting(agent, "high")
        self.assertEqual(backend.reasoning_effort, "high")

        chat_worker._apply_reasoning_effort_setting(agent, "off")
        self.assertEqual(backend.reasoning_effort, "medium")

    def test_default_reasoning_effort_preserves_unset_backend_value(self):
        backend = SimpleNamespace(reasoning_effort=None)
        agent = SimpleNamespace(llmclient=SimpleNamespace(backend=backend))

        chat_worker._apply_reasoning_effort_setting(agent, "max")
        chat_worker._apply_reasoning_effort_setting(agent, "off")

        self.assertIsNone(backend.reasoning_effort)

    def test_resume_reaches_official_put_task_literal_and_done_state_sync(self):
        agent = FakeAgent()

        chat_worker.handle_request(agent, FakeWorker(), self.request())

        self.assertEqual(agent.prompts, [("/resume", "admin_chat")])
        self.assertFalse(any(event.get("type") == "btw_done" for event in self.events))
        done = next(event for event in self.events if event.get("type") == "done")
        self.assertEqual(done["message"]["content"], "resumed")
        self.assertEqual(done["message"]["outputs"], ["segment one", "segment two"])
        self.assertEqual(done["message"]["model_id"], "official-model")
        self.assertEqual(done["raw_history"][-1]["content"][0]["text"], "resumed")
        self.assertEqual(done["history_info"], [{"role": "assistant", "summary": "official resume state"}])
        self.assertEqual(done["working"], {"checkpoint": "restored"})
        self.assertEqual(done["reasoning_effort"], "high")
        self.assertIn("usage", done)
        self.assertIn("usages", done)

    def test_structured_turn_hook_publishes_official_turn_and_is_removed(self):
        class TurnAgent(FakeAgent):
            def put_task(self, prompt, source=None):
                hooks = list(self._turn_end_hooks.values())
                self.assert_hook_count = len(hooks)
                hooks[0]({
                    "summary": "checked files",
                    "response": SimpleNamespace(
                        thinking="inspect repository",
                        content="implemented fix",
                    ),
                    "tool_calls": [{"name": "file_read", "arguments": {"path": "a.py"}}],
                })
                return super().put_task(prompt, source=source)

        agent = TurnAgent()
        chat_worker.handle_request(agent, FakeWorker(), self.request())

        self.assertEqual(agent.assert_hook_count, 1)
        turn = next(event for event in self.events if event.get("type") == "turn")
        self.assertEqual(turn, {
            "type": "turn",
            "summary": "checked files",
            "thinking": "inspect repository",
            "content": "implemented fix",
            "tool_calls": [{"name": "file_read", "arguments": {"path": "a.py"}}],
        })
        self.assertEqual(agent._turn_end_hooks, {})

    def test_structured_turn_hook_is_removed_after_request_error(self):
        agent = FakeAgent(fail=True)

        chat_worker.handle_request(agent, FakeWorker(), self.request())

        self.assertEqual(agent._turn_end_hooks, {})
        self.assertTrue(any(event.get("type") == "error" for event in self.events))

    def test_usage_is_published_on_cache_then_completed_at_the_same_index(self):
        chat_worker._reset_usage()
        capture = chat_worker._UsageCapturingStderr(mock.Mock())

        capture.write("[Cache] input=1500 cached=821500\n")
        live = self.events[-1]
        self.assertEqual(live["type"], "turn_usage")
        self.assertEqual(live["index"], 0)
        self.assertEqual(live["usage"], {
            "input_tokens": 1500,
            "cache_creation_tokens": 0,
            "cache_read_tokens": 821500,
            "output_tokens": 0,
            "cached_tokens": 0,
            "input_tokens_include_cache_read": 1,
        })

        capture.write("[Output] tokens=22100\n")
        completed = self.events[-1]
        self.assertEqual(completed["type"], "turn_usage")
        self.assertEqual(completed["index"], 0)
        self.assertEqual(completed["usage"], {
            "input_tokens": 1500,
            "cache_creation_tokens": 0,
            "cache_read_tokens": 821500,
            "output_tokens": 22100,
            "cached_tokens": 0,
            "input_tokens_include_cache_read": 1,
        })
        self.assertEqual(chat_worker._snapshot_turn_usages(), [completed["usage"]])

    def test_claude_cache_usage_counts_creation_and_read_in_total_input(self):
        chat_worker._reset_usage()
        capture = chat_worker._UsageCapturingStderr(mock.Mock())

        capture.write("[Cache] input=1500 creation=1200 read=821500\n")

        live = self.events[-1]
        self.assertEqual(live["type"], "turn_usage")
        self.assertEqual(live["usage"], {
            "input_tokens": 1500,
            "cache_creation_tokens": 1200,
            "cache_read_tokens": 821500,
            "output_tokens": 0,
            "cached_tokens": 0,
            "input_tokens_include_cache_read": 0,
        })

    def test_transport_error_attempt_seals_usage_before_fallback(self):
        class LeafSession:
            def __init__(self, model, result):
                self.model = model
                self.result = result

            def raw_ask(self, messages):
                result = self.result

                def stream():
                    chat_worker.sys.stderr.write(result[0])
                    yield result[1]
                    if len(result) > 2:
                        chat_worker.sys.stderr.write(result[2])
                return stream()

        failed = LeafSession("claude-first", (
            "[Cache] input=100 creation=20 read=80\n",
            '!!!Error: HTTP 503: {"error":{"message":"Service temporarily unavailable","type":"api_error"}}',
        ))
        fallback = LeafSession("claude-fallback", (
            "[Cache] input=200 creation=40 read=160\n",
            "ok",
            "[Output] tokens=30\n",
        ))
        backend = SimpleNamespace(
            history=[],
            model="claude-first",
            reasoning_effort=None,
            _sessions=[failed, fallback],
        )
        agent = FakeAgent()
        agent.llmclient.backend = backend
        chat_worker._reset_usage()

        restore = chat_worker._install_outbound_model_hooks(agent)
        try:
            with mock.patch.object(chat_worker.time, "perf_counter", side_effect=[10.0, 11.0, 11.4, 11.9]):
                self.assertIn("!!!Error: HTTP 503", "".join(failed.raw_ask([])))
                self.assertEqual("".join(fallback.raw_ask([])), "ok")
        finally:
            restore()

        self.assertEqual(chat_worker._snapshot_turn_usages(), [
            {"input_tokens": 100, "cache_creation_tokens": 20, "cache_read_tokens": 80, "output_tokens": 0, "cached_tokens": 0, "input_tokens_include_cache_read": 0},
            {"input_tokens": 200, "cache_creation_tokens": 40, "cache_read_tokens": 160, "output_tokens": 30, "cached_tokens": 0, "input_tokens_include_cache_read": 0, "ttft_ms": 400, "generation_ms": 500},
        ])
        usage_events = [event for event in self.events if event.get("type") == "turn_usage"]
        self.assertEqual(usage_events[-2]["index"], 1)
        self.assertEqual(usage_events[-1]["index"], 1)
        self.assertEqual(
            [event for event in self.events if event.get("type") == "model_first_token"],
            [{"type": "model_first_token"}],
        )

    def test_outbound_model_events_follow_each_mixin_fallback_attempt(self):
        class LeafSession:
            def __init__(self, model, result):
                self.model = model
                self.result = result

            def raw_ask(self, messages):
                return iter([self.result])

        first = LeafSession("claude-first", "!!!Error: unavailable")
        second = LeafSession("claude-fallback", "ok")
        backend = SimpleNamespace(
            history=[],
            model="claude-first",
            reasoning_effort=None,
            _sessions=[first, second],
        )
        agent = FakeAgent()
        agent.llmclient.backend = backend

        restore = chat_worker._install_outbound_model_hooks(agent)
        try:
            list(first.raw_ask([]))
            list(second.raw_ask([]))
        finally:
            restore()

        model_ids = [event["model_id"] for event in self.events if event.get("type") == "model"]
        self.assertEqual(model_ids, ["claude-first", "claude-fallback"])
        self.assertNotIn("raw_ask", first.__dict__)
        self.assertNotIn("raw_ask", second.__dict__)

    def test_old_ga_without_worldline_can_complete_chat_and_activate_rpc(self):
        agent = FakeAgent()
        self.ensure_worldline.side_effect = REAL_ENSURE_WORLDLINE
        self.commit_worldline.side_effect = REAL_COMMIT_WORLDLINE
        with mock.patch.dict(sys.modules, {"frontends.worldline": None}):
            chat_worker.handle_request(agent, FakeWorker(), self.request("ordinary prompt"))
            self.assertTrue(any(e.get("type") == "done" for e in self.events))
            self.assertFalse(hasattr(agent, "_admin_worldline_store"))
            req = self.request()
            req.update(action="state", activate=True, sid="legacy-chat")
            chat_worker.handle_worldline_request(agent, req)
            self.assertEqual(self.events[-1]["type"], "worldline")
            self.assertEqual(self.events[-1]["tree"]["nodes"], [])

    def test_worldline_transitive_import_failure_is_not_suppressed(self):
        original = __import__
        def importing(name, *args, **kwargs):
            if name == "frontends.worldline":
                raise ModuleNotFoundError("missing dependency", name="missing_dependency")
            return original(name, *args, **kwargs)
        with mock.patch("builtins.__import__", side_effect=importing):
            with self.assertRaises(ModuleNotFoundError):
                REAL_ENSURE_WORLDLINE(FakeAgent(), ".", "")

    def test_ordinary_request_activates_worldline_before_agent_turn(self):
        class ActivationAwareAgent(FakeAgent):
            def put_task(self, prompt, source=None):
                self.worldline_active_during_turn = hasattr(self, "_admin_worldline_store")
                return super().put_task(prompt, source=source)

        agent = ActivationAwareAgent()
        req = self.request("ordinary prompt")

        chat_worker.handle_request(agent, FakeWorker(), req)

        self.ensure_worldline.assert_called_once_with(agent, Path(req["ga_root"]).resolve(), "")
        self.assertTrue(agent.worldline_active_during_turn)
        self.commit_worldline.assert_called_once_with(agent, "ordinary prompt")

    def test_extra_system_prompts_are_replaced_and_cleared_each_turn(self):
        agent = FakeAgent()
        first = self.request("first prompt")
        first["extra_sys_prompts"] = ["  be concise  ", "", "use JSON"]

        chat_worker.handle_request(agent, FakeWorker(), first)
        self.assertEqual(agent.extra_sys_prompts, ["be concise", "use JSON"])

        chat_worker.handle_request(agent, FakeWorker(), self.request("second prompt"))
        self.assertEqual(agent.extra_sys_prompts, [])

    def test_official_task_error_keeps_ordinary_error_protocol_shape(self):
        agent = FakeAgent(fail=True)

        chat_worker.handle_request(agent, FakeWorker(), self.request("ordinary prompt"))

        self.assertEqual(agent.prompts, [("ordinary prompt", "admin_chat")])
        error = next(event for event in self.events if event.get("type") == "error")
        self.assertTrue(error["message"]["error"])
        self.assertEqual(error["message"]["model_id"], "official-model")
        self.assertIn("official task failed", error["message"]["content"])
        self.assertEqual(error["raw_history"][0]["content"][0]["text"], "raw-before")
        self.assertEqual(error["reasoning_effort"], "high")
        self.assertIn("usage", error)
        self.assertIn("usages", error)

    def test_title_request_uses_isolated_backend_and_structured_conversation(self):
        class FakeTitleBackend:
            def __init__(self):
                self.history = [{"role": "user", "content": "stale"}]
                self.system = ""
                self.model = "title-model"
                self.request = None

            def ask(self, request):
                self.request = request
                return iter(["同步", "上游更新"])

        agent = FakeAgent()
        backend = FakeTitleBackend()
        agent.llmclient.backend = backend

        chat_worker.handle_title_request(agent, {
            "op": "title",
            "llm_no": 0,
            "conversation": {
                "messages": [
                    {"role": "user", "content": "同步上游更新"},
                    {"role": "assistant", "content": "已经完成同步并解决冲突"},
                    {"role": "user", "content": "再加入标题生成功能"},
                ],
            },
        })

        self.assertEqual(backend.history, [])
        self.assertIn("untrusted data", backend.system)
        self.assertIn('"role": "user", "content": "同步上游更新"', backend.request)
        self.assertIn('"role": "assistant", "content": "已经完成同步并解决冲突"', backend.request)
        self.assertIn('"role": "user", "content": "再加入标题生成功能"', backend.request)
        self.assertEqual(self.events[-1]["type"], "title_done")
        self.assertEqual(self.events[-1]["title"], "同步上游更新")

    def test_title_request_rejects_transport_error_text(self):
        class ErrorBackend:
            history = []
            system = ""
            model = "broken-model"

            def ask(self, request):
                return iter(["!!!Error: HTTP 401"])

        agent = FakeAgent()
        agent.llmclient.backend = ErrorBackend()

        with self.assertRaisesRegex(RuntimeError, "title model request failed"):
            chat_worker.handle_title_request(agent, {
                "op": "title",
                "conversation": {"user": "hello", "assistant": "world"},
            })

    def test_title_request_retries_verbose_meta_response(self):
        class VerboseBackend:
            history = []
            system = ""
            model = "title-model"

            def __init__(self):
                self.requests = []

            def ask(self, request):
                self.requests.append(request)
                if len(self.requests) == 1:
                    return iter(["我们被要求为这个对话生成一个标题并总结其中的主要内容"])
                return iter(["旧会话标题自动回填"])

        agent = FakeAgent()
        backend = VerboseBackend()
        agent.llmclient.backend = backend

        chat_worker.handle_title_request(agent, {
            "op": "title",
            "conversation": {
                "messages": [
                    {"role": "user", "content": "旧会话仍然使用第一句话作为标题"},
                    {"role": "assistant", "content": "将自动重新生成"},
                ],
            },
        })

        self.assertEqual(len(backend.requests), 2)
        self.assertTrue(backend.requests[0].startswith("["))
        self.assertNotIn("Create a title", backend.requests[0])
        self.assertEqual(self.events[-1]["title"], "旧会话标题自动回填")

    def test_title_request_uses_final_content_instead_of_reasoning_chunks(self):
        class FinalResponse:
            content = "淘宝SKU布局与定价"

        class ReasoningBackend:
            history = []
            system = ""
            model = "deepseek-title-model"

            def ask(self, request):
                def stream():
                    yield "我们需要分析对话并构造一个标题"
                    return FinalResponse()
                return stream()

        agent = FakeAgent()
        agent.llmclient.backend = ReasoningBackend()

        chat_worker.handle_title_request(agent, {
            "op": "title",
            "conversation": {
                "messages": [
                    {"role": "user", "content": "分析竞品SKU并重新定价"},
                    {"role": "assistant", "content": "已生成对比表"},
                ],
            },
        })

        self.assertEqual(self.events[-1]["title"], "淘宝SKU布局与定价")

    def test_ultraplan_is_an_ordinary_agent_task_and_preserves_raw_delta(self):
        agent = FakeAgent()
        with mock.patch.object(
            chat_worker, "_capture_ultraplan_dashboard_baseline", return_value={}
        ) as capture, mock.patch.object(
            chat_worker, "_observe_ultraplan_daemon", return_value=None
        ) as observe:
            chat_worker.handle_request(
                agent, FakeWorker(), self.request("/ultraplan ship feature")
            )

        self.assertEqual(len(agent.prompts), 1)
        rendered, source = agent.prompts[0]
        self.assertEqual(source, "admin_chat")
        self.assertIn("Objective: ship feature", rendered)
        self.assertIn("memory", rendered)
        self.assertIn("ultraplan_sop.md", rendered)
        self.assertNotIn("admin_chat_ultraplan.py", rendered)
        self.assertNotIn("/exec", rendered)
        self.assertEqual(
            [event["delta"] for event in self.events if event.get("type") == "delta"],
            ["res"],
        )
        capture.assert_called_once_with()
        observe.assert_called_once()

    def test_ultraplan_observer_continues_after_a_clarification_reply(self):
        agent = FakeAgent()
        baseline = {"existing-run": "before"}
        observed = []

        def observe(objective, baseline_arg, state, emit_event, stop_event, observer_state):
            observed.append((objective, baseline_arg, state, observer_state))
            if len(observed) == 2:
                state.update({
                    "objective": objective,
                    "run_dir": "official-run",
                    "dashboard_url": "http://127.0.0.1:47831",
                    "complete": False,
                })

        with mock.patch.object(
            chat_worker, "_capture_ultraplan_dashboard_baseline", return_value=baseline
        ) as capture, mock.patch.object(
            chat_worker, "_observe_ultraplan_daemon", side_effect=observe
        ) as observer:
            chat_worker.handle_request(
                agent, FakeWorker(), self.request("/ultraplan ship feature")
            )
            second_event_start = len(self.events)
            chat_worker.handle_request(
                agent, FakeWorker(), self.request("use postgres")
            )

        capture.assert_called_once_with()
        self.assertEqual(observer.call_count, 2)
        self.assertEqual([entry[0] for entry in observed], ["ship feature", "ship feature"])
        self.assertIs(observed[0][1], observed[1][1])
        self.assertIs(observed[0][2], observed[1][2])
        self.assertIs(observed[0][3], observed[1][3])
        self.assertEqual(agent.prompts[-1], ("use postgres", "admin_chat"))
        second_done = next(
            event for event in self.events[second_event_start:]
            if event.get("type") == "done"
        )
        self.assertEqual(
            second_done["message"]["ultraplan_state"]["run_dir"],
            "official-run",
        )

    def test_ultralplan_typo_is_not_treated_as_ultraplan(self):
        agent = FakeAgent()
        with mock.patch.object(
            chat_worker, "_capture_ultraplan_dashboard_baseline"
        ) as capture, mock.patch.object(
            chat_worker, "_observe_ultraplan_daemon"
        ) as observe:
            chat_worker.handle_request(
                agent, FakeWorker(), self.request("/ultralplan ship feature")
            )

        self.assertEqual(
            agent.prompts, [("/ultralplan ship feature", "admin_chat")]
        )
        capture.assert_not_called()
        observe.assert_not_called()


class UltraPlanReadOnlyObserverTests(unittest.TestCase):
    class _Response:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.body

    def test_dashboard_fetch_uses_default_daemon_get_without_request_body(self):
        body = b"<html><pre>rundir: C:/temp/official-run\n</pre></html>"
        with mock.patch(
            "urllib.request.urlopen", return_value=self._Response(body)
        ) as urlopen:
            sessions = chat_worker._fetch_ultraplan_dashboard_sessions(timeout=0.42)

        urlopen.assert_called_once_with(
            "http://127.0.0.1:47831/", timeout=0.42
        )
        self.assertIsInstance(sessions, dict)

    def test_session_selection_binds_only_to_this_conversations_run(self):
        # Regression guard for the cross-conversation UltraPlan leak: a run_dir
        # that already existed when this observer captured its baseline belongs
        # to another conversation (or an earlier turn). Merely observing it
        # change must never bind this observer onto it -- otherwise an unrelated
        # conversation's UltraPlan bleeds into this one. Only a freshly created
        # run_dir (absent from baseline) may be bound, unless a changed run's
        # slug explicitly matches THIS objective (same-objective restart).
        old = {"current": "phase-a", "phases": [], "tasks": [], "events": []}
        changed = {"current": "phase-b", "phases": [], "tasks": [], "events": []}
        baseline = {"C:/runs/existing": chat_worker._ultraplan_session_signature(old)}

        # A brand-new run_dir is bound (preferring an objective-slug match).
        self.assertEqual(
            chat_worker._select_ultraplan_session(
                {"C:/runs/existing": old, "C:/runs/new-objective": changed},
                baseline,
                objective="new objective",
            ),
            "C:/runs/new-objective",
        )
        # A pre-existing run that merely changed, with no objective match, must
        # NOT be grabbed -- this is the fix for the cross-talk leak.
        self.assertIsNone(
            chat_worker._select_ultraplan_session(
                {"C:/runs/existing": changed}, baseline
            )
        )
        # Same-objective restart on a pre-existing run_dir may be re-bound only
        # when its slug matches this objective.
        reuse_baseline = {
            "C:/runs/ship_feature": chat_worker._ultraplan_session_signature(old)
        }
        self.assertEqual(
            chat_worker._select_ultraplan_session(
                {"C:/runs/ship_feature": changed},
                reuse_baseline,
                objective="ship_feature",
            ),
            "C:/runs/ship_feature",
        )
        # Once bound, the selection is pinned and never re-bound mid-run.
        self.assertEqual(
            chat_worker._select_ultraplan_session(
                {"C:/runs/existing": changed, "C:/runs/other": changed},
                baseline,
                selected="C:/runs/existing",
            ),
            "C:/runs/existing",
        )
        # An unchanged pre-existing run is never selected.
        self.assertIsNone(
            chat_worker._select_ultraplan_session(
                {"C:/runs/existing": old}, baseline
            )
        )

    def test_observer_projects_official_session_without_starting_it(self):
        parsed = {
            "current": "phase-b",
            "phases": [{"name": "phase-b", "status": "running"}],
            "tasks": [{"desc": "lens", "status": "running"}],
            "events": [{"time": 0.2, "msg": "started"}],
            "done": False,
        }
        stop = chat_worker.threading.Event()
        events = []
        state = {"objective": "ship feature"}

        def fetch_once():
            stop.set()
            return {"C:/runs/official": parsed}

        with mock.patch.object(
            chat_worker, "_fetch_ultraplan_dashboard_sessions", side_effect=fetch_once
        ) as fetch, mock.patch.object(chat_worker, "_tail_ultraplan_outputs") as tail:
            chat_worker._observe_ultraplan_daemon(
                "ship feature", {}, state, events.append, stop
            )

        fetch.assert_called_once_with()
        tail.assert_called_once()
        self.assertEqual(state["run_dir"], "C:/runs/official")
        self.assertEqual(state["dashboard_port"], 47831)
        self.assertEqual(state["dashboard_url"], "http://127.0.0.1:47831/")
        self.assertEqual(state["phases"], parsed["phases"])
        self.assertEqual([event["type"] for event in events], ["ultraplan_event"])

    def test_output_tail_emits_file_lines_unchanged_and_only_once(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "001_lens.out.txt"
            output.write_bytes(b"alpha\nbeta\n")
            state = {}
            events = []
            tail_state = {}

            chat_worker._tail_ultraplan_outputs(
                tmp, state, events.append, tail_state
            )
            with output.open("ab") as stream:
                stream.write(b"gamma\n")
            chat_worker._tail_ultraplan_outputs(
                tmp, state, events.append, tail_state
            )

        self.assertEqual(
            events,
            [
                {
                    "type": "ultraplan_output",
                    "task_id": "001_lens",
                    "lines": ["alpha", "beta"],
                },
                {
                    "type": "ultraplan_output",
                    "task_id": "001_lens",
                    "lines": ["gamma"],
                },
            ],
        )
        self.assertEqual(
            state["task_outputs"]["001_lens"], ["alpha", "beta", "gamma"]
        )


class PlanPayloadAdapterTests(unittest.TestCase):
    def test_spaced_delegate_and_done_markers_are_consumed(self):
        payload = {
            "active": True,
            "placeholder": False,
            "done": 0,
            "total": 1,
            "complete": False,
            "items": [{
                # GA already consumed the first [D] from
                # `- [D] [\u2713] [VERIFY] ...`; this is its canonical output.
                "content": "[\u2713] [VERIFY] \u4e3bagent\u6267\u884c\u9a8c\u6536",
                "status": "open",
            }],
        }

        adapted = chat_worker._adapt_plan_payload(payload)

        self.assertEqual(adapted["items"], [{
            "content": "[VERIFY] \u4e3bagent\u6267\u884c\u9a8c\u6536",
            "status": "done",
        }])
        self.assertEqual((adapted["done"], adapted["total"], adapted["complete"]), (1, 1, True))
        self.assertEqual(payload["items"][0]["content"], "[\u2713] [VERIFY] \u4e3bagent\u6267\u884c\u9a8c\u6536")

    def test_semantic_bracket_tag_is_preserved(self):
        payload = {
            "active": True,
            "done": 0,
            "total": 1,
            "complete": False,
            "items": [{"content": "[VERIFY] smoke test", "status": "open"}],
        }

        adapted = chat_worker._adapt_plan_payload(payload)

        self.assertEqual(adapted["items"], payload["items"])
        self.assertEqual((adapted["done"], adapted["total"], adapted["complete"]), (0, 1, False))

    def test_snapshot_plan_adapts_canonical_payload(self):
        payload = {
            "active": True,
            "placeholder": False,
            "done": 0,
            "total": 1,
            "complete": False,
            "items": [{"content": "[\u2713] [VERIFY] wired", "status": "open"}],
        }
        plan_state = ModuleType("frontends.plan_state")
        plan_state.desktop_plan_payload_from_session = lambda sess, root: payload
        frontends = ModuleType("frontends")
        frontends.__path__ = []
        frontends.plan_state = plan_state

        with mock.patch.dict(sys.modules, {
            "frontends": frontends,
            "frontends.plan_state": plan_state,
        }), mock.patch.object(chat_worker, "_snapshot_ga_state", return_value={"working": {}}):
            adapted = chat_worker._snapshot_plan(FakeAgent(), "C:/ga")

        self.assertEqual(adapted["items"], [{
            "content": "[VERIFY] wired",
            "status": "done",
        }])
        self.assertEqual((adapted["done"], adapted["total"], adapted["complete"]), (1, 1, True))


class ImageInjectionTest(unittest.TestCase):
    def test_native_backend_gets_images_on_first_call_only_and_is_restored(self):
        requests = []

        class FakeBackend:
            def ask(self, request):
                requests.append(request)
                yield "ok"

        class NativeToolClient:
            def __init__(self, backend):
                self.backend = backend

        llmcore = ModuleType("llmcore")
        llmcore.NativeToolClient = NativeToolClient
        backend = FakeBackend()
        agent = SimpleNamespace(llmclient=NativeToolClient(backend))

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sample.png"
            image_path.write_bytes(b"png-bytes")
            with mock.patch.dict(sys.modules, {"llmcore": llmcore}):
                restore = chat_worker._install_image_injection(agent, [str(image_path)])
                first = {"content": [{"type": "text", "text": "look"}]}
                self.assertEqual(list(backend.ask(first)), ["ok"])
                self.assertNotIn("ask", vars(backend))

                image = first["content"][1]
                self.assertEqual(image["type"], "image")
                self.assertEqual(image["source"]["type"], "base64")
                self.assertEqual(image["source"]["media_type"], "image/png")
                self.assertEqual(image["source"]["data"], "cG5nLWJ5dGVz")

                second = {"content": [{"type": "text", "text": "again"}]}
                self.assertEqual(list(backend.ask(second)), ["ok"])
                self.assertEqual(len(second["content"]), 1)
                restore()

        self.assertEqual(requests, [first, second])

    def test_non_native_client_is_not_patched(self):
        llmcore = ModuleType("llmcore")
        llmcore.NativeToolClient = type("NativeToolClient", (), {})
        backend = SimpleNamespace(ask=lambda request: iter(("ok",)))
        agent = SimpleNamespace(llmclient=SimpleNamespace(backend=backend))
        original = backend.ask

        with mock.patch.dict(sys.modules, {"llmcore": llmcore}):
            restore = chat_worker._install_image_injection(agent, ["sample.png"])
            restore()

        self.assertIs(backend.ask, original)


class FakeReloadAgent:
    """Agent stub tracking GA's mtime gated profile reload."""

    def __init__(self, llm_no=0, reload_sets=None, reload_raises=False):
        self.llm_no = llm_no
        self.reload_calls = 0
        self.switch_calls = []
        self._reload_sets = reload_sets
        self._reload_raises = reload_raises

    def load_llm_sessions(self):
        self.reload_calls += 1
        if self._reload_raises:
            raise RuntimeError("mykey.py is broken")
        if self._reload_sets is not None:
            self.llm_no = self._reload_sets

    def next_llm(self, llm_no):
        self.switch_calls.append(llm_no)
        self.llm_no = llm_no


class LegacyAgent:
    """Agent without load_llm_sessions (older GA checkout)."""

    def __init__(self):
        self.llm_no = 0
        self.switch_calls = []

    def next_llm(self, llm_no):
        self.switch_calls.append(llm_no)
        self.llm_no = llm_no


class SelectLlmReloadTest(unittest.TestCase):
    def test_same_model_still_reloads_profiles_without_switching(self):
        agent = FakeReloadAgent(llm_no=1)

        chat_worker._select_llm_if_needed(agent, 1)

        self.assertEqual(agent.reload_calls, 1)
        self.assertEqual(agent.switch_calls, [])

    def test_model_switch_reloads_then_switches(self):
        agent = FakeReloadAgent(llm_no=0)

        chat_worker._select_llm_if_needed(agent, 2)

        self.assertEqual(agent.reload_calls, 1)
        self.assertEqual(agent.switch_calls, [2])

    def test_reload_runs_before_index_comparison(self):
        # load_llm_sessions remaps llm_no by model name after a mykey.py edit,
        # so the comparison must read the post-reload index.
        agent = FakeReloadAgent(llm_no=0, reload_sets=3)

        chat_worker._select_llm_if_needed(agent, 3)

        self.assertEqual(agent.reload_calls, 1)
        self.assertEqual(agent.switch_calls, [])

    def test_broken_reload_does_not_block_model_switch(self):
        agent = FakeReloadAgent(llm_no=0, reload_raises=True)

        chat_worker._select_llm_if_needed(agent, 1)

        self.assertEqual(agent.switch_calls, [1])

    def test_agent_without_reload_hook_is_tolerated(self):
        agent = LegacyAgent()

        chat_worker._select_llm_if_needed(agent, 1)

        self.assertEqual(agent.switch_calls, [1])


if __name__ == "__main__":
    unittest.main()
