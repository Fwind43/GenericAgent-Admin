"""Isolated request-memory contract tests; no GA installation or API required."""
import ast
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class ProjectMemoryTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('chat_worker.py')
        tree = ast.parse(path.read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == '_admin_project_request')
        ns = {'Path': Path}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), ns)
        self.decorate = ns['_admin_project_request']
        self.callbacks = []
        hooks = SimpleNamespace(
            register=lambda event: lambda fn: self.callbacks.append(fn),
            unregister=lambda event, fn: self.callbacks.remove(fn))
        self.modules = patch.dict(sys.modules, {'plugins': SimpleNamespace(hooks=hooks)})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.l1 = Path(self.tmp.name, 'project_mem_insight.txt')
        self.l1.write_text('FIRST_RULE', encoding='utf-8')
        self.req = {'project_provider': 'admin', 'project_id': 'test',
                    'project_memory_dir': self.tmp.name}

    def test_refresh_preserves_global_and_cleans_exception(self):
        for base in ('GLOBAL', [{'type': 'text', 'text': 'GLOBAL'}]):
            with self.subTest(base=base):
                self.l1.write_text('FIRST_RULE', encoding='utf-8')
                original = {'role': 'system', 'content': base}
                messages = [original]
                agent = SimpleNamespace(llmclient=object())

                @self.decorate
                def run(agent, req):
                    ctx = {'client': agent.llmclient, 'messages': messages}
                    self.callbacks[0](ctx)
                    self.assertIn('FIRST_RULE', str(messages))
                    self.assertIn('GLOBAL', str(messages))
                    self.assertIsInstance(messages[0]['content'], type(base))
                    self.l1.write_text('SECOND_RULE', encoding='utf-8')
                    self.callbacks[0](ctx)
                    self.assertNotIn('FIRST_RULE', str(messages))
                    self.assertIn('SECOND_RULE', str(messages))
                    raise ValueError('expected')

                with self.assertRaisesRegex(ValueError, 'expected'):
                    run(agent, self.req)
                self.assertEqual(messages, [original])
                self.assertIs(messages[0], original)
                self.assertEqual(self.callbacks, [])

    def test_btw_restores_inherited_and_owned_methods(self):
        for owned in (False, True):
            for fail in (False, True):
                with self.subTest(owned=owned, fail=fail):
                    test = self

                    class Backend:
                        def raw_ask(self, messages):
                            test.assertIn('FIRST_RULE', str(messages))
                            if fail:
                                raise ValueError('expected')
                            yield 'ok'

                    backend = Backend()
                    if owned:
                        backend.raw_ask = backend.raw_ask
                    original = backend.raw_ask
                    agent = SimpleNamespace(llmclient=SimpleNamespace(backend=backend))
                    messages = [{'role': 'system', 'content': 'GLOBAL'}]

                    @self.decorate
                    def run(agent, req):
                        return list(agent.llmclient.backend.raw_ask(messages))

                    if fail:
                        with self.assertRaisesRegex(ValueError, 'expected'):
                            run(agent, {**self.req, 'op': 'btw'})
                    else:
                        self.assertEqual(run(agent, {**self.req, 'op': 'btw'}), ['ok'])
                    self.assertEqual(backend.raw_ask, original)
                    self.assertEqual('raw_ask' in vars(backend), owned)
                    self.assertEqual(messages, [{'role': 'system', 'content': 'GLOBAL'}])
                    self.assertEqual(self.callbacks, [])

    def test_legacy_migration_preserves_local_and_source(self):
        legacy = Path(self.tmp.name) / 'legacy'
        (legacy / 'l3').mkdir(parents=True)
        (legacy / 'l1.md').write_text('OLD_RULE')
        (legacy / 'l3' / 'detail.md').write_text('DETAIL')
        target = Path(self.tmp.name) / 'workspace' / 'memory'
        req = {**self.req, 'project_memory_dir': str(target),
               'project_memory_legacy_dir': str(legacy)}
        @self.decorate
        def run(agent, req):
            pass
        agent = SimpleNamespace(llmclient=object())
        run(agent, req)
        self.assertEqual((target / 'l1.md').read_text(), 'OLD_RULE')
        (target / 'l1.md').write_text('NEW_RULE')
        before = {str(p.relative_to(target)): p.read_bytes() for p in target.rglob('*') if p.is_file()}
        run(agent, req)
        after = {str(p.relative_to(target)): p.read_bytes() for p in target.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual((legacy / 'l1.md').read_text(), 'OLD_RULE')
        self.assertEqual((target / 'l3' / 'detail.md').read_text(), 'DETAIL')

    def test_runtime_switch_preserves_both_stores(self):
        workspace = Path(self.tmp.name) / 'workspace'
        workspace.mkdir()
        legacy = workspace / 'project_memory.md'
        legacy.write_text('OFFICIAL_KNOWLEDGE', encoding='utf-8')
        agent = SimpleNamespace(llmclient=object())

        @self.decorate
        def run(agent, req):
            if req['project_provider'] == 'admin':
                messages = [{'role': 'system', 'content': 'GLOBAL'}]
                self.callbacks[0]({'client': agent.llmclient, 'messages': messages})
                self.assertIn(str(legacy), messages[0]['content'])
                self.assertIn('FIRST_RULE', str(messages))
            else:
                self.assertEqual(self.callbacks, [])

        req = {**self.req, 'project_workspace': str(workspace)}
        for mode in ('admin', 'official', 'admin'):
            run(agent, {**req, 'project_provider': mode})
            self.assertEqual(legacy.read_text(encoding='utf-8'), 'OFFICIAL_KNOWLEDGE')
            self.assertEqual(self.l1.read_text(encoding='utf-8'), 'FIRST_RULE')
        self.assertTrue((Path(self.tmp.name) / 'project_mem.txt').is_file())
        policy = (Path(self.tmp.name) / 'memory_management_sop.md').read_text()
        self.assertIn('30 lines', policy)
        self.assertIn('RULES', policy)
        self.assertFalse((Path(self.tmp.name) / 'l3').exists())

    def test_official_bypasses_admin_hooks(self):
        @self.decorate
        def run(agent, req):
            self.assertEqual(self.callbacks, [])
            return 'official'
        self.assertEqual(run(object(), {**self.req, 'project_provider': 'official'}), 'official')


if __name__ == '__main__':
    unittest.main()
