import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import { PhotosService } from './photos.service';
describe('C164: удаление фото не ломает договор/КП/счёт',()=>{
 let dir='',previous:string|undefined;
 beforeEach(async()=>{previous=process.env.UPLOAD_DIR;dir=await mkdtemp(join(tmpdir(),'c164-photo-ref-'));process.env.UPLOAD_DIR=dir;await writeFile(join(dir,'original.pdf'),'%PDF-1.4 immutable');});
 afterEach(async()=>{if(previous===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=previous;await rm(dir,{recursive:true,force:true});});
 it.each(['salesorders','commercialoffers','supplyinvoices'])('reference в%s:409доdeleteOne/unlink, включаякорзину',async(name)=>{
  const id=new Types.ObjectId(),variantId=new Types.ObjectId(),del=jest.fn();const doc={_id:id,storageUrl:'/uploads/original.pdf',deleteOne:del};const variant={_id:variantId,storageUrl:'/uploads/thumb.webp',deleteOne:del};
  const queries:Array<{name:string;filter:any}>=[];
  const db={collection:(collection:string)=>({find:()=>({toArray:async()=>[]}),findOne:async(filter:any)=>{queries.push({name:collection,filter});return collection===name?{_id:new Types.ObjectId(),deletedAt:new Date()}:null;}})};
  const model={updateMany:(f:any)=>({exec:async()=>({modifiedCount:f._id?.$in?.length||0})}),db:{db},findById:()=>({exec:async()=>doc}),find:()=>({exec:async()=>[variant]})};
  await expect(new PhotosService(model as any).remove(String(id))).rejects.toThrow('удаление запрещено');
  expect(del).not.toHaveBeenCalled();expect(await readFile(join(dir,'original.pdf'),'utf8')).toBe('%PDF-1.4 immutable');
  expect(queries.find(q=>q.name===name)?.filter.deletedAt).toBeUndefined();
 });
 it('другойPhotoIDсобщимstorageURLтакжезащищаетбайтыисточника',async()=>{
  const aliasId=new Types.ObjectId(),id=new Types.ObjectId(),del=jest.fn();let checked=false;
  const db={collection:(name:string)=>({find:()=>({toArray:async()=>[{_id:aliasId}]}),findOne:async(filter:any)=>{if(name==='salesorders'){checked=filter.$or[0]['legal.documents.fileId'].$in.some((x:any)=>String(x)===String(aliasId));return checked?{_id:new Types.ObjectId()}:null;}return null;}})};
  const model={updateMany:(f:any)=>({exec:async()=>({modifiedCount:f._id?.$in?.length||0})}),db:{db},findById:()=>({exec:async()=>({_id:id,storageUrl:'/uploads/original.pdf',deleteOne:del})}),find:()=>({exec:async()=>[]})};
  await expect(new PhotosService(model as any).remove(String(id))).rejects.toThrow();expect(checked).toBe(true);expect(del).not.toHaveBeenCalled();expect(await readFile(join(dir,'original.pdf'),'utf8')).toContain('immutable');
 });
});
