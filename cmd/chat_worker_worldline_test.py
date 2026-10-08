import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

sys.dont_write_bytecode = True


def _find_ga_root():
    """Locate the GA repo (contains frontends/worldline.py).

    Order: GA_ROOT env var -> ancestors of this file (nested checkout layout).
    Returns None when not found; tests then rely on PYTHONPATH already
    exposing `frontends`.
    """
    env = os.environ.get('GA_ROOT')
    if env and (Path(env) / 'frontends' / 'worldline.py').is_file():
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        if (parent / 'frontends' / 'worldline.py').is_file():
            return parent
    return None


GA_ROOT = _find_ga_root()
if GA_ROOT and str(GA_ROOT) not in sys.path:
    sys.path.insert(0, str(GA_ROOT))
if importlib.util.find_spec('frontends') is None:
    raise unittest.SkipTest(
        'frontends package not importable; set GA_ROOT env var to the GenericAgent repo root'
    )
WORKER_PATH = Path(__file__).with_name('chat_worker.py')
SPEC = importlib.util.spec_from_file_location('ga_admin_chat_worker_worldline_tested', WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class FakeStore:
    def __init__(self):
        self.root_id = 'root'
        self.head = 'b'
        self.nodes = {
            'root': {'parent': None, 'children': ['a', 'b'], 'title': 'same'},
            'a': {'parent': 'root', 'children': [], 'title': 'same'},
            'b': {'parent': 'root', 'children': ['c'], 'title': 'same'},
            'c': {'parent': 'b', 'children': [], 'title': 'leaf'},
        }


class WorldlineSidecarTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = FakeStore()

    def tearDown(self):
        self.tmp.cleanup()

    def test_worldline_hook_guard_is_defined_and_installs_once(self):
        registrations = []
        plugins = ModuleType('plugins')
        hooks = ModuleType('plugins.hooks')

        def register(event):
            self.assertEqual(event, 'tool_before')

            def decorator(callback):
                registrations.append(callback)
                return callback

            return decorator

        hooks.register = register
        plugins.hooks = hooks
        with mock.patch.object(worker, '_WORLDLINE_HOOK_INSTALLED', False), \
             mock.patch.dict(sys.modules, {'plugins': plugins, 'plugins.hooks': hooks}):
            worker._install_worldline_hook()
            worker._install_worldline_hook()
            self.assertTrue(worker._WORLDLINE_HOOK_INSTALLED)

        self.assertEqual(len(registrations), 1)

    def test_worldline_title_strips_project_mode_without_store_private_helper(self):
        store = SimpleNamespace(
            root_id='root',
            head='root',
            nodes={'root': {'parent': None, 'children': []}},
            rebuild_history=lambda _node_id: [],
        )
        history = [{
            'role': 'user',
            'content': (
                'Keep this title\n\n'
                '---\n[PROJECT MODE: ga-admin]\n'
                'Injected project instructions\n---\n'
            ),
        }]

        self.assertEqual(worker._worldline_title(store, history, 'fallback'), 'Keep this title')

    def test_worldline_title_extracts_text_from_structured_content(self):
        store = SimpleNamespace(
            root_id='root',
            head='root',
            nodes={'root': {'parent': None, 'children': []}},
            rebuild_history=lambda _node_id: [],
        )
        history = [{
            'role': 'user',
            'content': [{
                'type': 'text',
                'text': (
                    'Readable node title\n\n'
                    '---\n[PROJECT MODE: ga-admin]\n'
                    'Injected project instructions\n---\n'
                ),
            }],
        }]

        self.assertEqual(
            worker._worldline_title(store, history, 'fallback'),
            'Readable node title',
        )

    def test_worldline_title_skips_tool_result_messages_masquerading_as_user(self):
        store = SimpleNamespace(
            root_id='root',
            head='root',
            nodes={'root': {'parent': None, 'children': []}},
            rebuild_history=lambda _node_id: [],
        )
        history = [
            {
                'role': 'user',
                'content': [
                    {'type': 'tool_result', 'content': {'result': '{"status":"success"}'}},
                    {'type': 'text', 'text': '### [WORKING MEMORY]\ninternal state'},
                ],
            },
            {
                'role': 'user',
                'content': [{'type': 'text', 'text': 'Actual human request'}],
            },
        ]

        self.assertEqual(
            worker._worldline_title(store, history, 'fallback'),
            'Actual human request',
        )

    def test_worldline_title_falls_back_when_only_new_user_entry_is_a_tool_result(self):
        store = SimpleNamespace(
            root_id='root',
            head='root',
            nodes={'root': {'parent': None, 'children': []}},
            rebuild_history=lambda _node_id: [],
        )
        history = [{
            'role': 'user',
            'content': [{'type': 'tool_result', 'content': {'result': 'not a title'}}],
        }]

        self.assertEqual(worker._worldline_title(store, history, 'fallback prompt'), 'fallback prompt')

    def test_worldline_content_text_handles_nested_result(self):
        content = [{'type': 'tool_result', 'content': {'result': 'Useful result'}}]
        self.assertEqual(worker._worldline_content_text(content), 'Useful result')

    def test_projected_title_preserves_stored_value_when_conv_blob_is_missing(self):
        store = SimpleNamespace(
            nodes={'node': {'conv': 'missing-conv'}},
            _get_blob=mock.Mock(side_effect=FileNotFoundError('missing blob')),
        )

        self.assertEqual(
            worker._projected_worldline_title(store, 'node', 'Stored title'),
            'Stored title',
        )

    def test_projection_repairs_legacy_tool_result_title_without_persisting(self):
        history_delta = [
            {
                'role': 'user',
                'content': [
                    {'type': 'tool_result', 'content': {'result': '{"status":"success"}'}},
                    {'type': 'text', 'text': '### [WORKING MEMORY]\ninternal state'},
                ],
            },
            {
                'role': 'user',
                'content': [{'type': 'text', 'text': 'Actual human request'}],
            },
        ]
        legacy_title = '{"status":"success"} ### [WORKING MEMORY] internal state'
        store = SimpleNamespace(
            root_id='root',
            head='node',
            nodes={
                'root': {'parent': None, 'children': ['node'], 'title': 'origin'},
                'node': {
                    'parent': 'root', 'children': [], 'title': legacy_title,
                    'conv': 'node-conv',
                },
            },
            _get_blob=lambda blob: json.dumps(history_delta).encode('utf-8') if blob == 'node-conv' else b'[]',
        )
        tree = SimpleNamespace(root_id='root', nodes={
            'root': SimpleNamespace(
                id='root', parent_id=None, children=['node'], title='origin',
                kind='origin', files=[], ago=0, rw_tag=None,
            ),
            'node': SimpleNamespace(
                id='node', parent_id='root', children=[], title=legacy_title,
                kind='edit', files=[], ago=0, rw_tag=None,
            ),
        })

        with mock.patch('frontends.worldline.tree_from_store', return_value=tree):
            projection = worker._worldline_nodes(store)

        by_id = {node['id']: node for node in projection['nodes']}
        self.assertEqual(by_id['node']['title'], 'Actual human request')
        self.assertEqual(store.nodes['node']['title'], legacy_title)

    def test_projection_preserves_custom_title_even_when_delta_contains_tool_result(self):
        history_delta = [
            {
                'role': 'user',
                'content': [{'type': 'tool_result', 'content': 'tool output'}],
            },
            {
                'role': 'user',
                'content': [{'type': 'text', 'text': 'Actual human request'}],
            },
        ]
        store = SimpleNamespace(
            root_id='node', head='node',
            nodes={'node': {
                'parent': None, 'children': [], 'title': 'Custom checkpoint title',
                'conv': 'node-conv',
            }},
            _get_blob=lambda blob: json.dumps(history_delta).encode('utf-8'),
        )
        tree = SimpleNamespace(root_id='node', nodes={
            'node': SimpleNamespace(
                id='node', parent_id=None, children=[], title='Custom checkpoint title',
                kind='edit', files=[], ago=0, rw_tag=None,
            ),
        })
        with mock.patch('frontends.worldline.tree_from_store', return_value=tree):
            projection = worker._worldline_nodes(store)

        self.assertEqual(projection['nodes'][0]['title'], 'Custom checkpoint title')

    def test_projection_preserves_sibling_order_repeated_title_identity_and_path(self):
        nodes = {
            key: SimpleNamespace(
                id=key, parent_id=value['parent'], children=list(value['children']),
                title=value['title'], kind='edit', files=[], ago=0, rw_tag=None,
            )
            for key, value in self.store.nodes.items()
        }
        tree = SimpleNamespace(root_id='root', nodes=nodes)
        sidecar = worker._empty_worldline_sidecar('sid-1')
        sidecar['bindings']['a'] = {
            'user_message_id': 'u-a', 'assistant_message_id': 'm-a', 'display_path': [0]
        }
        with mock.patch('frontends.worldline.tree_from_store', return_value=tree):
            projection = worker._worldline_nodes(self.store, sidecar, 'ok')
        self.assertEqual([n['id'] for n in projection['nodes']], ['root', 'b', 'a', 'c'])
        self.assertEqual([n['title'] for n in projection['nodes'][:3]], ['same', 'same', 'same'])
        self.assertEqual(projection['current_path'], ['root', 'b'])
        by_id = {node['id']: node for node in projection['nodes']}
        self.assertEqual(by_id['a']['mapping_status'], 'mapped')
        self.assertEqual(by_id['b']['mapping_status'], 'unmapped')
        self.assertIsNone(by_id['b']['user_message_id'])

    def test_projection_collapses_internal_bridge_alias_and_reparents_descendant(self):
        store = SimpleNamespace(root_id='root', head='new', nodes={
            'root': {'parent': None, 'children': ['a', 'b', 'bridge']},
            'a': {'parent': 'root', 'children': []},
            'b': {'parent': 'root', 'children': []},
            'bridge': {'parent': 'root', 'children': ['new']},
            'new': {'parent': 'bridge', 'children': []},
        })
        nodes = {
            node_id: SimpleNamespace(
                id=node_id, parent_id=value['parent'], children=list(value['children']),
                title=node_id, kind='edit', files=[], ago=0, rw_tag=None,
            )
            for node_id, value in store.nodes.items()
        }
        sidecar = worker._empty_worldline_sidecar('sid-1')
        sidecar['aliases']['bridge'] = 'a'
        with mock.patch('frontends.worldline.tree_from_store', return_value=SimpleNamespace(root_id='root', nodes=nodes)):
            projection = worker._worldline_nodes(store, sidecar, 'ok')
        by_id = {node['id']: node for node in projection['nodes']}
        self.assertNotIn('bridge', by_id)
        self.assertEqual(projection['head'], 'new')
        self.assertEqual(projection['current_path'], ['root', 'a', 'new'])
        self.assertEqual(by_id['new']['parent_id'], 'a')
        self.assertIn('new', by_id['a']['children'])

    def test_projection_caps_oversized_topology_and_keeps_current_path(self):
        child_ids = [f'n-{index}' for index in range(worker._WORLDLINE_PUBLIC_NODE_LIMIT + 25)]
        store = SimpleNamespace(root_id='root', head=child_ids[-1], nodes={
            'root': {'parent': None, 'children': child_ids},
            **{node_id: {'parent': 'root', 'children': []} for node_id in child_ids},
        })
        nodes = {
            'root': SimpleNamespace(id='root', parent_id=None, children=child_ids, title='root', kind='edit', files=[], ago=0, rw_tag=None),
            **{node_id: SimpleNamespace(id=node_id, parent_id='root', children=[], title=node_id, kind='edit', files=[], ago=0, rw_tag=None) for node_id in child_ids},
        }
        with mock.patch('frontends.worldline.tree_from_store', return_value=SimpleNamespace(root_id='root', nodes=nodes)):
            projection = worker._worldline_nodes(store)
        ids = {node['id'] for node in projection['nodes']}
        self.assertEqual(projection['schema_version'], 1)
        self.assertEqual(len(projection['nodes']), worker._WORLDLINE_PUBLIC_NODE_LIMIT)
        self.assertTrue(projection['truncated'])
        self.assertEqual(projection['current_path'], ['root', child_ids[-1]])
        self.assertEqual(projection['head'], child_ids[-1])
        self.assertTrue(all(set(node['children']) <= ids for node in projection['nodes']))

    def test_state_source_nodes_keep_folded_physical_ancestors_private(self):
        store = SimpleNamespace(
            head='leaf',
            nodes={
                'root': {'parent': None, 'children': ['folded']},
                'folded': {'parent': 'root', 'children': ['leaf']},
                'leaf': {'parent': 'folded', 'children': []},
            },
        )
        sidecar = {'status': 'ok', 'bindings': {
            'folded': {'user_message_id': 'u-folded'},
            'leaf': {'user_message_id': 'u-leaf'},
            'sibling': {'user_message_id': 'u-sibling'},
        }}
        self.assertEqual(worker._worldline_source_nodes(store, sidecar), {
            'u-folded': 'folded',
            'u-leaf': 'leaf',
        })
        self.assertEqual(
            worker._worldline_rpc_result(store, sidecar, 'ok', 'state', None),
            {'source_nodes': {'u-folded': 'folded', 'u-leaf': 'leaf'}},
        )
        self.assertIsNone(worker._worldline_rpc_result(store, sidecar, 'ok', 'list', None))

    def test_completed_head_binding_is_atomic_and_persists_across_reload(self):
        req = {
            'node_id': 'b', 'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'user-1', 'assistant_message_id': 'assistant-1',
            'display_path': ['root', 'b'],
        }
        result = worker._bind_worldline_head(self.store, self.root, 'sid-1', req)
        self.assertEqual(result['assistant_message_id'], 'assistant-1')
        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(loaded['bindings']['b']['display_path'], ['root', 'b'])
        ordinal = loaded['bindings']['b']['ordinal']
        created_at = loaded['bindings']['b']['created_at']
        self.assertGreaterEqual(ordinal, 1)
        self.assertGreater(created_at, 0)
        self.assertGreater(loaded['next_ordinal'], ordinal)
        rebound = dict(req, assistant_message_id='assistant-2')
        worker._bind_worldline_head(self.store, self.root, 'sid-1', rebound)
        reloaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(reloaded['bindings']['b']['ordinal'], ordinal)
        self.assertEqual(reloaded['bindings']['b']['created_at'], created_at)
        self.assertEqual(reloaded['bindings']['b']['assistant_message_id'], 'assistant-2')
        path = worker._worldline_sidecar_path(self.root, 'sid-1')
        self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['schema_version'], 1)
        self.assertEqual(list(path.parent.glob('*.tmp-*')), [])

    def test_missing_malformed_legacy_and_sid_isolation_degrade_safely(self):
        missing, status = worker._load_worldline_sidecar(self.root, 'sid-a')
        self.assertEqual((status, missing['bindings']), ('missing', {}))
        path_a = worker._worldline_sidecar_path(self.root, 'sid-a')
        path_a.parent.mkdir(parents=True)
        path_a.write_text('{bad', encoding='utf-8')
        malformed, status = worker._load_worldline_sidecar(self.root, 'sid-a')
        self.assertEqual((status, malformed['bindings']), ('malformed', {}))
        path_a.write_text(json.dumps({'schema_version': 0, 'bindings': {'b': {}}}), encoding='utf-8')
        legacy, status = worker._load_worldline_sidecar(self.root, 'sid-a')
        self.assertEqual((status, legacy['bindings']), ('legacy', {}))
        req = {
            'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'u', 'assistant_message_id': 'a',
        }
        worker._bind_worldline_head(self.store, self.root, 'sid-b', req)
        isolated, status = worker._load_worldline_sidecar(self.root, 'sid-a')
        other, other_status = worker._load_worldline_sidecar(self.root, 'sid-b')
        self.assertEqual((status, isolated['bindings']), ('legacy', {}))
        self.assertEqual(other_status, 'ok')
        self.assertIn('b', other['bindings'])
        for bad_sid in ('', '../escape', 'a/b', 'a\\b'):
            with self.assertRaises(ValueError):
                worker._worldline_sidecar_path(self.root, bad_sid)

    def test_non_completed_or_non_final_turn_never_binds(self):
        base = {'user_message_id': 'u', 'assistant_message_id': 'a'}
        for req in (
            dict(base, turn_status='running', has_final_answer=True),
            dict(base, turn_status='completed', has_final_answer=False),
            dict(base, turn_status='completed'),
        ):
            with self.assertRaises(ValueError):
                worker._bind_worldline_head(self.store, self.root, 'sid-1', req)
        self.assertFalse(worker._worldline_sidecar_path(self.root, 'sid-1').exists())

    def test_only_current_head_can_be_bound(self):
        req = {
            'node_id': 'a', 'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'u', 'assistant_message_id': 'a',
        }
        with self.assertRaises(ValueError):
            worker._bind_worldline_head(self.store, self.root, 'sid-1', req)

    def test_worldline_store_is_initialized_only_by_an_activating_request(self):
        emitted = []
        empty_store = SimpleNamespace(nodes={})
        history = [
            {'id': 'u-old', 'role': 'user', 'content': 'old question'},
            {'id': 'a-old', 'role': 'assistant', 'content': 'old answer'},
        ]
        agent = object()
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=empty_store) as ensure, \
             mock.patch.object(worker, '_restore_admin_history') as restore_history, \
             mock.patch.object(worker, '_restore_ga_state') as restore_state, \
             mock.patch.object(worker, '_commit_worldline', return_value='baseline') as commit, \
             mock.patch.object(worker, '_bind_worldline_head') as bind, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append):
            worker.handle_worldline_request(agent, {
                'action': 'state', 'sid': 'sid-1',
            })
            ensure.assert_not_called()
            commit.assert_not_called()
            bind.assert_not_called()
            self.assertEqual(emitted[-1]['tree']['sidecar_status'], 'inactive')

            worker.handle_worldline_request(agent, {
                'activate': True, 'action': 'list', 'sid': 'sid-1',
                'history': history,
                'raw_history': [{'role': 'assistant', 'content': 'backend'}],
                'history_info': [{'step': 1}],
                'working': {'key_info': 'restored'},
            })
            ensure.assert_called_once_with(agent, self.root, None)
            restore_history.assert_called_once_with(
                agent, history, [{'role': 'assistant', 'content': 'backend'}]
            )
            restore_state.assert_called_once_with(agent, [{'step': 1}], {'key_info': 'restored'})
            commit.assert_called_once_with(agent, 'old question')
            bind.assert_called_once_with(empty_store, self.root, 'sid-1', {
                'node_id': 'baseline',
                'turn_status': 'completed',
                'has_final_answer': True,
                'user_message_id': 'u-old',
                'assistant_message_id': 'a-old',
                'display_path': history,
            })
            self.assertEqual(emitted[-1]['tree'], {'nodes': []})

    def test_existing_tree_activation_restores_persisted_working_memory(self):
        agent = SimpleNamespace(history=[], handler=None)
        emitted = []
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=self.store), \
             mock.patch.object(worker, '_restore_admin_history') as restore_history, \
             mock.patch.object(worker, '_commit_worldline') as commit, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append):
            worker.handle_worldline_request(agent, {
                'activate': True, 'action': 'state', 'sid': 'sid-1',
                'history': [], 'raw_history': [],
                'history_info': [{'step': 7}],
                'working': {'key_info': 'persisted checkpoint'},
            })
        self.assertEqual(emitted[-1]['working'].get('key_info'), 'persisted checkpoint')
        self.assertEqual(emitted[-1]['history_info'], [{'step': 7}])
        restore_history.assert_called_once_with(agent, [], [])
        commit.assert_not_called()

    def test_real_store_restore_memory_survives_cold_activation_and_reload(self):
        from frontends.worldline import RewindStore

        cases = [
            ('legacy', None, 'conversation', 'at', 'persisted checkpoint'),
            ('branch', 'branch checkpoint', 'conversation', 'at', 'branch checkpoint'),
            ('empty', '', 'conversation', 'at', ''),
            ('before', 'branch checkpoint', 'conversation', 'before', 'parent checkpoint'),
            ('code', 'branch checkpoint', 'code', 'at', 'persisted checkpoint'),
        ]
        for label, target_key, mode, to, expected in cases:
            with self.subTest(case=label):
                workspace = self.root / label
                workspace.mkdir()
                store = RewindStore(str(self.root / ('rewind-' + label)), str(workspace))
                history = [{'role': 'user', 'content': 'parent'}]
                kwargs = {} if target_key is None else {'hist_info': [], 'key_info': 'parent checkpoint'}
                store.commit('parent', history=list(history), **kwargs)
                history.append({'role': 'assistant', 'content': 'target'})
                kwargs = {} if target_key is None else {'hist_info': [], 'key_info': target_key}
                target = store.commit('target', history=list(history), **kwargs)
                history.append({'role': 'user', 'content': 'head'})
                kwargs = {} if target_key is None else {'hist_info': [], 'key_info': 'head checkpoint'}
                store.commit('head', history=list(history), **kwargs)
                if label == 'legacy':
                    # Modern commits derive WM automatically; simulate pre-WM nodes.
                    for node in store.nodes.values():
                        for field in ('hinfo', 'hinfo_len', 'kinfo'):
                            node.pop(field, None)
                    self.assertFalse(store.path_has_wm(target))
                agent = SimpleNamespace(history=[], handler=None,
                                        llmclient=SimpleNamespace(backend=SimpleNamespace(history=[])))
                emitted = []
                with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
                     mock.patch.object(worker, '_apply_workspace', return_value=workspace), \
                     mock.patch.object(worker, '_ensure_worldline_store', return_value=store), \
                     mock.patch.object(worker, 'emit', side_effect=emitted.append):
                    worker.handle_worldline_request(agent, {
                        'activate': True, 'action': 'restore', 'sid': label,
                        'node_id': target, 'mode': mode, 'to': to,
                        'history': [], 'raw_history': history,
                        'history_info': [],
                        'working': {'key_info': 'persisted checkpoint', 'sentinel': 'keep'},
                    })
                state = emitted[-1]
                self.assertEqual(state['working']['key_info'], expected)
                self.assertEqual(state['working']['sentinel'], 'keep')
                reloaded = SimpleNamespace(history=[], handler=None,
                                           llmclient=SimpleNamespace(backend=SimpleNamespace(history=[])))
                worker._restore_admin_history(reloaded, [], state['raw_history'])
                worker._restore_ga_state(reloaded, state['history_info'], state['working'])
                self.assertEqual(worker._snapshot_ga_state(reloaded)['working']['key_info'], expected)
                self.assertEqual(reloaded.llmclient.backend.history, state['raw_history'])

    def test_mapped_restore_uses_core_conv_mode_and_returns_display_mapping(self):
        worker._bind_worldline_head(self.store, self.root, 'sid-1', {
            'node_id': 'b', 'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'u1', 'assistant_message_id': 'a1',
            'display_path': [2, 4],
        })
        emitted = []
        restore_result = {'history': [{'role': 'user', 'content': 'restored'}], 'target': 'bridge-mapped'}
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=self.store), \
             mock.patch.object(worker, '_apply_worldline_restore') as apply_restore, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append), \
             mock.patch('frontends.worldline.restore_plan', return_value=restore_result) as restore:
            worker.handle_worldline_request(object(), {
                'activate': True, 'action': 'restore_mapped', 'sid': 'sid-1', 'node_id': 'b'
            })
        restore.assert_called_once_with(self.store, 'b', mode='conv', to='at')
        apply_restore.assert_called_once()
        self.assertEqual(emitted[0]['result']['display_path'], [2, 4])
        self.assertEqual(emitted[0]['result']['user_message_id'], 'u1')
        self.assertEqual(emitted[0]['result']['assistant_message_id'], 'a1')
        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(loaded['aliases']['bridge-mapped'], 'b')

    def test_public_conversation_restore_maps_to_core_conv_mode(self):
        emitted = []
        restore_result = {'history': [{'role': 'user', 'content': 'restored'}], 'target': 'bridge-before'}
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=self.store), \
             mock.patch.object(worker, '_apply_worldline_restore') as apply_restore, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append), \
             mock.patch('frontends.worldline.restore_plan', return_value=restore_result) as restore:
            worker.handle_worldline_request(object(), {
                'activate': True, 'action': 'restore', 'sid': 'sid-1', 'node_id': 'b',
                'mode': 'conversation', 'to': 'before',
            })
        restore.assert_called_once_with(self.store, 'b', mode='conv', to='before')
        apply_restore.assert_called_once_with(mock.ANY, restore_result)
        self.assertEqual(emitted[0]['result'], restore_result)
        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(loaded['aliases']['bridge-before'], 'root')

    def test_restore_full_user_display_at(self):
        display = [{'id': 'old-u', 'role': 'user', 'content': 'not in raw history'}, {'id': 'u1', 'role': 'user', 'content': 'restored'}]
        worker._bind_worldline_head(self.store, self.root, 'sid-1', {'node_id': 'b', 'turn_status': 'completed', 'has_final_answer': True, 'user_message_id': 'u1', 'assistant_message_id': 'a1', 'display_path': display})
        emitted = []
        restore_result = {'history': [{'role': 'user', 'content': 'restored'}], 'target': 'bridge-before'}
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=self.store), \
             mock.patch.object(worker, '_apply_worldline_restore') as apply_restore, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append), \
             mock.patch('frontends.worldline.restore_plan', return_value=restore_result) as restore:
            worker.handle_worldline_request(object(), {
                'activate': True, 'action': 'restore', 'sid': 'sid-1', 'node_id': 'b',
                'mode': 'conversation', 'to': 'at',
            })
        restore.assert_called_once_with(self.store, 'b', mode='conv', to='at')
        apply_restore.assert_called_once_with(mock.ANY, restore_result)
        self.assertEqual(emitted[0]['result'], restore_result)
        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(emitted[0]['result']['display_path'], display)

    def test_restore_full_user_display_before(self):
        display = [{'id': 'old-u', 'role': 'user', 'content': 'not in raw history'}, {'id': 'u1', 'role': 'user', 'content': 'restored'}]
        worker._bind_worldline_head(self.store, self.root, 'sid-1', {'node_id': 'b', 'turn_status': 'completed', 'has_final_answer': True, 'user_message_id': 'u1', 'assistant_message_id': 'a1', 'display_path': display})
        emitted = []
        restore_result = {'history': [{'role': 'user', 'content': 'restored'}], 'target': 'bridge-before'}
        with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
             mock.patch.object(worker, '_apply_workspace', return_value=None), \
             mock.patch.object(worker, '_ensure_worldline_store', return_value=self.store), \
             mock.patch.object(worker, '_apply_worldline_restore') as apply_restore, \
             mock.patch.object(worker, '_worldline_nodes', return_value={'nodes': []}), \
             mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
             mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
             mock.patch.object(worker, 'emit', side_effect=emitted.append), \
             mock.patch('frontends.worldline.restore_plan', return_value=restore_result) as restore:
            worker.handle_worldline_request(object(), {
                'activate': True, 'action': 'restore', 'sid': 'sid-1', 'node_id': 'b',
                'mode': 'conversation', 'to': 'before',
            })
        restore.assert_called_once_with(self.store, 'b', mode='conv', to='before')
        apply_restore.assert_called_once_with(mock.ANY, restore_result)
        self.assertEqual(emitted[0]['result'], restore_result)
        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-1')
        self.assertEqual(status, 'ok')
        self.assertEqual(emitted[0]['result']['display_path'], display[:1])

    def test_real_store_multi_hop_switch_commit_and_before_restore_stays_logical(self):
        from frontends.worldline import RewindStore

        workspace = self.root / 'workspace'
        workspace.mkdir()
        store = RewindStore(str(self.root / 'rewind'), str(workspace))
        history = []

        def commit_turn(title, user, assistant):
            history.extend([
                {'role': 'user', 'content': user},
                {'role': 'assistant', 'content': assistant},
            ])
            return store.commit(title, history=list(history))

        v1 = commit_turn('one', 'one', 'answer one')
        worker._bind_worldline_head(store, self.root, 'sid-real', {
            'node_id': v1, 'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'u1', 'assistant_message_id': 'a1',
            'display_path': [0],
        })
        v2 = commit_turn('two', 'two', 'answer two')
        worker._bind_worldline_head(store, self.root, 'sid-real', {
            'node_id': v2, 'turn_status': 'completed', 'has_final_answer': True,
            'user_message_id': 'u2', 'assistant_message_id': 'a2',
            'display_path': [0, 1],
        })
        commit_turn('three', 'three', 'answer three')

        def request(payload):
            emitted = []
            with mock.patch.object(worker, '_resolve_request_root', return_value=self.root), \
                 mock.patch.object(worker, '_apply_workspace', return_value=workspace), \
                 mock.patch.object(worker, '_ensure_worldline_store', return_value=store), \
                 mock.patch.object(worker, '_apply_worldline_restore'), \
                 mock.patch.object(worker, '_snapshot_backend_history', return_value=[]), \
                 mock.patch.object(worker, '_snapshot_ga_state', return_value={}), \
                 mock.patch.object(worker, 'emit', side_effect=emitted.append):
                worker.handle_worldline_request(object(), dict(payload, activate=True))
            self.assertEqual(len(emitted), 1)
            return emitted[0]

        first_switch = request({
            'action': 'restore_mapped', 'sid': 'sid-real', 'node_id': v1,
        })
        bridge1 = first_switch['result']['target']
        self.assertNotEqual(bridge1, v1)
        self.assertEqual(store.head, bridge1)
        child1_history = store.rebuild_history(store.head) + [
            {'role': 'user', 'content': 'one child'},
            {'role': 'assistant', 'content': 'answer one child'},
        ]
        child1 = store.commit('one child', history=child1_history)

        second_switch = request({
            'action': 'restore_mapped', 'sid': 'sid-real', 'node_id': v2,
        })
        bridge2 = second_switch['result']['target']
        self.assertNotEqual(bridge2, v2)
        child2_history = store.rebuild_history(store.head) + [
            {'role': 'user', 'content': 'two child'},
            {'role': 'assistant', 'content': 'answer two child'},
        ]
        child2 = store.commit('two child', history=child2_history)
        self.assertEqual(store.nodes[child2]['parent'], bridge2)

        before = request({
            'action': 'restore', 'sid': 'sid-real', 'node_id': child2,
            'mode': 'conversation', 'to': 'before',
        })
        bridge3 = before['result']['target']
        projection = before['tree']
        by_id = {node['id']: node for node in projection['nodes']}

        self.assertEqual(store.head, bridge3)
        self.assertEqual(projection['head'], v2)
        self.assertEqual(projection['current_path'][-2:], [v1, v2])
        self.assertTrue({bridge1, bridge2, bridge3}.isdisjoint(by_id))
        self.assertEqual(by_id[child1]['parent_id'], v1)
        self.assertEqual(by_id[child2]['parent_id'], v2)
        self.assertIn(child1, by_id[v1]['children'])
        self.assertIn(child2, by_id[v2]['children'])

        loaded, status = worker._load_worldline_sidecar(self.root, 'sid-real')
        self.assertEqual(status, 'ok')
        self.assertEqual(loaded['aliases'][bridge1], v1)
        self.assertEqual(loaded['aliases'][bridge2], v2)
        self.assertEqual(loaded['aliases'][bridge3], v2)


if __name__ == '__main__':
    unittest.main()
