// Сопоставление: строка ЗНП → наш заказ (по «Заказ №» в шапке) → позиция (по тексту) → задача YouGile. Запуск из «для анализа»: node ../backend/scripts/znp/match.js
// Пишет znp-match.json. Нужны: znp-parsed.json, yougile-2026-10-27/{lines,mcp-export}.json. Пары ЗНП→заказ — MAP ниже (из шапок ЗНП, 2-26 → 14 Академия).
const Z=require(process.cwd()+"/znp-parsed.json");const L=require(process.cwd()+"/yougile-2026-10-27/lines.json").items;const E=require(process.cwd()+"/yougile-2026-10-27/mcp-export.json");
const MAP={"1-26":["15|ЕХ"],"2-26":["14|АКАД"],"3-26":["12|АКАД","17|АКАД","18|АКАД"],"4-26":["25|"],"5-26":["25|"],"6-26":["19|","20|"],"7-26":["13|АКАД"],"8-26":["90-П|","109-П|"],"9-26":["0376300000126000163|"],"10-26":["10|Сахаджи"],"11-26":["9|Сахаджи"],"12-26":["110-П|","111-П|","114-П|","115-П|"],"13-26":["23|"],"14-26":["22|"]};
const w=s=>new Set((s||"").toLowerCase().replace(/ё/g,"е").match(/[a-zа-я]{3,}|\d{3,}/g)||[]);
const sim=(a,b)=>{const A=w(a),B=w(b);let n=0;A.forEach(x=>B.has(x)&&n++);return n/Math.max(1,Math.min(A.size,B.size))};
const res={};let tot=0,ok=0;
for(const z in Z){const rows=Z[z].rows.filter(r=>r[4]);const keys=(MAP[z]||[]);
 const lines=L.filter(l=>keys.some(k=>{const[o,c]=k.split("|");return l.orderNo===o&&(!c||(l.customer||"").toUpperCase().includes(c.toUpperCase()))}));
 const used=new Set();res[z]={orders:keys.map(k=>k.split("|")[0]),rows:[]};
 for(const r of rows){tot++;let best=null,bs=0;for(const l of lines){if(used.has(l._id))continue;const s=sim(r[3],l.title)+(String(l.qty)===r[4]?0.2:0);if(s>bs){bs=s;best=l}}
  if(best&&bs>=0.4){used.add(best._id);ok++}else best=null;
  const tasks=E.tasks.filter(t=>{const m=t.title.match(/ЗНП\s*([\d-]+)\s*поз\.?\s*([\d.]+)/i);return m&&m[1]===z&&m[2]===r[0]}).map(t=>t.taskId);
  res[z].rows.push({pos:r[0],art:r[1],name:r[3],qty:r[4],line:best?{id:best._id,orderNo:best.orderNo,lineNo:best.lineNo,title:best.title}:null,score:+bs.toFixed(2),tasks});}
 res[z].unusedLines=lines.filter(l=>!used.has(l._id)).map(l=>l.orderNo+"/"+l.lineNo+" "+l.title.slice(0,50));}
require("fs").writeFileSync("znp-match.json",JSON.stringify(res,null,1));
console.log("позиций ЗНП",tot,"нашли позицию заказа",ok);
for(const z in res){const r=res[z];console.log("==",z,"→",r.orders.join(",")||"НЕТ ЗАКАЗА","| без пары:",r.rows.filter(x=>!x.line).map(x=>x.pos).join(",")||"—","| задач:",r.rows.reduce((a,x)=>a+x.tasks.length,0),"| лишние позиции заказа:",r.unusedLines.length?r.unusedLines.join("; "):"—")}
const all=new Set(E.tasks.map(t=>t.taskId));Object.values(res).forEach(r=>r.rows.forEach(x=>x.tasks.forEach(t=>all.delete(t))));console.log("задачи без позиции ЗНП:",[...all].map(id=>id+" "+E.tasks.find(t=>t.taskId===id).title).join(" | "));
