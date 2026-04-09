# Windows Kiosk Lockdown (EXE)

Bu papka test EXE ni Windows'da yanada qattiq cheklov bilan ishlatish uchun.

## 1. Tavsiya etilgan sxema

1. Alohida Windows foydalanuvchi yarating (masalan: `exam-kiosk`).
2. Kiosk foydalanuvchi bilan bir marta tizimga kiring.
3. EXE (`Olimpiada Kiosk Test`) ni o'rnating.
4. Kiosk foydalanuvchida `Enable-KioskLockdown.ps1` ni ishga tushiring.
5. Imtihondan keyin `Disable-KioskLockdown.ps1` bilan qaytaring.

## 2. Lockdown yoqish

Kiosk foydalanuvchi ichida PowerShell ochib:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\ops\windows-kiosk\Enable-KioskLockdown.ps1 -ExamExePath "C:\Program Files\Olimpiada Kiosk Test\Olimpiada Kiosk Test.exe"
```

Ixtiyoriy (yanada qattiq):

```powershell
.\ops\windows-kiosk\Enable-KioskLockdown.ps1 -ExamExePath "C:\Program Files\Olimpiada Kiosk Test\Olimpiada Kiosk Test.exe" -SetShellReplacement
```

`-SetShellReplacement` foydalanuvchi shell'ini EXE ga almashtiradi. Buni faqat kiosk account uchun ishlating.

## 3. Lockdown o'chirish

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\ops\windows-kiosk\Disable-KioskLockdown.ps1 -RestoreExplorerShell
```

## 4. Muhim eslatmalar

- Bu cheklovlar **current user** uchun qo'llanadi (kiosk account).
- `Alt+Tab` va screenshot'ni 100% kafolat bilan bloklash OS/hardware darajasiga bog'liq.
- Eng kuchli variant: korporativ Windows (Enterprise/Education)da Shell Launcher/MDM kiosk siyosatlari.
- Imtihon vaqtida internet va server barqaror bo'lishi kerak (`heartbeat` ishlashi uchun).
