// Проверки безопасного отката: только временные файлы и fake Docker/curl, без VM и Mongo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const bash=process.env.TEST_BASH || (process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash');
const image='sha256:'+'a'.repeat(64),ts='20261103094500',hash='b'.repeat(40);
function fixture({mode='full',invalid=false,incomplete=false,health='200'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dc-release-test-'));
  const write=(rel,text)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
  write('backend/pwa/version.json','{"v":"new"}');write('backend/admin/index.html','new admin');write('backend/src/version','new source');
  write('backend.prev-'+ts+'/pwa/version.json','{"v":"old"}');write('backend.prev-'+ts+'/admin/index.html','old admin');write('backend.prev-'+ts+'/src/version','old source');
  write('deploy/synology/rollback.sh',fs.readFileSync(path.join(here,'rollback.sh'),'utf8'));
  write('deploy/synology/sync-dir.sh',fs.readFileSync(path.join(here,'sync-dir.sh'),'utf8'));
  write('deploy.prev-'+ts+'/version','old deploy');write('deploy/version','new deploy');
  write('docker-compose.prod.yml','new compose');if(!incomplete)write('docker-compose.prod.yml.prev-'+ts,'old compose');
  write('.release-commit','c'.repeat(40));write('.rollback-'+ts,`image=${invalid?'invalid':image}\nrelease=${hash}\nmode=${mode}\n`);
  write('bin/docker',`#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> calls.log\nif [[ "$*" == *'{{.Config.Image}}'* ]]; then echo datacore-backend:latest; fi\n`);
  write('bin/curl',`#!/usr/bin/env bash\nprintf '%s' '${health}'\n`);write('bin/sleep','#!/usr/bin/env bash\nexit 0\n');
  for(const f of ['docker','curl','sleep'])fs.chmodSync(path.join(root,'bin',f),0o755);
  // На Windows открытый shell-файл блокирует rename его родительского каталога.
  // Выполняем тот же текст из памяти; реальные file/Docker операции не подменяются.
  return {root,write,run(args=[`backend.prev-${ts}`]){return spawnSync(bash,['-c','if command -v cygpath >/dev/null; then export PATH="$(cygpath -u "$FIXTURE")/bin:$PATH"; else export PATH="$FIXTURE/bin:$PATH"; fi; export DC_ROLLBACK_ROOT="$PWD"; bash -c "$ROLLBACK_SCRIPT" rollback-test "$@"','rollback-test',...args],{cwd:root,env:{...process.env,FIXTURE:root,ROLLBACK_SCRIPT:fs.readFileSync(path.join(here,'rollback.sh'),'utf8')},encoding:'utf8',timeout:15000});},read:f=>fs.readFileSync(path.join(root,f),'utf8'),calls:()=>fs.existsSync(path.join(root,'calls.log'))?fs.readFileSync(path.join(root,'calls.log'),'utf8'):'',cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('полный откат возвращает source, deploy, compose, image ID без build/pull и изменения Mongo',()=>{
  const f=fixture();try{const r=f.run();assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(f.read('backend/src/version'),'old source');assert.equal(f.read('deploy/version'),'old deploy');assert.equal(f.read('docker-compose.prod.yml'),'old compose');assert.equal(f.read('.release-commit').trim(),hash);const c=f.calls();assert.match(c,new RegExp('tag '+image));assert.match(c,/up -d --no-deps --no-build --pull never backend/);assert.doesNotMatch(c,/\b(?:down|volume|mongo|build backend|pull backend)\b/);}finally{f.cleanup();}
});
test('неподтверждённый image ID отказывает до замены файлов',()=>{const f=fixture({invalid:true});try{const r=f.run();assert.notEqual(r.status,0);assert.equal(f.read('backend/src/version'),'new source');assert.doesNotMatch(f.calls(),/up /);}finally{f.cleanup();}});
test('неполная пара code/compose отказывает без запуска',()=>{const f=fixture({incomplete:true});try{const r=f.run();assert.notEqual(r.status,0);assert.equal(f.read('backend/src/version'),'new source');assert.doesNotMatch(f.calls(),/up /);}finally{f.cleanup();}});
test('быстрый откат возвращает только экраны, не трогая образ и backend',()=>{const f=fixture({mode:'fast'});try{const r=f.run();assert.equal(r.status,0,r.stderr+r.stdout);assert.match(f.read('backend/pwa/version.json'),/old/);assert.equal(f.read('backend/src/version'),'new source');assert.equal(f.calls(),'');}finally{f.cleanup();}});
test('откат без аргумента выбирает последнюю подтверждённую копию',()=>{const f=fixture();try{const r=f.run([]);assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(f.read('backend/src/version'),'old source');}finally{f.cleanup();}});
test('ошибка health не объявляет успешный откат и не восстанавливает метку',()=>{const f=fixture({health:'503'});try{const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout,/ОТКАТ: СБОЙ/);assert.equal(fs.existsSync(path.join(f.root,'.release-commit')),false);}finally{f.cleanup();}});
test('path traversal не может выбрать постороннюю папку',()=>{const f=fixture();try{assert.notEqual(f.run(['../backend.prev-'+ts]).status,0);assert.equal(f.read('backend/src/version'),'new source');assert.equal(f.calls(),'');}finally{f.cleanup();}});
test('частичная замена каталогов восстанавливается из целой пары',()=>{const f=fixture();try{fs.rmSync(path.join(f.root,'backend'),{recursive:true});const r=f.run();assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(f.read('backend/src/version'),'old source');}finally{f.cleanup();}});
test('release имеет EXIT cleanup, image ID до build, hash/app smoke, gate и release tag',()=>{const s=fs.readFileSync(path.join(here,'release.sh'),'utf8');assert.match(s,/trap cleanup_release EXIT/);assert.match(s,/docker inspect -f '\{\{\.Image\}\}'/);assert.ok(s.indexOf("docker inspect -f '{{.Image}}'")<s.indexOf('build backend >/tmp'));assert.match(s,/JSON\.parse\(raw\)\.v!==expected/);assert.match(s,/\/app\/: 200/);assert.match(s,/git push origin "refs\/tags\/\$TAG"/);assert.match(s,/VERIFIED=1/);assert.match(s,/preflight\.sh \$URGENT \|\| exit 1/);assert.doesNotMatch(s,/compose[^\n]*(?:down\s+-v|volume\s+rm)/);assert.match(s,/DC_RELEASE_LOGGED=1 bash/);});
test('оба shell-скрипта синтаксически корректны',()=>{for(const file of ['release.sh','rollback.sh']){const r=spawnSync(bash,['-n',path.join(here,file)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}});
