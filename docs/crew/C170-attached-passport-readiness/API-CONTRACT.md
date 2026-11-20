# C170 API contract
Base `/api/passports/order/:orderId/lines/:incomeId/source`; existing plan `/api/passports/order/:orderId/plan`. READ + passports section для GET plan/source/candidates и POST download-ticket; WORK для PUT source/создания/выпуска. ID строковые, даты ISO. План отдаёт явную проекцию без финансовых полей.

GET/PUT source: `{orderId,incomeId,productId,selection,passportEpoch,contextToken,effectiveState,missing,attachment,sitePassports}`.
`selection={mode:'site'|'attachment',revision:number,attachmentId?,attachmentGeneration?,productIdAtSelection?,confirmedAt?,confirmedBy?,changedAt?,changedBy?,invalidatedAt?,invalidReason?}`.
`effectiveState='issued'|'attached'|'ready'|'blocked'`; missing string[].
`attachment=null|{id,productId,originalName,size,ext,mime:null|string,typeId,typeName,selectionGeneration:number,available:boolean,unavailableReason:null|string}`.
`sitePassports=[{id,number:null|string,status:'draft'|'issued',presentationVersion?:1,variant?:string}]`.

GET source/candidates?page=1&limit=20 => `{items:Attachment[],total,page,limit}` max100, live current-product files regardless upload origin. No path/ticket, unavailable candidates cannot be selected.
PUT source: `{mode:'attachment',expectedRevision,contextToken,attachmentId,expectedAttachmentGeneration:number,confirm:true}` or `{mode:'site',expectedRevision,contextToken}`. Strict body, returns source view. Site forbids attachmentId/confirm/expectedAttachmentGeneration. Attachment requires expectedAttachmentGeneration from candidate.selectionGeneration.409 code STALE_CONTEXT or ATTACHMENT_UNAVAILABLE (message Russian), attachment mode guards create/issue409 SOURCE_ATTACHMENT.
POST source/download-ticket `{contextToken}` => `{ticket,expiresIn,url}` existing product attachment URL,60s. Live choice/baseline/availability checked; later selection change does not revoke issued ticket.

Plan retains current keys/lines; adds attached/completed (completed=issued+attached,total=issued+attached+ready+blocked). Line retains fields and adds `source:'site'|'attachment',selection,passportEpoch,contextToken,attachment,sitePassports`. state adds attached. Attachment source has passport=null (history in sitePassports); missing/invalid attachment stays source=attachment,state=blocked. Template/firm blockers do not affect attachment rows. No tickets from reads.
Mass issue skips any attachment source with SOURCE_ATTACHMENT. Current-order PDF excludes attachment source even with old issued; individual historical PDF unchanged.
