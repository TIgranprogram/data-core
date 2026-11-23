$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$out=Join-Path $repo 'docs/crew/C236-trainer-exercise-instructions/qa/run05'
& (Join-Path $out 'preflight.ps1')
$env:NODE_OPTIONS='--max-old-space-size=6144';$env:MONGO_PORT='27237';$env:MONGO_URI='mongodb://127.0.0.1:27237/x?replicaSet=rs0&directConnection=true';$env:MONGO_DB_TEST='datacore-test-c236-run05';$env:MONGO_DB=$env:MONGO_DB_TEST
Push-Location backend
try {
 npx jest --silent --runInBand --json "--outputFile=$out/full-unit.json" *> (Join-Path $repo 'tools/logs/c236-run05-unit.log')
 if($LASTEXITCODE -ne 0){throw 'full unit FAIL; stop'}
 npx tsc --noEmit *> (Join-Path $repo 'tools/logs/c236-run05-tsc.log');$type=$LASTEXITCODE
 if($type -ne 0){throw 'typecheck FAIL; stop'}
 $files=@(git diff HEAD --name-only -- src test | Where-Object {$_ -match '\.ts$'} | ForEach-Object {$_ -replace '^backend/',''})
 $files+=@(git ls-files --others --exclude-standard src test | Where-Object {$_ -match '\.ts$'})
 $prior=Get-Content (Join-Path $repo 'docs/crew/C236-trainer-exercise-instructions/qa/run04/static-checks.json') -Raw|ConvertFrom-Json
 $files+=@($prior.eslintFiles)+@('src/modules/order-line-plan/work-schedule.service.ts','src/modules/order-line-plan/work-schedule-session.spec.ts')
 $files=@($files|Sort-Object -Unique)
 if(!$files.Count){throw 'Empty explicit lint manifest'}
 npx eslint --no-ignore @files *> (Join-Path $repo 'tools/logs/c236-run05-eslint.log');$lint=$LASTEXITCODE
 @{typecheckExit=$type;eslintExit=$lint;eslintFiles=$files}|ConvertTo-Json -Depth 4|Set-Content (Join-Path $out 'static-checks.json') -Encoding utf8
 if($lint -ne 0){throw 'eslint FAIL; stop'}
} finally {Pop-Location}
& (Join-Path $out 'run-full.ps1')
if($LASTEXITCODE -ne 0){throw 'full e2e FAIL; stop'}
Set-Location $repo
& (Join-Path $out 'summarize.ps1')




