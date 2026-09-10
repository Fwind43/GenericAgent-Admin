import ast
import unittest
from pathlib import Path
from types import SimpleNamespace


class ConductorDispatchOptionsTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        dispatch = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'dispatch' and any(isinstance(x, ast.Constant) and x.value == 'conductor_dispatch' for x in ast.walk(n)))
        self.events = []
        self.agent = object()
        self.env = dict(agent=self.agent, StepOutcome=lambda value, **kwargs: value,
                        re=__import__('re'), uuid=__import__('uuid'), broker=Path('unused'),
                        emit=self.events.append, receipts={},
                        read_reply=lambda *args: {'ok': True, 'dispatch_id': 'd'})
        exec(compile(ast.Module(body=[dispatch], type_ignores=[]), '<dispatch>', 'exec'), self.env)

    def call(self, **options):
        return self.env['dispatch'](SimpleNamespace(parent=self.agent), {'objective': 'task', **options}, None)

    def test_omitted_preserves_absence(self):
        self.assertTrue(self.call()['ok'])
        self.assertNotIn('project_id', self.events[0])
        self.assertNotIn('llm_no', self.events[0])
        self.assertNotIn('reasoning_effort', self.events[0])

    def test_overrides_forwarded(self):
        for effort in ('off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
            self.assertTrue(self.call(llm_no=0, reasoning_effort=effort, session_id='worker')['ok'])
            self.assertEqual(self.events[-1]['llm_no'], 0)
            self.assertEqual(self.events[-1]['reasoning_effort'], effort)
            self.assertEqual(self.events[-1]['session_id'], 'worker')

    def test_project_forwarded(self):
        self.assertTrue(self.call(project_id=' target ')['ok'])
        self.assertEqual(self.events[-1]['project_id'], 'target')
        for value in (None, '', ' ', 3):
            self.assertFalse(self.call(project_id=value)['ok'])
        self.assertFalse(self.call(project_id='target', session_id='worker')['ok'])
        self.assertEqual(len(self.events), 1)

    def outcome(self, **options):
        return self.env['dispatch'](SimpleNamespace(parent=self.agent), {'objective': 'test', **options}, None)

    def test_repeated_invalid_project_and_recovery(self):
        self.env['StepOutcome'] = lambda data, **kwargs: SimpleNamespace(data=data, **kwargs)
        self.env['read_reply'] = lambda *args: {'ok': False, 'error': 'invalid project_id: missing'}
        for _ in range(3):
            result = self.outcome(project_id='web')
            self.assertIn('No worker was created', result.next_prompt)
        for _ in range(5):
            result = self.outcome(project_id='web', objective='reworded task')
            self.assertEqual(result.data['error_code'], 'repeated_invalid_parameters')
        self.assertEqual(len(self.events), 3)
        self.env['read_reply'] = lambda *args: {'ok': True, 'dispatch_id': 'd', 'status': 'queued'}
        for options in ({'project_id': 'real-project'}, {}, {'session_id': 'worker'}):
            result = self.outcome(**options)
            self.assertTrue(result.data['ok'])
            self.assertIn('Dispatch accepted', result.next_prompt)
        self.assertEqual(len(self.events), 6)
        self.assertIn('d', self.env['receipts'])

    def test_pending_is_not_rejection(self):
        self.env['StepOutcome'] = lambda data, **kwargs: SimpleNamespace(data=data, **kwargs)
        self.env['read_reply'] = lambda *args: {'ok': False, 'pending': True, 'error': 'timeout'}
        for _ in range(4):
            result = self.outcome()
            self.assertIn('outcome unknown', result.next_prompt)
            self.assertNotIn('No worker was created', result.next_prompt)
        self.assertEqual(len(self.events), 4)

    def test_invalid_never_emits(self):
        for options in ({'llm_no': -1}, {'llm_no': True}, {'llm_no': 1.5}, {'llm_no': '1'}, {'llm_no': None}, {'reasoning_effort': None}, {'reasoning_effort': ''}, {'reasoning_effort': 'invalid'}):
            self.assertFalse(self.call(**options)['ok'])
        self.assertEqual(self.events, [])


class ConductorReviewTest(unittest.TestCase):
    def test_review_forwards_evidence_and_rejects_wrong_parent(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'review' and any(isinstance(x, ast.Constant) and x.value == 'conductor_review' for x in ast.walk(n)))
        agent, events, replies = object(), [], []
        def read_reply(path, timeout):
            replies.append((path, timeout))
            return {'ok': True}
        env = dict(agent=agent, StepOutcome=lambda value: value,
                   uuid=__import__('uuid'), broker=Path('broker'),
                   emit=events.append, read_reply=read_reply)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<review>', 'exec'), env)
        args = dict(dispatch_id='d', status='verified', basis='Test output',
                    evidence_ids=['d:0'], unverified='Production')
        self.assertFalse(env['review'](SimpleNamespace(parent=object()), args, None)['ok'])
        self.assertEqual(events, [])
        self.assertTrue(env['review'](SimpleNamespace(parent=agent), args, None)['ok'])
        self.assertEqual(len(events), 1)
        for key, value in args.items():
            self.assertEqual(events[0][key], value)
        self.assertEqual(replies, [(Path('broker') / (events[0]['request_id'] + '.response.json'), 30)])


class ConductorToolBoundaryTest(unittest.TestCase):
    def test_parent_denies_execution_and_restores_inherited_tools(self):
        import sys
        import tempfile
        from unittest.mock import patch
        from types import ModuleType
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_install_conductor_tools')
        env = {'Path': Path}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<boundary>', 'exec'), env)
        calls = []
        class Base:
            def do_code_run(self, args, response):
                calls.append(args)
        class Handler(Base):
            def do_file_read(self, args, response):
                calls.append(args)
            def do_ask_user(self, args, response):
                return 'ask'
        original_read = Handler.do_file_read
        module = ModuleType('agentmain')
        module.GenericAgentHandler = Handler
        schema = [{'type': 'function', 'function': {'name': name}} for name in ('code_run', 'file_read', 'ask_user')]
        module.TOOLS_SCHEMA = schema
        loop = ModuleType('agent_loop')
        loop.StepOutcome = lambda value: value
        with patch.dict(sys.modules, {'agentmain': module, 'agent_loop': loop}), tempfile.TemporaryDirectory() as directory:
            install = env['_install_conductor_tools']
            for config in (None, {'role': 'worker'}):
                install(object(), config)()
                self.assertIs(module.TOOLS_SCHEMA, schema)
                self.assertIs(Handler.do_file_read, original_read)
                self.assertFalse(hasattr(Handler, 'do_conductor_dispatch'))
            restore = install(object(), {'role': 'parent', 'broker_dir': directory})
            try:
                self.assertEqual({s['function']['name'] for s in module.TOOLS_SCHEMA}, {'ask_user', 'conductor_dispatch', 'conductor_collect', 'conductor_cancel', 'conductor_review'})
                review_schema = next(s['function']['parameters'] for s in module.TOOLS_SCHEMA if s['function']['name'] == 'conductor_review')
                self.assertEqual(set(review_schema['required']), {'dispatch_id', 'status', 'basis', 'evidence_ids'})
                self.assertEqual(review_schema['properties']['status']['enum'], ['verified', 'needs_work'])
                self.assertFalse(review_schema['additionalProperties'])
                handler = Handler()
                for name, args in [('code_run', {'script': 'python agentmain.py --task task'}), ('file_read', {'path': 'subagent_sop.md'})]:
                    result = getattr(handler, 'do_' + name)(args, None)
                    self.assertFalse(result['ok'])
                    self.assertIn('conductor_dispatch', result['error'])
                self.assertEqual(calls, [])
                self.assertEqual(handler.do_ask_user({}, None), 'ask')
            finally:
                restore()
            restore()
            self.assertIs(module.TOOLS_SCHEMA, schema)
            self.assertIs(Handler.do_file_read, original_read)
            self.assertNotIn('do_code_run', Handler.__dict__)
            self.assertFalse(hasattr(Handler, 'do_conductor_dispatch'))
            Handler().do_code_run({}, None)
            self.assertEqual(calls, [{}])


class ConductorCoreContractTest(ConductorDispatchOptionsTest):
    def setUp(self):
        super().setUp()
        import importlib.util
        import os
        import sys
        from types import ModuleType
        from unittest.mock import patch
        source = os.environ.get('GA_CORE_AGENT_LOOP')
        if not source:
            self.skipTest('Set GA_CORE_AGENT_LOOP to the real GA agent_loop.py')
        spec = importlib.util.spec_from_file_location('_conductor_core_contract', source)
        core = importlib.util.module_from_spec(spec)
        hooks = ModuleType('plugins.hooks')
        hooks.trigger = lambda *args, **kwargs: None
        with patch.dict(sys.modules, {spec.name: core, 'plugins.hooks': hooks}):
            spec.loader.exec_module(core)
        self.core = core
        self.agent = SimpleNamespace(task_dir=None)
        self.env.update(agent=self.agent, StepOutcome=core.StepOutcome)

    def call(self, **options):
        return super().call(**options).data

    def exercise_loop(self, reply, first_args=None, legacy=False):
        import json
        import copy
        core, env = self.core, self.env
        reads, requests = [], []
        def read_reply(path, timeout):
            reads.append((path.name, timeout))
            return reply
        env['read_reply'] = read_reply
        class Handler(core.BaseHandler):
            parent = self.agent
            _done_hooks = []
            def do_conductor_dispatch(handler, args, response):
                outcome = env['dispatch'](handler, args, response)
                return core.StepOutcome(outcome.data) if legacy else outcome
            def do_no_tool(handler, args, response):
                return core.StepOutcome(None)
        def tool(tid, args):
            return SimpleNamespace(id=tid, function=SimpleNamespace(
                name='conductor_dispatch', arguments=json.dumps(args)))
        class Client:
            def chat(client, messages, tools):
                requests.append(copy.deepcopy(messages))
                calls = [tool('first', first_args or {'objective': 'one'}),
                         tool('second', {'objective': 'two'})] if len(requests) == 1 else []
                if False:
                    yield ''
                return SimpleNamespace(content='', tool_calls=calls)
        output = list(core.agent_runner_loop(Client(), '', 'coordinate', Handler(), [], max_turns=2))
        if legacy:
            self.assertEqual(len(requests), 1)
            self.assertEqual(len(reads), 1)
            return
        self.assertEqual(len(requests), 2)
        results = requests[1][0]['tool_results']
        self.assertEqual([r['tool_use_id'] for r in results], ['first', 'second'])
        self.assertEqual(json.loads(results[1]['content']), reply)
        self.assertEqual(json.loads(results[0]['content']), reply if first_args is None else
                         {'ok': False, 'error': 'objective is required'})
        self.assertTrue(requests[1][0]['content'])
        self.assertTrue(all(name.endswith('.response.json') and timeout == 30 for name, timeout in reads))
        self.assertEqual(len(reads), 2 if first_args is None else 1)
        # Receipt data belongs in tool_results, not a second copy in streamed text.
        self.assertNotIn(json.dumps(reply), ''.join(output))

    def test_real_loop_two_async_receipts(self):
        self.exercise_loop({'ok': True, 'dispatch_id': 'd', 'session_id': 'worker', 'status': 'queued'})

    def test_real_loop_error_and_timeout_receipts(self):
        for reply in ({'ok': False, 'error': 'capacity'},
                      {'ok': False, 'pending': True, 'error': 'Conductor wait timed out; outcome unknown'}):
            with self.subTest(reply=reply):
                self.exercise_loop(reply)

    def test_real_loop_validation_does_not_cut_batch(self):
        self.exercise_loop({'ok': True, 'dispatch_id': 'd'}, {'objective': ' '})

    def test_legacy_contract_reproduces_early_exit(self):
        self.exercise_loop({'ok': True, 'dispatch_id': 'd'}, legacy=True)


if __name__ == '__main__':
    unittest.main()
