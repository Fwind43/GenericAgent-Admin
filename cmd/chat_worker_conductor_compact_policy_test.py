import ast
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


class CompactPolicyReceiptTest(unittest.TestCase):
    def test_success_updates_same_turn_without_permission_expansion(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        installer = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_install_conductor_tools')
        node = next(n for n in installer.body if isinstance(n, ast.FunctionDef) and n.name == 'settings_tool')
        for reply in ({'ok': True, 'strategy': 'User policy "A"'}, {'ok': True, 'strategy': ''}, {'ok': False, 'error': 'rejected'}):
            with self.subTest(reply=reply), tempfile.TemporaryDirectory() as directory:
                events = []
                env = dict(uuid=__import__('uuid'), broker=Path(directory), json=json, emit=events.append,
                           read_reply=lambda *args: reply, StepOutcome=lambda data, **kw: SimpleNamespace(data=data, **kw))
                exec(compile(ast.Module(body=[node], type_ignores=[]), '<settings>', 'exec'), env)
                outcome = env['settings_tool']('conductor_model_strategy', {'action': 'get', '_index': 0})
                self.assertIs(outcome.data, reply)
                self.assertEqual(events[0]['args'], {'action': 'get'})
                if reply['ok']:
                    self.assertIn(json.dumps(reply['strategy']), outcome.next_prompt)
                    for text in ('Replaces earlier snapshots this turn', 'no permission grant', 'Explicit user choices win', 'queued/running workers are unchanged'):
                        self.assertIn(text, outcome.next_prompt)
                    self.assertLess(len(outcome.next_prompt) - len(json.dumps(reply['strategy'])), 400)
                else:
                    self.assertNotIn('Replaces earlier snapshots', outcome.next_prompt)


if __name__ == '__main__':
    unittest.main()
