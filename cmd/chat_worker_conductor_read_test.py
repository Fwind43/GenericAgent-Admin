import ast
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

class ConductorReadTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        names = {'_ack_conductor_result', '_prepare_conductor_completion'}
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        collect = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'collect' and any(isinstance(x, ast.Constant) and x.value == 'conductor_collect' for x in ast.walk(n)))
        self.events = []
        self.env = dict(emit=self.events.append, json=json, StepOutcome=lambda data, **kw: SimpleNamespace(data=data, **kw))
        exec(compile(ast.Module(body=nodes+[collect], type_ignores=[]), '<read>', 'exec'), self.env)
        self.result = dict(dispatch_id='d', session_id='w', status='succeeded', result_receipt=dict(id='a',revision='v'))

    def test_automatic_consumption_and_failure(self):
        agent = SimpleNamespace(extra_sys_prompts=['original'])
        req = dict(input_kind='conductor_completion', conductor_completion_receipt=self.result)
        prompt, restore = self.env['_prepare_conductor_completion'](agent, req, 'result')
        self.assertIn('result', agent.extra_sys_prompts[-1])
        self.assertEqual(self.events[-1]['type'], 'conductor_read')
        restore(); self.assertEqual(agent.extra_sys_prompts,['original'])
        self.events.clear()
        with self.assertRaises(AttributeError):
            self.env['_prepare_conductor_completion'](object(), req, 'result')
        self.assertEqual(self.events, [])
        self.env['_prepare_conductor_completion'](agent, {}, 'result')
        self.assertEqual(self.events, [])

    def test_collect_terminal_pending_missing_corrupt(self):
        with tempfile.TemporaryDirectory() as folder:
            broker=Path(folder); agent=object(); self.env.update(broker=broker,agent=agent)
            path=broker/'d.outcome.json'
            for value in (None, 'broken', json.dumps(dict(self.result,status='pending')), json.dumps(self.result)):
                self.events.clear()
                if value is not None: path.write_text(value)
                outcome=self.env['collect'](SimpleNamespace(parent=agent),dict(dispatch_id='d'),None)
                self.assertEqual(any(e['type']=='conductor_read' for e in self.events), value==json.dumps(self.result))
            self.events.clear()
            self.env['StepOutcome']=lambda data, **kw: (_ for _ in ()).throw(ValueError('cannot return'))
            with self.assertRaises(ValueError):self.env['collect'](SimpleNamespace(parent=agent),dict(dispatch_id='d'),None)
            self.assertFalse(any(e['type']=='conductor_read' for e in self.events))

    def test_collect_success_pending_and_read_failure(self):
        import tempfile
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        install = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_install_conductor_tools')
        collect = next(n for n in install.body if isinstance(n, ast.FunctionDef) and n.name == 'collect')
        with tempfile.TemporaryDirectory() as directory:
            broker = Path(directory)
            env = dict(self.env, broker=broker, Path=Path, StepOutcome=lambda data, **kw: SimpleNamespace(data=data, **kw),
                       _same_agent_instance=lambda a, b: True, agent=object())
            exec(compile(ast.Module(body=[collect], type_ignores=[]), '<collect>', 'exec'), env)
            owner = SimpleNamespace(parent=env['agent'])
            path = broker / 'd.outcome.json'
            for content, expected in [(None, 0), ('broken', 0), (json.dumps({'status': 'pending'}), 0), (json.dumps(self.result), 1)]:
                if content is not None:
                    path.write_text(content)
                self.events.clear()
                env['collect'](owner, {'dispatch_id': 'd'}, None)
                self.assertEqual(sum(e['type'] == 'conductor_read' for e in self.events), expected)
            self.events.clear()
            def broken_outcome(*args, **kw):
                raise RuntimeError('construction failed')
            env['StepOutcome'] = broken_outcome
            with self.assertRaises(RuntimeError):
                env['collect'](owner, {'dispatch_id': 'd'}, None)
            self.assertFalse(any(e['type'] == 'conductor_read' for e in self.events))

if __name__ == '__main__': unittest.main()
