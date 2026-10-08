"""Admin instruction installation against a read-only GA loop; no network or core edits."""
import ast
import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

LOOP_PATH = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else None


class WorkerInstructionTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(LOOP_PATH, 'Pass read-only GA agent_loop.py')
        self.loop = types.ModuleType('agent_loop')
        self.fake = types.ModuleType('agentmain')
        hooks = types.ModuleType('plugins.hooks')
        hooks.trigger = lambda *a, **k: None
        self.modules = patch.dict(sys.modules, {'agent_loop': self.loop, 'agentmain': self.fake, 'plugins.hooks': hooks})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        exec(compile(LOOP_PATH.read_text(encoding='utf-8'), str(LOOP_PATH), 'exec'), self.loop.__dict__)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.rows, self.events, self.closed = [], [], False
        self.config = {'role': 'worker', 'broker_dir': self.tmp.name, 'dispatch_id': 'test-dispatch'}
        source = Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
                 ('_install_conductor_worker_instructions', '_install_conductor_tools')]
        self.scope = dict(Path=Path, re=re, json=json, time=time, emit=self.emit, emit_tool=lambda *a, **k: None)
        exec(compile(ast.Module(body=funcs, type_ignores=[]), '<Admin installers>', 'exec'), self.scope)
        owner = self
        class Handler(self.loop.BaseHandler):
            def __init__(self):
                self.parent = owner.agent
                self._done_hooks = []
            def do_no_tool(self, args, response):
                return owner.loop.StepOutcome({'done': True})
            def do_work(self, args, response):
                owner.enqueue('after-tool-' + str(args['_index']))
                yield 'work completed'
                return owner.loop.StepOutcome({'work': True}, next_prompt='Continue assigned task.')
            def do_exit(self, args, response):
                return owner.loop.StepOutcome({'exit': True}, should_exit=True)
        self.Handler = self.fake.GenericAgentHandler = Handler
        self.fake.TOOLS_SCHEMA = []

    def enqueue(self, text):
        self.assertFalse(self.closed, 'sealed worker admitted a late input')
        row = dict(id='instruction-' + str(len(self.rows)), instruction=text, status='queued')
        self.rows.append(row)
        return row

    def emit(self, event):
        self.events.append(event)
        self.assertEqual(event['dispatch_id'], self.config['dispatch_id'])
        pending = [dict(row) for row in self.rows if row['status'] == 'queued']
        if event['type'] == 'conductor_instruction_check':
            if event.get('terminal') and not pending:
                self.closed = True
            reply = dict(ok=True, closed=self.closed, instructions=pending)
        elif event['type'] == 'conductor_instruction_ack':
            for row in self.rows:
                if row['id'] in event['instruction_ids']:
                    row['status'] = 'delivered'
            reply = dict(ok=True)
        else:
            self.fail('unexpected event: ' + str(event))
        path = Path(self.tmp.name) / (event['request_id'] + '.response.json')
        path.write_text(json.dumps(reply), encoding='utf-8')

    def install(self, client):
        self.agent = types.SimpleNamespace(llmclient=client, stop_sig=False, task_dir=None)
        return self.scope['_install_conductor_tools'](self.agent, self.config)

    def test_running_tools_model_stream_and_terminal_boundary(self):
        owner = self
        class Model:
            def __init__(self):
                self.inputs = []
            def chat(self, messages, tools):
                self.inputs.append(copy.deepcopy(messages))
                turn = len(self.inputs)
                if turn == 1:
                    calls = [types.SimpleNamespace(id=str(i), function=types.SimpleNamespace(name='work', arguments='{}')) for i in range(2)]
                else:
                    calls = []
                if turn == 2:
                    owner.enqueue('during-model-response')
                yield 'model stream'
                return types.SimpleNamespace(content='done', tool_calls=calls)
        model = Model()
        original_dispatch = self.Handler.dispatch
        original_chat = model.chat
        restore = self.install(model)
        try:
            result = self.loop.exhaust(self.loop.agent_runner_loop(model, 'safety', 'original objective', self.Handler(), [], max_turns=6))
            self.assertEqual(result['result'], 'CURRENT_TASK_DONE')
            self.assertEqual(len(model.inputs), 3)
            second = model.inputs[1][-1]['content']
            self.assertLess(second.index('after-tool-0'), second.index('after-tool-1'))
            self.assertNotIn('during-model-response', second)
            self.assertIn('during-model-response', model.inputs[2][-1]['content'])
            self.assertTrue(all(row['status'] == 'delivered' for row in self.rows))
            self.assertTrue(self.closed)
            self.assertEqual(sum(e.get('terminal', False) for e in self.events), 2)
        finally:
            restore()
        self.assertIs(self.Handler.dispatch, original_dispatch)
        self.assertEqual(model.chat, original_chat)
        self.assertNotIn('chat', model.__dict__)
        self.assertNotIn('dispatch', self.Handler.__dict__)


    def test_model_failure_retains_input_and_request_restore(self):
        class Model:
            def __init__(self):
                self.fail = True
                self.inputs = []
            def chat(self, messages, tools=None):
                self.inputs.append(copy.deepcopy(messages))
                yield 'partial'
                if self.fail:
                    raise RuntimeError('simulated model failure')
                return types.SimpleNamespace(content='ok', tool_calls=[])
        model = Model()
        self.enqueue('retry guidance')
        caller = [{'role': 'system', 'content': 'unchanged safety'},
                  {'role': 'user', 'content': [{'type': 'text', 'text': 'task'}]}]
        frozen = copy.deepcopy(caller)
        restore = self.install(model)
        try:
            with self.assertRaisesRegex(RuntimeError, 'simulated model failure'):
                self.loop.exhaust(model.chat(messages=caller))
            self.assertEqual(self.rows[0]['status'], 'queued')
            self.assertFalse(any(e['type'] == 'conductor_instruction_ack' for e in self.events))
        finally:
            restore()
        model.fail = False
        restore = self.install(model)
        try:
            self.loop.exhaust(model.chat(messages=caller))
            self.assertEqual(self.rows[0]['status'], 'delivered')
            self.assertIn('retry guidance', model.inputs[-1][-1]['content'][-1]['text'])
            self.assertEqual(model.inputs[-1][0], caller[0])
            self.assertEqual(caller, frozen)
        finally:
            restore()
        self.assertNotIn('chat', model.__dict__)
        self.assertNotIn('dispatch', self.Handler.__dict__)


if __name__ == '__main__':
    unittest.main(verbosity=2)
