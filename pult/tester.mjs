import fs from 'node:fs';
import path from 'node:path';

/** Только локальные журналы; отсутствие пульса не выдаём за успешный обход. */
export function testerState(root, runs = {}, jobs = [], now = Date.now()) {
  const dir = path.join(root, 'tools', 'logs', 'ai-tester');
  let marker = null, report = null;
  try { marker = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); } catch {}
  try {
    const days = fs.readdirSync(dir).filter(x => /^\d{4}-\d\d-\d\d$/.test(x)).sort().reverse();
    for (const day of days) {
      const file = path.join(dir, day, 'REPORT.md');
      if (fs.existsSync(file)) { report = { path: `tools/logs/ai-tester/${day}/REPORT.md`, at: fs.statSync(file).mtimeMs }; break; }
    }
  } catch {}
  const live = jobs.filter(j => j.state === 'running');
  const launch = runs['ait-run'];
  const active = marker && now - Number(marker.beat) < 240000;
  let state = 'empty';
  if (live.some(j => j.cmdId === 'ait-run')) state = 'preparing';
  else if (active) state = live.some(j => j.cmdId === 'ait-stop') || fs.existsSync(path.join(dir, 'STOP')) ? 'stopping' : 'running';
  else if (marker) state = 'interrupted';
  else if (launch && launch.code !== 0) state = 'failed';
  else if (report && (!launch || report.at >= launch.at)) state = 'finished';
  else if (launch?.code === 0 && now - launch.at < 120000) state = 'starting';
  else if (launch) state = 'missing';
  return { state, active: !!active, busy: !!marker || ['preparing', 'starting'].includes(state), report, logs: 'tools/logs/ai-tester', launchLogs: 'pult/logs' };
}
