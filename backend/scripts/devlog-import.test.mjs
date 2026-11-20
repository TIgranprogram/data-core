import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {mainCheckout,createApiTransport}=require('./devlog-import.js');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devlog-transport-test-'));
  const main=path.join(dir,'main $(); ` literal checkout'), worktree=path.join(dir,'linked рабочая копия');
  fs.mkdirSync(path.join(main,'.git'),{recursive:true});fs.mkdirSync(path.join(main,'deploy/synology'),{recursive:true});fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(main,'deploy/synology/api.sh'),'# mocked transport only\n');
  t.after(()=>{for(const name of fs.readdirSync(dir))assert.ok(!name.startsWith('datacore-devlog-'),'транспорт удалил tempfile');fs.rmSync(dir,{recursive:true,force:true});});
  const calls=[];
  const run=(cmd,args,opts)=>{calls.push({cmd,args,opts});assert.equal(cmd,'git');assert.deepEqual(args,['rev-parse','--git-common-dir']);assert.equal(opts.cwd,worktree);return path.relative(worktree,path.join(main,'.git'))+'\n';};
  return {dir,main,worktree,calls,run};
}
test('git common-dir находит credential-owning main из linked worktree, без hardcode/чтения env',t=>{
  const f=fixture(t);assert.equal(mainCheckout(f.worktree,f.run),f.main);assert.equal(f.calls.length,1);
});
test('main checkout с .git использует свой api.sh',t=>{
  const f=fixture(t);assert.equal(mainCheckout(f.main,()=>'.git\n'),f.main);
});
test('POST: JSON только в закрытом tempfile, argv literal и cleanup после успеха',async t=>{
  const f=fixture(t);let filename;
  const body={docs:[{text:'русский текст\n$(touch injected); `echo no` " \\',path:'docs/пример.md'}]};
  const run=(cmd,args,opts)=>{if(cmd==='git')return f.run(cmd,args,opts);assert.equal(cmd,'bash');assert.equal(opts.cwd,f.main);assert.equal(opts.shell,false);assert.deepEqual(opts.stdio,['ignore','pipe','pipe']);assert.equal(opts.windowsHide,true);
    assert.deepEqual(args.slice(0,4),[path.join(f.main,'deploy/synology/api.sh').replaceAll('\\','/'),'prod','POST','/api/devlog/import']);assert.equal(args.length,5);filename=args[4];assert.deepEqual(JSON.parse(fs.readFileSync(filename,'utf8')),body);assert.ok(!args.includes(JSON.stringify(body)));
    if(process.platform!=='win32'){assert.equal(fs.statSync(filename).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(filename)).mode&0o777,0o700);}return '{"commits":2}';};
  const api=createApiTransport(f.worktree,'prod',{run,tempRoot:f.dir,wait:async()=>{}});assert.deepEqual(await api('POST','/api/devlog/import',body),{commits:2});assert.ok(!fs.existsSync(filename));assert.ok(!fs.existsSync(path.dirname(filename)));
});
for(const failure of ['subprocess','json','http'])test(`cleanup и безопасная ошибка: ${failure}`,async t=>{
  const f=fixture(t);let filename;const secret='Bearer TOKEN_PASSWORD_DO_NOT_PRINT';
  const run=(cmd,args,opts)=>{if(cmd==='git')return f.run(cmd,args,opts);filename=args[4];assert.ok(fs.existsSync(filename));if(failure==='subprocess')throw Object.assign(new Error(secret),{stdout:secret,stderr:secret});return failure==='json'?secret:JSON.stringify({statusCode:401,message:secret,access:secret});};
  const api=createApiTransport(f.worktree,'local',{run,tempRoot:f.dir,wait:async()=>{}});
  await assert.rejects(api('POST','/api/devlog/import',{commits:[]}),e=>{assert.ok(!e.message.includes(secret));assert.match(e.message,/штатный api.sh/);return true;});assert.ok(!fs.existsSync(filename));assert.ok(!fs.existsSync(path.dirname(filename)));
});
test('GET: отдельный argv query, нет файла тела/JSON, только необходимый endpoint',async t=>{
  const f=fixture(t);const endpoint='/api/devlog/docs?path='+encodeURIComponent('docs/$(touch injected); файл.md');
  const run=(cmd,args,opts)=>{if(cmd==='git')return f.run(cmd,args,opts);assert.deepEqual(args.slice(1),['local','GET',endpoint]);assert.equal(opts.shell,false);return '{"items":[]}';};
  const api=createApiTransport(f.worktree,'local',{run,tempRoot:f.dir,wait:async()=>{}});assert.deepEqual(await api('GET',endpoint),{items:[]});await assert.rejects(api('POST','/api/auth/login',{}),/недопустимый/);await assert.rejects(api('POST','/api/devlog/import-extra',{}),/недопустимый/);
});
test('dry-run CLI не запускает api.sh/сеть и не читает доступ',async()=>{
  const source=fs.readFileSync(new URL('./devlog-import.js',import.meta.url),'utf8');const calls=[],logs=[];const module={exports:{}};const fakeProcess={argv:['node','devlog-import.js','prod'],exitCode:0};
  const fakeRequire=(name)=>{
    if(name==='child_process')return {execFileSync:(cmd,args)=>{calls.push({cmd,args});assert.equal(cmd,'git');if(args[0]==='rev-parse')return 'abcdef123456\n';return '';}};
    if(name==='fs')return {existsSync:()=>false,readFileSync:()=>{throw Error('dry-run не читает секреты');}};
    return require(name);
  };fakeRequire.main=module;
  vm.runInNewContext(source,{require:fakeRequire,module,__dirname:path.dirname(new URL(import.meta.url).pathname),process:fakeProcess,console:{log:(...x)=>logs.push(x.join(' ')),warn:()=>{},error:(...x)=>logs.push(x.join(' '))},setTimeout,fetch:()=>{throw Error('dry-run сеть запрещена');}});
  await new Promise(r=>setImmediate(r));assert.equal(fakeProcess.exitCode,0);assert.ok(logs.some(s=>s.includes('ПЛАН, ничего не отправляется')));assert.ok(calls.every(c=>c.cmd==='git'));assert.ok(!calls.some(c=>c.args.includes('--git-common-dir')));
});
