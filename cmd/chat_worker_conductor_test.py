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
        self.env = dict(agent=self.agent, StepOutcome=lambda value: value,
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


if __name__ == '__main__':
    unittest.main()
