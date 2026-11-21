import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Без Inventor проверяем границу протокола VB ↔ API; транзакцию и редакции — серверными тестами.
const rule = readFileSync(new URL('./passport-images.iLogicVb', import.meta.url), 'utf8');
const upload = rule.match(/Function UploadPassportImages[\s\S]*?End Function/)?.[0];

test('после подтверждённого импорта открывается шаблон без нового паспорта', () => {
  assert.match(rule, /Dim productId As String = UploadPassportImages\b[\s\S]*?If productId <> "" Then[\s\S]*?APP_BASE & "#products\?templateFor=" & productId[\s\S]*?ProcessStartInfo\(productUrl\)/);
  assert.doesNotMatch(rule, /#products\?bookFor=|HttpMethod\.Post, "passports/);
  assert.doesNotMatch(rule, /Ранее выданный паспорт сохранит прежний снимок/);
  assert.match(rule, /Номера сохранены\. Прежние данные — в истории редакций/);
});

test('контекст и три PNG отправляются одним commit без attach/delete/PATCH', () => {
  const contextAt = upload.indexOf('importPath & "-context"');
  const uploadAt = upload.indexOf('Dim overviewId As String = UploadPng');
  const commitAt = upload.indexOf('Global.System.Net.Http.HttpMethod.Post, importPath, body');
  assert.ok(contextAt > 0 && uploadAt > contextAt && commitAt > uploadAt);
  assert.equal((upload.match(/UploadPng\(client,/g) || []).length, 3);
  for (const [kind, variable] of [['overview', 'overviewId'], ['dimensions', 'dimensionsId'], ['foundation', 'foundationId']]) {
    assert.ok(upload.includes(`New With {.kind = "${kind}", .photoId = ${variable}}`));
  }
  assert.match(upload, /\.contextToken = contextToken/);
  assert.doesNotMatch(upload, /AttachPassportImage|HttpMethod\.Delete|"PATCH"|payload\.Count = 0/);
  assert.doesNotMatch(rule, /Sub VerifyReadSlots|Function AttachPassportImage|Function DimensionsMatch/);
});

test('только подтверждённые конечные числа, отказ ничего не очищает', () => {
  assert.match(upload, /Dim sizeKnown As Boolean = .*mm > 0 .*Not Double.IsInfinity\(mm\).*Not Double.IsNaN\(mm\)/);
  assert.match(upload, /Dim massKnown As Boolean = massKg > 0 .*Not Double.IsNaN\(massKg\)/);
  assert.match(upload, /Dim writeSize As Boolean = writeSizeAndMass AndAlso sizeKnown/);
  assert.match(upload, /Dim writeMass As Boolean = writeSizeAndMass AndAlso massKnown/);
  assert.match(upload, /If writeSize Then confirmed.Add\("dimensions", New With \{\s+\.length = dimensions\(0\), \.width = dimensions\(1\), \.height = dimensions\(2\), \.unit = "мм"\}\)/);
  assert.match(upload, /If writeMass Then confirmed.Add\("weightKg", massKg\)/);
  assert.match(upload, /If writeDepth Then confirmed.Add\("foundationDepth", depthMm\)/);
  assert.match(upload, /Dim writeDepth As Boolean = depthMm >= 0 .*Not Double.IsNaN\(depthMm\)/);
});

test('повтор использует те же файлы; успех только после проверенного ответа', () => {
  const retry = upload.slice(upload.indexOf('For attempt As Integer = 1 To 3'));
  assert.doesNotMatch(retry, /UploadPng|\.Delete/);
  assert.match(retry, /New Global.System.Net.Http.StringContent\(json,/);
  assert.match(retry, /Catch ex As Global.System.Net.Http.HttpRequestException When attempt < 3/);
  assert.match(retry, /Catch ex As Global.System.Threading.Tasks.TaskCanceledException When attempt < 3/);
  assert.match(retry, /importSummary = PassportImportSummary\(saved\)\s+Return productId/);
  const summary = rule.match(/Function PassportImportSummary[\s\S]*?End Function/)?.[0];
  assert.match(summary, /If status <> "applied" AndAlso status <> "unchanged" Then\s+Throw/);
  for (const key of ['issued', 'drafts', 'skipped', 'warnings']) assert.ok(summary.includes(`ImportArray(result, "${key}")`));
  assert.match(summary, /For Each warning/);
});
