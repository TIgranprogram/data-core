$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$qa=Join-Path $repo 'docs/crew/C236-trainer-exercise-instructions/qa'
$out=Join-Path $qa 'run02'
$plan=Get-Content (Join-Path $qa 'full-plan.json') -Raw | ConvertFrom-Json
$expected=Get-Content (Join-Path $qa 'full-e2e-suite-list.json') -Raw | ConvertFrom-Json
$actual=Get-ChildItem backend/test -Recurse -Filter '*.e2e-spec.ts' | ForEach-Object FullName
if(@(Compare-Object $expected $actual).Count){throw 'Suite inventory changed; revise plan'}
$actual | ConvertTo-Json | Set-Content (Join-Path $out 'expected-suite-list.json') -Encoding utf8
$hashes=@{}; Get-ChildItem backend/src,backend/test -Recurse -File -Filter '*.ts' | ForEach-Object {$hashes[$_.FullName.Substring($repo.Length+1)]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
$hashes | ConvertTo-Json | Set-Content (Join-Path $out 'source-sha256.json') -Encoding utf8
$env:NODE_OPTIONS='--max-old-space-size=6144'; $env:MONGO_PORT='27237'; $env:MONGO_URI='mongodb://127.0.0.1:27237/x?replicaSet=rs0&directConnection=true'
Set-Location backend
$groups=@()
foreach($n in 1..4){$groups+=@{name="batch-$n";db=$plan.ordinaryDatabase;files=@(Get-Content (Join-Path $qa "full-e2e-batch-$n-list.json") -Raw | ConvertFrom-Json)}}
foreach($name in @('c172','c240c242','c188','c198','stockscope','t26')){$names=@($plan.specialGroups.$name);$groups+=@{name=$name;db=$plan.fixedDatabases.$name;files=@($expected | Where-Object { (Split-Path $_ -Leaf) -in $names })}}
foreach($group in $groups){
 $env:MONGO_DB_TEST=$group.db;$env:MONGO_DB=$group.db
 if($group.name -eq 't26'){$env:STOCK_CATALOG_TEST_DISPOSABLE='1';$env:STOCK_CATALOG_TEST_URI="mongodb://127.0.0.1:27237/$($group.db)?replicaSet=rs0&directConnection=true"}
 $files=$group.files;$json=Join-Path $out "$($group.name).json";$log=Join-Path $repo "tools/logs/c236-run02-$($group.name).log"
 Write-Output "START $($group.name) suites=$($files.Count) db=$($group.db)"
 npx jest --config ./test/jest-e2e.json --runInBand --forceExit --silent --json "--outputFile=$json" --runTestsByPath @files *> $log
 $code=$LASTEXITCODE;Write-Output "END $($group.name) exit=$code"
 if($code -ne 0){exit $code}
}
