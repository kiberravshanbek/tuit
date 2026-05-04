const express = require('express')
const session = require('express-session')
const mongoose = require('mongoose')
const ExcelJS = require('exceljs')
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType } = require('docx')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas')
const { registerFont } = require('@napi-rs/canvas/node-canvas')
const QRCode = require('qrcode')
const archiver = require('archiver')
const opentype = require('opentype.js')

const app = express()
const PORT = process.env.PORT || 3000
const IS_PROD = process.env.NODE_ENV === 'production'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'Ar$20020604Mat'
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-key-change-this-in-production-environments-now'
const MONGODB_URI = process.env.MONGODB_URI

const MIN_TEST_DURATION = 5, MAX_TEST_DURATION = 180
const parsedDuration = Number.parseInt(process.env.TEST_DURATION_MIN || '30', 10)
const TEST_DURATION_MIN = Number.isInteger(parsedDuration) && parsedDuration >= MIN_TEST_DURATION && parsedDuration <= MAX_TEST_DURATION ? parsedDuration : 30
const PHONE_REGEX = /^[+\d\s()-]{7,20}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_OPTIONS = new Set(['A','B','C','D'])
const QUESTION_TYPES = new Set(['single_choice','multiple_choice','text_input','matching'])
const VALID_COURSES = new Set(['1-kurs','2-kurs','3-kurs','4-kurs','Magistratura'])
const VALID_LANGS = new Set(['uz','ru'])
const MAX_REGISTER_FIELD_LEN = 120, MAX_PHONE_LEN = 20, MAX_QUESTION_LEN = 500, MAX_OPTION_LEN = 250
const MAX_IMPORT_ROWS = 1000, MAX_TEXT_ANSWERS = 10, MAX_MATCHING_PAIRS = 10
const ATTEMPT_TOKEN_BYTES = 32, MAX_SECURITY_EVENT_DETAILS = 300, MAX_SECURITY_EVENTS_STORED = 200
const DEFAULT_TAB_SWITCH_LIMIT = 2
const parsedTabSwitchLimit = Number.parseInt(process.env.TAB_SWITCH_MAX_ALLOWED || String(DEFAULT_TAB_SWITCH_LIMIT), 10)
const TAB_SWITCH_MAX_ALLOWED = Number.isInteger(parsedTabSwitchLimit) && parsedTabSwitchLimit >= 1 && parsedTabSwitchLimit <= 20 ? parsedTabSwitchLimit : DEFAULT_TAB_SWITCH_LIMIT
const parsedQuestionSubset = Number.parseInt(process.env.TEST_QUESTION_COUNT || '0', 10)
const TEST_QUESTION_COUNT = Number.isInteger(parsedQuestionSubset) && parsedQuestionSubset > 0 ? parsedQuestionSubset : 0
const parsedHeartbeatTimeoutSec = Number.parseInt(process.env.KIOSK_HEARTBEAT_TIMEOUT_SEC || '90', 10)
const KIOSK_HEARTBEAT_TIMEOUT_SEC = Number.isInteger(parsedHeartbeatTimeoutSec) && parsedHeartbeatTimeoutSec >= 20 && parsedHeartbeatTimeoutSec <= 600 ? parsedHeartbeatTimeoutSec : 90
const parsedHeartbeatIntervalSec = Number.parseInt(process.env.KIOSK_HEARTBEAT_INTERVAL_SEC || '8', 10)
const KIOSK_HEARTBEAT_INTERVAL_SEC = Number.isInteger(parsedHeartbeatIntervalSec) && parsedHeartbeatIntervalSec >= 3 && parsedHeartbeatIntervalSec <= 60 ? parsedHeartbeatIntervalSec : 8
const WATCHDOG_INTERVAL_MS = 15000
const LOGIN_WINDOW_MS = 15 * 60 * 1000, LOGIN_MAX_ATTEMPTS = 7
const loginAttempts = new Map()
const REGISTER_RATE_WINDOW_MS = 15*60*1000, REGISTER_RATE_MAX = 10
const TEST_START_RATE_WINDOW_MS = 15*60*1000, TEST_START_RATE_MAX = 20
const TEST_SUBMIT_RATE_WINDOW_MS = 15*60*1000, TEST_SUBMIT_RATE_MAX = 40
const TEST_EVENT_RATE_WINDOW_MS = 15*60*1000, TEST_EVENT_RATE_MAX = 120
const registerRequests = new Map(), testStartRequests = new Map(), testSubmitRequests = new Map(), testEventRequests = new Map()
const CLIENT_MODES = new Set(['web','kiosk'])
const SECURITY_EVENT_TYPES = new Set(['tab_hidden','window_blur','copy_block','contextmenu_block','shortcut_block','printscreen_block','kiosk_focus_lost','kiosk_app_closed','kiosk_heartbeat_lost','kiosk_host_force_finish'])
const FORCE_FINISH_REASONS = new Set(['kiosk_focus_lost','kiosk_app_closed','kiosk_heartbeat_lost','kiosk_host_force_finish','kiosk_policy'])
const CERT_WIDTH = 1600, CERT_HEIGHT = 1131
const CERT_THEMES = [
    { bgStart: '#EEF5FF', bgEnd: '#F7FAFF', primary: '#0F3D91', accent: '#0B1F3B', highlight: '#CFE1FF', wave: '#2D7DE0', glow: 'rgba(125, 170, 255, 0.55)', grid: 'rgba(41, 98, 184, 0.22)' },
    { bgStart: '#ECFEF8', bgEnd: '#F7FFFC', primary: '#0A6A5A', accent: '#073A32', highlight: '#C9F5E6', wave: '#0EA58A', glow: 'rgba(86, 211, 178, 0.55)', grid: 'rgba(8, 120, 96, 0.22)' },
    { bgStart: '#FFF5EC', bgEnd: '#FFF9F3', primary: '#A14C15', accent: '#57270B', highlight: '#FFE2C8', wave: '#E67D2E', glow: 'rgba(242, 163, 93, 0.52)', grid: 'rgba(186, 96, 34, 0.20)' },
]
const CERT_LOGO_PATHS = [
    path.join(__dirname, 'assets', 'logo', 'tatu-logo.png'),
    path.join(__dirname, 'assets', 'logo', 'TATU_logo.png'),
    path.join(__dirname, 'assets', 'logo', 'tatu.png'),
]
const CERT_FONT_DIR = path.join(__dirname, 'assets', 'fonts')
const CERT_FONTS = { serif: null, serifBold: null, sans: null, sansBold: null }
const CERT_CANVAS_FONTS = { serif: 'Times New Roman', sans: 'Arial' }
let certLogoPromise = null
const tryRegisterFont = (file, family, weight='normal') => {
    const fontPath = path.join(CERT_FONT_DIR, file)
    if (!fs.existsSync(fontPath)) return
    try { registerFont(fontPath, { family, weight }) } catch { /* ignore */ }
    try { if (GlobalFonts && GlobalFonts.registerFromPath) GlobalFonts.registerFromPath(fontPath, family) } catch { /* ignore */ }
}
const loadOpentypeFont = (file) => {
    const fontPath = path.join(CERT_FONT_DIR, file)
    if (!fs.existsSync(fontPath)) return null
    try {
        const buf = fs.readFileSync(fontPath)
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        return opentype.parse(ab)
    } catch {
        return null
    }
}
const loadCertFonts = () => {
    tryRegisterFont('NotoSans-Regular.ttf', 'Noto Sans', 'normal')
    tryRegisterFont('NotoSans-Bold.ttf', 'Noto Sans', 'bold')
    tryRegisterFont('NotoSerif-Regular.ttf', 'Noto Serif', 'normal')
    tryRegisterFont('NotoSerif-Bold.ttf', 'Noto Serif', 'bold')
    CERT_FONTS.sans = loadOpentypeFont('NotoSans-Regular.ttf')
    CERT_FONTS.sansBold = loadOpentypeFont('NotoSans-Bold.ttf')
    CERT_FONTS.serif = loadOpentypeFont('NotoSerif-Regular.ttf')
    CERT_FONTS.serifBold = loadOpentypeFont('NotoSerif-Bold.ttf')
    try { if (GlobalFonts && GlobalFonts.loadFontsFromDir) GlobalFonts.loadFontsFromDir(CERT_FONT_DIR) } catch { /* ignore */ }
    try { if (GlobalFonts && GlobalFonts.loadSystemFonts) GlobalFonts.loadSystemFonts() } catch { /* ignore */ }
    const families = Array.isArray(GlobalFonts?.families) ? GlobalFonts.families : []
    const familyByLower = new Map(families.map((f) => [String(f.family || '').toLowerCase(), String(f.family || '')]))
    const pick = (preferred, fallback) => familyByLower.get(String(preferred || '').toLowerCase()) || familyByLower.get(String(fallback || '').toLowerCase()) || fallback
    CERT_CANVAS_FONTS.sans = pick('Noto Sans', 'Arial')
    CERT_CANVAS_FONTS.serif = pick('Noto Serif', 'Times New Roman')
}
loadCertFonts()

async function getCertificateLogo() {
    if (!certLogoPromise) {
        certLogoPromise = (async () => {
            for (const logoPath of CERT_LOGO_PATHS) {
                if (!fs.existsSync(logoPath)) continue
                try {
                    return await loadImage(logoPath)
                } catch {
                    // try next file
                }
            }
            return null
        })()
    }
    try {
        return await certLogoPromise
    } catch {
        return null
    }
}

if (IS_PROD) {
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) throw new Error('ADMIN_USER va ADMIN_PASS majburiy.')
    if (process.env.ADMIN_PASS.length < 12) throw new Error('ADMIN_PASS kamida 12 belgi.')
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET kamida 32 belgi.')
    if (!MONGODB_URI) throw new Error('MONGODB_URI majburiy.')
}

// ============ SCHEMAS ============
const Student = mongoose.model('Student', new mongoose.Schema({
    full_name: { type: String, required: true },
    direction: { type: String, required: true },
    course: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
}))

const QuestionBank = mongoose.model('QuestionBank', new mongoose.Schema({
    text: { type: mongoose.Schema.Types.Mixed, required: true },
    question_type: { type: String, required: true },
    question_payload: { type: mongoose.Schema.Types.Mixed, required: true },
    correct_answer_json: { type: mongoose.Schema.Types.Mixed, required: true },
    created_at: { type: Date, default: Date.now },
}))

const TestResult = mongoose.model('TestResult', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    score: Number, total: Number,
    answers_json: mongoose.Schema.Types.Mixed,
    question_order: [mongoose.Schema.Types.ObjectId],
    attempt_token_hash: String, tab_switch_count: { type: Number, default: 0 },
    security_events_json: mongoose.Schema.Types.Mixed,
    client_mode: String, test_lang: String, last_heartbeat_at: Date, ended_reason: String,
    started_at: { type: Date, default: Date.now }, finished_at: Date,
}))

// ============ HELPERS ============
const nt = (v, max) => { if (typeof v !== 'string') return ''; return v.replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,max) }
const ne = (v) => nt(v, 254).toLowerCase()
const isEmail = (v) => EMAIL_REGEX.test(v) && v.length <= 254
const isPosInt = (v) => { const n = Number.parseInt(v,10); return Number.isInteger(n) && n > 0 ? n : null }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const hashTok = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
const genTok = () => crypto.randomBytes(ATTEMPT_TOKEN_BYTES).toString('hex')
const safeCmp = (a,b) => { const ab = Buffer.from(String(a)), bb = Buffer.from(String(b)); if (ab.length!==bb.length) return false; return crypto.timingSafeEqual(ab,bb) }
const sanCell = (v) => { if (typeof v !== 'string') return v; const t=v.trimStart(); if (!t) return v; if (/^[=+\-@]/.test(t)) return "'"+v; return v }
const shuffle = (items) => { const a=[...items]; for (let i=a.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]] }; return a }
const getIp = (req) => { const xff=req.headers['x-forwarded-for']; if (typeof xff==='string'&&xff.trim()) return xff.split(',')[0].trim(); return req.ip||req.socket.remoteAddress||'unknown' }
const sameOrigin = (url, host) => { try { return new URL(url).host===host } catch { return false } }
const parseNN = (v,fb=0) => { const n=Number.parseInt(v,10); return Number.isInteger(n)&&n>=0?n:fb }
const appendSec = (arr, ev) => { const a=Array.isArray(arr)?[...arr]:[]; a.push(ev); return a.length>MAX_SECURITY_EVENTS_STORED?a.slice(a.length-MAX_SECURITY_EVENTS_STORED):a }
const normMode = (v) => { const m=nt(String(v||'').toLowerCase(),12); return CLIENT_MODES.has(m)?m:'web' }
const normLang = (v) => { const l=nt(String(v||'').toLowerCase(),5); return VALID_LANGS.has(l)?l:'uz' }
const normFree = (v) => nt(String(v||''),MAX_OPTION_LEN).replace(/\s+/g,' ').toLowerCase()
const getLT = (v, lang) => { if (!v) return ''; if (typeof v==='string') return v; if (isObj(v)) return String(v[lang]||v['uz']||Object.values(v)[0]||''); return String(v) }
const parseVariant = (v) => { const n = Number.parseInt(v,10); return Number.isInteger(n) && n >= 1 && n <= CERT_THEMES.length ? n : 1 }
const formatDate = (v) => { if (!v) return ''; const d = new Date(v); if (Number.isNaN(d.getTime())) return ''; return d.toISOString().slice(0,10) }
const slugify = (v) => { const s = nt(String(v||''),80).toLowerCase(); const out = s.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); return out || 'sertifikat' }
const escapeHtml = (v) => String(v||'').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

function measureTextWidth(ctx, font, text, size) {
    try {
        if (font && typeof font.getAdvanceWidth === 'function') {
            return font.getAdvanceWidth(text, size)
        }
    } catch {
        // fall back to canvas measurement
    }
    try {
        return ctx.measureText(text).width
    } catch {
        return 0
    }
}

function drawTextLine(ctx, font, text, x, y, align, size) {
    const raw = String(text || '')
    const width = measureTextWidth(ctx, font, raw, size)
    let startX = x
    if (align === 'center') startX = x - width / 2
    if (align === 'right') startX = x - width

    if (font && typeof font.getPath === 'function') {
        try {
            const path = font.getPath(raw, startX, y, size)
            if (Array.isArray(path?.commands) && path.commands.length > 0) {
                path.draw(ctx)
                return
            }
        } catch {
            // fall back to fillText
        }
    }
    try {
        ctx.textAlign = align
        ctx.fillText(raw, x, y)
    } catch {
        // ignore rendering errors
    }
}

function wrapText(ctx, text, maxWidth, font, size) {
    const words = String(text||'').split(/\s+/).filter(Boolean)
    const lines = []
    let line = ''
    for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (measureTextWidth(ctx, font, test, size) <= maxWidth) { line = test; continue }
        if (line) lines.push(line)
        line = word
    }
    if (line) lines.push(line)
    return lines
}

function drawParagraph(ctx, text, x, y, maxWidth, lineHeight, align='center', font=null, size=16) {
    const lines = Array.isArray(text) ? text : wrapText(ctx, text, maxWidth, font, size)
    lines.forEach((line, idx) => drawTextLine(ctx, font, line, x, y + idx * lineHeight, align, size))
    return y + lines.length * lineHeight
}

function roundedRectPath(ctx, x, y, w, h, r = 14) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + w - radius, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
    ctx.lineTo(x + w, y + h - radius)
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
    ctx.lineTo(x + radius, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
}

function drawWirelessIcon(ctx, x, y, size, color, alpha = 0.2) {
    const radii = [size * 0.22, size * 0.35, size * 0.48]
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineCap = 'round'
    radii.forEach((r, idx) => {
        ctx.lineWidth = Math.max(1.2, 3.4 - idx * 0.8)
        ctx.beginPath()
        ctx.arc(x, y, r, Math.PI * 1.12, Math.PI * 1.88)
        ctx.stroke()
    })
    ctx.beginPath()
    ctx.arc(x, y + size * 0.26, Math.max(3, size * 0.033), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
}

function drawCertificateBackground(ctx, theme, variant) {
    const bgStart = theme.bgStart || '#F8FAFC'
    const bgEnd = theme.bgEnd || '#FFFFFF'
    const wave = theme.wave || theme.primary || '#1E3A8A'
    const highlight = theme.highlight || '#E2E8F0'
    const grid = theme.grid || 'rgba(30, 58, 138, 0.14)'
    const glow = theme.glow || 'rgba(59, 130, 246, 0.45)'

    const bg = ctx.createLinearGradient(0, 0, CERT_WIDTH, CERT_HEIGHT)
    bg.addColorStop(0, bgStart)
    bg.addColorStop(1, bgEnd)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT)

    const glow1 = ctx.createRadialGradient(CERT_WIDTH * 0.17, CERT_HEIGHT * 0.17, 10, CERT_WIDTH * 0.17, CERT_HEIGHT * 0.17, 430)
    glow1.addColorStop(0, glow)
    glow1.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow1
    ctx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT)

    const glow2 = ctx.createRadialGradient(CERT_WIDTH * 0.86, CERT_HEIGHT * 0.77, 10, CERT_WIDTH * 0.86, CERT_HEIGHT * 0.77, 380)
    glow2.addColorStop(0, glow)
    glow2.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow2
    ctx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT)

    ctx.save()
    ctx.globalAlpha = 0.24
    ctx.fillStyle = highlight
    ctx.fillRect(0, 0, CERT_WIDTH, 150)
    ctx.fillRect(0, CERT_HEIGHT - 132, CERT_WIDTH, 132)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = grid
    ctx.lineWidth = 1.2
    for (let i = -6; i < 28; i++) {
        const x = i * 95
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x + 250, CERT_HEIGHT)
        ctx.stroke()
    }
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = wave
    ctx.lineWidth = 2.2
    for (let i = 0; i < 5; i++) {
        const y = 185 + i * 165 + (variant - 1) * 12
        ctx.beginPath()
        ctx.moveTo(-120, y)
        ctx.bezierCurveTo(CERT_WIDTH * 0.2, y - 40, CERT_WIDTH * 0.78, y + 34, CERT_WIDTH + 120, y - 8)
        ctx.stroke()
    }
    ctx.restore()

    const nodes = [
        [200, 220], [360, 280], [560, 240], [760, 300], [980, 270], [1210, 330], [1400, 290],
        [270, 780], [460, 730], [690, 790], [910, 735], [1110, 800], [1320, 760]
    ]
    ctx.save()
    ctx.globalAlpha = 0.32
    ctx.strokeStyle = wave
    ctx.fillStyle = wave
    ctx.lineWidth = 1.4
    for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1]
        const cur = nodes[i]
        ctx.beginPath()
        ctx.moveTo(prev[0], prev[1])
        ctx.lineTo(cur[0], cur[1])
        ctx.stroke()
    }
    nodes.forEach(([nx, ny]) => {
        ctx.beginPath()
        ctx.arc(nx, ny, 4.2, 0, Math.PI * 2)
        ctx.fill()
    })
    ctx.restore()

    drawWirelessIcon(ctx, 210, 190, 140, wave, 0.24)
    drawWirelessIcon(ctx, CERT_WIDTH - 240, 205, 110, wave, 0.16)
    drawWirelessIcon(ctx, CERT_WIDTH - 230, CERT_HEIGHT - 210, 145, wave, 0.22)

    ctx.save()
    ctx.globalAlpha = 0.11
    ctx.fillStyle = wave
    ctx.font = `bold 150px "${CERT_CANVAS_FONTS.sans}"`
    ctx.textAlign = 'left'
    ctx.fillText('5G', CERT_WIDTH - 425, 258)
    ctx.restore()

    ctx.strokeStyle = theme.primary
    ctx.lineWidth = 6
    ctx.strokeRect(40, 40, CERT_WIDTH - 80, CERT_HEIGHT - 80)
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 2
    ctx.strokeRect(60, 60, CERT_WIDTH - 120, CERT_HEIGHT - 120)
}

function getCertCopy(lang, student, result) {
    const name = nt(student.full_name, 120) || (lang === 'ru' ? 'Uchastnik' : 'Ishtirokchi')
    const direction = nt(student.direction, 120)
    const course = nt(student.course, 40)
    const date = formatDate(result.finished_at || result.started_at)

    if (lang === 'ru') {
        return {
            name,
            title: 'SERTIFIKAT',
            subtitle: 'Uchastnik olimpiady po besprovodnym setyam',
            universityLines: [
                'Tashkentskiy universitet informatsionnyh tehnologiy',
                'imeni Muhammada al-Horazmiy'
            ],
            facultyLine: 'Fakultet radio i mobilnoy svyazi',
            awardLabel: 'NAGRAZhDAETSYA',
            body: [
                'za aktivnoe uchastie v olimpiade',
                'po distsipline "Besprovodnye seti".'
            ],
            subjectLine: 'Predmet: Besprovodnye seti',
            fieldLine: `Napravlenie: ${direction || '-'}   Kurs: ${course || '-'}   Data: ${date || '-'}`,
            footerLabel: 'Zaveduyushchiy kafedroy',
            footerName: 'Xayrullayev Alisher Fayzulla o`gli',
            qrLabel: 'Proverka po QR'
        }
    }

    return {
        name,
        title: 'SERTIFIKAT',
        subtitle: 'Simsiz aloqa va tarmoqlar olimpiadasi',
        universityLines: [
            'Muhammad al-Xorazmiy nomidagi',
            'Toshkent Axborot Texnologiyalari Universiteti'
        ],
        facultyLine: 'Radio va mobil aloqa fakulteti | Mobil aloqa texnologiyalari kafedrasi',
        awardLabel: 'TAQDIRLANADI',
        body: [
            '"Simsiz tarmoqlar" fanidan olimpiadada',
            'faol ishtirok etganligi uchun ushbu sertifikat bilan taqdirlanadi.'
        ],
        subjectLine: 'Fan: Simsiz tarmoqlar',
        fieldLine: `Yo'nalish: ${direction || '-'}   Kurs: ${course || '-'}   Sana: ${date || '-'}`,
        footerLabel: 'Mobil aloqa texnologiyalari kafedrasi mudiri',
        footerName: "Xayrullayev Alisher Fayzulla o'g'li",
        qrLabel: 'QR orqali tekshirish'
    }
}

async function renderCertificatePng({ student, result, lang, variant, verifyUrl }) {
    const theme = CERT_THEMES[(variant - 1) % CERT_THEMES.length]
    const canvas = createCanvas(CERT_WIDTH, CERT_HEIGHT)
    const ctx = canvas.getContext('2d')
    drawCertificateBackground(ctx, theme, variant)

    const copy = getCertCopy(lang, student, result)
    const logoImage = await getCertificateLogo()
    const centerX = CERT_WIDTH / 2
    const maxWidth = CERT_WIDTH - 210
    const topShift = logoImage ? 96 : 0

    if (logoImage) {
        const plateCenterY = 130
        const plateRadius = 102
        ctx.save()
        ctx.shadowColor = 'rgba(9, 30, 66, 0.24)'
        ctx.shadowBlur = 24
        ctx.shadowOffsetY = 5
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.beginPath()
        ctx.arc(centerX, plateCenterY, plateRadius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.strokeStyle = theme.primary
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.arc(centerX, plateCenterY, plateRadius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()

        const maxLogoW = 176
        const maxLogoH = 176
        const logoScale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height)
        const drawW = Math.max(1, Math.round(logoImage.width * logoScale))
        const drawH = Math.max(1, Math.round(logoImage.height * logoScale))
        const drawX = Math.round(centerX - drawW / 2)
        const drawY = Math.round(plateCenterY - drawH / 2)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(logoImage, drawX, drawY, drawW, drawH)
    }

    ctx.font = `bold 78px "${CERT_CANVAS_FONTS.serif}"`
    ctx.fillStyle = theme.primary
    drawTextLine(ctx, CERT_FONTS.serifBold || CERT_FONTS.serif, copy.title, centerX, 146 + topShift, 'center', 78)

    ctx.font = `28px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.accent
    drawTextLine(ctx, CERT_FONTS.sans || CERT_FONTS.serif, copy.subtitle, centerX, 196 + topShift, 'center', 28)

    ctx.font = `bold 34px "${CERT_CANVAS_FONTS.serif}"`
    let y = 246 + topShift
    y = drawParagraph(ctx, copy.universityLines || [], centerX, y, maxWidth, 44, 'center', CERT_FONTS.serifBold || CERT_FONTS.serif, 34)

    y += 14
    ctx.font = `23px "${CERT_CANVAS_FONTS.sans}"`
    drawTextLine(ctx, CERT_FONTS.sans || CERT_FONTS.serif, copy.facultyLine || '', centerX, y, 'center', 23)

    y += 56
    ctx.font = `bold 22px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.primary
    drawTextLine(ctx, CERT_FONTS.sansBold || CERT_FONTS.sans || CERT_FONTS.serif, copy.awardLabel || '', centerX, y, 'center', 22)

    y += 58
    ctx.font = `bold 62px "${CERT_CANVAS_FONTS.serif}"`
    ctx.fillStyle = theme.accent
    drawTextLine(ctx, CERT_FONTS.serifBold || CERT_FONTS.serif, copy.name, centerX, y, 'center', 62)

    y += 14
    ctx.strokeStyle = theme.primary
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(270, y)
    ctx.lineTo(CERT_WIDTH - 270, y)
    ctx.stroke()

    y += 56
    ctx.font = `28px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.accent
    for (const paragraph of copy.body || []) {
        y = drawParagraph(ctx, paragraph, centerX, y, maxWidth, 38, 'center', CERT_FONTS.sans || CERT_FONTS.serif, 28)
        y += 8
    }

    const subjectBoxW = 760
    const subjectBoxH = 58
    const subjectBoxX = Math.round((CERT_WIDTH - subjectBoxW) / 2)
    const subjectBoxY = y + 14

    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.fillStyle = theme.highlight
    roundedRectPath(ctx, subjectBoxX, subjectBoxY, subjectBoxW, subjectBoxH, 14)
    ctx.fill()
    ctx.strokeStyle = theme.primary
    ctx.lineWidth = 1.8
    roundedRectPath(ctx, subjectBoxX, subjectBoxY, subjectBoxW, subjectBoxH, 14)
    ctx.stroke()
    ctx.restore()

    ctx.font = `bold 30px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.primary
    drawTextLine(ctx, CERT_FONTS.sansBold || CERT_FONTS.sans || CERT_FONTS.serif, copy.subjectLine || '', centerX, subjectBoxY + 39, 'center', 30)

    y = subjectBoxY + subjectBoxH + 42
    ctx.font = `23px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.accent
    y = drawParagraph(ctx, copy.fieldLine, centerX, y, maxWidth, 32, 'center', CERT_FONTS.sans || CERT_FONTS.serif, 23)

    const footerY = CERT_HEIGHT - 195
    ctx.textAlign = 'left'
    ctx.font = `21px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.accent
    drawTextLine(ctx, CERT_FONTS.sans || CERT_FONTS.serif, copy.footerLabel, 120, footerY, 'left', 21)
    ctx.font = `bold 24px "${CERT_CANVAS_FONTS.sans}"`
    drawTextLine(ctx, CERT_FONTS.sansBold || CERT_FONTS.sans || CERT_FONTS.serif, copy.footerName, 120, footerY + 31, 'left', 24)
    ctx.strokeStyle = theme.primary
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(120, footerY + 47)
    ctx.lineTo(620, footerY + 47)
    ctx.stroke()

    ctx.font = `16px "${CERT_CANVAS_FONTS.sans}"`
    drawTextLine(ctx, CERT_FONTS.sans || CERT_FONTS.serif, `ID: ${result._id}`, 120, CERT_HEIGHT - 72, 'left', 16)

    const qrData = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 })
    const qrImg = await loadImage(qrData)
    const qrX = CERT_WIDTH - 338
    const qrY = CERT_HEIGHT - 338
    ctx.drawImage(qrImg, qrX, qrY, 216, 216)
    ctx.textAlign = 'center'
    ctx.font = `18px "${CERT_CANVAS_FONTS.sans}"`
    ctx.fillStyle = theme.accent
    drawTextLine(ctx, CERT_FONTS.sans || CERT_FONTS.serif, copy.qrLabel, qrX + 108, qrY + 238, 'center', 18)

    return canvas.toBuffer('image/png')
}
async function getCertificateRecord(id) {
    let result
    try {
        result = await TestResult.findById(id)
            .populate('student_id', 'full_name direction course email phone')
            .lean()
    } catch {
        return null
    }
    if (!result || !result.finished_at || !result.student_id) return null
    return result
}

function requireSameOrigin(req, res, next) {
    const host = String(req.get('host')||'')
    const origin = req.get('origin'), referer = req.get('referer')
    if (origin) { if (!sameOrigin(origin,host)) return res.status(403).json({success:false,message:"Noto`g`ri so`rov manbasi"}); return next() }
    if (referer) { if (!sameOrigin(referer,host)) return res.status(403).json({success:false,message:"Noto`g`ri so`rov manbasi"}); return next() }
    return res.status(403).json({success:false,message:"So`rov manbasi aniqlanmadi"})
}

function cleanupMap(map, windowMs, now=Date.now()) { for (const [k,e] of map.entries()) if (now-e.firstRequestAt>windowMs) map.delete(k) }
function fixedWindow(map, key, max, windowMs) {
    const now=Date.now(); cleanupMap(map,windowMs,now)
    const e=map.get(key)
    if (!e) { map.set(key,{count:1,firstRequestAt:now}); return {blocked:false} }
    if (now-e.firstRequestAt>windowMs) { map.set(key,{count:1,firstRequestAt:now}); return {blocked:false} }
    if (e.count>=max) return {blocked:true,retryAfterSec:Math.ceil((windowMs-(now-e.firstRequestAt))/1000)}
    e.count+=1; return {blocked:false}
}
function rateLimiter(map,max,windowMs,msg) { return (req,res,next) => { const s=fixedWindow(map,getIp(req),max,windowMs); if (s.blocked) { res.setHeader('Retry-After',String(s.retryAfterSec)); return res.status(429).json({success:false,message:msg}) }; return next() } }
const limitReg = rateLimiter(registerRequests, REGISTER_RATE_MAX, REGISTER_RATE_WINDOW_MS, "Ro`yxatdan o`tish so`rovlari ko`payib ketdi.")
const limitStart = rateLimiter(testStartRequests, TEST_START_RATE_MAX, TEST_START_RATE_WINDOW_MS, 'Testni boshlash so`rovlari ko`payib ketdi.')
const limitSubmit = rateLimiter(testSubmitRequests, TEST_SUBMIT_RATE_MAX, TEST_SUBMIT_RATE_WINDOW_MS, 'Juda ko`p yakunlash so`rovi.')
const limitEvent = rateLimiter(testEventRequests, TEST_EVENT_RATE_MAX, TEST_EVENT_RATE_WINDOW_MS, 'Juda ko`p xavfsizlik hodisasi.')

function cleanupLogin(now=Date.now()) { for (const [k,e] of loginAttempts.entries()) if (now-e.firstAttemptAt>LOGIN_WINDOW_MS) loginAttempts.delete(k) }
function checkLogin(key) { const now=Date.now(); cleanupLogin(now); const e=loginAttempts.get(key); if (!e) return {blocked:false}; const el=now-e.firstAttemptAt; if (el>LOGIN_WINDOW_MS) { loginAttempts.delete(key); return {blocked:false} }; if (e.count>=LOGIN_MAX_ATTEMPTS) return {blocked:true,retryAfterSec:Math.ceil((LOGIN_WINDOW_MS-el)/1000)}; return {blocked:false} }
function recordLogin(key) { const now=Date.now(); const e=loginAttempts.get(key); if (!e||now-e.firstAttemptAt>LOGIN_WINDOW_MS) { loginAttempts.set(key,{count:1,firstAttemptAt:now}); return }; e.count+=1 }
function clearLogin(key) { loginAttempts.delete(key) }

function uniqList(values) { const out=[],seen=new Set(); values.forEach(v => { const k=normFree(v); if (!k||seen.has(k)) return; seen.add(k); out.push(nt(String(v),MAX_OPTION_LEN)) }); return out }

function parseQRow(row) { return { id:row._id, text:row.text, questionType:row.question_type, questionPayload:row.question_payload, correctAnswer:row.correct_answer_json, createdAt:row.created_at } }

function parseQPayload(body) {
    const textUz=nt(body.text_uz||body.text,MAX_QUESTION_LEN)
    const textRu=nt(body.text_ru||body.text,MAX_QUESTION_LEN)
    const qType=nt(String(body.question_type||'single_choice').toLowerCase(),30)
    if (!textUz) return {error:"O'zbek tilidagi savol matnini kiriting"}
    if (!textRu) return {error:"Rus tilidagi savol matnini kiriting (text_ru)"}
    if (!QUESTION_TYPES.has(qType)) return {error:"Savol turi noto`g`ri"}
    const text={uz:textUz,ru:textRu}

    if (qType==='single_choice'||qType==='multiple_choice') {
        const getOpt=(letter,lang) => nt(body[`option_${letter.toLowerCase()}_${lang}`]||body[`option_${letter.toLowerCase()}`]||'',MAX_OPTION_LEN)
        const uzA=getOpt('A','uz'),uzB=getOpt('B','uz'),uzC=getOpt('C','uz'),uzD=getOpt('D','uz')
        const ruA=getOpt('A','ru'),ruB=getOpt('B','ru'),ruC=getOpt('C','ru'),ruD=getOpt('D','ru')
        if (!uzA||!uzB||!uzC||!uzD) return {error:"O'zbek tilida barcha variantlarni kiriting (A, B, C, D)"}
        if (!ruA||!ruB||!ruC||!ruD) return {error:"Rus tilida barcha variantlarni kiriting"}
        const options={A:{uz:uzA,ru:ruA},B:{uz:uzB,ru:ruB},C:{uz:uzC,ru:ruC},D:{uz:uzD,ru:ruD}}
        if (qType==='single_choice') {
            const co=nt(String(body.correct_option||'').toUpperCase(),1)
            if (!VALID_OPTIONS.has(co)) return {error:"To`g`ri variant A, B, C yoki D bo`lishi kerak"}
            return {value:{text,questionType:qType,questionPayload:{options},correctAnswer:{correctOption:co}}}
        }
        let raw=body.correct_options; if (!Array.isArray(raw)) raw=typeof raw==='string'?raw.split(/[,\s]+/):[]
        const norm=Array.from(new Set(raw.map(v=>nt(String(v||'').toUpperCase(),1)).filter(v=>VALID_OPTIONS.has(v)))).sort()
        if (!norm.length) return {error:"Kamida bitta to`g`ri variant tanlang"}
        return {value:{text,questionType:qType,questionPayload:{options},correctAnswer:{correctOptions:norm}}}
    }

    if (qType==='text_input') {
        let uzRaw=body.accepted_answers_uz||body.accepted_answers||[]
        let ruRaw=body.accepted_answers_ru||body.accepted_answers||[]
        if (!Array.isArray(uzRaw)) uzRaw=typeof uzRaw==='string'?uzRaw.split(/\r?\n|,/):[]
        if (!Array.isArray(ruRaw)) ruRaw=typeof ruRaw==='string'?ruRaw.split(/\r?\n|,/):[]
        const uzA=uniqList(uzRaw).slice(0,MAX_TEXT_ANSWERS)
        const ruA=uniqList(ruRaw).slice(0,MAX_TEXT_ANSWERS)
        if (!uzA.length) return {error:"O'zbek tilidagi to'g'ri javoblarni kiriting"}
        if (!ruA.length) return {error:"Rus tilidagi to'g'ri javoblarni kiriting"}
        return {value:{text,questionType:qType,questionPayload:{placeholder:{uz:'Javobingizni kiriting',ru:'Введите ваш ответ'}},correctAnswer:{acceptedAnswers:{uz:uzA,ru:ruA}}}}
    }

    let pRaw=body.matching_pairs
    if (!Array.isArray(pRaw)) { if (typeof pRaw==='string') pRaw=pRaw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const[left,...rest]=l.split('|');return{left,right:rest.join('|')}}); else pRaw=[] }
    const pairs=pRaw.map((p,i)=>{
        const lUz=nt(getLT(p.left_uz||p.left,'uz'),MAX_OPTION_LEN)
        const lRu=nt(getLT(p.left_ru||p.left,'ru')||lUz,MAX_OPTION_LEN)
        const rUz=nt(getLT(p.right_uz||p.right,'uz'),MAX_OPTION_LEN)
        const rRu=nt(getLT(p.right_ru||p.right,'ru')||rUz,MAX_OPTION_LEN)
        return {id:String(i+1),left:{uz:lUz,ru:lRu},right:{uz:rUz,ru:rRu}}
    }).filter(p=>p.left.uz&&p.right.uz).slice(0,MAX_MATCHING_PAIRS)
    if (pairs.length<2) return {error:"Moslashtirish turida kamida 2 juftlik bo`lishi kerak"}
    return {value:{text,questionType:qType,questionPayload:{pairs},correctAnswer:{pairIds:pairs.map(p=>p.id)}}}
}

function serializeQAdmin(q) {
    const b={id:q.id,text:getLT(q.text,'uz'),text_uz:getLT(q.text,'uz'),text_ru:getLT(q.text,'ru'),question_type:q.questionType,created_at:q.createdAt}
    if (q.questionType==='single_choice'||q.questionType==='multiple_choice') {
        const opts=q.questionPayload.options||{}
        ;['A','B','C','D'].forEach(l=>{ const o=opts[l]||{}; b[`option_${l.toLowerCase()}_uz`]=getLT(o,'uz'); b[`option_${l.toLowerCase()}_ru`]=getLT(o,'ru'); b[`option_${l.toLowerCase()}`]=getLT(o,'uz') })
        b.correct_option=q.correctAnswer.correctOption||''; b.correct_options=Array.isArray(q.correctAnswer.correctOptions)?q.correctAnswer.correctOptions:[]
        return b
    }
    if (q.questionType==='text_input') {
        const aa=q.correctAnswer.acceptedAnswers||{}
        b.accepted_answers_uz=Array.isArray(aa.uz)?aa.uz:(Array.isArray(aa)?aa:[])
        b.accepted_answers_ru=Array.isArray(aa.ru)?aa.ru:[]
        b.accepted_answers=b.accepted_answers_uz; return b
    }
    b.matching_pairs=Array.isArray(q.questionPayload.pairs)?q.questionPayload.pairs.map(p=>({id:p.id,left_uz:getLT(p.left,'uz'),left_ru:getLT(p.left,'ru'),right_uz:getLT(p.right,'uz'),right_ru:getLT(p.right,'ru'),left:getLT(p.left,'uz'),right:getLT(p.right,'uz')})):[]
    return b
}

function serializeQTest(q, lang='uz') {
    const text=getLT(q.text,lang)
    if (q.questionType==='single_choice'||q.questionType==='multiple_choice') {
        const opts=q.questionPayload.options||{}, options={}
        Object.keys(opts).forEach(l=>{ options[l]=getLT(opts[l],lang) })
        return {id:q.id,text,type:q.questionType,options,optionOrder:shuffle(Array.from(VALID_OPTIONS))}
    }
    if (q.questionType==='text_input') {
        return {id:q.id,text,type:q.questionType,placeholder:getLT(q.questionPayload.placeholder,lang)||(lang==='ru'?'Введите ваш ответ':'Javobingizni kiriting')}
    }
    const pairs=Array.isArray(q.questionPayload.pairs)?q.questionPayload.pairs:[]
    return {id:q.id,text,type:q.questionType,leftItems:pairs.map(p=>({id:String(p.id),text:getLT(p.left,lang)})),rightOptions:shuffle(pairs.map(p=>({id:String(p.id),text:getLT(p.right,lang)})))}
}

function normAnswer(q, raw) {
    if (q.questionType==='single_choice') { const a=nt(String(raw||'').toUpperCase(),1); return VALID_OPTIONS.has(a)?a:null }
    if (q.questionType==='multiple_choice') { let v=raw; if (!Array.isArray(v)) { if (typeof v==='string') v=v.split(/[,\s]+/); else return null }; const n=Array.from(new Set(v.map(x=>nt(String(x||'').toUpperCase(),1)).filter(x=>VALID_OPTIONS.has(x)))).sort(); return n.length?n:null }
    if (q.questionType==='text_input') { const a=nt(String(raw||''),MAX_OPTION_LEN); return a||null }
    if (!isObj(raw)) return null
    const pairs=Array.isArray(q.questionPayload.pairs)?q.questionPayload.pairs:[]
    const allowed=new Set(pairs.map(p=>String(p.id))); const norm={}
    for (const [l,r] of Object.entries(raw)) { const li=nt(String(l||''),20),ri=nt(String(r||''),20); if (!allowed.has(li)||!allowed.has(ri)) continue; norm[li]=ri }
    return Object.keys(norm).length?norm:null
}

function isCorrect(q, ans, lang='uz') {
    if (ans===null||ans===undefined) return false
    if (q.questionType==='single_choice') return ans===nt(String(q.correctAnswer.correctOption||'').toUpperCase(),1)
    if (q.questionType==='multiple_choice') { const c=Array.isArray(q.correctAnswer.correctOptions)?Array.from(new Set(q.correctAnswer.correctOptions.map(v=>nt(String(v||'').toUpperCase(),1)))).sort():[]; if (!c.length||!Array.isArray(ans)) return false; if (c.length!==ans.length) return false; return c.every((v,i)=>v===ans[i]) }
    if (q.questionType==='text_input') { const aa=q.correctAnswer.acceptedAnswers; let accepted=[]; if (isObj(aa)) accepted=Array.isArray(aa[lang])?aa[lang]:(Array.isArray(aa['uz'])?aa['uz']:[]); else if (Array.isArray(aa)) accepted=aa; return new Set(accepted.map(v=>normFree(v)).filter(Boolean)).has(normFree(ans)) }
    const pids=Array.isArray(q.correctAnswer.pairIds)?q.correctAnswer.pairIds.map(String):Array.isArray(q.questionPayload.pairs)?q.questionPayload.pairs.map(p=>String(p.id)):[]
    if (!pids.length||!isObj(ans)) return false; return pids.every(id=>ans[id]===id)
}

// ============ EXPRESS SETUP ============
app.disable('x-powered-by')
if (IS_PROD) app.set('trust proxy', 1)
app.use((req,res,next)=>{ res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()'); res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"); next() })
app.use((req,res,next)=>{ if (req.path.startsWith('/api/')||req.path==='/admin.html'||req.path==='/login.html') { res.setHeader('Cache-Control','no-store'); res.setHeader('Pragma','no-cache') }; next() })
app.use(express.json({limit:'50kb'}))
app.use(express.urlencoded({extended:true,limit:'50kb'}))
app.use(session({name:'olimpiada.sid',secret:SESSION_SECRET,resave:false,saveUninitialized:false,rolling:true,cookie:{httpOnly:true,sameSite:'lax',secure:IS_PROD,maxAge:1000*60*60*8}}))
const EXCEL_MIME = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'])
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024},fileFilter:(req,file,cb)=>{ const ext=path.extname(String(file.originalname||'')).toLowerCase(); if (ext!=='.xlsx'||!EXCEL_MIME.has(String(file.mimetype||'').toLowerCase())) return cb(new Error('Faqat .xlsx formatdagi fayl.')); return cb(null,true) }})
function requireAuth(req,res,next) { if (req.session&&req.session.isAdmin) return next(); if (req.path.startsWith('/api/')) return res.status(401).json({success:false,message:'Avtorizatsiya talab qilinadi'}); return res.redirect('/login.html') }
app.get('/admin.html',requireAuth,(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')))
app.use(express.static(path.join(__dirname,'public')))

// ============ API ROUTES ============
app.post('/api/register',requireSameOrigin,limitReg,async(req,res)=>{
    try {
        const fn=nt(req.body.full_name,MAX_REGISTER_FIELD_LEN),dir=nt(req.body.direction,MAX_REGISTER_FIELD_LEN),course=nt(req.body.course,40),email=ne(req.body.email),phone=nt(req.body.phone,MAX_PHONE_LEN)
        if (!fn||!dir||!course||!email||!phone) return res.status(400).json({success:false,message:"Barcha maydonlarni to`ldiring"})
        if (!VALID_COURSES.has(course)) return res.status(400).json({success:false,message:"Kurs qiymati noto`g`ri"})
        if (!isEmail(email)) return res.status(400).json({success:false,message:'Email formati noto`g`ri'})
        if (!PHONE_REGEX.test(phone)) return res.status(400).json({success:false,message:'Telefon raqam formati noto`g`ri'})
        if (await Student.findOne({email:{$regex:new RegExp(`^${email}$`,'i')}})) return res.status(409).json({success:false,message:"Bu email allaqachon ro`yxatdan o`tgan"})
        const s=await Student.create({full_name:fn,direction:dir,course,email,phone})
        return res.json({success:true,message:"Muvaffaqiyatli ro`yxatdan o`tdingiz!",id:s._id})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

app.post('/api/login',requireSameOrigin,(req,res)=>{
    const user=nt(req.body.username,128),pass=nt(req.body.password,256),key=getIp(req),thr=checkLogin(key)
    if (thr.blocked) { res.setHeader('Retry-After',String(thr.retryAfterSec)); return res.status(429).json({success:false,message:"Ko'p urinish. "+thr.retryAfterSec+" soniyadan keyin."}) }
    if (!safeCmp(user,ADMIN_USER)||!safeCmp(pass,ADMIN_PASS)) { recordLogin(key); return res.status(401).json({success:false,message:"Login yoki parol noto`g`ri"}) }
    req.session.regenerate(err=>{ if(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}; req.session.isAdmin=true; clearLogin(key); return res.json({success:true}) })
})
app.post('/api/logout',requireSameOrigin,(req,res)=>{ req.session.destroy(()=>{res.clearCookie('olimpiada.sid');res.json({success:true})}) })
app.get('/api/me',(req,res)=>res.json({isAdmin:!!(req.session&&req.session.isAdmin)}))
app.get('/api/health',(req,res)=>res.json({success:true,status:'ok',now:new Date().toISOString(),uptimeSec:Math.round(process.uptime())}))

app.get('/api/students',requireAuth,async(req,res)=>{ const r=await Student.find().sort({created_at:-1}).lean(); res.json({success:true,data:r.map(x=>({...x,id:x._id}))}) })
app.delete('/api/students/:id',requireAuth,requireSameOrigin,async(req,res)=>{ try { const r=await Student.findByIdAndDelete(req.params.id); if(!r) return res.status(404).json({success:false,message:'Talaba topilmadi'}); res.json({success:true}) } catch { return res.status(400).json({success:false,message:'Noto`g`ri ID'}) } })

app.get('/api/export/excel',requireAuth,async(req,res)=>{
    const rows=await Student.find().sort({created_at:-1}).lean()
    const wb=new ExcelJS.Workbook(),sh=wb.addWorksheet('Talabalar')
    sh.columns=[{header:'#',key:'n',width:6},{header:'F.I.Sh',key:'fn',width:32},{header:"Yo'nalish",key:'dir',width:30},{header:'Kurs',key:'course',width:10},{header:'Email',key:'email',width:28},{header:'Telefon',key:'phone',width:18},{header:'Sana',key:'date',width:22}]
    sh.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; sh.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}
    rows.forEach((r,i)=>sh.addRow({n:i+1,fn:sanCell(r.full_name),dir:sanCell(r.direction),course:sanCell(r.course),email:sanCell(r.email),phone:sanCell(r.phone),date:r.created_at?new Date(r.created_at).toLocaleString('uz'):''}))
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition','attachment; filename="talabalar.xlsx"')
    await wb.xlsx.write(res); res.end()
})

app.get('/api/export/word',requireAuth,async(req,res)=>{
    const rows=await Student.find().sort({created_at:-1}).lean()
    const headers=['#','F.I.Sh',"Yo'nalish",'Kurs','Email','Telefon','Sana']
    const hRow=new TableRow({children:headers.map(h=>new TableCell({children:[new Paragraph({children:[new TextRun({text:h,bold:true,color:'FFFFFF'})],alignment:AlignmentType.CENTER})],shading:{fill:'1E3A8A'}}))})
    const dRows=rows.map((r,i)=>new TableRow({children:[String(i+1),r.full_name,r.direction,r.course,r.email,r.phone,r.created_at?new Date(r.created_at).toLocaleString('uz'):''].map(v=>new TableCell({children:[new Paragraph(String(v))]}))}))
    const doc=new Document({sections:[{children:[new Paragraph({text:'Simsiz tarmoqlar fanidan olimpiada',heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER}),new Paragraph({text:"Talabalar ro'yxati",heading:HeadingLevel.HEADING_2,alignment:AlignmentType.CENTER}),new Paragraph({text:' '}),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[hRow,...dRows]})]}]})
    const buf=await Packer.toBuffer(doc)
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition','attachment; filename="talabalar.docx"')
    res.send(buf)
})

app.post('/api/test/start',requireSameOrigin,limitStart,async(req,res)=>{
    try {
        const email=ne(req.body.email),mode=normMode(req.body.client_mode),lang=normLang(req.body.lang||'uz')
        if (!email||!isEmail(email)) return res.status(400).json({success:false,message:'Email kiriting'})
        const student=await Student.findOne({email:{$regex:new RegExp(`^${email}$`,'i')}})
        if (!student) return res.status(404).json({success:false,message:"Bu email ro'yxatdan o'tmagan. Avval ro'yxatdan o'ting."})
        const existing=await TestResult.findOne({student_id:student._id,finished_at:{$ne:null}})
        if (existing) return res.status(403).json({success:false,message:`Siz testni allaqachon topshirgansiz. Natijangiz: ${existing.score}/${existing.total}`,alreadyFinished:true,score:existing.score,total:existing.total})
        const qDocs=await QuestionBank.find().lean()
        const questions=qDocs.map(parseQRow).filter(q=>QUESTION_TYPES.has(q.questionType))
        if (!questions.length) return res.status(503).json({success:false,message:"Hozircha savollar yo'q."})
        const shuffled=shuffle(questions)
        const selected=TEST_QUESTION_COUNT>0?shuffled.slice(0,Math.min(TEST_QUESTION_COUNT,shuffled.length)):shuffled
        let attempt=await TestResult.findOne({student_id:student._id,finished_at:null})
        if (!attempt) {
            attempt=await TestResult.create({student_id:student._id,total:selected.length,question_order:selected.map(q=>q.id),attempt_token_hash:null,test_lang:lang})
        } else {
            if (Date.now()-new Date(attempt.started_at).getTime()>TEST_DURATION_MIN*60*1000) {
                await TestResult.findByIdAndUpdate(attempt._id,{finished_at:new Date(),score:0,attempt_token_hash:null,ended_reason:'time_expired_before_resume'})
                return res.status(403).json({success:false,message:'Test vaqti tugagan.',alreadyFinished:true,score:0,total:attempt.total})
            }
        }
        const tok=genTok(),tokHash=hashTok(tok)
        const upd={attempt_token_hash:tokHash,client_mode:mode,test_lang:lang}
        if (mode==='kiosk') upd.last_heartbeat_at=new Date(); else upd.last_heartbeat_at=null
        await TestResult.findByIdAndUpdate(attempt._id,upd)
        const ref=await TestResult.findById(attempt._id)
        const orderFromDb=Array.isArray(ref.question_order)?ref.question_order:[]
        if (!orderFromDb.length) return res.status(409).json({success:false,message:'Savollar tartibi buzilgan.'})
        const byId=new Map(questions.map(q=>[String(q.id),q]))
        const ordered=orderFromDb.map(id=>byId.get(String(id))).filter(Boolean)
        if (ordered.length!==orderFromDb.length) return res.status(409).json({success:false,message:'Savollar yangilangan.'})
        const endsAt=new Date(new Date(ref.started_at).getTime()+TEST_DURATION_MIN*60*1000).toISOString()
        return res.json({success:true,data:{attemptId:ref._id,attemptToken:tok,student:{full_name:student.full_name,email:student.email},durationMin:TEST_DURATION_MIN,endsAt,tabSwitchCount:parseNN(ref.tab_switch_count),antiCheat:{tabSwitchMaxAllowed:TAB_SWITCH_MAX_ALLOWED,heartbeatIntervalSec:KIOSK_HEARTBEAT_INTERVAL_SEC,heartbeatTimeoutSec:KIOSK_HEARTBEAT_TIMEOUT_SEC},questions:ordered.map(q=>serializeQTest(q,lang))}})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

async function resolveAttempt(idRaw, tokRaw) {
    const tok=nt(String(tokRaw||''),128)
    if (!idRaw||!tok) return {status:400,message:"Noto'g'ri urinish ma'lumoti"}
    let attempt; try { attempt=await TestResult.findById(idRaw) } catch { return {status:400,message:"Noto'g'ri ID"} }
    if (!attempt) return {status:404,message:'Urinish topilmadi'}
    if (attempt.finished_at) return {status:403,message:'Test allaqachon yakunlangan',finished:true}
    if (!attempt.attempt_token_hash) return {status:403,message:'Urinish tokeni yaroqsiz'}
    const tHash=hashTok(tok)
    if (!safeCmp(attempt.attempt_token_hash,tHash)) return {status:403,message:'Urinish tokeni yaroqsiz'}
    return {status:200,attempt,tokenHash:tHash}
}
async function finishPolicy({attemptId,tokenHash,reason,answersJson,securityEventsJson,tabSwitchCount}) {
    return !!(await TestResult.findOneAndUpdate({_id:attemptId,finished_at:null,attempt_token_hash:tokenHash},{score:0,answers_json:answersJson,finished_at:new Date(),attempt_token_hash:null,ended_reason:reason,security_events_json:securityEventsJson,tab_switch_count:tabSwitchCount}))
}

app.post('/api/test/event',requireSameOrigin,limitEvent,async(req,res)=>{
    try {
        const ev=nt(String(req.body.eventType||'').toLowerCase(),40),det=nt(String(req.body.details||''),MAX_SECURITY_EVENT_DETAILS)
        if (!SECURITY_EVENT_TYPES.has(ev)) return res.status(400).json({success:false,message:"Noto'g'ri hodisa"})
        const r=await resolveAttempt(req.body.attemptId,req.body.attemptToken)
        if (r.status!==200) return res.status(r.status).json({success:false,message:r.message,finished:r.finished})
        const {attempt,tokenHash}=r
        let tc=parseNN(attempt.tab_switch_count)
        if (ev==='tab_hidden'||ev==='kiosk_focus_lost') tc+=1
        const sev=appendSec(attempt.security_events_json,{type:ev,at:new Date().toISOString(),details:det||undefined})
        if (tc>=TAB_SWITCH_MAX_ALLOWED) {
            const reason=ev==='kiosk_focus_lost'?'kiosk_focus_limit':'tab_switch_limit'
            const fin=await finishPolicy({attemptId:attempt._id,tokenHash,reason,answersJson:attempt.answers_json||{},securityEventsJson:sev,tabSwitchCount:tc})
            if (!fin) return res.status(409).json({success:false,message:'Urinish holati yangilangan.'})
            return res.json({success:true,data:{tabSwitchCount:tc,maxAllowed:TAB_SWITCH_MAX_ALLOWED,autoFinished:true,result:{score:0,total:attempt.total,percentage:0,timedOut:false,endedByPolicy:true,reason:reason==='tab_switch_limit'?'Tab almashish limiti oshib ketdi.':"Kiosk fokus limiti oshib ketdi."}}})
        }
        const upd={tab_switch_count:tc,security_events_json:sev}
        if (attempt.client_mode==='kiosk') upd.last_heartbeat_at=new Date()
        if (!await TestResult.findOneAndUpdate({_id:attempt._id,finished_at:null,attempt_token_hash:tokenHash},upd)) return res.status(409).json({success:false,message:'Urinish holati yangilangan.'})
        return res.json({success:true,data:{tabSwitchCount:tc,maxAllowed:TAB_SWITCH_MAX_ALLOWED,autoFinished:false}})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

app.post('/api/test/heartbeat',requireSameOrigin,limitEvent,async(req,res)=>{
    try {
        const r=await resolveAttempt(req.body.attemptId,req.body.attemptToken)
        if (r.status!==200) return res.status(r.status).json({success:false,message:r.message,finished:r.finished})
        if (!await TestResult.findOneAndUpdate({_id:r.attempt._id,finished_at:null,attempt_token_hash:r.tokenHash},{last_heartbeat_at:new Date()})) return res.status(409).json({success:false,message:'Heartbeat saqlanmadi.'})
        return res.json({success:true,data:{heartbeatTimeoutSec:KIOSK_HEARTBEAT_TIMEOUT_SEC}})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

app.post('/api/test/force-finish',requireSameOrigin,limitEvent,async(req,res)=>{
    try {
        const r=await resolveAttempt(req.body.attemptId,req.body.attemptToken)
        if (r.status!==200) return res.status(r.status).json({success:false,message:r.message,finished:r.finished})
        const {attempt,tokenHash}=r
        const rawR=nt(String(req.body.reason||''),50).toLowerCase()
        const reason=FORCE_FINISH_REASONS.has(rawR)?rawR:'kiosk_policy'
        const det=nt(String(req.body.details||''),MAX_SECURITY_EVENT_DETAILS)
        const tc=parseNN(attempt.tab_switch_count)
        const sev=appendSec(attempt.security_events_json,{type:reason,at:new Date().toISOString(),details:det||undefined})
        if (!await finishPolicy({attemptId:attempt._id,tokenHash,reason,answersJson:attempt.answers_json||{},securityEventsJson:sev,tabSwitchCount:tc})) return res.status(409).json({success:false,message:'Urinish allaqachon yakunlangan.'})
        return res.json({success:true,data:{score:0,total:attempt.total,percentage:0,timedOut:false,endedByPolicy:true,reason:"Kiosk siyosati bo'yicha test yakunlandi.",ended_reason:reason}})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

app.post('/api/test/submit',requireSameOrigin,limitSubmit,async(req,res)=>{
    try {
        const tok=nt(String(req.body.attemptToken||''),128),answers=req.body.answers,lang=normLang(req.body.lang||'uz')
        if (!req.body.attemptId||!tok||!isObj(answers)) return res.status(400).json({success:false,message:"Noto'g'ri ma'lumot"})
        let attempt; try { attempt=await TestResult.findById(req.body.attemptId) } catch { return res.status(400).json({success:false,message:"Noto'g'ri ID"}) }
        if (!attempt) return res.status(404).json({success:false,message:'Urinish topilmadi'})
        if (attempt.finished_at) return res.status(403).json({success:false,message:'Test allaqachon topshirilgan'})
        if (!attempt.attempt_token_hash) return res.status(403).json({success:false,message:'Urinish tokeni yaroqsiz'})
        const tHash=hashTok(tok)
        if (!safeCmp(attempt.attempt_token_hash,tHash)) return res.status(403).json({success:false,message:'Urinish tokeni yaroqsiz'})
        const testLang = attempt.test_lang || lang
        const timedOut=Date.now()-new Date(attempt.started_at).getTime()>(TEST_DURATION_MIN+1)*60*1000
        const order=Array.isArray(attempt.question_order)?attempt.question_order:[]
        if (!order.length) return res.status(400).json({success:false,message:'Savollar tartibi buzilgan'})
        const qDocs=await QuestionBank.find({_id:{$in:order}}).lean()
        const byId=new Map(qDocs.map(q=>[String(q._id),parseQRow(q)]))
        if (!qDocs.length) return res.status(400).json({success:false,message:'Savollar topilmadi'})
        const cleaned={};let score=0
        for (const qId of order) { const q=byId.get(String(qId)); if (!q) continue; const raw=answers[String(qId)]; const norm=normAnswer(q,raw); if (norm!==null) cleaned[String(qId)]=norm; if (isCorrect(q,norm,lang)) score++ }
        if (timedOut) score=0
        if (!await TestResult.findOneAndUpdate({_id:attempt._id,finished_at:null,attempt_token_hash:tHash},{score,answers_json:cleaned,finished_at:new Date(),attempt_token_hash:null,ended_reason:timedOut?'time_expired':'submitted',test_lang:testLang})) return res.status(409).json({success:false,message:'Test natijasi allaqachon saqlangan'})
        return res.json({success:true,data:{score,total:attempt.total,percentage:attempt.total?Math.round((score/attempt.total)*100):0,timedOut}})
    } catch(err){console.error(err);return res.status(500).json({success:false,message:'Server xatosi'})}
})

app.get('/api/admin/questions',requireAuth,async(req,res)=>{ const r=await QuestionBank.find().sort({_id:-1}).lean(); res.json({success:true,data:r.map(parseQRow).map(serializeQAdmin)}) })
app.post('/api/admin/questions',requireAuth,requireSameOrigin,async(req,res)=>{ const p=parseQPayload(req.body); if (p.error) return res.status(400).json({success:false,message:p.error}); const q=await QuestionBank.create({text:p.value.text,question_type:p.value.questionType,question_payload:p.value.questionPayload,correct_answer_json:p.value.correctAnswer}); res.json({success:true,id:q._id}) })
app.put('/api/admin/questions/:id',requireAuth,requireSameOrigin,async(req,res)=>{ const p=parseQPayload(req.body); if (p.error) return res.status(400).json({success:false,message:p.error}); try { const u=await QuestionBank.findByIdAndUpdate(req.params.id,{text:p.value.text,question_type:p.value.questionType,question_payload:p.value.questionPayload,correct_answer_json:p.value.correctAnswer}); if (!u) return res.status(404).json({success:false,message:'Savol topilmadi'}); res.json({success:true}) } catch { return res.status(400).json({success:false,message:'Noto`g`ri ID'}) } })
app.delete('/api/admin/questions/:id',requireAuth,requireSameOrigin,async(req,res)=>{ try { const r=await QuestionBank.findByIdAndDelete(req.params.id); if (!r) return res.status(404).json({success:false,message:'Savol topilmadi'}); res.json({success:true}) } catch { return res.status(400).json({success:false,message:'Noto`g`ri ID'}) } })

app.post('/api/admin/questions/import',requireAuth,requireSameOrigin,upload.single('file'),async(req,res)=>{
    try {
        if (!req.file) return res.status(400).json({success:false,message:'Fayl yuklanmagan'})
        const wb=new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer)
        const sh=wb.worksheets[0]; if (!sh) return res.status(400).json({success:false,message:"Excel fayl bo'sh"})
        let added=0,errors=0; const rows=[]
        sh.eachRow((row,rn)=>{
            if (rn===1) return; if (rows.length>=MAX_IMPORT_ROWS){errors++;return}
            const g=(n)=>nt(String(row.getCell(n).text||''),MAX_QUESTION_LEN)
            const go=(n)=>nt(String(row.getCell(n).text||''),MAX_OPTION_LEN)
            const tUz=g(1),tRu=g(2),aUz=go(3),aRu=go(4),bUz=go(5),bRu=go(6),cUz=go(7),cRu=go(8),dUz=go(9),dRu=go(10),cor=nt(String(row.getCell(11).text||'').toUpperCase(),1)
            if (tUz&&tRu&&aUz&&aRu&&bUz&&bRu&&cUz&&cRu&&dUz&&dRu&&VALID_OPTIONS.has(cor)) rows.push({tUz,tRu,aUz,aRu,bUz,bRu,cUz,cRu,dUz,dRu,cor})
            else errors++
        })
        for (const r of rows) { try { await QuestionBank.create({text:{uz:r.tUz,ru:r.tRu},question_type:'single_choice',question_payload:{options:{A:{uz:r.aUz,ru:r.aRu},B:{uz:r.bUz,ru:r.bRu},C:{uz:r.cUz,ru:r.cRu},D:{uz:r.dUz,ru:r.dRu}}},correct_answer_json:{correctOption:r.cor}}); added++ } catch { errors++ } }
        res.json({success:true,added,errors,message:`${added} ta savol qo'shildi${errors?', '+errors+' ta xato':''}`})
    } catch(err){console.error(err);res.status(500).json({success:false,message:"Excel faylni o'qishda xatolik"})}
})

app.get('/api/admin/questions/template',requireAuth,async(req,res)=>{
    const wb=new ExcelJS.Workbook(),sh=wb.addWorksheet('Savollar')
    sh.columns=[{header:'Savol (UZ)',key:'t1',width:40},{header:'Savol (RU)',key:'t2',width:40},{header:'A (UZ)',key:'a1',width:20},{header:'A (RU)',key:'a2',width:20},{header:'B (UZ)',key:'b1',width:20},{header:'B (RU)',key:'b2',width:20},{header:'C (UZ)',key:'c1',width:20},{header:'C (RU)',key:'c2',width:20},{header:'D (UZ)',key:'d1',width:20},{header:'D (RU)',key:'d2',width:20},{header:"To'g'ri (A/B/C/D)",key:'cor',width:20}]
    sh.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; sh.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}
    sh.addRow({t1:'Wi-Fi qaysi IEEE standartida ishlaydi?',t2:'По какому стандарту IEEE работает Wi-Fi?',a1:'802.3',a2:'802.3',b1:'802.11',b2:'802.11',c1:'802.15',c2:'802.15',d1:'802.16',d2:'802.16',cor:'B'})
    sh.addRow({t1:'Bluetooth qaysi chastotada ishlaydi?',t2:'На какой частоте работает Bluetooth?',a1:'900 MHz',a2:'900 МГц',b1:'1.8 GHz',b2:'1.8 ГГц',c1:'2.4 GHz',c2:'2.4 ГГц',d1:'5 GHz',d2:'5 ГГц',cor:'C'})
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition','attachment; filename="shablon-ikki-tilli.xlsx"')
    await wb.xlsx.write(res); res.end()
})

app.get('/api/admin/results',requireAuth,async(req,res)=>{ const r=await TestResult.find().populate('student_id','full_name direction course email phone').sort({finished_at:-1,started_at:-1}).lean(); res.json({success:true,data:r.map(x=>({id:x._id,score:x.score,total:x.total,started_at:x.started_at,finished_at:x.finished_at,tab_switch_count:x.tab_switch_count,ended_reason:x.ended_reason,client_mode:x.client_mode,test_lang:x.test_lang,full_name:x.student_id?.full_name,direction:x.student_id?.direction,course:x.student_id?.course,email:x.student_id?.email,phone:x.student_id?.phone}))}) })

app.get('/api/admin/results/excel',requireAuth,async(req,res)=>{
    const rows=await TestResult.find({finished_at:{$ne:null}}).populate('student_id','full_name direction course email phone').sort({score:-1,finished_at:1}).lean()
    const wb=new ExcelJS.Workbook(),sh=wb.addWorksheet('Natijalar')
    sh.columns=[{header:'#',key:'n',width:6},{header:'F.I.Sh',key:'fn',width:30},{header:"Yo'nalish",key:'dir',width:28},{header:'Kurs',key:'course',width:10},{header:'Email',key:'email',width:26},{header:'Telefon',key:'phone',width:18},{header:'Ball',key:'score',width:10},{header:'Jami',key:'total',width:10},{header:'%',key:'pct',width:8},{header:'Rejim',key:'mode',width:10},{header:'Tab',key:'tab',width:10},{header:'Sabab',key:'reason',width:22},{header:'Boshlangan',key:'start',width:20},{header:'Tugatgan',key:'end',width:20}]
    sh.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; sh.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}
    rows.forEach((r,i)=>{ const s=r.student_id||{}; sh.addRow({n:i+1,fn:sanCell(s.full_name||''),dir:sanCell(s.direction||''),course:sanCell(s.course||''),email:sanCell(s.email||''),phone:sanCell(s.phone||''),score:r.score,total:r.total,pct:r.total?Math.round((r.score/r.total)*100)+'%':'-',mode:sanCell(r.client_mode||'web'),tab:parseNN(r.tab_switch_count),reason:sanCell(r.ended_reason||'submitted'),start:r.started_at?new Date(r.started_at).toLocaleString('uz'):'',end:r.finished_at?new Date(r.finished_at).toLocaleString('uz'):''}) })
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition','attachment; filename="natijalar.xlsx"')
    await wb.xlsx.write(res); res.end()
})

app.get('/api/verify/:id',async(req,res)=>{
    const result = await getCertificateRecord(req.params.id)
    if (!result) return res.status(404).json({success:false,message:'Sertifikat topilmadi'})
    const student = result.student_id
    const lang = VALID_LANGS.has(result.test_lang) ? result.test_lang : 'uz'
    return res.json({
        success: true,
        data: {
            id: result._id,
            full_name: student.full_name,
            direction: student.direction,
            course: student.course,
            email: student.email,
            phone: student.phone,
            finished_at: result.finished_at,
            lang
        }
    })
})

app.get('/verify/:id',async(req,res)=>{
    const result = await getCertificateRecord(req.params.id)
    if (!result) return res.status(404).send('Not found')
    const student = result.student_id
    const lang = VALID_LANGS.has(result.test_lang) ? result.test_lang : 'uz'
    const date = formatDate(result.finished_at || result.started_at)
    const title = lang === 'ru' ? 'Сертификат подтвержден' : 'Sertifikat tasdiqlandi'
    const subtitle = lang === 'ru' ? 'Проверка участия в олимпиаде' : 'Olimpiadada qatnashganlik tasdig\'i'
    const labelName = lang === 'ru' ? 'Ф.И.О.' : 'F.I.Sh'
    const labelDirection = lang === 'ru' ? 'Направление' : "Yo'nalish"
    const labelCourse = lang === 'ru' ? 'Курс' : 'Kurs'
    const labelDate = lang === 'ru' ? 'Дата' : 'Sana'
    const labelId = lang === 'ru' ? 'ID сертификата' : 'Sertifikat ID'
    const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 40px; color: #0f172a; }
    .card { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 28px 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    .sub { margin: 0 0 18px; color: #475569; }
    dl { display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; margin: 0; }
    dt { font-weight: 700; color: #334155; }
    dd { margin: 0; color: #0f172a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    <dl>
      <dt>${labelName}</dt><dd>${escapeHtml(student.full_name || '-')}</dd>
      <dt>${labelDirection}</dt><dd>${escapeHtml(student.direction || '-')}</dd>
      <dt>${labelCourse}</dt><dd>${escapeHtml(student.course || '-')}</dd>
      <dt>${labelDate}</dt><dd>${escapeHtml(date || '-')}</dd>
      <dt>${labelId}</dt><dd>${escapeHtml(result._id)}</dd>
    </dl>
  </div>
</body>
</html>`
    res.setHeader('Content-Type','text/html; charset=utf-8')
    return res.send(html)
})

app.get('/api/admin/certificates/:id.png',requireAuth,async(req,res)=>{
    try {
        const result = await getCertificateRecord(req.params.id)
        if (!result) return res.status(404).json({success:false,message:'Sertifikat topilmadi'})
        const student = result.student_id
        const lang = VALID_LANGS.has(result.test_lang) ? result.test_lang : 'uz'
        const variant = parseVariant(req.query.variant)
        const baseUrl = `${req.protocol}://${req.get('host')}`
        const verifyUrl = `${baseUrl}/verify/${result._id}`
        const png = await renderCertificatePng({ student, result, lang, variant, verifyUrl })
        res.setHeader('Content-Type','image/png')
        res.setHeader('Content-Disposition',`attachment; filename="sertifikat-${result._id}.png"`)
        return res.send(png)
    } catch (err) {
        console.error(err)
        const debug = String(req.query.debug || '') === '1'
        return res.status(500).json({success:false,message:'Server xatosi',detail:debug?String(err&&err.message?err.message:err):undefined})
    }
})

app.get('/api/admin/certificates/zip',requireAuth,async(req,res)=>{
    try {
        const variant = parseVariant(req.query.variant)
        const rows = await TestResult.find({finished_at:{$ne:null}})
            .populate('student_id','full_name direction course email phone')
            .sort({finished_at:-1})
            .lean()
        if (!rows.length) return res.status(404).json({success:false,message:'Tugallangan testlar topilmadi'})
        res.setHeader('Content-Type','application/zip')
        res.setHeader('Content-Disposition','attachment; filename="sertifikatlar.zip"')
        const archive = archiver('zip', { zlib: { level: 9 } })
        archive.on('error', (err) => {
            console.error(err)
            if (!res.headersSent) res.status(500).json({success:false,message:'Server xatosi'})
        })
        archive.pipe(res)
        const baseUrl = `${req.protocol}://${req.get('host')}`
        for (const result of rows) {
            if (!result.student_id) continue
            const student = result.student_id
            const lang = VALID_LANGS.has(result.test_lang) ? result.test_lang : 'uz'
            const verifyUrl = `${baseUrl}/verify/${result._id}`
            const png = await renderCertificatePng({ student, result, lang, variant, verifyUrl })
            const fileName = `${slugify(student.full_name)}-${result._id}.png`
            archive.append(png, { name: fileName })
        }
        await archive.finalize()
    } catch (err) {
        console.error(err)
        if (!res.headersSent) return res.status(500).json({success:false,message:'Server xatosi'})
    }
})

async function watchdog() {
    try {
        const now=Date.now(),timeout=KIOSK_HEARTBEAT_TIMEOUT_SEC*1000
        const attempts=await TestResult.find({finished_at:null,client_mode:'kiosk',attempt_token_hash:{$ne:null}})
        for (const a of attempts) { const hb=a.last_heartbeat_at?new Date(a.last_heartbeat_at).getTime():new Date(a.started_at).getTime(); if (!hb||now-hb<=timeout) continue; await TestResult.findOneAndUpdate({_id:a._id,finished_at:null,client_mode:'kiosk'},{score:0,finished_at:new Date(),attempt_token_hash:null,ended_reason:'kiosk_heartbeat_lost',security_events_json:appendSec(a.security_events_json,{type:'kiosk_heartbeat_lost',at:new Date().toISOString(),details:'watchdog-timeout'}),tab_switch_count:parseNN(a.tab_switch_count)}) }
    } catch(err){console.error('Watchdog xatosi:',err)}
}

app.use((err,req,res,next)=>{ if (err instanceof multer.MulterError) { if (err.code==='LIMIT_FILE_SIZE') return res.status(400).json({success:false,message:'Fayl 2 MB dan oshmasligi kerak'}); return res.status(400).json({success:false,message:'Faylni yuklashda xatolik'}) }; if (err&&err.message==='Faqat .xlsx formatdagi fayl.') return res.status(400).json({success:false,message:err.message}); if (err) { console.error(err); return res.status(500).json({success:false,message:'Server xatosi'}) }; return next() })

async function startServer() {
    await mongoose.connect(MONGODB_URI||'mongodb://localhost:27017/olimpiada')
    console.log('MongoDB ga ulandi!')
    const t=setInterval(watchdog,WATCHDOG_INTERVAL_MS)
    if (typeof t.unref==='function') t.unref()
    app.listen(PORT,()=>{ console.log(`\n  Olimpiada server (MongoDB + Ikki tilli)\n  http://localhost:${PORT}\n  Test: ${TEST_DURATION_MIN} daqiqa, ${TEST_QUESTION_COUNT||'barcha'} savol\n`) })
}
startServer().catch(err=>{ console.error('Server ishga tushmadi:',err); process.exit(1) })
