[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExamExePath,
    [switch]$SetShellReplacement
)

$resolvedExe = Resolve-Path -LiteralPath $ExamExePath -ErrorAction Stop
$exePath = $resolvedExe.Path

Write-Host "Kiosk lockdown yoqilmoqda (current user)..." -ForegroundColor Cyan
Write-Host "EXE: $exePath"

function Set-DwordValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Value
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
    New-ItemProperty -Path $Path -Name $Name -PropertyType DWord -Value $Value -Force | Out-Null
}

# Explorer policies (current user)
$explorerPolicy = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
Set-DwordValue -Path $explorerPolicy -Name "NoWinKeys" -Value 1
Set-DwordValue -Path $explorerPolicy -Name "NoRun" -Value 1
Set-DwordValue -Path $explorerPolicy -Name "NoViewContextMenu" -Value 1
Set-DwordValue -Path $explorerPolicy -Name "NoControlPanel" -Value 1
Set-DwordValue -Path $explorerPolicy -Name "NoTrayContextMenu" -Value 1

# System policies (current user)
$systemPolicy = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System"
Set-DwordValue -Path $systemPolicy -Name "DisableTaskMgr" -Value 1
Set-DwordValue -Path $systemPolicy -Name "DisableLockWorkstation" -Value 1
Set-DwordValue -Path $systemPolicy -Name "DisableChangePassword" -Value 1

# Auto-start kiosk app after login for this user.
$runPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (-not (Test-Path -LiteralPath $runPath)) {
    New-Item -Path $runPath -Force | Out-Null
}
New-ItemProperty -Path $runPath -Name "OlimpiadaKiosk" -PropertyType String -Value "`"$exePath`"" -Force | Out-Null

if ($SetShellReplacement.IsPresent) {
    $shellPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    if (-not (Test-Path -LiteralPath $shellPath)) {
        New-Item -Path $shellPath -Force | Out-Null
    }
    New-ItemProperty -Path $shellPath -Name "Shell" -PropertyType String -Value "`"$exePath`"" -Force | Out-Null
    Write-Host "Shell replacement yoqildi (current user)." -ForegroundColor Yellow
}

Write-Host "Lockdown sozlamalari saqlandi." -ForegroundColor Green
Write-Host "O'zgarishlar to'liq ishlashi uchun foydalanuvchi sessiyasini qayta oching." -ForegroundColor Green
