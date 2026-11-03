from pathlib import Path
from datetime import datetime, timezone
import json
import platform
import re
import uuid
import zipfile
from .masking import mask_obj


def create_handoff(results, out_dir='handoff'):
    results = mask_obj(results)
    d = Path(out_dir) / (datetime.now(timezone.utc).strftime('%Y-%m-%d_%H%M%S') + '_' + uuid.uuid4().hex[:8])
    d.mkdir(parents=True)
    for sub in ['issues', 'fix_history', 'needs_big_ai', 'metrics']:
        (d / sub).mkdir()
    for index, r in enumerate(results):
        if r.get('returncode') != 0:
            name = re.sub(r'[^A-Za-z0-9_-]', '_', str(r.get('name', 'unknown')))
            issue_dir = d / 'issues' / (name or str(index))
            issue_dir.mkdir(exist_ok=True)
            (issue_dir / 'issue.json').write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding='utf-8')
    text = json.dumps(results, ensure_ascii=False, indent=2)
    (d / 'README_FOR_AI.md').write_text('# Handoff\nСначала прочитать summary.md.\n', encoding='utf-8')
    (d / 'summary.md').write_text('# Summary\n```json\n' + text + '\n```\n', encoding='utf-8')
    (d / 'summary.json').write_text(text, encoding='utf-8')
    (d / 'environment.json').write_text(json.dumps({'platform': platform.system()}), encoding='utf-8')
    with zipfile.ZipFile(d.with_suffix('.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for f in d.rglob('*'):
            if f.is_file():
                z.write(f, f.relative_to(d.parent))
    return d
