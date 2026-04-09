[CmdletBinding()]
param(
    [switch]$RestoreExplorerShell
)

Write-Host "Kiosk lockdown o'chirilmoqda (current user)..." -ForegroundColor Cyan

function Remove-PolicyValueIfExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (Test-Path -LiteralPath $Path) {
        try {
            Remove-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        } catch {
            # ignore if property missing
        }
    }
}

$explorerPolicy = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
@("NoWinKeys", "NoRun", "NoViewContextMenu", "NoControlPanel", "NoTrayContextMenu") | ForEach-Object {
    Remove-PolicyValueIfExists -Path $explorerPolicy -Name $_
}

$systemPolicy = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System"
@("DisableTaskMgr", "DisableLockWorkstation", "DisableChangePassword") | ForEach-Object {
    Remove-PolicyValueIfExists -Path $systemPolicy -Name $_
}

$runPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Remove-PolicyValueIfExists -Path $runPath -Name "OlimpiadaKiosk"

if ($RestoreExplorerShell.IsPresent) {
    $shellPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    if (-not (Test-Path -LiteralPath $shellPath)) {
        New-Item -Path $shellPath -Force | Out-Null
    }
    New-ItemProperty -Path $shellPath -Name "Shell" -PropertyType String -Value "explorer.exe" -Force | Out-Null
    Write-Host "Shell explorer.exe holatiga qaytarildi." -ForegroundColor Yellow
}

Write-Host "Lockdown sozlamalari bekor qilindi." -ForegroundColor Green
Write-Host "O'zgarishlar to'liq ishlashi uchun foydalanuvchi sessiyasini qayta oching." -ForegroundColor Green
