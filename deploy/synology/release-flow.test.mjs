// Весь release-поток: fake ssh/scp/git, никакого сетевого доступа или настоящих контейнеров.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
function run(mode='ok'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dc-release-flow-'));
 const write=(rel,text)=>{const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);};
 for(const f of ['release.sh','rollback.sh'])write('deploy/synology/'+f,fs.readFileSync(path.join(here,f),'utf8'));
 write('deploy/synology/preflight.sh','#!/usr/bin/env bash\nif [[ "$FAIL_MODE" == gate ]]; then echo "ВОРОТА: СТОП"; exit 1; fi\necho "ВОРОТА: ОК"\n');
 write('backend/scripts/devlog-import.js','console.log("история: test stub")');
 write('bin/git',`#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> trace.log
case "$1" in
 rev-parse) [[ "$*" == *show-toplevel* ]] && pwd || echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
 cat-file|merge-base) exit 0;;
 diff) echo backend/src/main.ts;;
 rev-list) [[ "$*" == *--count* ]] && echo 10 || echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
 log) if [[ "$*" == *'--format=%h'* ]]; then echo abc1234; elif [[ "$*" == *'--format={'* ]]; then echo '{"v":"abc1234","n":10,"date":"2026-11-03"}'; else echo 'abc1234 test commit'; fi;;
 archive) while [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && { shift; touch "$1"; break; }; shift; done;;
 tag|push) exit 0;;
 *) exit 0;;
esac
`);
 write('bin/scp','#!/usr/bin/env bash\nprintf "scp %s\\n" "$*" >> trace.log\nexit 0\n');
 write('bin/ssh',`#!/usr/bin/env bash
cmd="\u0024{!#}"
printf 'ssh %s\\n' "$cmd" >> trace.log
if [[ "$cmd" == *'bash -s'* ]]; then
 body="$(cat)"; printf '%s\\n' "$body" >> trace.log
 [[ "$cmd" == *DC_ROLLBACK_ROOT* ]] && echo 'ОТКАТ: ОК'
 exit 0
fi
if [[ "$cmd" == *'cat /opt/data-core/.release-commit'* ]]; then echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
elif [[ "$cmd" == *'docker inspect -f'* ]]; then echo yes
elif [[ "$cmd" == *'df -Pk'* ]]; then echo 999999999
elif [[ "$cmd" == *'build backend'* && "$FAIL_MODE" == build ]]; then exit 1
elif [[ "$cmd" == *'for i in '* ]]; then
 [[ "$FAIL_MODE" == disconnect ]] && exit 1
 echo 'data-core /api/health/ready: 200'; echo '/app/: 200'; echo '/admin/: 200'; echo 'смоук: 7 из 7 в норме'
 [[ "$FAIL_MODE" == health ]] && echo 'СБОЙ /app/main.js: 503'
elif [[ "$cmd" == *'/app/version.json'* ]]; then
 if [[ "$FAIL_MODE" == version ]]; then echo '{"v":"wrong"}'; else echo '{"v":"abc1234"}'; fi
fi
`);
 for(const f of ['git','ssh','scp'])fs.chmodSync(path.join(root,'bin',f),0o755);
 const r=spawnSync(bash,['-c','if command -v cygpath >/dev/null; then export PATH="$(cygpath -u "$FIXTURE")/bin:$PATH"; else export PATH="$FIXTURE/bin:$PATH"; fi; bash deploy/synology/release.sh --full'],{cwd:root,env:{...process.env,FIXTURE:root,FAIL_MODE:mode,DC_RELEASE_LOGGED:'1',VM:'fake-test-host',KEY:'fake-key'},encoding:'utf8',timeout:15000});
 const trace=fs.readFileSync(path.join(root,'trace.log'),'utf8');fs.rmSync(root,{recursive:true,force:true});return {...r,trace};
}
test('успех проходит gate/hash/app и только потом публикует tag',()=>{const r=run();assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/ГОТОВО v1\.10/);assert.match(r.trace,/git push origin refs\/tags\/release-v1\.10/);assert.doesNotMatch(r.trace,/DC_ROLLBACK_ROOT=/);assert.ok(r.trace.indexOf("docker inspect -f '{{.Image}}'")<r.trace.indexOf('build backend'));});
test('ошибка build вызывает rollback и не создаёт tag',()=>{const r=run('build');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=\/opt\/data-core bash -s/);assert.doesNotMatch(r.trace,/git push origin/);});
test('ошибка смоука вызывает rollback и не создаёт tag',()=>{const r=run('health');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=/);assert.doesNotMatch(r.trace,/git push origin/);});
test('неверный hash вызывает rollback, хотя HTTP health 200',()=>{const r=run('version');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=/);assert.doesNotMatch(r.trace,/git push origin/);});
test('красные ворота не заменяют файлы и не запускают сборку',()=>{const r=run('gate');assert.notEqual(r.status,0);assert.doesNotMatch(r.trace,/build backend|mv backend|git push origin/);});
