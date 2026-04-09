# Simsiz tarmoqlar olimpiadasi

Talabalarni ro'yxatdan o'tkazish, test topshirish va admin boshqaruvi uchun web loyiha.

## Asosiy oqim

1. Talaba faqat bosh sahifada ro'yxatdan o'tadi (`/`).
2. Test boshlash tugmasi bosh sahifada yo'q.
3. Tashkilotchi test havolasini alohida beradi (`/test.html`).
4. Talaba test sahifasida ro'yxatdan o'tgan emailini kiritib testni ishlaydi.

## Imkoniyatlar

- Ro'yxatdan o'tish (F.I.Sh, yo'nalish, kurs, email, telefon)
- Admin panel (kirish, savol banki, import/eksport, natijalar)
- Bir nechta savol turlari: `single_choice`, `multiple_choice`, `text_input`, `matching`
- Anti-cheat: tab/focus monitoring, copy/shortcut block, watermark, event log
- Kiosk EXE rejim + Windows lockdown skriptlari

## Tez ishga tushirish

```bash
npm install
npm start
```

Sahifalar:

- Ro'yxatdan o'tish: `http://localhost:3000/`
- Test: `http://localhost:3000/test.html`
- Admin login: `http://localhost:3000/login.html`

## Muhim environment o'zgaruvchilari

`.env.example` asosida `.env` yarating.

```bash
NODE_ENV=production
PORT=3000
SQLITE_DB_PATH=./data/olimpiada.db

ADMIN_USER=admin_login
ADMIN_PASS=replace_with_strong_password_min_12_chars
SESSION_SECRET=replace_with_long_random_secret_min_32_chars

TEST_DURATION_MIN=30
TEST_QUESTION_COUNT=30
TAB_SWITCH_MAX_ALLOWED=2
KIOSK_HEARTBEAT_INTERVAL_SEC=8
KIOSK_HEARTBEAT_TIMEOUT_SEC=90
```

## Kiosk EXE

```bash
npm run kiosk:dev
npm run kiosk:build
```

- Kiosk client: `kiosk-client/`
- Windows lockdown: `ops/windows-kiosk/`

## Deploy

- Xavfsizlik checklist: `PRODUCTION_CHECKLIST.md`
- Free/global deploy guide: `DEPLOY_FREE.md`
- Oracle VM scriptlari: `ops/oracle-free/`
- Docker image: `Dockerfile`
- Docker Compose: `docker-compose.yml`

Oracle quick deploy:

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy.sh
./ops/oracle-free/quick-deploy.sh your-domain.com admin@your-domain.com admin_login 'StrongPass123!'
```

Oracle quick deploy without own domain (auto `sslip.io`):

```bash
cd /opt/olimpiada
chmod +x ops/oracle-free/quick-deploy-ip-domain.sh
./ops/oracle-free/quick-deploy-ip-domain.sh admin@your-email.com admin_login 'StrongPass123!'
```

## Eslatma

Screenshot/copy ni 100% texnik yopish imkonsiz, lekin kiosk + OS lockdown + server policy birgalikda amaliy himoyani sezilarli kuchaytiradi.
