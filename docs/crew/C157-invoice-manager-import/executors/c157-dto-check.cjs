// Только локальная проверка payload по фактическим DTO, без API/БД.
const path = require('node:path');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const backend = createRequire(path.join(root, 'backend/package.json'));
backend('reflect-metadata');
backend('ts-node').register({transpileOnly: true, project: path.join(root, 'backend/tsconfig.json')});
const {validateSync} = backend('class-validator');
const {plainToInstance} = backend('class-transformer');
const {PatchInvoiceDto, PatchInvoiceLineDto, CreateInvoicePaymentDto} = backend('./src/modules/supply/dto-invoice');
const base = path.join(root, 'docs/crew/C157-invoice-manager-import/data');
const read = name => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
let checked = 0;
function check(Type, body, label) {
  const errors = validateSync(plainToInstance(Type, body), {whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true});
  if (errors.length) throw Error(label + ': ' + JSON.stringify(errors.map(e => ({field: e.property, constraints: e.constraints}))));
  checked++;
}
for (const op of read('no8-recovery-plan.json').steps) {
  const body = {...op.body};
  if (body.version === '$freshInvoiceVersion') body.version = 1;
  check(op.key === 'line' ? PatchInvoiceLineDto : op.key === 'payment' ? CreateInvoicePaymentDto : PatchInvoiceDto, body, 'recovery ' + op.key);
}
for (const d of read('remaining9-exact-apply-proposal.json').documents) {
  check(PatchInvoiceDto, {...d.invoicePatch, payerCompanyId: '6ad52bec863df73f344ea489', fileIds: ['6aff4f421eb87438515b476f']}, d.no + ' header');
  check(PatchInvoiceDto, {issue: true}, d.no + ' issue');
  for (const line of d.requests) check(PatchInvoiceLineDto, {...Object.fromEntries(Object.entries(line.financialLineBody).filter(([, v]) => v !== null)), version: 1}, d.no + ' line');
  check(CreateInvoicePaymentDto, {...d.proposedPayment, payerCompanyId: '6ad52bec863df73f344ea489', version: 1}, d.no + ' payment');
}
const bad = validateSync(plainToInstance(PatchInvoiceDto, {no: '8', version: 1}), {whitelist: true, forbidNonWhitelisted: true});
if (!bad.some(e => e.property === 'version')) throw Error('Regression: header.version accepted');
const result = {status: 'PASS', checked, forbiddenVersionRejected: true, apiCalls: 0, at: new Date().toISOString()};
fs.writeFileSync(path.join(base, 'recovery-remaining9-dto-proof.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
