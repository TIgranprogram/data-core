// Проверка MCP-сервера как его вызывает Claude: initialize → tools/list → вызовы инструментов.
//   DATACORE_URL=… DATACORE_KEY=kppd_… node mcp/selftest.mjs [инструмент '{"аргументы"}']
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const srv = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'datacore-mcp.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
let buf = ''; const wait = new Map(); let id = 0;
srv.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); wait.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise((r) => { const n = ++id; wait.set(n, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const text = (m) => m.result?.content?.[0]?.text ?? JSON.stringify(m.error);

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } });
console.log('initialize:', init.result?.serverInfo?.name, init.result?.protocolVersion);
const list = await rpc('tools/list', {});
console.log('инструменты:', list.result.tools.map((t) => t.name).join(', '));
const calls = process.argv[2] ? [[process.argv[2], JSON.parse(process.argv[3] || '{}')]] : [['stock_items', { status: 'low', limit: 3 }], ['search', { q: 'болт' }], ['requests', { limit: 3 }], ['money_forecast', { days: 30, opening: 100000 }]];
for (const [name, args] of calls) {
  const r = await rpc('tools/call', { name, arguments: args });
  console.log(`\n${name}${r.result?.isError ? ' (ошибка)' : ''}: ${text(r).replace(/\s+/g, ' ').slice(0, 400)}`);
}
srv.kill();
