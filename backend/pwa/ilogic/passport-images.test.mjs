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
  assert.match(upload, /Dim writeDepth As Boolean = depthApplicable AndAlso depthMm >= 0 .*Not Double.IsNaN\(depthMm\)/);
});

test('C241: явный выбор из контекста и отмена раньше любого upload', () => {
  const choose = rule.match(/Function ChooseInstallation[\s\S]*?End Function/)?.[0];
  const selectAt = upload.indexOf('ChooseInstallation(context)');
  assert.ok(selectAt > upload.indexOf('importPath & "-context"'));
  assert.ok(selectAt < upload.indexOf('Dim sizeKnown'));
  assert.ok(selectAt < upload.indexOf('Dim overviewId As String = UploadPng'));
  assert.match(upload, /If installation.ValueKind = Global.System.Text.Json.JsonValueKind.Undefined Then Return ""/);
  assert.match(choose, /variants.GetArrayLength\(\) = 0 Then Throw/);
  assert.match(choose, /Dim selected As Integer = -1/);
  assert.match(choose, /If String.Equals\(id, currentId, StringComparison.Ordinal\) Then selected = choices.Count - 1/);
  assert.match(choose, /selectBox.Items.Add\(name\)/); // Unicode-имя из ответа, не код/захардкоженный ID.
  assert.match(choose, /\.DropDownStyle = Global.System.Windows.Forms.ComboBoxStyle.DropDownList/);
  assert.match(choose, /\.Enabled = False/);
  assert.match(choose, /If dialog.ShowDialog\(\) <> DialogResult.OK OrElse selectBox.SelectedIndex < 0 Then Return Nothing/);
  assert.doesNotMatch(choose, /HttpMethod|UploadPng|[a-f0-9]{24}|SelectedIndex = 0/);
});

test('C241: тип третьего листа и применимость глубины берутся из выбранного профиля', () => {
  const choose = rule.match(/Function ChooseInstallation[\s\S]*?End Function/)?.[0];
  assert.match(choose, /kind <> "mounting" AndAlso kind <> "foundation"/);
  assert.match(choose, /Not item.TryGetProperty\("depthApplicable", depth\)/);
  assert.match(choose, /depth.ValueKind <> Global.System.Text.Json.JsonValueKind.True AndAlso depth.ValueKind <> Global.System.Text.Json.JsonValueKind.False/);
  assert.match(choose, /JsonString\(item, "thirdImportKind"\) = "mounting", "схема монтажа", "схема фундамента"/);
  assert.match(upload, /Dim depthApplicable As Boolean = installation.GetProperty\("depthApplicable"\).GetBoolean\(\)/);
  assert.match(upload, /confirmed.Add\("installationTypeId", installationId\)/);
  assert.match(upload, /Dim installationId As String = ApiId\(installation\)/);
  // AndAlso не открывает диалог глубины, когда профиль её исключает.
  assert.match(upload, /Dim writeDepth As Boolean = depthApplicable AndAlso[^\r\n]*AndAlso\s+MessageBox.Show/);
});

test('C241: конфликт останавливает импорт; неизменные JSON, файлы и выбор при сетевом повторе', () => {
  const retry = upload.slice(upload.indexOf('For attempt As Integer = 1 To 3'));
  assert.ok(upload.indexOf('Dim json As String = Global.System.Text.Json.JsonSerializer.Serialize(payload)') < upload.indexOf('For attempt As Integer = 1 To 3'));
  assert.match(retry, /Catch ex As InvalidOperationException When ex.Message.Contains\("HTTP 409"\)\s+Throw New InvalidOperationException/);
  assert.doesNotMatch(retry, /ChooseInstallation|confirmed.Add|UploadPng|passport-import-context|\.Serialize\(/);
  assert.equal((upload.match(/HttpMethod.Post, importPath, body/g) || []).length, 1);
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
