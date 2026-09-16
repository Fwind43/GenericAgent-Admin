"""Isolated tests of the production request-scoped task pager, without GA imports."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class TaskPagerTest(unittest.TestCase):
    def test_pages_are_bounded_complete_and_read_only(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        function = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'tasks' and any(isinstance(x, ast.Name) and x.id == 'config' for x in ast.walk(n)))
        rows = [{'dispatch_id': str(i)} for i in range(113)]
        import json
        scope = {'json': json, 'config': {'tasks': rows}, 'StepOutcome': lambda value, **kw: SimpleNamespace(value=value, **kw)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<production task pager>', 'exec'), scope)
        call = lambda offset: scope['tasks'](None, {'offset': offset}, None).value
        outcome = scope['tasks'](None, {'offset': 48}, None)
        self.assertEqual(json.loads(outcome.next_prompt.split('\n', 1)[1])['tasks'], rows[48:96])
        found = []
        offset = 0
        while offset is not None:
            page = call(offset)
            self.assertLessEqual(len(page['tasks']), 48)
            self.assertEqual(page['total'], 113)
            found.extend(page['tasks'])
            offset = page['next_offset']
        self.assertEqual(found, rows)
        self.assertEqual(len(rows), 113)
        for invalid in [-1, True, '48', 1.5]:
            self.assertFalse(call(invalid)['ok'])
        self.assertEqual(call(999)['tasks'], [])
        self.assertIsNone(call(999)['next_offset'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
