$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$out=Join-Path $repo 'docs/crew/C236-trainer-exercise-instructions/qa/run04'
$running=@(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object {$_.CommandLine -match 'jest[\\/]bin[\\/]jest.js|npx-cli.js.*jest'})
if($running.Count){throw "Active Jest processes exist: $($running.ProcessId -join ','); do not kill; wait for owner"}
$info=docker inspect datacore-c236-qa-mongo | ConvertFrom-Json
if($info[0].Config.Labels.'datacore.task' -ne 'C236' -or $info[0].Config.Labels.'datacore.ephemeral' -ne 'true'){throw 'Owned Mongo labels mismatch'}
$binding=$info[0].HostConfig.PortBindings.'27017/tcp'[0]
if($binding.HostIp -ne '127.0.0.1' -or $binding.HostPort -ne '27237'){throw 'Loopback port mismatch'}
$snapshot=docker exec datacore-c236-qa-mongo mongo --quiet --eval 'var s=db.serverStatus(); print(JSON.stringify({transactions:Number(s.transactions.currentOpen),queue:s.globalLock.currentQueue.total,ops:db.getSiblingDB("admin").currentOp(true).inprog.filter(function(x){return x.active && ((x.ns && x.ns.indexOf("datacore-test")===0)||(x.command && x.command.createIndexes))}).map(function(x){return {opid:x.opid,ns:x.ns,waitingForLock:x.waitingForLock,secs_running:x.secs_running}})}));'
if($LASTEXITCODE -ne 0){throw 'Mongo snapshot failed'}
$snapshot | Set-Content (Join-Path $out 'preflight-last.json') -Encoding utf8
$s=$snapshot | ConvertFrom-Json
if($s.transactions -ne 0 -or $s.queue -ne 0 -or @($s.ops).Count -ne 0){throw 'Mongo has open transaction/queued lock/index operation; wait for owner, no kill'}
Write-Output 'Preflight PASS: owned loopback27237, no Jest/open transaction/lock queue/test operation'
$global:LASTEXITCODE=0


