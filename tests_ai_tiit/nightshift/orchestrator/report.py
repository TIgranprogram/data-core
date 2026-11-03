import html
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone
from .masking import mask_obj
from .execution import commit_hash, now


def category(result):
    if result.get('category') in {'runner_error', 'timeout', 'not_implemented', 'blocked'}:
        return result['category']
    if result.get('timed_out') or result.get('returncode') == 124:
        return 'timeout'
    if result.get('error') or result.get('returncode') == 2:
        return 'runner_error'
    if result.get('expected_failure'):
        return 'expected_demo_failure' if result.get('returncode') == 1 else 'demo_mismatch'
    if result.get('returncode') == 0:
        return 'passed'
    return result.get('failure_category', 'app_failure')


def generate(results, out_dir='reports'):
    results = mask_obj(results)
    for r in results:
        r['category'] = category(r)
        r['status'] = r['category']
        r.setdefault('commit_hash', commit_hash())
        r.setdefault('started_at', now())
        r.setdefault('finished_at', now())
        r.setdefault('reason', 'exit code ' + str(r.get('returncode')))
    d = Path(out_dir) / (datetime.now(timezone.utc).strftime('%Y-%m-%d_%H%M%S') + '_' + uuid.uuid4().hex[:8])
    d.mkdir(parents=True)
    passed = sum(r['category'] == 'passed' for r in results)
    report = {'summary': {'passed': passed, 'failed': len(results) - passed, 'total': len(results),
                          'executed': [r['name'] for r in results if r.get('executed', True)]},
              'results': results, 'issues': [], 'config_diff': []}
    for r in results:
        if r['category'] != 'passed':
            report['issues'].append({'suite': r.get('name'), 'test': r.get('name'),
                'run_time': r['started_at'], 'commit_hash': r['commit_hash'],
                'expected': 'exit code 1 (demo)' if r.get('expected_failure') else 'exit code 0',
                'actual': f"exit code {r.get('returncode')}", 'error': r.get('error', r.get('stderr', '')),
                'stacktrace': r.get('stderr', ''), 'log_fragment': r.get('stdout', '')[:500],
                'repro': ' '.join(r.get('command', [])), 'category': r['category'], 'reason': r['reason']})
    text = json.dumps(mask_obj(report), ensure_ascii=False, indent=2)
    (d / 'report.json').write_text(text, encoding='utf-8')
    (d / 'report.html').write_text('<!doctype html><meta charset="utf-8"><h1>Nightshift</h1><pre>' + html.escape(text) + '</pre>', encoding='utf-8')
    return d
