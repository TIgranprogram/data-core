import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { PhotosService } from './photos.service';
import { validateLegalFiles } from '../../common/legal/legal-utils';
describe('C164 первая привязка и удаление имеют общий photoCAS',()=>{
 let dir='',previous:string|undefined;
 beforeEach(async()=>{previous=process.env.UPLOAD_DIR;dir=await mkdtemp(join(tmpdir(),'c164-photo-cas-'));process.env.UPLOAD_DIR=dir;await writeFile(join(dir,'source.pdf'),'%PDF-1.4 immutable');});
 afterEach(async()=>{if(previous===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=previous;await rm(dir,{recursive:true,force:true});});
 const fixture=()=>{
  const id=new Types.ObjectId(),state:any={_id:id,storageUrl:'/uploads/source.pdf',variant:'original',deletedAt:null};const deleted=jest.fn();
  const doc={...state,deleteOne:deleted};
  const db={collection:(name:string)=>({find:()=>({toArray:async()=>[{...state}]}),findOne:async(filter:any)=>name==='photos'&&filter.sourceDeleting&&state.sourceDeleting?{...state}:null})};
  const model:any={db:{db},findById:()=>({exec:async()=>doc}),find:()=>({exec:async()=>[]}),updateMany:(filter:any,update:any)=>({exec:async()=>{
   if(filter.sourceDeleteClaim){if(state.sourceDeleteClaim===filter.sourceDeleteClaim){delete state.sourceDeleting;delete state.sourceDeleteClaim;}return {modifiedCount:1};}
   if(state.sourceProtected||state.sourceDeleting)return {modifiedCount:0};Object.assign(state,update.$set);return {modifiedCount:1};
  }})};
  const connection:any={db:{collection:(name:string)=>name==='photos'?{find:()=>({toArray:async()=>[{...state}]}),findOne:async(filter:any)=>filter.sourceDeleting&&state.sourceDeleting?state:null}:{}},model:()=>({updateOne:(_filter:any,update:any)=>({exec:async()=>{if(state.sourceDeleting||state.deletedAt)return {matchedCount:0};Object.assign(state,update.$set);return {matchedCount:1};}})})};
  const legal:any={documents:[{uid:'original',fileId:String(id),sourceSha256:createHash('sha256').update('%PDF-1.4 immutable').digest('hex')}],issues:[]};
  return {state,doc,deleted,connection,legal,service:new PhotosService(model)};
 };
 it('attach выигрывает: sourceProtected выставлен до parentCAS, remove409безunlink',async()=>{
  const f=fixture();await validateLegalFiles(f.connection,f.legal);expect(f.state.sourceProtected).toBe(true);
  await expect(f.service.remove(String(f.doc._id))).rejects.toThrow('удаление запрещено');expect(f.deleted).not.toHaveBeenCalled();expect(await readFile(join(dir,'source.pdf'),'utf8')).toBe('%PDF-1.4 immutable');
 });
 it('deleteclaim выигрывает: новая привязка409доlegalCAS, можно безопасно снять ownclaim',async()=>{
  const f=fixture();const rollback=await (f.service as any).claimSourceDeletion(f.doc,[]);expect(f.state.sourceDeleting).toBe(true);
  await expect(validateLegalFiles(f.connection,f.legal)).rejects.toThrow('Файл уже удаляется');expect(f.state.sourceProtected).not.toBe(true);expect(f.deleted).not.toHaveBeenCalled();await rollback();expect(f.state.sourceDeleting).toBeUndefined();
 });
});
