$root=(Get-Location).Path
$dir=Join-Path $root 'docs/crew/C236-trainer-exercise-instructions/qa/run02'
$expected=@(Get-Content (Join-Path $dir 'expected-suite-list.json') -Raw|ConvertFrom-Json)
$groups=@('batch-1','batch-2','batch-3','batch-4','c172','c240c242','c188','c198','stockscope','t26')
$all=@();$records=@();$missingGroups=@()
foreach($name in $groups){$path=Join-Path $dir "$name.json";if(!(Test-Path $path)){$missingGroups+=$name;continue};$j=Get-Content $path -Raw|ConvertFrom-Json;$all+=@($j.testResults);$records+=@{name=$name;suites=$j.numTotalTestSuites;passedSuites=$j.numPassedTestSuites;tests=$j.numTotalTests;passedTests=$j.numPassedTests;failedTests=$j.numFailedTests;pendingTests=$j.numPendingTests;success=$j.success}}
$names=@($all|ForEach-Object name)
$missing=@($expected|Where-Object {$_ -notin $names});$extra=@($names|Where-Object {$_ -notin $expected});$duplicates=@($names|Group-Object|Where-Object Count -gt 1|ForEach-Object Name)
$baseline=Get-Content (Join-Path $dir 'source-sha256.json') -Raw|ConvertFrom-Json
$changed=@();foreach($property in $baseline.PSObject.Properties){if((Get-FileHash -LiteralPath (Join-Path $root $property.Name) -Algorithm SHA256).Hash -ne $property.Value){$changed+=$property.Name}}
$summary=[ordered]@{expectedSuites=$expected.Count;actualSuites=$all.Count;passedSuites=@($all|Where-Object status -eq passed).Count;failedSuites=@($all|Where-Object status -ne passed).Count;passedTests=($records|Measure-Object passedTests -Sum).Sum;totalTests=($records|Measure-Object tests -Sum).Sum;failedTests=($records|Measure-Object failedTests -Sum).Sum;pendingTests=($records|Measure-Object pendingTests -Sum).Sum;missingGroups=$missingGroups;missing=$missing;extra=$extra;duplicates=$duplicates;changedSources=$changed;groups=$records}
$summary.success=($all.Count -eq $expected.Count -and !$missing.Count -and !$extra.Count -and !$duplicates.Count -and !$changed.Count -and !$summary.failedSuites -and !$summary.pendingTests)
$summary|ConvertTo-Json -Depth 7|Set-Content (Join-Path $dir 'full-summary.json') -Encoding utf8
$summary|Select-Object expectedSuites,actualSuites,passedSuites,passedTests,totalTests,failedTests,pendingTests,success,changedSources|ConvertTo-Json
