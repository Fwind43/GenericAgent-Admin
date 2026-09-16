"""Run Admin installation against a read-only GA loop and a fake model.
Usage: python this_test.py /path/to/GenericAgent/agent_loop.py
No agent, official plugin, network client, or real broker is started.
"""
import ast
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

LOOP_PATH = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else None


class InstallationTest(unittest.TestCase):
    def test_real_install_dispatch_and_model_continuation(self):
        self.assertIsNotNone(LOOP_PATH, 'Pass the read-only GA agent_loop.py path')
        loop = types.ModuleType('agent_loop')
        hooks = types.ModuleType('plugins.hooks')
        hooks.trigger = lambda *args, **kwargs: None
        fake = types.ModuleType('agentmain')
        with patch.dict(sys.modules, {'agent_loop': loop, 'agentmain': fake,
                                     'plugins.hooks': hooks}):
            exec(compile(LOOP_PATH.read_text(encoding='utf-8'), str(LOOP_PATH), 'exec'), loop.__dict__)

            class Handler(loop.BaseHandler):
                def __init__(self):
                    self.parent = types.SimpleNamespace(task_dir=None)
                    self._done_hooks = []

                def do_no_tool(self, args, response):
                    return loop.StepOutcome({'done': True})

            fake.GenericAgentHandler = Handler
            original = [{'type': 'function', 'function': {'name': 'no_tool'}}]
            fake.TOOLS_SCHEMA = original
            source = Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8')
            function = next(n for n in ast.parse(source).body
                            if isinstance(n, ast.FunctionDef) and n.name == '_install_conductor_tools')
            scope = {'Path': Path, 'json': json}
            exec(compile(ast.Module(body=[function], type_ignores=[]), 'chat_worker.py', 'exec'), scope)
            rows = [{'dispatch_id': str(i), 'objective': 'task-' + str(i)} for i in range(113)]
            offsets = [-1, True, '48', 1.5, 0, 48, 96, 999]
            received = []
            owner = self

            class FakeModel:
                turn = 0

                def chat(self, messages, tools):
                    schema = next(t['function'] for t in tools if t['function']['name'] == 'conductor_tasks')
                    owner.assertEqual(schema['parameters']['properties']['offset'], {'type': 'integer', 'minimum': 0})
                    owner.assertEqual(schema['parameters']['required'], ['offset'])
                    if self.turn:
                        msg = messages[0]
                        result = json.loads(msg['tool_results'][0]['content'])
                        received.append(result)
                        owner.assertTrue(msg['content'])
                        owner.assertEqual(msg['tool_results'][0]['tool_use_id'], str(self.turn - 1))
                        if result['ok']:
                            owner.assertEqual(json.loads(msg['content'].split('\n', 1)[1]), result)
                    calls = []
                    if self.turn < len(offsets):
                        calls = [types.SimpleNamespace(id=str(self.turn), function=types.SimpleNamespace(
                            name='conductor_tasks', arguments=json.dumps({'offset': offsets[self.turn]})))]
                    self.turn += 1
                    if False:
                        yield None
                    return types.SimpleNamespace(content='', tool_calls=calls)

            with tempfile.TemporaryDirectory() as broker:
                config = {'role': 'parent', 'broker_dir': broker, 'tasks': rows}
                restore = scope['_install_conductor_tools'](types.SimpleNamespace(stop_sig=False), config)
                try:
                    self.assertTrue(hasattr(Handler, 'do_conductor_tasks'))
                    model = FakeModel()
                    result = loop.exhaust(loop.agent_runner_loop(model, 'test', 'test', Handler(),
                                                                 fake.TOOLS_SCHEMA, max_turns=12))
                    self.assertEqual(result['result'], 'CURRENT_TASK_DONE')
                    self.assertEqual(model.turn, 9)
                    self.assertEqual(len(received), 8)
                    self.assertTrue(all(not item['ok'] for item in received[:4]))
                    self.assertEqual([len(p['tasks']) for p in received[4:]], [48, 48, 17, 0])
                    self.assertEqual([p['next_offset'] for p in received[4:]], [48, 96, None, None])
                    self.assertEqual([row for p in received[4:7] for row in p['tasks']], rows)
                    self.assertEqual(list(Path(broker).iterdir()), [])
                finally:
                    restore()
                self.assertIs(fake.TOOLS_SCHEMA, original)
                self.assertFalse(hasattr(Handler, 'do_conductor_tasks'))
                print('model calls=9; pages=48,48,17; rows=113; invalid offsets=4 recovered; broker files=0; restore=OK')


if __name__ == '__main__':
    unittest.main(verbosity=2)
