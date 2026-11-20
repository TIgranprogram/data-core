import { effectiveAttachment } from './attachment-availability';
const file={id:'f',productId:'p',originalName:'паспорт.pdf',size:1,ext:'pdf',mime:'application/pdf',typeId:'t',typeName:'Паспорт',selectionGeneration:0,available:true,unavailableReason:null};
const line={productId:'p',passportSelection:{mode:'attachment' as const,revision:1,attachmentId:'f',attachmentGeneration:0,productIdAtSelection:'p'}};
describe('C170 эффективная доступность',()=>{
  it('подтверждённый файл готов без шаблона',()=>expect(effectiveAttachment(line,file).missing).toEqual([]));
  it('удаление→restore не возрождает прежнее подтверждение',()=>expect(effectiveAttachment(line,{...file,selectionGeneration:2}).attachment).toMatchObject({available:false,unavailableReason:'ATTACHMENT_DELETED'}));
  it('пропавший файл блокирует без записи',()=>expect(effectiveAttachment(line,{...file,available:false,unavailableReason:'FILE_MISSING'}).missing).toEqual(['Файл не найден на сервере']));
  it('после A→B→A инвалидность сохраняется',()=>expect(effectiveAttachment({...line,passportSelection:{...line.passportSelection,invalidReason:'PRODUCT_CHANGED'}},file).missing[0]).toContain('Изделие'));
  it('чужое изделие не раскрывает метаданные и не становится готовым',()=>{const r=effectiveAttachment({...line,productId:'q'},file);expect(r.attachment).toBeNull();expect(r.missing.length).toBe(1);});
  it('услуга не превращается во вложенный паспорт изделия',()=>expect(effectiveAttachment({...line,lineType:'service'},file).missing.length).toBe(1));
});
