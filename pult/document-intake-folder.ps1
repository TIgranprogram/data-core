param(
    [Parameter(Mandatory=$true)][ValidateSet('Pick','Open')][string]$Mode,
    [string]$InitialPath
)
$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Open') {
    $folder = Get-Item -LiteralPath $InitialPath
    if (-not $folder.PSIsContainer) { throw 'Folder not found' }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class IntakeExplorerWindow
{
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@

    $shell = New-Object -ComObject Shell.Application
    function Find-IntakeWindow {
        foreach ($window in $shell.Windows()) {
            try {
                if ($window.Document.Folder.Self.Path -eq $folder.FullName) { return $window }
            } catch {
                # Окно могло закрыться или ещё не показать папку.
            }
        }
    }

    $explorer = Find-IntakeWindow
    if (-not $explorer) {
        $shell.Explore($folder.FullName)
        for ($attempt = 0; $attempt -lt 30 -and -not $explorer; $attempt++) {
            Start-Sleep -Milliseconds 100
            $explorer = Find-IntakeWindow
        }
    }
    if (-not $explorer) { throw 'Explorer window not found' }

    $handle = [IntPtr]([long]$explorer.HWND)
    $restore = -not $explorer.Visible -or [IntakeExplorerWindow]::IsIconic($handle)
    if ($restore) { [void][IntakeExplorerWindow]::ShowWindowAsync($handle, 9) }
    $explorer.Visible = $true
    [void][IntakeExplorerWindow]::SetForegroundWindow($handle)
    if ([IntakeExplorerWindow]::GetForegroundWindow() -eq $handle) {
        [Console]::Write('foreground')
    } else {
        [Console]::Write('visible')
    }
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
