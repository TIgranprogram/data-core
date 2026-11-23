$ErrorActionPreference='Stop'
$repo=(Get-Location).Path;$out=Join-Path $repo 'docs/crew/C244-order-product-photo/qa'
$cfg=Get-Content (Join-Path $out 'config.json') -Raw|ConvertFrom-Json
if($cfg.freezeRequired -or !$cfg.extraStrictSuites.Count){throw 'Await C244 author freeze + reviewed HTTP inventory + root stand-build signal'}
& (Join-Path $out 'preflight.ps1')
$expected=@(Get-ChildItem backend/test -Recurse -Filter '*.e2e-spec.ts'|ForEach-Object FullName|Sort-Object)
$special=@{c172=@('c170-passport-source.e2e-spec.ts','passport-import.e2e-spec.ts','passport-presentation.e2e-spec.ts');c240c242=@('c240-stock-views.e2e-spec.ts','c242-stock-catalog-http.e2e-spec.ts');c188=@('c188-order-archive.e2e-spec.ts');c198=@('c198-order-acts.e2e-spec.ts');stockscope=@('stock-scope.e2e-spec.ts');t26=@('stock-catalog-atomicity.e2e-spec.ts');c244=@($cfg.extraStrictSuites)}
$databases=@{c172='datacore-test-c172-release';c240c242='datacore-test-c240-c242';c188=$cfg.ordinaryDatabase;c198='datacore-test-c198-acts';stockscope=$cfg.ordinaryDatabase;t26=$cfg.t26Database;c244=$cfg.extraStrictDatabase}
$specialNames=@($special.Values|ForEach-Object {$_})
foreach($name in $specialNames){if(@($expected|Where-Object {(Split-Path $_ -Leaf) -eq $name}).Count -ne 1){throw "Missing/ambiguous strict suite $name"}}
$ordinary=@($expected|Where-Object {(Split-Path $_ -Leaf) -notin $specialNames});$size=[int][Math]::Ceiling($ordinary.Count/4)
$groups=@();foreach($n in 1..4){$files=@($ordinary|Select-Object -Skip (($n-1)*$size) -First $size);if(!$files.Count){throw 'Empty ordinary batch'};$groups+=@{name="batch-$n";db=$cfg.ordinaryDatabase;files=$files}}
foreach($name in @('c172','c240c242','c188','c198','stockscope','t26','c244')){$files=@($expected|Where-Object {(Split-Path $_ -Leaf) -in $special[$name]});$groups+=@{name=$name;db=$databases[$name];files=$files}}
$union=@($groups|ForEach-Object {$_.files});if(@(Compare-Object $expected $union).Count -or @($union|Group-Object|Where-Object Count -ne 1).Count){throw 'Plan union missing/duplicate suite'}
$expected|ConvertTo-Json|Set-Content (Join-Path $out 'expected-suite-list.json') -Encoding utf8
@{expectedSuites=$expected.Count;ordinarySuites=$ordinary.Count;groups=$groups}|ConvertTo-Json -Depth 7|Set-Content (Join-Path $out 'manifest-plan.json') -Encoding utf8
$hashes=@{};Get-ChildItem backend/src,backend/test -Recurse -File -Filter '*.ts'|ForEach-Object {$hashes[$_.FullName.Substring($repo.Length+1)]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash};$hashes|ConvertTo-Json|Set-Content (Join-Path $out 'source-sha256.json') -Encoding utf8
$env:NODE_OPTIONS='--max-old-space-size=6144';$env:MONGO_PORT='27237';$env:MONGO_URI='mongodb://127.0.0.1:27237/x?replicaSet=rs0&directConnection=true'
Push-Location backend
try {foreach($group in $groups){
 if(Test-Path (Join-Path $out 'PAUSE')){throw 'Coordinator pause; no next group started'}
 $env:MONGO_DB_TEST=$group.db;$env:MONGO_DB=$group.db
 if($group.name -eq 't26'){$env:STOCK_CATALOG_TEST_DISPOSABLE='1';$env:STOCK_CATALOG_TEST_URI="mongodb://127.0.0.1:27237/$($group.db)?replicaSet=rs0&directConnection=true"}
 $files=$group.files;$json=Join-Path $out "$($group.name).json";$log=Join-Path $repo "tools/logs/c244-run01-$($group.name).log"
 Write-Output "START $($group.name) suites=$($files.Count) db=$($group.db)"
 npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json "--outputFile=$json" --runTestsByPath @files *> $log
 $code=$LASTEXITCODE;Write-Output "END $($group.name) exit=$code";if($code -ne 0){throw "Group $($group.name) FAIL; stop"}
}}finally {Pop-Location}
