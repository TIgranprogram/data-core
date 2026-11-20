param(
    [Parameter(Mandatory=$true)][ValidateSet('Pick','Open')][string]$Mode,
    [string]$InitialPath
)
$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Open') {
    $folder = Get-Item -LiteralPath $InitialPath
    if (-not $folder.PSIsContainer) { throw 'Folder not found' }
    $open = New-Object System.Diagnostics.ProcessStartInfo
    $open.FileName = $folder.FullName
    $open.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($open)
    exit
}

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
try {
    $dialog.ShowNewFolderButton = $true
    if ($InitialPath -and (Test-Path -LiteralPath $InitialPath -PathType Container)) {
        $dialog.SelectedPath = $InitialPath
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
    }
} finally {
    $dialog.Dispose()
}
