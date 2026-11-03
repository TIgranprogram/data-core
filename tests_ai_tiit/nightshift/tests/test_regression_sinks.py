import json
import subprocess
from pathlib import Path
import pytest
from orchestrator.stand import context, ROOT
from orchestrator.execution import safe_env


@pytest.mark.parametrize('ready_status', [200, 503])
def test_regression_uses_only_controlled_sinks(ready_status):
    ctx = context()
    source = json.dumps(str(ROOT / 'stand/regression.cjs'))
    env = json.dumps({'MONGO_DB': ctx['db'], 'MONGO_DB_TEST': ctx['test_db'], 'MONGO_URI': f"mongodb://mongo:27017/{ctx['db']}?replicaSet=rs0"})
    script = f"""
const fs = require('node:fs');
const vm = require('node:vm');
const calls = [];
const fakeProcess = {{env: {env}, exitCode: 0}};
const mongo = {{
  connection: {{name: fakeProcess.env.MONGO_DB, db: {{
    command: async x => {{ calls.push(['mongo-command', x]); return {{ok: 1}}; }},
    listCollections: () => ({{toArray: async () => [{{name: 'users'}}]}})
  }}}},
  connect: async uri => {{calls.push(['mongo-connect', uri]);}},
  disconnect: async () => {{}}
}};
const sandbox = {{
  require: name => name === '/app/node_modules/mongoose' ? mongo : require(name),
  process: fakeProcess,
  console: {{log: () => {{}}, error: () => {{}}}},
  AbortSignal,
  fetch: async (url, opts) => {{
    calls.push(['http', url]);
    if (url !== 'http://127.0.0.1:3000/api/health/ready' && url !== 'http://127.0.0.1:3000/api/stock/items') throw Error('non-sink URL');
    return {{status: url.endsWith('/ready') ? {ready_status} : 401, json: async () => ({{status: 'ok'}})}};
  }}
}};
vm.runInNewContext(fs.readFileSync({source}, 'utf8'), sandbox);
setTimeout(() => {{ console.log(JSON.stringify({{calls, code: fakeProcess.exitCode}})); process.exitCode = fakeProcess.exitCode; }}, 20);
"""
    proc = subprocess.run(['node', '-e', script], env=safe_env(), capture_output=True, text=True, encoding='utf-8', timeout=10)
    data = json.loads(proc.stdout)
    assert proc.returncode == (0 if ready_status == 200 else 1)
    assert all(call[1].startswith('http://127.0.0.1:3000/') for call in data['calls'] if call[0] == 'http')
    if ready_status == 200:
        assert ['mongo-connect', f"mongodb://mongo:27017/{ctx['db']}?replicaSet=rs0"] in data['calls']
    else:
        assert not any(call[0] == 'mongo-connect' for call in data['calls'])
