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


if __name__ == '__main__':
    unittest.main()
