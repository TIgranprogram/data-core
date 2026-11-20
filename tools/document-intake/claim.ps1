param(
    [Parameter(Mandatory = $true, Position = 0)][string]$InputPath,
    [Parameter(Mandatory = $true, Position = 1)][string]$TargetPath
)

$ErrorActionPreference = 'Stop'
$handle = $null
$hash = $null
try {
    $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($InputPath))
    if ($drive.DriveType -eq [System.IO.DriveType]::Network) { exit 4 }
    $attributes = [System.IO.File]::GetAttributes($InputPath)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -or ($attributes -band [System.IO.FileAttributes]::Directory)) {
        exit 3
    }
    # Разрешено только перемещение. Дескриптор не откроется, пока файл пишет другая программа.
    $handle = [System.IO.File]::Open($InputPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Delete)
} catch {
    $cause = $_.Exception.GetBaseException()
    if ($cause -is [System.IO.IOException] -or $cause -is [System.UnauthorizedAccessException]) { exit 3 }
    exit 5
}

try {
    if ([System.IO.File]::GetAttributes($InputPath) -band [System.IO.FileAttributes]::ReparsePoint) { exit 3 }
    [System.IO.File]::Move($InputPath, $TargetPath)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $result = [System.BitConverter]::ToString($hash.ComputeHash($handle)).Replace('-', '').ToLowerInvariant()
    [System.Console]::WriteLine($result)
} catch {
    exit 5
} finally {
    if ($hash) { $hash.Dispose() }
    if ($handle) { $handle.Dispose() }
}
