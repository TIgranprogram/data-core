import { Schema } from 'mongoose';
// Снимки внутри договора не являются коллекциями и не имеют собственного удаления.
const sub = (fields: Record<string, unknown>) => new Schema(fields, { _id: false, strict: true, softDelete: false });
const money={type:Number,min:0};
export const SourceLineSchema=sub({documentUid:String,rowKey:String,title:String,qty:Number,unit:String,unitPrice:money,lineAmount:money,description:String,dimensions:String,sku:String});
const party=sub({name:String,inn:String,kpp:String,address:String});
const document=sub({uid:String,kind:String,number:String,date:String,revision:String,fileId:Schema.Types.ObjectId,sourceSha256:String,gross:money,vatRate:Number,vatAmount:money,currency:String,supersedesUid:String,reason:String,lineRefs:[String],at:Date,by:String});
const issue=sub({uid:String,field:String,label:String,reason:String,state:String,documentUid:String,responsibleId:String,resolution:String,resolvedAt:Date,resolvedBy:String});
const stage=sub({uid:String,label:String,percent:Number,amount:money,currency:String,event:String,offsetDays:Number,dayType:String,dueDate:String,eventDate:String,evidenceDocumentUid:String});
export const LegalBundleSchema=sub({state:String,sourceNumber:String,sourceDate:String,currency:String,gross:money,vatMode:String,vatRate:Number,vatAmount:money,companySnapshot:party,counterpartySnapshot:party,objectAddress:String,signature:sub({state:String,signedDate:String,evidenceDocumentUid:String}),paymentVerification:String,documents:[document],issues:[issue],paymentPlan:[stage],deliveryTerms:String,deadlineTerms:String,origin:sub({kind:String,sourceBatchUid:String})});
export const LegalReceiptSchema=sub({uid:String,hash:String,version:Number,at:Date});
export const LegalHistorySchema=sub({version:Number,at:Date,by:String,reason:String,legal:LegalBundleSchema});
