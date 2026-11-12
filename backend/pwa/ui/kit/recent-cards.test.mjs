import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { createRecentCards, recentHref } from '../../core/recent-cards.js';
test('Запись истории только для текущей карточки и пользователя; поздние ответы пропускаются', async () => {
 const values=new Map(), session={user:{id:'a'}}, row={id:'000000000000000000000001'};
 let route={section:'products',params:{open:row.id}};
 const context=createContext({localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},String});
 const deps={
 '../../core/api.js':{session,PREFIX:'/db'}, '../../core/router.js':{current:()=>route},
 '../../core/dom.js':{h(){}}, '../../core/recent-cards.js':{createRecentCards,recentHref},
 '../icons.js':{icon(){}}, './pop-menu.js':{openPopMenu(){},closePopMenu(){},isOpenFor(){}},
 };
 const mod=new SourceTextModule(readFileSync(new URL('./recent-cards.js',import.meta.url),'utf8'),{context});
 await mod.link(key=>{const d=deps[key]; return new SyntheticModule(Object.keys(d),function(){for(const [k,v] of Object.entries(d))this.setExport(k,v);},{context});});
 await mod.evaluate(); const record=mod.namespace.recentRecorder('products');
 record(row,'Изделие','Продукция'); assert.equal(values.size,1);
 session.user={id:'b'}; record(row,'Чужая карточка',''); assert.equal(values.size,1);
 const next=mod.namespace.recentRecorder('products');
 route.params.open='000000000000000000000002'; next(row,'Устаревший ответ',''); assert.equal(values.size,1);
 route.params={open:row.id,new:'1'}; next(row,'Новая карточка',''); assert.equal(values.size,1);
 route.params={open:row.id}; next(row,'Своя карточка',''); assert.equal(values.size,2);
 assert.equal(JSON.parse(values.get('dc-recent-cards:/db:a'))[0].title,'Изделие');
 assert.equal(JSON.parse(values.get('dc-recent-cards:/db:b'))[0].title,'Своя карточка');
});
