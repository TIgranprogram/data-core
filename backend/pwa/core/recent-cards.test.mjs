import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentCards, recentHref } from './recent-cards.js';
const memory = () => { const m = new Map(); return { getItem: k => m.get(k), setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k) }; };
const entry = n => ({section:'products',of:'products',id:n.toString(16).padStart(24,'0'),title:`Изделие ${n}`});
test('История сохраняется, ограничена 20 и повторный просмотр переносит карточку вверх', () => {
 const storage=memory(), a=createRecentCards(storage,'user1');
 for(let n=1;n<=25;n++) a.remember(entry(n));
 const b=createRecentCards(storage,'user1'); assert.equal(b.list().length,20); assert.equal(b.list()[0].title,'Изделие 25');
 b.remember(entry(10)); assert.equal(b.list()[0].title,'Изделие 10'); assert.equal(b.list().length,20);
 assert.equal(createRecentCards(storage,'user2').list().length,0);
 b.clear(); assert.equal(a.list().length,0);
});
test('Повреждённый кэш и недоступное хранилище не ломают приложение', () => {
 const storage=memory(); storage.setItem('x','{'); const a=createRecentCards(storage,'x'); assert.deepEqual(a.list(),[]);
 const broken=createRecentCards({getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}},'x');
 assert.deepEqual(broken.list(),[]); broken.remember(entry(1)); broken.clear();
});
test('История исключает недоступные разделы и произвольные URL/параметры', () => {
 const a=createRecentCards(memory(),'x'); a.remember(entry(1)); a.remember({...entry(2),section:'orders'});
 assert.equal(a.list(s=>s==='products').length,1);
 assert.equal(recentHref({...entry(1),section:'https://evil.test'}),'');
 const href=recentHref({...entry(1),token:'secret',new:'1',fill:'x',tab:'main'});
 assert.equal(href,'#products?open=000000000000000000000001&of=products&tab=main');
});
