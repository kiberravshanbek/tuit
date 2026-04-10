# Kiosk Client (Electron EXE)

Bu client `test.html` sahifasini EXE ichida kiosk rejimida ochadi.

## Ishga tushirish (dev)

```bash
npm install
npm run kiosk:dev
```

## EXE build

```bash
npm install
npm run kiosk:build
```

Natija: `dist-kiosk/` ichida Windows installer (`.exe`) chiqadi.

## Kiosk xulqi

- Oyna blur/minimize/fullscreen-dan chiqish aniqlansa test force-finish.
- Renderer `heartbeat` yuboradi; signal uzilib qolsa server watchdog orqali yakunlaydi.
- `/api/test/start` da `client_mode=kiosk` yuboriladi.
- Natijalar admin panelga odatdagidek tushadi.
