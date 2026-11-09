# Сборка DataCore.PdmLoader.exe в out/<версия>/ + meta.json (как читает apps.service.ts)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

[xml]$csproj = Get-Content .\DataCore.PdmLoader.csproj
$version = $csproj.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { $version = "1.0.0" }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Версия в csproj должна быть N.N.N, сейчас: $version" }

$outDir = Join-Path $PSScriptRoot "out\$version"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "dotnet publish → $outDir"
dotnet publish -c Release -o $outDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed: $LASTEXITCODE" }

$exe = Join-Path $outDir "DataCore.PdmLoader.exe"
if (-not (Test-Path $exe)) { throw "Нет файла $exe" }

$sha = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLowerInvariant()
$size = (Get-Item $exe).Length
$meta = @{
  version    = $version
  size       = $size
  sha256     = $sha
  uploadedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
} | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $outDir "meta.json") -Value $meta -Encoding utf8

# копия «последней» для удобства
$latest = Join-Path $PSScriptRoot "out"
Copy-Item $exe (Join-Path $latest "DataCore.PdmLoader.exe") -Force
Copy-Item (Join-Path $outDir "meta.json") (Join-Path $latest "meta.json") -Force

Write-Host "Готово: $exe"
Write-Host "meta.json: version=$version size=$size sha256=$sha"
