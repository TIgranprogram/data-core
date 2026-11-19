import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rule = readFileSync(new URL('./passport-images.iLogicVb', import.meta.url), 'utf8');
const upload = rule.match(/Function UploadPassportImages[\s\S]*?End Function/)?.[0];

test('после проверки загрузки открывается шаблон изделия', () => {
  assert.match(rule, /Dim productId As String = UploadPassportImages\b[\s\S]*?If productId <> "" Then[\s\S]*?APP_BASE & "#products\?templateFor=" & productId[\s\S]*?ProcessStartInfo\(productUrl\)/);
  assert.doesNotMatch(rule, /#products\?bookFor=|HttpMethod\.Post, "passports/);
  assert.match(rule, /Ранее выданный паспорт сохранит прежний снимок/);
});

test('масса и размеры записываются только по согласию, при наличии и изменении', () => {
  assert.match(upload, /Dim sizeKnown As Boolean = .*mm > 0 AndAlso Not Double.IsInfinity\(mm\)/);
  assert.match(upload, /Dim massKnown As Boolean = massKg > 0 AndAlso Not Double.IsInfinity\(massKg\)/);
  assert.match(upload, /Dim writeSize As Boolean = writeSizeAndMass AndAlso sizeKnown/);
  assert.match(upload, /Dim writeMass As Boolean = writeSizeAndMass AndAlso massKnown/);
  assert.match(upload, /If writeSize AndAlso Not DimensionsMatch\(product, dimensions\) Then\s+payload.Add\("dimensions", New With \{\s+\.length = dimensions\(0\), \.width = dimensions\(1\),\s+\.height = dimensions\(2\), \.unit = "мм"\}\)/);
  assert.match(upload, /If writeMass AndAlso Not JsonNumberEquals\(product, "weightKg", massKg\) Then payload.Add\("weightKg", massKg\)/);
  assert.equal((upload.match(/payload.Add\("weightKg"/g) || []).length, 1);
  assert.match(upload, /If writeDepth AndAlso Not JsonNumberEquals\(JsonObject\(product, "passportDefaults"\), "foundationDepth", depthMm\) Then/);
  assert.match(upload, /If payload.Count > 0 Then[\s\S]*?saved = RequestJson\(client, New Global.System.Net.Http.HttpMethod\("PATCH"\), productPath, body\)/);
});

test('замена удаляет только прежние связи и подтверждает рисунки и записанные числа', () => {
  assert.match(upload, /For Each linkId As String In previous.Keys[\s\S]*?VerifyReadSlots\(client, photosPath, newLinks\)\s+If payload.Count = 0 Then Return productId/);
  assert.match(upload, /If payload.ContainsKey\("dimensions"\) AndAlso Not DimensionsMatch\(saved, dimensions\) Then/);
  assert.match(upload, /If payload.ContainsKey\("weightKg"\) AndAlso Not JsonNumberEquals\(saved, "weightKg", massKg\) Then/);
  assert.match(upload, /If payload.ContainsKey\("foundationDepth"\) AndAlso\s+Not JsonNumberEquals\(JsonObject\(saved, "passportDefaults"\), "foundationDepth", depthMm\) Then/);
  const verify = rule.match(/Sub VerifyReadSlots[\s\S]*?End Sub/)?.[0];
  assert.match(verify, /saved.Count <> 3/);
  assert.match(verify, /newLinks.Count <> 3/);
  assert.match(verify, /saved.ContainsKey\(newLinks\(i\)\)/);
  assert.match(verify, /saved\(newLinks\(i\)\) <> expectedKinds\(i\)/);
  assert.match(verify, /Count\(saved.Values, Function\(kind\) kind = expectedKinds\(i\)\) <> 1/);
});
