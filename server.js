const express = require('express')
const session = require('express-session')
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType } = require('docx')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000
const IS_PROD = process.env.NODE_ENV === 'production'

const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'Ar$20020604Mat'
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-key-change-this-in-production-environments-now'

const MIN_TEST_DURATION = 5
const MAX_TEST_DURATION = 180
const parsedDuration = Number.parseInt(process.env.TEST_DURATION_MIN || '30', 10)
const TEST_DURATION_MIN = Number.isInteger(parsedDuration) && parsedDuration >= MIN_TEST_DURATION && parsedDuration <= MAX_TEST_DURATION ? parsedDuration : 30

const PHONE_REGEX = /^[+\d\s()-]{7,20}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_OPTIONS = new Set(['A', 'B', 'C', 'D'])
const QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'text_input', 'matching'])
const VALID_COURSES = new Set(['1-kurs', '2-kurs', '3-kurs', '4-kurs', 'Magistratura'])
const MAX_REGISTER_FIELD_LEN = 120
const MAX_PHONE_LEN = 20
const MAX_QUESTION_LEN = 500
const MAX_OPTION_LEN = 250
const MAX_IMPORT_ROWS = 1000
const MAX_TEXT_ANSWERS = 10
const MAX_MATCHING_PAIRS = 10
const ATTEMPT_TOKEN_BYTES = 32
const MAX_SECURITY_EVENT_DETAILS = 300
const MAX_SECURITY_EVENTS_STORED = 200

const MIN_TAB_SWITCH_LIMIT = 1
const MAX_TAB_SWITCH_LIMIT = 20
const DEFAULT_TAB_SWITCH_LIMIT = 2
const parsedTabSwitchLimit = Number.parseInt(process.env.TAB_SWITCH_MAX_ALLOWED || String(DEFAULT_TAB_SWITCH_LIMIT), 10)
const TAB_SWITCH_MAX_ALLOWED =
    Number.isInteger(parsedTabSwitchLimit) && parsedTabSwitchLimit >= MIN_TAB_SWITCH_LIMIT && parsedTabSwitchLimit <= MAX_TAB_SWITCH_LIMIT
        ? parsedTabSwitchLimit
        : DEFAULT_TAB_SWITCH_LIMIT

const parsedQuestionSubset = Number.parseInt(process.env.TEST_QUESTION_COUNT || '0', 10)
const TEST_QUESTION_COUNT = Number.isInteger(parsedQuestionSubset) && parsedQuestionSubset > 0 ? parsedQuestionSubset : 0

const MIN_HEARTBEAT_TIMEOUT_SEC = 20
const MAX_HEARTBEAT_TIMEOUT_SEC = 600
const DEFAULT_HEARTBEAT_TIMEOUT_SEC = 90
const parsedHeartbeatTimeoutSec = Number.parseInt(process.env.KIOSK_HEARTBEAT_TIMEOUT_SEC || String(DEFAULT_HEARTBEAT_TIMEOUT_SEC), 10)
const KIOSK_HEARTBEAT_TIMEOUT_SEC =
    Number.isInteger(parsedHeartbeatTimeoutSec) &&
    parsedHeartbeatTimeoutSec >= MIN_HEARTBEAT_TIMEOUT_SEC &&
    parsedHeartbeatTimeoutSec <= MAX_HEARTBEAT_TIMEOUT_SEC
        ? parsedHeartbeatTimeoutSec
        : DEFAULT_HEARTBEAT_TIMEOUT_SEC

const MIN_HEARTBEAT_INTERVAL_SEC = 3
const MAX_HEARTBEAT_INTERVAL_SEC = 60
const DEFAULT_HEARTBEAT_INTERVAL_SEC = 8
const parsedHeartbeatIntervalSec = Number.parseInt(process.env.KIOSK_HEARTBEAT_INTERVAL_SEC || String(DEFAULT_HEARTBEAT_INTERVAL_SEC), 10)
const KIOSK_HEARTBEAT_INTERVAL_SEC =
    Number.isInteger(parsedHeartbeatIntervalSec) &&
    parsedHeartbeatIntervalSec >= MIN_HEARTBEAT_INTERVAL_SEC &&
    parsedHeartbeatIntervalSec <= MAX_HEARTBEAT_INTERVAL_SEC
        ? parsedHeartbeatIntervalSec
        : DEFAULT_HEARTBEAT_INTERVAL_SEC

const WATCHDOG_INTERVAL_MS = 15000

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 7
const loginAttempts = new Map()

const REGISTER_RATE_WINDOW_MS = 15 * 60 * 1000
const REGISTER_RATE_MAX = 10
const TEST_START_RATE_WINDOW_MS = 15 * 60 * 1000
const TEST_START_RATE_MAX = 20
const TEST_SUBMIT_RATE_WINDOW_MS = 15 * 60 * 1000
const TEST_SUBMIT_RATE_MAX = 40
const TEST_EVENT_RATE_WINDOW_MS = 15 * 60 * 1000
const TEST_EVENT_RATE_MAX = 120

const registerRequests = new Map()
const testStartRequests = new Map()
const testSubmitRequests = new Map()
const testEventRequests = new Map()

const CLIENT_MODES = new Set(['web', 'kiosk'])
const SECURITY_EVENT_TYPES = new Set([
    'tab_hidden',
    'window_blur',
    'copy_block',
    'contextmenu_block',
    'shortcut_block',
    'printscreen_block',
    'kiosk_focus_lost',
    'kiosk_app_closed',
    'kiosk_heartbeat_lost',
    'kiosk_host_force_finish',
])

const FORCE_FINISH_REASONS = new Set([
    'kiosk_focus_lost',
    'kiosk_app_closed',
    'kiosk_heartbeat_lost',
    'kiosk_host_force_finish',
    'kiosk_policy',
])

if (IS_PROD) {
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
        throw new Error('ADMIN_USER va ADMIN_PASS production muhitida majburiy.')
    }
    if (process.env.ADMIN_PASS.length < 12) {
        throw new Error('ADMIN_PASS production muhitida kamida 12 belgidan iborat bo`lishi kerak.')
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        throw new Error('SESSION_SECRET production muhitida kamida 32 belgidan iborat bo`lishi kerak.')
    }
}

if (ADMIN_USER === 'admin' || ADMIN_PASS === 'admin123') {
    console.warn("WARNING: Default admin credentials ishlatilmoqda. Xavfsizlik uchun o`zgartiring.")
}
if (SESSION_SECRET.startsWith('dev-only-')) {
    console.warn('WARNING: Default SESSION_SECRET ishlatilmoqda. Xavfsizlik uchun o`zgartiring.')
}

const EXCEL_MIME_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
])

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(String(file.originalname || '')).toLowerCase()
        const mimeOk = EXCEL_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())
        if (ext !== '.xlsx' || !mimeOk) {
            return cb(new Error('Faqat .xlsx formatdagi fayl yuklash mumkin.'))
        }
        return cb(null, true)
    },
})

const resolvedDbPath = process.env.SQLITE_DB_PATH
    ? path.resolve(String(process.env.SQLITE_DB_PATH))
    : path.join(__dirname, 'olimpiada.db')
fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true })
const db = new Database(resolvedDbPath)
db.exec(`
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        direction TEXT NOT NULL,
        course TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option TEXT NOT NULL CHECK(correct_option IN ('A','B','C','D')),
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS question_bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        question_type TEXT NOT NULL,
        question_payload TEXT NOT NULL,
        correct_answer_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        score INTEGER,
        total INTEGER,
        answers_json TEXT,
        question_order TEXT,
        attempt_token_hash TEXT,
        tab_switch_count INTEGER DEFAULT 0,
        security_events_json TEXT,
        client_mode TEXT,
        last_heartbeat_at TEXT,
        ended_reason TEXT,
        started_at TEXT DEFAULT (datetime('now', 'localtime')),
        finished_at TEXT,
        FOREIGN KEY (student_id) REFERENCES students(id)
    );

    CREATE INDEX IF NOT EXISTS idx_students_email_nocase ON students(email COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_test_results_student_id ON test_results(student_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_finished_at ON test_results(finished_at);
    CREATE INDEX IF NOT EXISTS idx_question_bank_type ON question_bank(question_type);
`)

ensureColumnIfMissing('test_results', 'attempt_token_hash', 'TEXT')
ensureColumnIfMissing('test_results', 'tab_switch_count', 'INTEGER DEFAULT 0')
ensureColumnIfMissing('test_results', 'security_events_json', 'TEXT')
ensureColumnIfMissing('test_results', 'client_mode', 'TEXT')
ensureColumnIfMissing('test_results', 'last_heartbeat_at', 'TEXT')
ensureColumnIfMissing('test_results', 'ended_reason', 'TEXT')
migrateLegacyQuestionsToQuestionBank()

function ensureColumnIfMissing(tableName, columnName, columnType) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
    const exists = columns.some((c) => c.name === columnName)
    if (!exists) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
    }
}

function migrateLegacyQuestionsToQuestionBank() {
    const existing = db.prepare('SELECT COUNT(*) AS c FROM question_bank').get()
    if ((existing && existing.c) > 0) return

    const legacyExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'").get()
    if (!legacyExists) return

    const legacyRows = db
        .prepare('SELECT id, text, option_a, option_b, option_c, option_d, correct_option, created_at FROM questions ORDER BY id ASC')
        .all()
    if (!legacyRows.length) return

    const insert = db.prepare(
        'INSERT INTO question_bank (id, text, question_type, question_payload, correct_answer_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )

    const migrate = db.transaction((rows) => {
        rows.forEach((r) => {
            const payload = {
                options: {
                    A: String(r.option_a || ''),
                    B: String(r.option_b || ''),
                    C: String(r.option_c || ''),
                    D: String(r.option_d || ''),
                },
            }
            const answer = { correctOption: String(r.correct_option || 'A') }
            insert.run(r.id, String(r.text || ''), 'single_choice', JSON.stringify(payload), JSON.stringify(answer), r.created_at)
        })
    })

    migrate(legacyRows)
}

function normalizeText(value, maxLength) {
    if (typeof value !== 'string') return ''
    return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}

function normalizeEmail(value) {
    return normalizeText(value, 254).toLowerCase()
}

function isValidEmail(value) {
    return EMAIL_REGEX.test(value) && value.length <= 254
}

function parsePositiveInt(value) {
    const n = Number.parseInt(value, 10)
    return Number.isInteger(n) && n > 0 ? n : null
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function generateAttemptToken() {
    return crypto.randomBytes(ATTEMPT_TOKEN_BYTES).toString('hex')
}

function safeStringCompare(a, b) {
    const aBuf = Buffer.from(String(a))
    const bBuf = Buffer.from(String(b))
    if (aBuf.length !== bBuf.length) return false
    return crypto.timingSafeEqual(aBuf, bBuf)
}

function sanitizeSpreadsheetCell(value) {
    if (typeof value !== 'string') return value
    const trimmedStart = value.trimStart()
    if (!trimmedStart) return value
    if (/^[=+\-@]/.test(trimmedStart)) {
        return `'${value}`
    }
    return value
}

function shuffleArray(items) {
    const arr = [...items]
    for (let i = arr.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1)
        const temp = arr[i]
        arr[i] = arr[j]
        arr[j] = temp
    }
    return arr
}

function getRequestHost(req) {
    return String(req.get('host') || '')
}

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.trim()) {
        return xff.split(',')[0].trim()
    }
    return req.ip || req.socket.remoteAddress || 'unknown'
}

function isHeaderSameOrigin(urlValue, host) {
    try {
        return new URL(urlValue).host === host
    } catch {
        return false
    }
}

function requireSameOrigin(req, res, next) {
    const host = getRequestHost(req)
    const origin = req.get('origin')
    const referer = req.get('referer')

    if (origin) {
        if (!isHeaderSameOrigin(origin, host)) {
            return res.status(403).json({ success: false, message: "Noto`g`ri so`rov manbasi" })
        }
        return next()
    }

    if (referer) {
        if (!isHeaderSameOrigin(referer, host)) {
            return res.status(403).json({ success: false, message: "Noto`g`ri so`rov manbasi" })
        }
        return next()
    }

    return res.status(403).json({ success: false, message: "So`rov manbasi aniqlanmadi" })
}

function getLoginKey(req) {
    return getClientIp(req)
}

function cleanupLoginAttempts(now = Date.now()) {
    for (const [key, entry] of loginAttempts.entries()) {
        if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
            loginAttempts.delete(key)
        }
    }
}

function checkLoginThrottle(key) {
    const now = Date.now()
    cleanupLoginAttempts(now)
    const entry = loginAttempts.get(key)
    if (!entry) return { blocked: false }

    const elapsed = now - entry.firstAttemptAt
    if (elapsed > LOGIN_WINDOW_MS) {
        loginAttempts.delete(key)
        return { blocked: false }
    }

    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        return { blocked: true, retryAfterSec: Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000) }
    }

    return { blocked: false }
}

function recordLoginFailure(key) {
    const now = Date.now()
    const entry = loginAttempts.get(key)
    if (!entry || now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
        loginAttempts.set(key, { count: 1, firstAttemptAt: now })
        return
    }
    entry.count += 1
}

function clearLoginFailures(key) {
    loginAttempts.delete(key)
}

function cleanupRateLimitMap(map, windowMs, now = Date.now()) {
    for (const [key, entry] of map.entries()) {
        if (now - entry.firstRequestAt > windowMs) {
            map.delete(key)
        }
    }
}

function checkAndUpdateFixedWindow(map, key, maxRequests, windowMs) {
    const now = Date.now()
    cleanupRateLimitMap(map, windowMs, now)

    const entry = map.get(key)
    if (!entry) {
        map.set(key, { count: 1, firstRequestAt: now })
        return { blocked: false }
    }

    const elapsed = now - entry.firstRequestAt
    if (elapsed > windowMs) {
        map.set(key, { count: 1, firstRequestAt: now })
        return { blocked: false }
    }

    if (entry.count >= maxRequests) {
        return { blocked: true, retryAfterSec: Math.ceil((windowMs - elapsed) / 1000) }
    }

    entry.count += 1
    return { blocked: false }
}

function createIpRateLimiter(map, maxRequests, windowMs, message) {
    return (req, res, next) => {
        const key = getClientIp(req)
        const status = checkAndUpdateFixedWindow(map, key, maxRequests, windowMs)
        if (status.blocked) {
            res.setHeader('Retry-After', String(status.retryAfterSec))
            return res.status(429).json({ success: false, message })
        }
        return next()
    }
}

const limitRegisterRequests = createIpRateLimiter(
    registerRequests,
    REGISTER_RATE_MAX,
    REGISTER_RATE_WINDOW_MS,
    "Ro`yxatdan o`tish so`rovlari ko`payib ketdi. Keyinroq qayta urinib ko`ring."
)

const limitTestStartRequests = createIpRateLimiter(
    testStartRequests,
    TEST_START_RATE_MAX,
    TEST_START_RATE_WINDOW_MS,
    'Testni boshlash so`rovlari ko`payib ketdi. Keyinroq urinib ko`ring.'
)

const limitTestSubmitRequests = createIpRateLimiter(
    testSubmitRequests,
    TEST_SUBMIT_RATE_MAX,
    TEST_SUBMIT_RATE_WINDOW_MS,
    'Juda ko`p yakunlash so`rovi yuborildi. Keyinroq urinib ko`ring.'
)

const limitTestEventRequests = createIpRateLimiter(
    testEventRequests,
    TEST_EVENT_RATE_MAX,
    TEST_EVENT_RATE_WINDOW_MS,
    'Juda ko`p xavfsizlik hodisasi yuborildi. Keyinroq urinib ko`ring.'
)

function parseJsonSafe(value, fallback) {
    try {
        if (typeof value !== 'string') return fallback
        const parsed = JSON.parse(value)
        return parsed === null || parsed === undefined ? fallback : parsed
    } catch {
        return fallback
    }
}

function parseNonNegativeInt(value, fallback = 0) {
    const n = Number.parseInt(value, 10)
    return Number.isInteger(n) && n >= 0 ? n : fallback
}

function appendSecurityEvent(existingJson, eventEntry) {
    const parsed = parseJsonSafe(existingJson, [])
    const events = Array.isArray(parsed) ? parsed : []
    events.push(eventEntry)
    if (events.length > MAX_SECURITY_EVENTS_STORED) {
        return events.slice(events.length - MAX_SECURITY_EVENTS_STORED)
    }
    return events
}

function normalizeClientMode(value) {
    const mode = normalizeText(String(value || '').toLowerCase(), 12)
    return CLIENT_MODES.has(mode) ? mode : 'web'
}

function parseDbDateMs(value) {
    if (!value) return null
    const parsed = new Date(String(value).replace(' ', 'T'))
    const ms = parsed.getTime()
    return Number.isFinite(ms) ? ms : null
}

function resolveAttemptWithToken(attemptIdRaw, attemptTokenRaw) {
    const attemptId = parsePositiveInt(attemptIdRaw)
    const attemptToken = normalizeText(String(attemptTokenRaw || ''), 128)

    if (!attemptId || !attemptToken) {
        return { status: 400, message: "Noto'g'ri urinish ma'lumoti" }
    }

    const attempt = db.prepare('SELECT * FROM test_results WHERE id = ?').get(attemptId)
    if (!attempt) {
        return { status: 404, message: 'Urinish topilmadi' }
    }
    if (attempt.finished_at) {
        return { status: 403, message: 'Test allaqachon yakunlangan', finished: true }
    }
    if (!attempt.attempt_token_hash) {
        return { status: 403, message: 'Urinish tokeni yaroqsiz' }
    }

    const tokenHash = hashToken(attemptToken)
    if (!safeStringCompare(attempt.attempt_token_hash, tokenHash)) {
        return { status: 403, message: 'Urinish tokeni yaroqsiz' }
    }

    return { status: 200, attempt, tokenHash }
}

function finishAttemptByPolicy({ attemptId, tokenHash, reason, answersJson, securityEventsJson, tabSwitchCount }) {
    const update = db
        .prepare(
            `UPDATE test_results
             SET score = 0,
                 answers_json = ?,
                 finished_at = datetime('now','localtime'),
                 attempt_token_hash = NULL,
                 ended_reason = ?,
                 security_events_json = ?,
                 tab_switch_count = ?
             WHERE id = ?
               AND finished_at IS NULL
               AND attempt_token_hash = ?`
        )
        .run(answersJson, reason, securityEventsJson, tabSwitchCount, attemptId, tokenHash)
    return update.changes > 0
}

function normalizeFreeText(value) {
    return normalizeText(String(value || ''), MAX_OPTION_LEN).replace(/\s+/g, ' ').toLowerCase()
}

function uniqueStringList(values) {
    const out = []
    const seen = new Set()
    values.forEach((v) => {
        const key = normalizeFreeText(v)
        if (!key || seen.has(key)) return
        seen.add(key)
        out.push(normalizeText(String(v), MAX_OPTION_LEN))
    })
    return out
}

function parseQuestionRow(row) {
    return {
        id: row.id,
        text: row.text,
        questionType: row.question_type,
        questionPayload: parseJsonSafe(row.question_payload, {}),
        correctAnswer: parseJsonSafe(row.correct_answer_json, {}),
        createdAt: row.created_at,
    }
}

function parseChoiceOptions(body) {
    const optionA = normalizeText(body.option_a, MAX_OPTION_LEN)
    const optionB = normalizeText(body.option_b, MAX_OPTION_LEN)
    const optionC = normalizeText(body.option_c, MAX_OPTION_LEN)
    const optionD = normalizeText(body.option_d, MAX_OPTION_LEN)
    if (!optionA || !optionB || !optionC || !optionD) {
        return { error: 'Variantlar to`liq kiritilishi kerak (A, B, C, D).' }
    }
    return {
        value: {
            A: optionA,
            B: optionB,
            C: optionC,
            D: optionD,
        },
    }
}

function parseQuestionPayload(body) {
    const text = normalizeText(body.text, MAX_QUESTION_LEN)
    const questionType = normalizeText(String(body.question_type || 'single_choice').toLowerCase(), 30)

    if (!text) {
        return { error: "Savol matnini kiriting" }
    }
    if (!QUESTION_TYPES.has(questionType)) {
        return { error: "Savol turi noto`g`ri" }
    }

    if (questionType === 'single_choice') {
        const choice = parseChoiceOptions(body)
        if (choice.error) return { error: choice.error }

        const correctOption = normalizeText(String(body.correct_option || '').toUpperCase(), 1)
        if (!VALID_OPTIONS.has(correctOption)) {
            return { error: "To`g`ri variant A, B, C yoki D bo`lishi kerak" }
        }

        return {
            value: {
                text,
                questionType,
                questionPayload: { options: choice.value },
                correctAnswer: { correctOption },
            },
        }
    }

    if (questionType === 'multiple_choice') {
        const choice = parseChoiceOptions(body)
        if (choice.error) return { error: choice.error }

        let correctOptionsRaw = body.correct_options
        if (!Array.isArray(correctOptionsRaw)) {
            if (typeof correctOptionsRaw === 'string') {
                correctOptionsRaw = correctOptionsRaw.split(/[,\s]+/)
            } else {
                correctOptionsRaw = []
            }
        }

        const normalized = Array.from(
            new Set(correctOptionsRaw.map((v) => normalizeText(String(v || '').toUpperCase(), 1)).filter((v) => VALID_OPTIONS.has(v)))
        ).sort()

        if (!normalized.length) {
            return { error: "Kamida bitta to`g`ri variant tanlang" }
        }

        return {
            value: {
                text,
                questionType,
                questionPayload: { options: choice.value },
                correctAnswer: { correctOptions: normalized },
            },
        }
    }

    if (questionType === 'text_input') {
        let acceptedRaw = body.accepted_answers
        if (!Array.isArray(acceptedRaw)) {
            if (typeof acceptedRaw === 'string') {
                acceptedRaw = acceptedRaw.split(/\r?\n|,/)
            } else {
                acceptedRaw = []
            }
        }

        const acceptedAnswers = uniqueStringList(acceptedRaw).slice(0, MAX_TEXT_ANSWERS)
        if (!acceptedAnswers.length) {
            return { error: "Kamida bitta to`g`ri javob matnini kiriting" }
        }

        return {
            value: {
                text,
                questionType,
                questionPayload: { placeholder: 'Javobingizni kiriting' },
                correctAnswer: { acceptedAnswers },
            },
        }
    }

    let pairsRaw = body.matching_pairs
    if (!Array.isArray(pairsRaw)) {
        if (typeof pairsRaw === 'string') {
            pairsRaw = pairsRaw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    const [left, ...rest] = line.split('|')
                    return { left, right: rest.join('|') }
                })
        } else {
            pairsRaw = []
        }
    }

    const pairs = pairsRaw
        .map((p) => ({
            left: normalizeText((p && p.left) || '', MAX_OPTION_LEN),
            right: normalizeText((p && p.right) || '', MAX_OPTION_LEN),
        }))
        .filter((p) => p.left && p.right)
        .slice(0, MAX_MATCHING_PAIRS)
        .map((p, index) => ({ id: String(index + 1), left: p.left, right: p.right }))

    if (pairs.length < 2) {
        return { error: "Moslashtirish turida kamida 2 juftlik bo`lishi kerak" }
    }

    return {
        value: {
            text,
            questionType,
            questionPayload: { pairs },
            correctAnswer: { pairIds: pairs.map((p) => p.id) },
        },
    }
}

function serializeQuestionForAdmin(question) {
    const base = {
        id: question.id,
        text: question.text,
        question_type: question.questionType,
        created_at: question.createdAt,
    }

    if (question.questionType === 'single_choice' || question.questionType === 'multiple_choice') {
        const options = question.questionPayload.options || {}
        base.option_a = options.A || ''
        base.option_b = options.B || ''
        base.option_c = options.C || ''
        base.option_d = options.D || ''
        base.correct_option = question.correctAnswer.correctOption || ''
        base.correct_options = Array.isArray(question.correctAnswer.correctOptions) ? question.correctAnswer.correctOptions : []
        return base
    }

    if (question.questionType === 'text_input') {
        base.accepted_answers = Array.isArray(question.correctAnswer.acceptedAnswers) ? question.correctAnswer.acceptedAnswers : []
        return base
    }

    base.matching_pairs = Array.isArray(question.questionPayload.pairs)
        ? question.questionPayload.pairs.map((p) => ({ id: p.id, left: p.left, right: p.right }))
        : []
    return base
}

function serializeQuestionForTest(question) {
    if (question.questionType === 'single_choice' || question.questionType === 'multiple_choice') {
        const optionOrder = shuffleArray(Array.from(VALID_OPTIONS))
        return {
            id: question.id,
            text: question.text,
            type: question.questionType,
            options: question.questionPayload.options || {},
            optionOrder,
        }
    }

    if (question.questionType === 'text_input') {
        return {
            id: question.id,
            text: question.text,
            type: question.questionType,
            placeholder: question.questionPayload.placeholder || 'Javobingizni kiriting',
        }
    }

    const pairs = Array.isArray(question.questionPayload.pairs) ? question.questionPayload.pairs : []
    return {
        id: question.id,
        text: question.text,
        type: question.questionType,
        leftItems: pairs.map((p) => ({ id: String(p.id), text: p.left })),
        rightOptions: shuffleArray(pairs.map((p) => ({ id: String(p.id), text: p.right }))),
    }
}

function normalizeAnswerByQuestion(question, rawAnswer) {
    if (question.questionType === 'single_choice') {
        const answer = normalizeText(String(rawAnswer || '').toUpperCase(), 1)
        return VALID_OPTIONS.has(answer) ? answer : null
    }

    if (question.questionType === 'multiple_choice') {
        let values = rawAnswer
        if (!Array.isArray(values)) {
            if (typeof values === 'string') {
                values = values.split(/[,\s]+/)
            } else {
                return null
            }
        }
        const normalized = Array.from(
            new Set(values.map((v) => normalizeText(String(v || '').toUpperCase(), 1)).filter((v) => VALID_OPTIONS.has(v)))
        ).sort()
        return normalized.length ? normalized : null
    }

    if (question.questionType === 'text_input') {
        const answer = normalizeText(String(rawAnswer || ''), MAX_OPTION_LEN)
        return answer || null
    }

    if (!isPlainObject(rawAnswer)) return null
    const pairs = Array.isArray(question.questionPayload.pairs) ? question.questionPayload.pairs : []
    const allowedIds = new Set(pairs.map((p) => String(p.id)))
    const normalized = {}
    for (const [leftIdRaw, rightIdRaw] of Object.entries(rawAnswer)) {
        const leftId = normalizeText(String(leftIdRaw || ''), 20)
        const rightId = normalizeText(String(rightIdRaw || ''), 20)
        if (!allowedIds.has(leftId) || !allowedIds.has(rightId)) continue
        normalized[leftId] = rightId
    }
    return Object.keys(normalized).length ? normalized : null
}

function isAnswerCorrect(question, normalizedAnswer) {
    if (normalizedAnswer === null || normalizedAnswer === undefined) return false

    if (question.questionType === 'single_choice') {
        const correct = normalizeText(String(question.correctAnswer.correctOption || '').toUpperCase(), 1)
        return normalizedAnswer === correct
    }

    if (question.questionType === 'multiple_choice') {
        const correct = Array.isArray(question.correctAnswer.correctOptions)
            ? Array.from(new Set(question.correctAnswer.correctOptions.map((v) => normalizeText(String(v || '').toUpperCase(), 1)))).sort()
            : []
        if (!correct.length || !Array.isArray(normalizedAnswer)) return false
        if (correct.length !== normalizedAnswer.length) return false
        return correct.every((value, index) => value === normalizedAnswer[index])
    }

    if (question.questionType === 'text_input') {
        const accepted = Array.isArray(question.correctAnswer.acceptedAnswers) ? question.correctAnswer.acceptedAnswers : []
        const acceptedNormalized = new Set(accepted.map((v) => normalizeFreeText(v)).filter(Boolean))
        return acceptedNormalized.has(normalizeFreeText(normalizedAnswer))
    }

    const pairIds = Array.isArray(question.correctAnswer.pairIds)
        ? question.correctAnswer.pairIds.map((id) => String(id))
        : Array.isArray(question.questionPayload.pairs)
            ? question.questionPayload.pairs.map((p) => String(p.id))
            : []
    if (!pairIds.length || !isPlainObject(normalizedAnswer)) return false
    return pairIds.every((id) => normalizedAnswer[id] === id)
}

app.disable('x-powered-by')

if (IS_PROD) {
    app.set('trust proxy', 1)
}

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    )
    next()
})

app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/admin.html' || req.path === '/login.html') {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Pragma', 'no-cache')
    }
    next()
})

app.use(express.json({ limit: '50kb' }))
app.use(express.urlencoded({ extended: true, limit: '50kb' }))
app.use(
    session({
        name: 'olimpiada.sid',
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: IS_PROD,
            maxAge: 1000 * 60 * 60 * 8,
        },
    })
)

app.get('/admin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.use(express.static(path.join(__dirname, 'public')))

function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next()
    if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, message: 'Avtorizatsiya talab qilinadi' })
    return res.redirect('/login.html')
}

// ============ PUBLIC ROUTES ============
app.post('/api/register', requireSameOrigin, limitRegisterRequests, (req, res) => {
    try {
        const fullName = normalizeText(req.body.full_name, MAX_REGISTER_FIELD_LEN)
        const direction = normalizeText(req.body.direction, MAX_REGISTER_FIELD_LEN)
        const course = normalizeText(req.body.course, 40)
        const email = normalizeEmail(req.body.email)
        const phone = normalizeText(req.body.phone, MAX_PHONE_LEN)

        if (!fullName || !direction || !course || !email || !phone) {
            return res.status(400).json({ success: false, message: "Barcha maydonlarni to`ldiring" })
        }
        if (!VALID_COURSES.has(course)) {
            return res.status(400).json({ success: false, message: "Kurs qiymati noto`g`ri" })
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Email formati noto`g`ri' })
        }
        if (!PHONE_REGEX.test(phone)) {
            return res.status(400).json({ success: false, message: 'Telefon raqam formati noto`g`ri' })
        }

        const existingStudent = db.prepare('SELECT id FROM students WHERE lower(email) = lower(?)').get(email)
        if (existingStudent) {
            return res.status(409).json({ success: false, message: "Bu email allaqachon ro`yxatdan o`tgan" })
        }

        const stmt = db.prepare('INSERT INTO students (full_name, direction, course, email, phone) VALUES (?, ?, ?, ?, ?)')
        const result = stmt.run(fullName, direction, course, email, phone)
        return res.json({ success: true, message: "Muvaffaqiyatli ro`yxatdan o`tdingiz!", id: result.lastInsertRowid })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

// ============ ADMIN AUTH ============
app.post('/api/login', requireSameOrigin, (req, res) => {
    const username = normalizeText(req.body.username, 128)
    const password = normalizeText(req.body.password, 256)
    const loginKey = getLoginKey(req)
    const throttle = checkLoginThrottle(loginKey)

    if (throttle.blocked) {
        res.setHeader('Retry-After', String(throttle.retryAfterSec))
        return res.status(429).json({
            success: false,
            message: "Ko'p urinish bo'ldi. " + throttle.retryAfterSec + " soniyadan keyin urinib ko'ring.",
        })
    }

    const isUsernameValid = safeStringCompare(username, ADMIN_USER)
    const isPasswordValid = safeStringCompare(password, ADMIN_PASS)

    if (!isUsernameValid || !isPasswordValid) {
        recordLoginFailure(loginKey)
        return res.status(401).json({ success: false, message: "Login yoki parol noto`g`ri" })
    }

    req.session.regenerate((err) => {
        if (err) {
            console.error(err)
            return res.status(500).json({ success: false, message: 'Server xatosi' })
        }
        req.session.isAdmin = true
        clearLoginFailures(loginKey)
        return res.json({ success: true })
    })
})

app.post('/api/logout', requireSameOrigin, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('olimpiada.sid')
        res.json({ success: true })
    })
})

app.get('/api/me', (req, res) => {
    res.json({ isAdmin: !!(req.session && req.session.isAdmin) })
})

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        now: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
    })
})

// ============ ADMIN ROUTES ============
app.get('/api/students', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all()
    res.json({ success: true, data: rows })
})

app.delete('/api/students/:id', requireAuth, requireSameOrigin, (req, res) => {
    const studentId = parsePositiveInt(req.params.id)
    if (!studentId) return res.status(400).json({ success: false, message: 'Noto`g`ri ID' })
    const result = db.prepare('DELETE FROM students WHERE id = ?').run(studentId)
    if (!result.changes) return res.status(404).json({ success: false, message: 'Talaba topilmadi' })
    res.json({ success: true })
})

app.get('/api/export/excel', requireAuth, async (req, res) => {
    const rows = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all()
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Talabalar')

    sheet.columns = [
        { header: '#', key: 'n', width: 6 },
        { header: 'F.I.Sh', key: 'full_name', width: 32 },
        { header: "Yo'nalish", key: 'direction', width: 30 },
        { header: 'Kurs', key: 'course', width: 10 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Telefon', key: 'phone', width: 18 },
        { header: "Ro'yxatdan o'tgan vaqti", key: 'created_at', width: 22 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }

    rows.forEach((r, i) => {
        sheet.addRow({
            n: i + 1,
            full_name: sanitizeSpreadsheetCell(r.full_name),
            direction: sanitizeSpreadsheetCell(r.direction),
            course: sanitizeSpreadsheetCell(r.course),
            email: sanitizeSpreadsheetCell(r.email),
            phone: sanitizeSpreadsheetCell(r.phone),
            created_at: sanitizeSpreadsheetCell(r.created_at),
        })
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="talabalar-royxati.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

app.get('/api/export/word', requireAuth, async (req, res) => {
    const rows = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all()

    const headers = ['#', 'F.I.Sh', "Yo'nalish", 'Kurs', 'Email', 'Telefon', 'Sana']
    const headerRow = new TableRow({
        children: headers.map(
            (h) =>
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
                    shading: { fill: '1E3A8A' },
                })
        ),
    })

    const dataRows = rows.map(
        (r, i) =>
            new TableRow({
                children: [String(i + 1), r.full_name, r.direction, r.course, r.email, r.phone, r.created_at].map(
                    (v) => new TableCell({ children: [new Paragraph(String(v))] })
                ),
            })
    )

    const doc = new Document({
        sections: [
            {
                children: [
                    new Paragraph({
                        text: 'Simsiz tarmoqlar fanidan olimpiada',
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({
                        text: "Ro'yxatdan o'tgan talabalar ro'yxati",
                        heading: HeadingLevel.HEADING_2,
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({ text: ' ' }),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [headerRow, ...dataRows],
                    }),
                ],
            },
        ],
    })

    const buffer = await Packer.toBuffer(doc)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', 'attachment; filename="talabalar-royxati.docx"')
    res.send(buffer)
})

// ============ TEST ROUTES (PUBLIC) ============
app.post('/api/test/start', requireSameOrigin, limitTestStartRequests, (req, res) => {
    try {
        const email = normalizeEmail(req.body.email)
        const clientMode = normalizeClientMode(req.body.client_mode)
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Email kiriting' })
        }

        const student = db.prepare('SELECT * FROM students WHERE lower(email) = lower(?)').get(email)
        if (!student) {
            return res.status(404).json({ success: false, message: "Bu email ro'yxatdan o'tmagan. Avval ro'yxatdan o'ting." })
        }

        const existing = db.prepare('SELECT * FROM test_results WHERE student_id = ? AND finished_at IS NOT NULL').get(student.id)
        if (existing) {
            return res.status(403).json({
                success: false,
                message: `Siz testni allaqachon topshirgansiz. Natijangiz: ${existing.score}/${existing.total}`,
                alreadyFinished: true,
                score: existing.score,
                total: existing.total,
            })
        }

        const questions = db
            .prepare('SELECT id, text, question_type, question_payload, correct_answer_json, created_at FROM question_bank ORDER BY id ASC')
            .all()
            .map(parseQuestionRow)
            .filter((q) => QUESTION_TYPES.has(q.questionType))

        if (questions.length === 0) {
            return res.status(503).json({ success: false, message: "Hozircha savollar yo'q. Tashkilotchi bilan bog'laning." })
        }

        const shuffledQuestions = shuffleArray(questions)
        const selectedQuestions =
            TEST_QUESTION_COUNT > 0 ? shuffledQuestions.slice(0, Math.min(TEST_QUESTION_COUNT, shuffledQuestions.length)) : shuffledQuestions
        const orderIds = selectedQuestions.map((q) => q.id)

        let attempt = db.prepare('SELECT * FROM test_results WHERE student_id = ? AND finished_at IS NULL').get(student.id)
        if (!attempt) {
            const result = db
                .prepare('INSERT INTO test_results (student_id, total, question_order, attempt_token_hash) VALUES (?, ?, ?, ?)')
                .run(student.id, selectedQuestions.length, JSON.stringify(orderIds), null)
            attempt = db.prepare('SELECT * FROM test_results WHERE id = ?').get(result.lastInsertRowid)
        } else {
            const startedAt = new Date(String(attempt.started_at).replace(' ', 'T'))
            const elapsedMs = Date.now() - startedAt.getTime()
            if (elapsedMs > TEST_DURATION_MIN * 60 * 1000) {
                db.prepare(
                    "UPDATE test_results SET finished_at = datetime('now','localtime'), score = 0, attempt_token_hash = NULL, ended_reason = 'time_expired_before_resume' WHERE id = ?"
                ).run(attempt.id)
                return res.status(403).json({
                    success: false,
                    message: 'Test vaqti tugagan. Siz endi qayta topshira olmaysiz.',
                    alreadyFinished: true,
                    score: 0,
                    total: attempt.total,
                })
            }
        }

        const attemptToken = generateAttemptToken()
        const attemptTokenHash = hashToken(attemptToken)
        if (clientMode === 'kiosk') {
            db.prepare("UPDATE test_results SET attempt_token_hash = ?, client_mode = 'kiosk', last_heartbeat_at = datetime('now','localtime') WHERE id = ?")
                .run(attemptTokenHash, attempt.id)
        } else {
            db.prepare("UPDATE test_results SET attempt_token_hash = ?, client_mode = 'web', last_heartbeat_at = NULL WHERE id = ?").run(
                attemptTokenHash,
                attempt.id
            )
        }

        const refreshedAttempt = db.prepare('SELECT * FROM test_results WHERE id = ?').get(attempt.id)
        let orderFromDb = []
        try {
            const parsed = JSON.parse(refreshedAttempt.question_order || '[]')
            if (Array.isArray(parsed)) {
                orderFromDb = parsed.map((id) => parsePositiveInt(id)).filter(Boolean)
            }
        } catch {
            orderFromDb = []
        }
        if (!orderFromDb.length) {
            return res.status(409).json({ success: false, message: 'Savollar tartibi buzilgan. Testni qayta boshlang.' })
        }
        const byId = new Map(questions.map((q) => [q.id, q]))
        const orderedQuestions = orderFromDb.map((id) => byId.get(id)).filter(Boolean)
        if (orderedQuestions.length !== orderFromDb.length) {
            return res.status(409).json({ success: false, message: 'Savollar yangilangan. Testni qaytadan boshlang.' })
        }

        const startedAt = new Date(String(refreshedAttempt.started_at).replace(' ', 'T'))
        const endsAt = new Date(startedAt.getTime() + TEST_DURATION_MIN * 60 * 1000).toISOString()

        return res.json({
            success: true,
            data: {
                attemptId: refreshedAttempt.id,
                attemptToken,
                student: { full_name: student.full_name, email: student.email },
                durationMin: TEST_DURATION_MIN,
                endsAt,
                tabSwitchCount: parseNonNegativeInt(refreshedAttempt.tab_switch_count),
                antiCheat: {
                    tabSwitchMaxAllowed: TAB_SWITCH_MAX_ALLOWED,
                    heartbeatIntervalSec: KIOSK_HEARTBEAT_INTERVAL_SEC,
                    heartbeatTimeoutSec: KIOSK_HEARTBEAT_TIMEOUT_SEC,
                },
                questions: orderedQuestions.map(serializeQuestionForTest),
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/event', requireSameOrigin, limitTestEventRequests, (req, res) => {
    try {
        const eventType = normalizeText(String(req.body.eventType || '').toLowerCase(), 40)
        const details = normalizeText(String(req.body.details || ''), MAX_SECURITY_EVENT_DETAILS)

        if (!SECURITY_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ success: false, message: "Noto'g'ri hodisa ma'lumoti" })
        }

        const resolved = resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) {
            return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })
        }
        const attempt = resolved.attempt
        const tokenHash = resolved.tokenHash

        let tabSwitchCount = parseNonNegativeInt(attempt.tab_switch_count)
        if (eventType === 'tab_hidden' || eventType === 'kiosk_focus_lost') {
            tabSwitchCount += 1
        }

        const securityEvents = appendSecurityEvent(attempt.security_events_json, {
            type: eventType,
            at: new Date().toISOString(),
            details: details || undefined,
        })
        const securityEventsJson = JSON.stringify(securityEvents)

        if (tabSwitchCount >= TAB_SWITCH_MAX_ALLOWED) {
            const reason = eventType === 'kiosk_focus_lost' ? 'kiosk_focus_limit' : 'tab_switch_limit'
            const finished = finishAttemptByPolicy({
                attemptId: attempt.id,
                tokenHash,
                reason,
                answersJson: String(attempt.answers_json || '{}'),
                securityEventsJson,
                tabSwitchCount,
            })

            if (!finished) {
                return res.status(409).json({ success: false, message: 'Urinish holati yangilangan, testni qayta tekshiring.' })
            }

            return res.json({
                success: true,
                data: {
                    tabSwitchCount,
                    maxAllowed: TAB_SWITCH_MAX_ALLOWED,
                    autoFinished: true,
                    result: {
                        score: 0,
                        total: attempt.total,
                        percentage: 0,
                        timedOut: false,
                        endedByPolicy: true,
                        reason:
                            reason === 'tab_switch_limit'
                                ? 'Tab almashish limiti oshib ketdi.'
                                : "Kiosk fokus limiti oshib ketdi.",
                    },
                },
            })
        }

        const update = db
            .prepare(
                "UPDATE test_results SET tab_switch_count = ?, security_events_json = ?, last_heartbeat_at = CASE WHEN client_mode = 'kiosk' THEN datetime('now','localtime') ELSE last_heartbeat_at END WHERE id = ? AND finished_at IS NULL AND attempt_token_hash = ?"
            )
            .run(tabSwitchCount, securityEventsJson, attempt.id, tokenHash)
        if (!update.changes) {
            return res.status(409).json({ success: false, message: 'Urinish holati yangilangan, testni qayta tekshiring.' })
        }

        return res.json({
            success: true,
            data: {
                tabSwitchCount,
                maxAllowed: TAB_SWITCH_MAX_ALLOWED,
                autoFinished: false,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/heartbeat', requireSameOrigin, limitTestEventRequests, (req, res) => {
    try {
        const resolved = resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) {
            return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })
        }

        const attempt = resolved.attempt
        const tokenHash = resolved.tokenHash
        const update = db
            .prepare(
                "UPDATE test_results SET last_heartbeat_at = datetime('now','localtime') WHERE id = ? AND finished_at IS NULL AND attempt_token_hash = ?"
            )
            .run(attempt.id, tokenHash)
        if (!update.changes) {
            return res.status(409).json({ success: false, message: 'Heartbeat saqlanmadi, urinish holatini qayta tekshiring.' })
        }

        return res.json({
            success: true,
            data: {
                heartbeatTimeoutSec: KIOSK_HEARTBEAT_TIMEOUT_SEC,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/force-finish', requireSameOrigin, limitTestEventRequests, (req, res) => {
    try {
        const resolved = resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) {
            return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })
        }

        const attempt = resolved.attempt
        const tokenHash = resolved.tokenHash
        const rawReason = normalizeText(String(req.body.reason || ''), 50).toLowerCase()
        const reason = FORCE_FINISH_REASONS.has(rawReason) ? rawReason : 'kiosk_policy'
        const details = normalizeText(String(req.body.details || ''), MAX_SECURITY_EVENT_DETAILS)
        const tabSwitchCount = parseNonNegativeInt(attempt.tab_switch_count)
        const securityEvents = appendSecurityEvent(attempt.security_events_json, {
            type: reason,
            at: new Date().toISOString(),
            details: details || undefined,
        })
        const finished = finishAttemptByPolicy({
            attemptId: attempt.id,
            tokenHash,
            reason,
            answersJson: String(attempt.answers_json || '{}'),
            securityEventsJson: JSON.stringify(securityEvents),
            tabSwitchCount,
        })
        if (!finished) {
            return res.status(409).json({ success: false, message: 'Urinish allaqachon yakunlangan yoki yangilangan.' })
        }

        return res.json({
            success: true,
            data: {
                score: 0,
                total: attempt.total,
                percentage: 0,
                timedOut: false,
                endedByPolicy: true,
                reason: "Kiosk siyosati bo'yicha test yakunlandi.",
                ended_reason: reason,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/submit', requireSameOrigin, limitTestSubmitRequests, (req, res) => {
    try {
        const attemptId = parsePositiveInt(req.body.attemptId)
        const attemptToken = normalizeText(String(req.body.attemptToken || ''), 128)
        const answers = req.body.answers

        if (!attemptId || !attemptToken || !isPlainObject(answers)) {
            return res.status(400).json({ success: false, message: "Noto'g'ri ma'lumot" })
        }

        const attempt = db.prepare('SELECT * FROM test_results WHERE id = ?').get(attemptId)
        if (!attempt) return res.status(404).json({ success: false, message: 'Urinish topilmadi' })
        if (attempt.finished_at) return res.status(403).json({ success: false, message: 'Test allaqachon topshirilgan' })
        if (!attempt.attempt_token_hash) return res.status(403).json({ success: false, message: 'Urinish tokeni yaroqsiz' })

        const tokenHash = hashToken(attemptToken)
        if (!safeStringCompare(attempt.attempt_token_hash, tokenHash)) {
            return res.status(403).json({ success: false, message: 'Urinish tokeni yaroqsiz' })
        }

        const startedAt = new Date(String(attempt.started_at).replace(' ', 'T'))
        const elapsedMs = Date.now() - startedAt.getTime()
        const timedOut = elapsedMs > (TEST_DURATION_MIN + 1) * 60 * 1000

        let questionOrder = []
        try {
            const parsedOrder = JSON.parse(attempt.question_order || '[]')
            if (Array.isArray(parsedOrder)) {
                questionOrder = parsedOrder.map((id) => parsePositiveInt(id)).filter(Boolean)
            }
        } catch {
            questionOrder = []
        }

        if (questionOrder.length === 0) {
            return res.status(400).json({ success: false, message: 'Savollar tartibi buzilgan' })
        }

        const placeholders = questionOrder.map(() => '?').join(',')
        const questionRows = db
            .prepare(`SELECT id, text, question_type, question_payload, correct_answer_json, created_at FROM question_bank WHERE id IN (${placeholders})`)
            .all(...questionOrder)
            .map(parseQuestionRow)
        const questionsById = new Map(questionRows.map((q) => [q.id, q]))
        if (!questionRows.length) {
            return res.status(400).json({ success: false, message: 'Savollar topilmadi' })
        }

        const cleanedAnswers = {}
        let score = 0
        for (const questionId of questionOrder) {
            const question = questionsById.get(questionId)
            if (!question) continue

            const rawAnswer = answers[String(questionId)]
            const normalizedAnswer = normalizeAnswerByQuestion(question, rawAnswer)
            if (normalizedAnswer !== null) {
                cleanedAnswers[questionId] = normalizedAnswer
            }

            if (isAnswerCorrect(question, normalizedAnswer)) {
                score++
            }
        }

        if (timedOut) {
            score = 0
        }

        const endedReason = timedOut ? 'time_expired' : 'submitted'
        const updateResult = db
            .prepare(
                'UPDATE test_results SET score = ?, answers_json = ?, finished_at = datetime(\'now\',\'localtime\'), attempt_token_hash = NULL, ended_reason = ? WHERE id = ? AND finished_at IS NULL AND attempt_token_hash = ?'
            )
            .run(score, JSON.stringify(cleanedAnswers), endedReason, attemptId, tokenHash)

        if (!updateResult.changes) {
            return res.status(409).json({ success: false, message: 'Test natijasi allaqachon saqlangan' })
        }

        return res.json({
            success: true,
            data: {
                score,
                total: attempt.total,
                percentage: attempt.total ? Math.round((score / attempt.total) * 100) : 0,
                timedOut,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

// ============ ADMIN: QUESTIONS ============
app.get('/api/admin/questions', requireAuth, (req, res) => {
    const rows = db
        .prepare('SELECT id, text, question_type, question_payload, correct_answer_json, created_at FROM question_bank ORDER BY id DESC')
        .all()
        .map(parseQuestionRow)
        .map(serializeQuestionForAdmin)
    res.json({ success: true, data: rows })
})

app.post('/api/admin/questions', requireAuth, requireSameOrigin, (req, res) => {
    const parsed = parseQuestionPayload(req.body)
    if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error })
    }

    const result = db
        .prepare('INSERT INTO question_bank (text, question_type, question_payload, correct_answer_json) VALUES (?,?,?,?)')
        .run(parsed.value.text, parsed.value.questionType, JSON.stringify(parsed.value.questionPayload), JSON.stringify(parsed.value.correctAnswer))
    res.json({ success: true, id: result.lastInsertRowid })
})

app.put('/api/admin/questions/:id', requireAuth, requireSameOrigin, (req, res) => {
    const questionId = parsePositiveInt(req.params.id)
    if (!questionId) return res.status(400).json({ success: false, message: 'Noto`g`ri ID' })

    const parsed = parseQuestionPayload(req.body)
    if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error })
    }

    const update = db
        .prepare('UPDATE question_bank SET text=?, question_type=?, question_payload=?, correct_answer_json=? WHERE id=?')
        .run(parsed.value.text, parsed.value.questionType, JSON.stringify(parsed.value.questionPayload), JSON.stringify(parsed.value.correctAnswer), questionId)

    if (!update.changes) {
        return res.status(404).json({ success: false, message: 'Savol topilmadi' })
    }

    res.json({ success: true })
})

app.delete('/api/admin/questions/:id', requireAuth, requireSameOrigin, (req, res) => {
    const questionId = parsePositiveInt(req.params.id)
    if (!questionId) return res.status(400).json({ success: false, message: 'Noto`g`ri ID' })
    const result = db.prepare('DELETE FROM question_bank WHERE id = ?').run(questionId)
    if (!result.changes) return res.status(404).json({ success: false, message: 'Savol topilmadi' })
    res.json({ success: true })
})

app.post('/api/admin/questions/import', requireAuth, requireSameOrigin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Fayl yuklanmagan' })

        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(req.file.buffer)
        const sheet = workbook.worksheets[0]
        if (!sheet) return res.status(400).json({ success: false, message: "Excel fayl bo'sh" })

        const insert = db.prepare(
            'INSERT INTO question_bank (text, question_type, question_payload, correct_answer_json) VALUES (?,?,?,?)'
        )
        let added = 0
        let errors = 0

        const insertMany = db.transaction((rows) => {
            rows.forEach((r) => {
                try {
                    const payload = { options: { A: r.a, B: r.b, C: r.c, D: r.d } }
                    const answer = { correctOption: r.correct }
                    insert.run(r.text, 'single_choice', JSON.stringify(payload), JSON.stringify(answer))
                    added++
                } catch {
                    errors++
                }
            })
        })

        const rows = []
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return
            if (rows.length >= MAX_IMPORT_ROWS) {
                errors++
                return
            }

            const text = normalizeText(String(row.getCell(1).text || ''), MAX_QUESTION_LEN)
            const a = normalizeText(String(row.getCell(2).text || ''), MAX_OPTION_LEN)
            const b = normalizeText(String(row.getCell(3).text || ''), MAX_OPTION_LEN)
            const c = normalizeText(String(row.getCell(4).text || ''), MAX_OPTION_LEN)
            const d = normalizeText(String(row.getCell(5).text || ''), MAX_OPTION_LEN)
            const correct = normalizeText(String(row.getCell(6).text || '').toUpperCase(), 1)

            if (text && a && b && c && d && VALID_OPTIONS.has(correct)) {
                rows.push({ text, a, b, c, d, correct })
            } else {
                errors++
            }
        })

        insertMany(rows)
        const limitWarning = sheet.rowCount - 1 > MAX_IMPORT_ROWS ? `, ${MAX_IMPORT_ROWS} tadan ortig'i qabul qilinmadi` : ''
        res.json({ success: true, added, errors, message: `${added} ta savol qo'shildi${errors ? ', ' + errors + ' ta xato' : ''}${limitWarning}` })
    } catch (err) {
        console.error(err)
        res.status(500).json({ success: false, message: "Excel faylni o'qishda xatolik" })
    }
})

app.get('/api/admin/questions/template', requireAuth, async (req, res) => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Savollar')
    sheet.columns = [
        { header: 'Savol', key: 'text', width: 50 },
        { header: 'A varianti', key: 'a', width: 25 },
        { header: 'B varianti', key: 'b', width: 25 },
        { header: 'C varianti', key: 'c', width: 25 },
        { header: 'D varianti', key: 'd', width: 25 },
        { header: "To'g'ri javob (A/B/C/D)", key: 'correct', width: 22 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
    sheet.addRow({
        text: 'Wi-Fi qaysi IEEE standartida ishlaydi?',
        a: '802.3',
        b: '802.11',
        c: '802.15',
        d: '802.16',
        correct: 'B',
    })
    sheet.addRow({
        text: 'Bluetooth qaysi chastotada ishlaydi?',
        a: '900 MHz',
        b: '1.8 GHz',
        c: '2.4 GHz',
        d: '5 GHz',
        correct: 'C',
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="savollar-shablon.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

// ============ ADMIN: RESULTS ============
app.get('/api/admin/results', requireAuth, (req, res) => {
    const rows = db
        .prepare(
            `SELECT r.id, r.score, r.total, r.started_at, r.finished_at, r.tab_switch_count, r.ended_reason, r.client_mode,
                    s.full_name, s.direction, s.course, s.email, s.phone
             FROM test_results r
             JOIN students s ON s.id = r.student_id
             ORDER BY r.finished_at DESC NULLS LAST, r.started_at DESC`
        )
        .all()
    res.json({ success: true, data: rows })
})

app.get('/api/admin/results/excel', requireAuth, async (req, res) => {
    const rows = db
        .prepare(
            `SELECT r.score, r.total, r.started_at, r.finished_at, r.tab_switch_count, r.ended_reason, r.client_mode,
                    s.full_name, s.direction, s.course, s.email, s.phone
             FROM test_results r
             JOIN students s ON s.id = r.student_id
             WHERE r.finished_at IS NOT NULL
             ORDER BY r.score DESC, r.finished_at ASC`
        )
        .all()
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Natijalar')
    sheet.columns = [
        { header: '#', key: 'n', width: 6 },
        { header: 'F.I.Sh', key: 'full_name', width: 30 },
        { header: "Yo'nalish", key: 'direction', width: 28 },
        { header: 'Kurs', key: 'course', width: 10 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Telefon', key: 'phone', width: 18 },
        { header: 'Ball', key: 'score', width: 10 },
        { header: 'Jami', key: 'total', width: 10 },
        { header: '%', key: 'pct', width: 8 },
        { header: 'Rejim', key: 'client_mode', width: 10 },
        { header: 'Tab switch', key: 'tab_switch_count', width: 12 },
        { header: 'Yakun sababi', key: 'ended_reason', width: 22 },
        { header: 'Boshlangan', key: 'started_at', width: 20 },
        { header: 'Tugatgan', key: 'finished_at', width: 20 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
    rows.forEach((r, i) => {
        sheet.addRow({
            n: i + 1,
            full_name: sanitizeSpreadsheetCell(r.full_name),
            direction: sanitizeSpreadsheetCell(r.direction),
            course: sanitizeSpreadsheetCell(r.course),
            email: sanitizeSpreadsheetCell(r.email),
            phone: sanitizeSpreadsheetCell(r.phone),
            score: r.score,
            total: r.total,
            pct: r.total ? Math.round((r.score / r.total) * 100) + '%' : '-',
            client_mode: sanitizeSpreadsheetCell(r.client_mode || 'web'),
            tab_switch_count: parseNonNegativeInt(r.tab_switch_count),
            ended_reason: sanitizeSpreadsheetCell(r.ended_reason || 'submitted'),
            started_at: sanitizeSpreadsheetCell(r.started_at),
            finished_at: sanitizeSpreadsheetCell(r.finished_at),
        })
    })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="test-natijalari.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

function runKioskHeartbeatWatchdog() {
    try {
        const attempts = db
            .prepare(
                "SELECT id, total, started_at, last_heartbeat_at, security_events_json, tab_switch_count FROM test_results WHERE finished_at IS NULL AND client_mode = 'kiosk' AND attempt_token_hash IS NOT NULL"
            )
            .all()

        const nowMs = Date.now()
        const timeoutMs = KIOSK_HEARTBEAT_TIMEOUT_SEC * 1000
        attempts.forEach((attempt) => {
            const heartbeatMs = parseDbDateMs(attempt.last_heartbeat_at) || parseDbDateMs(attempt.started_at)
            if (!heartbeatMs) return
            if (nowMs - heartbeatMs <= timeoutMs) return

            const securityEvents = appendSecurityEvent(attempt.security_events_json, {
                type: 'kiosk_heartbeat_lost',
                at: new Date().toISOString(),
                details: 'watchdog-timeout',
            })

            db.prepare(
                "UPDATE test_results SET score = 0, answers_json = COALESCE(answers_json, '{}'), finished_at = datetime('now','localtime'), attempt_token_hash = NULL, ended_reason = 'kiosk_heartbeat_lost', security_events_json = ?, tab_switch_count = ? WHERE id = ? AND finished_at IS NULL AND client_mode = 'kiosk'"
            ).run(JSON.stringify(securityEvents), parseNonNegativeInt(attempt.tab_switch_count), attempt.id)
        })
    } catch (err) {
        console.error('Heartbeat watchdog xatosi:', err)
    }
}

const heartbeatWatchdogTimer = setInterval(runKioskHeartbeatWatchdog, WATCHDOG_INTERVAL_MS)
if (typeof heartbeatWatchdogTimer.unref === 'function') {
    heartbeatWatchdogTimer.unref()
}

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'Excel fayl hajmi 2 MB dan oshmasligi kerak' })
        }
        return res.status(400).json({ success: false, message: 'Faylni yuklashda xatolik' })
    }

    if (err && err.message === 'Faqat .xlsx formatdagi fayl yuklash mumkin.') {
        return res.status(400).json({ success: false, message: err.message })
    }

    if (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }

    return next()
})

app.listen(PORT, () => {
    console.log('\n  Simsiz tarmoqlar olimpiadasi serveri')
    console.log(`  Ro'yxatdan o'tish:  http://localhost:${PORT}`)
    console.log(`  Admin panel:         http://localhost:${PORT}/login.html`)
    console.log(`  Test sahifasi:       http://localhost:${PORT}/test.html`)
    console.log(`  Admin user:          ${ADMIN_USER}`)
    console.log(`  Test davomiyligi:    ${TEST_DURATION_MIN} daqiqa\n`)
    console.log(`  Tab switch limiti:   ${TAB_SWITCH_MAX_ALLOWED}`)
    console.log(`  Savol subset hajmi:  ${TEST_QUESTION_COUNT > 0 ? TEST_QUESTION_COUNT : 'barchasi'}\n`)
    console.log(`  Heartbeat (sec):     ${KIOSK_HEARTBEAT_INTERVAL_SEC} / timeout ${KIOSK_HEARTBEAT_TIMEOUT_SEC}\n`)
})
