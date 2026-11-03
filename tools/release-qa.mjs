// Проверки выполняет компьютер. Production/Docker/E2E здесь не запускаются.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { maskSecrets } from '../pult/dispatch.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function plan(root=ROOT,{quick=false}={}){
 const node=process.execPath,night=path.join(root,'tests_ai_tiit/nightshift');
 const pultTests=fs.readdirSync(path.join(root,'pult/test')).filter(f=>f.endsWith('.test.mjs')).map(f=>'pult/test/'+f);
 const steps=[];
 if(!quick)steps.push({name:'backend',title:'Типы, юнит, импорты, дизайн и каталог',cmd:node,args:['tools/dc.mjs','check'],cwd:root});
 steps.push({name:'safety',title:'Безопасность стенда и пульта',cmd:node,args:['--test','tools/dc.test.mjs','tools/night.test.mjs',...pultTests],cwd:root});
 steps.push({name:'release',title:'Выпуск и откат без настоящего сервера',cmd:node,args:['--test','deploy/synology/release.test.mjs','deploy/synology/release-flow.test.mjs'],cwd:root});
 steps.push({name:'pwa',title:'Оплата, предпросмотр и фильтры склада',cmd:node,args:['--experimental-vm-modules','--test','backend/pwa/core/facets.test.mjs','backend/pwa/core/invoice-merge.test.mjs','backend/pwa/core/write-retry.test.mjs','backend/pwa/sections/request-step.test.mjs','backend/pwa/sections/invoice-price.test.mjs'],cwd:root});
 steps.push({name:'nightshift',title:'Nightshift и маскирование журналов',cmd:path.join(night,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),args:['-m','pytest','-q'],cwd:night});
 return steps;
}
export async function run({root=ROOT,quick=false}={}){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(root,'tools/logs','release-'+stamp);fs.mkdirSync(dir,{recursive:true});
 const results=[];
 for(const step of plan(root,{quick})){
  const file=path.join(dir,step.name+'.log'),started=Date.now();let output='';
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(^(MONGO|COMPOSE|CONTROL_|DC_PROD|NODE_OPTIONS)|password|secret|token|api[_-]?key|credential|private[_-]?key|authorization)/i.test(k)));
  const result=await new Promise(resolve=>{
   const child=spawn(step.cmd,step.args,{cwd:step.cwd,env,stdio:['ignore','pipe','pipe'],shell:false});let timedOut=false;
   const stop=()=>{if(process.platform==='win32'&&child.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',shell:false});else child.kill();};
   const collect=chunk=>{output+=chunk.toString('utf8');if(output.length>64*1024*1024){timedOut=true;stop();}};
   child.stdout.on('data',collect);child.stderr.on('data',collect);
   const timer=setTimeout(()=>{timedOut=true;stop();},30*60*1000);
   child.on('error',e=>{clearTimeout(timer);resolve({code:2,error:e.message});});
   child.on('close',code=>{clearTimeout(timer);resolve({code:timedOut?2:code??2,...(timedOut?{timedOut:true}:{})});});
  });fs.writeFileSync(file,maskSecrets(output+(result.error||'')));
  const item={...result,name:step.name,title:step.title,durationMs:Date.now()-started,log:path.relative(root,file).replace(/\\/g,'/')};results.push(item);
  console.log(`${item.code===0?'ОК':'СБОЙ'}: ${step.title} (${Math.round(item.durationMs/1000)} с)`);
 }
 const summary={at:new Date().toISOString(),scope:quick?'дополнительные локальные регрессии':'локальные проверки кода и регрессии',production:false,docker:false,e2e:false,ok:results.every(r=>r.code===0),results};
 const json=path.join(dir,'summary.json');fs.writeFileSync(json,JSON.stringify(summary,null,2));
 fs.writeFileSync(path.join(root,'tools/logs/RELEASE-QA.json'),JSON.stringify(summary,null,2));
 console.log('Docker/E2E: не запускались — для них отдельная кнопка «Полная проверка».');console.log('Итог: '+(summary.ok?'локальные проверки зелёные':'есть ошибки; исправлять по журналу'));console.log('Полный отчёт: '+path.relative(root,json));return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--plan'))console.log(JSON.stringify(plan(),null,2));
 else run({quick:process.argv.includes('--quick')}).then(r=>{process.exitCode=r.ok?0:1}).catch(e=>{console.error(e.message);process.exitCode=2});
}
