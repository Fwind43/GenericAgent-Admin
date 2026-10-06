import ast
import json
import unittest
from pathlib import Path


class ConductorPagingTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name('chat_worker.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_conductor_collect_page')
        env = {'json': json}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<paging>', 'exec'), env)
        self.page = env[node.name]

    def test_small_outcome_is_compatible(self):
        reply = dict(dispatch_id='d', status='succeeded', evidence=[], result='ok')
        self.assertIs(self.page(reply, {}), reply)

    def test_escaped_unicode_large_snapshot_round_trip_and_wire_budget(self):
        reply = dict(dispatch_id='d', session_id='w', status='succeeded', objective='objective',
                     result=('\U0001f680\u4e2d"\\\n' * 12000), error='',
                     evidence=[dict(id='d:0', output='\u4e2d' * 8000)],
                     review=dict(status='verified', basis='b' * 20000), result_receipt=dict(id='a', revision='v'))
        original = json.dumps(reply)
        summary = self.page(reply, {})
        self.assertTrue(summary['summary_only'])
        self.assertNotIn('evidence', summary)
        self.assertEqual(summary['evidence_count'], 1)
        offset = 0
        chunks = []
        while True:
            page = self.page(reply, dict(detail=True, offset=offset, snapshot_id=summary['snapshot_id']))
            wrapped = dict(untrusted_worker_result=page, instruction='i' * 1200)
            self.assertLessEqual(len(json.dumps(wrapped, ensure_ascii=True).encode()), 16 * 1024)
            self.assertEqual(page['offset'], offset)
            chunks.append(page['json_chunk'])
            if page['next_offset'] is None:
                break
            self.assertGreater(page['next_offset'], offset)
            offset = page['next_offset']
        self.assertEqual(json.loads(''.join(chunks)), reply)
        self.assertEqual(json.dumps(reply), original)
        self.assertGreater(len(chunks), 1)

    def test_large_summary_preserves_explicit_resolution(self):
        reply = dict(dispatch_id='d', status='failed', result='x' * 20000,
                     review=None, resolution=dict(status='superseded',
                     replacement_dispatch_id='new', basis='Retry replaces this attempt'))
        summary = self.page(reply, {})
        self.assertTrue(summary['summary_only'])
        self.assertEqual(summary['status'], 'failed')
        self.assertEqual(summary['resolution_status'], 'superseded')
        self.assertEqual(summary['replacement_dispatch_id'], 'new')
        self.assertNotIn('review_status', summary)

    def test_invalid_offsets_and_stale_snapshot_fail_closed(self):
        reply = dict(dispatch_id='d', status='succeeded', result='\U0001f680' * 6000)
        first = self.page(reply, dict(detail=True))
        for args in ({'offset': -1}, {'offset': True}, {'offset': 1},
                     {'detail': True, 'offset': first['next_offset']},
                     {'detail': True, 'snapshot_id': 'stale'},
                     {'detail': True, 'offset': 10 ** 9}):
            self.assertFalse(self.page(reply, args)['ok'])
        changed = dict(reply, result='changed')
        self.assertIn('Snapshot changed', self.page(changed, dict(detail=True, snapshot_id=first['snapshot_id']))['error'])
        raw = json.dumps(reply, ensure_ascii=False, separators=(',', ':')).encode()
        split = raw.index('\U0001f680'.encode()) + 1
        self.assertIn('UTF-8', self.page(reply, dict(detail=True, offset=split, snapshot_id=first['snapshot_id']))['error'])


if __name__ == '__main__':
    unittest.main()
