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
 write('deploy/ha/switch/release-artifact.sh',fs.readFileSync(path.join(here,'../ha/switch/release-artifact.sh'),'utf8'));
 write('deploy/synology/preflight.sh','#!/usr/bin/env bash\nif [[ "$FAIL_MODE" == gate ]]; then echo "ВОРОТА: СТОП"; exit 1; fi\necho "ВОРОТА: ОК"\n');
 write('apps/pdm-loader/DataCore.PdmLoader.csproj','<Project/>');
 write('backend/scripts/devlog-import.js','console.log("история: test stub")');
 write('bin/git',`#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> trace.log
if [[ "$1" == -c ]]; then shift 2; fi
case "$1" in
 rev-parse) [[ "$*" == *show-toplevel* ]] && pwd || echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
 cat-file|merge-base) exit 0;;
 diff) if [[ "$FAIL_MODE" == fast ]]; then echo backend/pwa/main.js; else echo backend/src/main.ts; fi;;
 rev-list) [[ "$*" == *--count* ]] && echo 10 || echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;
 log) if [[ "$*" == *'--format=%h'* ]]; then echo abc1234; elif [[ "$*" == *'--format={'* ]]; then echo '{"v":"abc1234","n":10,"date":"2026-11-03"}'; else echo 'abc1234 test commit'; fi;;
 archive) while [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && { shift; printf 'immutable release fixture bytes' > "$1"; break; }; shift; done;;
 tag|push) exit 0;;
 *) exit 0;;
esac
`);
 write('bin/scp',`#!/usr/bin/env bash
printf 'scp %s\\n' "$*" >> trace.log
mkdir -p remote
for arg in "$@"; do if [[ -f "$arg" && "$arg" == */release.tgz ]]; then cp "$arg" remote/release.tgz; fi; done
`);
 write('bin/ssh',`#!/usr/bin/env bash
cmd="\u0024{!#}"
printf 'ssh %s\\n' "$cmd" >> trace.log
if [[ "$cmd" == *'bash -s'* ]]; then
 body="$(cat)"; printf '%s\\n' "$body" >> trace.log
 if [[ "$cmd" == *'-- acquire '* && "$FAIL_MODE" == busy ]]; then exit 1; fi
 if [[ "$cmd" == *DC_ROLLBACK_ROOT* ]]; then
   [[ "$FAIL_MODE" != rollbackfail ]] || exit 1; echo 'ОТКАТ: ОК'
 fi
 exit 0
fi
if [[ "$cmd" == *'cat /opt/data-core/.release-commit'* ]]; then echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
elif [[ "$cmd" == *'test ! -f .release-commit'* ]]; then
 [[ "$FAIL_MODE" != changed ]] && echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb || echo cccccccccccccccccccccccccccccccccccccccc
elif [[ "$cmd" == *'sha256sum -c'* ]]; then
 [[ "$FAIL_MODE" != corrupt && -f remote/release.tgz ]] || exit 1
elif [[ "$cmd" == *'publish_artifact /opt/data-core'* ]]; then
 source deploy/ha/switch/release-artifact.sh
 hash="$(release_digest remote/release.tgz)"; [[ "$cmd" == *"$hash"* ]] || exit 1
 publish_artifact "$PWD/remote" remote/release.tgz aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$hash" abc1234
elif [[ "$cmd" == *'docker inspect -f'* ]]; then echo yes
elif [[ "$cmd" == *'df -Pk'* ]]; then echo 999999999
elif [[ "$cmd" == *'build backend'* && ( "$FAIL_MODE" == build || "$FAIL_MODE" == rollbackfail ) ]]; then exit 1
elif [[ "$cmd" == *'cd /opt/data-core && bash deploy/synology/rollback.sh'* ]]; then
 [[ "$FAIL_MODE" != manualfail ]] || exit 1
elif [[ "$cmd" == *'for i in '* ]]; then
 [[ "$FAIL_MODE" == disconnect ]] && exit 1
 echo 'data-core /api/health/ready: 200'; echo '/app/: 200'; echo '/admin/: 200'; echo 'смоук: 7 из 7 в норме'
 [[ "$FAIL_MODE" == health ]] && echo 'СБОЙ /app/main.js: 503'
elif [[ "$cmd" == *'/app/version.json'* ]]; then
 if [[ "$FAIL_MODE" == version ]]; then echo '{"v":"wrong"}'; else echo '{"v":"abc1234","n":10,"date":"2026-11-03"}'; fi
fi
`);
 for(const f of ['git','ssh','scp'])fs.chmodSync(path.join(root,'bin',f),0o755);
 const r=spawnSync(bash,['-c','if command -v cygpath >/dev/null; then export PATH="$(cygpath -u "$FIXTURE")/bin:$PATH"; else export PATH="$FIXTURE/bin:$PATH"; fi; if [[ "$FAIL_MODE" == fast ]]; then bash deploy/synology/release.sh; elif [[ "$FAIL_MODE" == manual* ]]; then bash deploy/synology/release.sh --rollback; else bash deploy/synology/release.sh --full; fi'],{cwd:root,env:{...process.env,FIXTURE:root,FAIL_MODE:mode,DC_RELEASE_LOGGED:'1',VM:'fake-test-host',KEY:'fake-key'},encoding:'utf8',timeout:15000});
 const trace=fs.readFileSync(path.join(root,'trace.log'),'utf8');
 const manifestPath=path.join(root,'remote/.ha-releases','a'.repeat(40),'manifest');
 const manifest=fs.existsSync(manifestPath)?fs.readFileSync(manifestPath,'utf8'):'';
 fs.rmSync(root,{recursive:true,force:true});return {...r,trace,manifest};
}
test('успех проходит gate/hash/app и только потом публикует tag',()=>{const r=run();assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/ГОТОВО v1\.10/);assert.match(r.trace,/git push origin refs\/tags\/release-v1\.10/);assert.doesNotMatch(r.trace,/DC_ROLLBACK_ROOT=/);assert.ok(r.trace.indexOf("docker inspect -f '{{.Image}}'")<r.trace.indexOf('build backend'));});
test('ошибка build вызывает rollback и не создаёт tag',()=>{const r=run('build');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=\/opt\/data-core bash -s/);assert.doesNotMatch(r.trace,/git push origin/);});
test('ошибка смоука вызывает rollback и не создаёт tag',()=>{const r=run('health');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=/);assert.doesNotMatch(r.trace,/git push origin/);});
test('неверный hash вызывает rollback, хотя HTTP health 200',()=>{const r=run('version');assert.notEqual(r.status,0);assert.match(r.trace,/DC_ROLLBACK_ROOT=/);assert.doesNotMatch(r.trace,/git push origin/);});
test('красные ворота не заменяют файлы и не запускают сборку',()=>{const r=run('gate');assert.notEqual(r.status,0);assert.doesNotMatch(r.trace,/build backend|mv backend|git push origin/);});
for(const mode of ['ok','fast']){
 test('путь '+mode+' публикует проверенный полный архив после health',()=>{
  const r=run(mode);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.manifest,/^a{40} [a-f0-9]{64} abc1234\n$/);
  assert.equal(r.trace.split('\n').filter(l=>l.startsWith('git ')&&l.includes(' archive ')).length,1);
  assert.match(r.trace,/archive [^\n]*backend docker-compose\.prod\.yml deploy/);
  assert.ok(r.trace.lastIndexOf('publish_artifact /opt/data-core')>r.trace.indexOf('curl --max-time 10 -fsS http://127.0.0.1:3001/app/version.json'));
  if(mode==='fast'){assert.match(r.stdout,/быстрый/);assert.doesNotMatch(r.trace,/build backend >\/tmp/);}
 });
}
for(const mode of ['busy','changed','corrupt']){
 test('выпуск при '+mode+' останавливается до замены и публикации',()=>{
  const r=run(mode);assert.notEqual(r.status,0);assert.equal(r.manifest,'');
  assert.doesNotMatch(r.trace,/mv backend backend\.replacing|git push origin|DC_ROLLBACK_ROOT=/);
 });
}

for(const reason of ['rollbackfail','disconnect','manualfail']){
 test('неподтверждённая операция удерживает замок первого обновления: '+reason,()=>{
  const r=run(reason);assert.notEqual(r.status,0);assert.match(r.trace,/ssh bash -s -- acquire /);
  assert.doesNotMatch(r.trace,/ssh bash -s -- release /);assert.doesNotMatch(r.trace,/git push origin/);
  assert.match(r.stdout,/блокировка выпуска сохранена|Блокировка выпуска и старого моста сохранена/);
 });
}
test('подтверждённый явный откат освобождает замок первого обновления',()=>{
 const r=run('manualok');assert.equal(r.status,0,r.stderr+r.stdout);
 assert.match(r.trace,/ssh bash -s -- acquire /);assert.match(r.trace,/ssh bash -s -- release /);
});
