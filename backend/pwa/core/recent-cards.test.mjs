import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecentCards, recentHref, recentEntry, recentThumb } from './recent-cards.js';
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


test('номер заказа с кириллицей и разделителями безопасно возвращается одним параметром open', () => {
 const id='№ 36 / 26-Б & участок #2?';
 const e={section:'salesorders',of:'salesorders',id,title:'Заказ '+id};
 const href=recentHref(e), url=new URL(href,'https://local.test');
 const params=new URLSearchParams(url.hash.split('?').slice(1).join('?'));
 assert.equal(params.get('open'),id); assert.equal([...params].length,2);
 assert.equal(recentHref({...e,of:'products'}),'');
 assert.equal(recentHref({...e,id:'bad\nkey'}),'');
 assert.equal(recentHref({...e,id:'https://evil.test'}),'');
 const a=createRecentCards(memory(),'orders');a.remember(e);a.remember({...e,title:'Обновлённый заказ'});
 assert.equal(a.list().length,1);
});

test('история хранит только безопасный локальный файл фото, старые записи остаются', () => {
 assert.equal(recentThumb('/uploads/photo.webp'),'/uploads/photo.webp');
 assert.equal(recentThumb('/db/uploads/Фото 1.png'),'/db/uploads/%D0%A4%D0%BE%D1%82%D0%BE%201.png');
 for(const src of ['https://evil.test/a.png','//evil.test/a.png','data:image/png;base64,AAAA','blob:local','/api/logout','/uploads/../outside.png','/uploads/%2e%2e/outside.png','/uploads/%252e%252e/outside.png','/uploads/a.png?token=secret','/uploads/a.svg','/uploads/a.png#x','/uploads/evil\\a.png']) assert.equal(recentThumb(src),'',src);
 const a=createRecentCards(memory(),'photo'); a.remember(entry(1));a.remember({...entry(2),thumb:'/uploads/a.png'});a.remember({...entry(3),thumb:'https://evil.test/a.png'});
 assert.equal(a.list().length,3);assert.equal(a.list()[0].thumb,undefined);assert.equal(a.list()[1].thumb,'/uploads/a.png');
 assert.equal(recentEntry(entry(1)).title,'Изделие 1');
});
