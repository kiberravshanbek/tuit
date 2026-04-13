const express = require('express')
const session = require('express-session')
const mongoose = require('mongoose')
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
const MONGODB_URI = process.env.MONGODB_URI

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
    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI production muhitida majburiy.')
    }
}

// ============ MONGOOSE SCHEMAS ============
const studentSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    direction: { type: String, required: true },
    course: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
})
studentSchema.index({ email: 1 }, { collation: { locale: 'en', strength: 2 } })

const questionBankSchema = new mongoose.Schema({
    text: { type: String, required: true },
    question_type: { type: String, required: true },
    question_payload: { type: mongoose.Schema.Types.Mixed, required: true },
    correct_answer_json: { type: mongoose.Schema.Types.Mixed, required: true },
    created_at: { type: Date, default: Date.now },
})

const testResultSchema = new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    score: { type: Number },
    total: { type: Number },
    answers_json: { type: mongoose.Schema.Types.Mixed },
    question_order: { type: [mongoose.Schema.Types.ObjectId] },
    attempt_token_hash: { type: String },
    tab_switch_count: { type: Number, default: 0 },
    security_events_json: { type: mongoose.Schema.Types.Mixed },
    client_mode: { type: String },
    last_heartbeat_at: { type: Date },
    ended_reason: { type: String },
    started_at: { type: Date, default: Date.now },
    finished_at: { type: Date },
})

const Student = mongoose.model('Student', studentSchema)
const QuestionBank = mongoose.model('QuestionBank', questionBankSchema)
const TestResult = mongoose.model('TestResult', testResultSchema)

// ============ HELPER FUNCTIONS ============
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

const limitRegisterRequests = createIpRateLimiter(registerRequests, REGISTER_RATE_MAX, REGISTER_RATE_WINDOW_MS, "Ro`yxatdan o`tish so`rovlari ko`payib ketdi. Keyinroq qayta urinib ko`ring.")
const limitTestStartRequests = createIpRateLimiter(testStartRequests, TEST_START_RATE_MAX, TEST_START_RATE_WINDOW_MS, 'Testni boshlash so`rovlari ko`payib ketdi. Keyinroq urinib ko`ring.')
const limitTestSubmitRequests = createIpRateLimiter(testSubmitRequests, TEST_SUBMIT_RATE_MAX, TEST_SUBMIT_RATE_WINDOW_MS, 'Juda ko`p yakunlash so`rovi yuborildi. Keyinroq urinib ko`ring.')
const limitTestEventRequests = createIpRateLimiter(testEventRequests, TEST_EVENT_RATE_MAX, TEST_EVENT_RATE_WINDOW_MS, 'Juda ko`p xavfsizlik hodisasi yuborildi. Keyinroq urinib ko`ring.')

function parseNonNegativeInt(value, fallback = 0) {
    const n = Number.parseInt(value, 10)
    return Number.isInteger(n) && n >= 0 ? n : fallback
}

function appendSecurityEvent(existingArr, eventEntry) {
    const events = Array.isArray(existingArr) ? [...existingArr] : []
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
        id: row._id,
        text: row.text,
        questionType: row.question_type,
        questionPayload: row.question_payload,
        correctAnswer: row.correct_answer_json,
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
    return { value: { A: optionA, B: optionB, C: optionC, D: optionD } }
}

function parseQuestionPayload(body) {
    const text = normalizeText(body.text, MAX_QUESTION_LEN)
    const questionType = normalizeText(String(body.question_type || 'single_choice').toLowerCase(), 30)

    if (!text) return { error: "Savol matnini kiriting" }
    if (!QUESTION_TYPES.has(questionType)) return { error: "Savol turi noto`g`ri" }

    if (questionType === 'single_choice') {
        const choice = parseChoiceOptions(body)
        if (choice.error) return { error: choice.error }
        const correctOption = normalizeText(String(body.correct_option || '').toUpperCase(), 1)
        if (!VALID_OPTIONS.has(correctOption)) return { error: "To`g`ri variant A, B, C yoki D bo`lishi kerak" }
        return { value: { text, questionType, questionPayload: { options: choice.value }, correctAnswer: { correctOption } } }
    }

    if (questionType === 'multiple_choice') {
        const choice = parseChoiceOptions(body)
        if (choice.error) return { error: choice.error }
        let correctOptionsRaw = body.correct_options
        if (!Array.isArray(correctOptionsRaw)) {
            correctOptionsRaw = typeof correctOptionsRaw === 'string' ? correctOptionsRaw.split(/[,\s]+/) : []
        }
        const normalized = Array.from(new Set(correctOptionsRaw.map((v) => normalizeText(String(v || '').toUpperCase(), 1)).filter((v) => VALID_OPTIONS.has(v)))).sort()
        if (!normalized.length) return { error: "Kamida bitta to`g`ri variant tanlang" }
        return { value: { text, questionType, questionPayload: { options: choice.value }, correctAnswer: { correctOptions: normalized } } }
    }

    if (questionType === 'text_input') {
        let acceptedRaw = body.accepted_answers
        if (!Array.isArray(acceptedRaw)) {
            acceptedRaw = typeof acceptedRaw === 'string' ? acceptedRaw.split(/\r?\n|,/) : []
        }
        const acceptedAnswers = uniqueStringList(acceptedRaw).slice(0, MAX_TEXT_ANSWERS)
        if (!acceptedAnswers.length) return { error: "Kamida bitta to`g`ri javob matnini kiriting" }
        return { value: { text, questionType, questionPayload: { placeholder: 'Javobingizni kiriting' }, correctAnswer: { acceptedAnswers } } }
    }

    let pairsRaw = body.matching_pairs
    if (!Array.isArray(pairsRaw)) {
        if (typeof pairsRaw === 'string') {
            pairsRaw = pairsRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [left, ...rest] = line.split('|'); return { left, right: rest.join('|') } })
        } else {
            pairsRaw = []
        }
    }
    const pairs = pairsRaw.map((p) => ({ left: normalizeText((p && p.left) || '', MAX_OPTION_LEN), right: normalizeText((p && p.right) || '', MAX_OPTION_LEN) }))
        .filter((p) => p.left && p.right).slice(0, MAX_MATCHING_PAIRS).map((p, index) => ({ id: String(index + 1), left: p.left, right: p.right }))
    if (pairs.length < 2) return { error: "Moslashtirish turida kamida 2 juftlik bo`lishi kerak" }
    return { value: { text, questionType, questionPayload: { pairs }, correctAnswer: { pairIds: pairs.map((p) => p.id) } } }
}

function serializeQuestionForAdmin(question) {
    const base = { id: question.id, text: question.text, question_type: question.questionType, created_at: question.createdAt }
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
    base.matching_pairs = Array.isArray(question.questionPayload.pairs) ? question.questionPayload.pairs.map((p) => ({ id: p.id, left: p.left, right: p.right })) : []
    return base
}

function serializeQuestionForTest(question) {
    if (question.questionType === 'single_choice' || question.questionType === 'multiple_choice') {
        const optionOrder = shuffleArray(Array.from(VALID_OPTIONS))
        return { id: question.id, text: question.text, type: question.questionType, options: question.questionPayload.options || {}, optionOrder }
    }
    if (question.questionType === 'text_input') {
        return { id: question.id, text: question.text, type: question.questionType, placeholder: question.questionPayload.placeholder || 'Javobingizni kiriting' }
    }
    const pairs = Array.isArray(question.questionPayload.pairs) ? question.questionPayload.pairs : []
    return {
        id: question.id, text: question.text, type: question.questionType,
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
            if (typeof values === 'string') values = values.split(/[,\s]+/)
            else return null
        }
        const normalized = Array.from(new Set(values.map((v) => normalizeText(String(v || '').toUpperCase(), 1)).filter((v) => VALID_OPTIONS.has(v)))).sort()
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
        : Array.isArray(question.questionPayload.pairs) ? question.questionPayload.pairs.map((p) => String(p.id)) : []
    if (!pairIds.length || !isPlainObject(normalizedAnswer)) return false
    return pairIds.every((id) => normalizedAnswer[id] === id)
}

// ============ EXPRESS SETUP ============
app.disable('x-powered-by')
if (IS_PROD) app.set('trust proxy', 1)

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
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
app.use(session({
    name: 'olimpiada.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 8 },
}))

const EXCEL_MIME_TYPES = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(String(file.originalname || '')).toLowerCase()
        const mimeOk = EXCEL_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())
        if (ext !== '.xlsx' || !mimeOk) return cb(new Error('Faqat .xlsx formatdagi fayl yuklash mumkin.'))
        return cb(null, true)
    },
})

function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next()
    if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, message: 'Avtorizatsiya talab qilinadi' })
    return res.redirect('/login.html')
}

app.get('/admin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})
app.use(express.static(path.join(__dirname, 'public')))

// ============ PUBLIC ROUTES ============
app.post('/api/register', requireSameOrigin, limitRegisterRequests, async (req, res) => {
    try {
        const fullName = normalizeText(req.body.full_name, MAX_REGISTER_FIELD_LEN)
        const direction = normalizeText(req.body.direction, MAX_REGISTER_FIELD_LEN)
        const course = normalizeText(req.body.course, 40)
        const email = normalizeEmail(req.body.email)
        const phone = normalizeText(req.body.phone, MAX_PHONE_LEN)

        if (!fullName || !direction || !course || !email || !phone) return res.status(400).json({ success: false, message: "Barcha maydonlarni to`ldiring" })
        if (!VALID_COURSES.has(course)) return res.status(400).json({ success: false, message: "Kurs qiymati noto`g`ri" })
        if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Email formati noto`g`ri' })
        if (!PHONE_REGEX.test(phone)) return res.status(400).json({ success: false, message: 'Telefon raqam formati noto`g`ri' })

        const existingStudent = await Student.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } })
        if (existingStudent) return res.status(409).json({ success: false, message: "Bu email allaqachon ro`yxatdan o`tgan" })

        const student = await Student.create({ full_name: fullName, direction, course, email, phone })
        return res.json({ success: true, message: "Muvaffaqiyatli ro`yxatdan o`tdingiz!", id: student._id })
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
        return res.status(429).json({ success: false, message: "Ko'p urinish bo'ldi. " + throttle.retryAfterSec + " soniyadan keyin urinib ko'ring." })
    }

    const isUsernameValid = safeStringCompare(username, ADMIN_USER)
    const isPasswordValid = safeStringCompare(password, ADMIN_PASS)

    if (!isUsernameValid || !isPasswordValid) {
        recordLoginFailure(loginKey)
        return res.status(401).json({ success: false, message: "Login yoki parol noto`g`ri" })
    }

    req.session.regenerate((err) => {
        if (err) { console.error(err); return res.status(500).json({ success: false, message: 'Server xatosi' }) }
        req.session.isAdmin = true
        clearLoginFailures(loginKey)
        return res.json({ success: true })
    })
})

app.post('/api/logout', requireSameOrigin, (req, res) => {
    req.session.destroy(() => { res.clearCookie('olimpiada.sid'); res.json({ success: true }) })
})

app.get('/api/me', (req, res) => { res.json({ isAdmin: !!(req.session && req.session.isAdmin) }) })

app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'ok', now: new Date().toISOString(), uptimeSec: Math.round(process.uptime()) })
})

// ============ ADMIN ROUTES ============
app.get('/api/students', requireAuth, async (req, res) => {
    const rows = await Student.find().sort({ created_at: -1 }).lean()
    res.json({ success: true, data: rows.map(r => ({ ...r, id: r._id, created_at: r.created_at })) })
})

app.delete('/api/students/:id', requireAuth, requireSameOrigin, async (req, res) => {
    try {
        const result = await Student.findByIdAndDelete(req.params.id)
        if (!result) return res.status(404).json({ success: false, message: 'Talaba topilmadi' })
        res.json({ success: true })
    } catch { return res.status(400).json({ success: false, message: 'Noto`g`ri ID' }) }
})

app.get('/api/export/excel', requireAuth, async (req, res) => {
    const rows = await Student.find().sort({ created_at: -1 }).lean()
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
            n: i + 1, full_name: sanitizeSpreadsheetCell(r.full_name), direction: sanitizeSpreadsheetCell(r.direction),
            course: sanitizeSpreadsheetCell(r.course), email: sanitizeSpreadsheetCell(r.email),
            phone: sanitizeSpreadsheetCell(r.phone), created_at: sanitizeSpreadsheetCell(r.created_at ? new Date(r.created_at).toLocaleString('uz') : ''),
        })
    })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="talabalar-royxati.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

app.get('/api/export/word', requireAuth, async (req, res) => {
    const rows = await Student.find().sort({ created_at: -1 }).lean()
    const headers = ['#', 'F.I.Sh', "Yo'nalish", 'Kurs', 'Email', 'Telefon', 'Sana']
    const headerRow = new TableRow({
        children: headers.map((h) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
            shading: { fill: '1E3A8A' },
        })),
    })
    const dataRows = rows.map((r, i) => new TableRow({
        children: [String(i + 1), r.full_name, r.direction, r.course, r.email, r.phone, r.created_at ? new Date(r.created_at).toLocaleString('uz') : ''].map(
            (v) => new TableCell({ children: [new Paragraph(String(v))] })
        ),
    }))
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ text: 'Simsiz tarmoqlar fanidan olimpiada', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "Ro'yxatdan o'tgan talabalar ro'yxati", heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: ' ' }),
                new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
            ],
        }],
    })
    const buffer = await Packer.toBuffer(doc)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', 'attachment; filename="talabalar-royxati.docx"')
    res.send(buffer)
})

// ============ TEST ROUTES ============
app.post('/api/test/start', requireSameOrigin, limitTestStartRequests, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email)
        const clientMode = normalizeClientMode(req.body.client_mode)
        if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, message: 'Email kiriting' })

        const student = await Student.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } })
        if (!student) return res.status(404).json({ success: false, message: "Bu email ro'yxatdan o'tmagan. Avval ro'yxatdan o'ting." })

        const existing = await TestResult.findOne({ student_id: student._id, finished_at: { $ne: null } })
        if (existing) {
            return res.status(403).json({ success: false, message: `Siz testni allaqachon topshirgansiz. Natijangiz: ${existing.score}/${existing.total}`, alreadyFinished: true, score: existing.score, total: existing.total })
        }

        const questionDocs = await QuestionBank.find().lean()
        const questions = questionDocs.map(parseQuestionRow).filter((q) => QUESTION_TYPES.has(q.questionType))

        if (questions.length === 0) return res.status(503).json({ success: false, message: "Hozircha savollar yo'q. Tashkilotchi bilan bog'laning." })

        const shuffledQuestions = shuffleArray(questions)
        const selectedQuestions = TEST_QUESTION_COUNT > 0 ? shuffledQuestions.slice(0, Math.min(TEST_QUESTION_COUNT, shuffledQuestions.length)) : shuffledQuestions
        const orderIds = selectedQuestions.map((q) => q.id)

        let attempt = await TestResult.findOne({ student_id: student._id, finished_at: null })
        if (!attempt) {
            attempt = await TestResult.create({ student_id: student._id, total: selectedQuestions.length, question_order: orderIds, attempt_token_hash: null })
        } else {
            const elapsedMs = Date.now() - new Date(attempt.started_at).getTime()
            if (elapsedMs > TEST_DURATION_MIN * 60 * 1000) {
                await TestResult.findByIdAndUpdate(attempt._id, { finished_at: new Date(), score: 0, attempt_token_hash: null, ended_reason: 'time_expired_before_resume' })
                return res.status(403).json({ success: false, message: 'Test vaqti tugagan. Siz endi qayta topshira olmaysiz.', alreadyFinished: true, score: 0, total: attempt.total })
            }
        }

        const attemptToken = generateAttemptToken()
        const attemptTokenHash = hashToken(attemptToken)
        const updateData = { attempt_token_hash: attemptTokenHash, client_mode: clientMode }
        if (clientMode === 'kiosk') updateData.last_heartbeat_at = new Date()
        else updateData.last_heartbeat_at = null
        await TestResult.findByIdAndUpdate(attempt._id, updateData)

        const refreshedAttempt = await TestResult.findById(attempt._id)
        const orderFromDb = Array.isArray(refreshedAttempt.question_order) ? refreshedAttempt.question_order : []
        if (!orderFromDb.length) return res.status(409).json({ success: false, message: 'Savollar tartibi buzilgan. Testni qayta boshlang.' })

        const byId = new Map(questions.map((q) => [String(q.id), q]))
        const orderedQuestions = orderFromDb.map((id) => byId.get(String(id))).filter(Boolean)
        if (orderedQuestions.length !== orderFromDb.length) return res.status(409).json({ success: false, message: 'Savollar yangilangan. Testni qaytadan boshlang.' })

        const startedAt = new Date(refreshedAttempt.started_at)
        const endsAt = new Date(startedAt.getTime() + TEST_DURATION_MIN * 60 * 1000).toISOString()

        return res.json({
            success: true,
            data: {
                attemptId: refreshedAttempt._id,
                attemptToken,
                student: { full_name: student.full_name, email: student.email },
                durationMin: TEST_DURATION_MIN,
                endsAt,
                tabSwitchCount: parseNonNegativeInt(refreshedAttempt.tab_switch_count),
                antiCheat: { tabSwitchMaxAllowed: TAB_SWITCH_MAX_ALLOWED, heartbeatIntervalSec: KIOSK_HEARTBEAT_INTERVAL_SEC, heartbeatTimeoutSec: KIOSK_HEARTBEAT_TIMEOUT_SEC },
                questions: orderedQuestions.map(serializeQuestionForTest),
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

async function resolveAttemptWithToken(attemptIdRaw, attemptTokenRaw) {
    const attemptToken = normalizeText(String(attemptTokenRaw || ''), 128)
    if (!attemptIdRaw || !attemptToken) return { status: 400, message: "Noto'g'ri urinish ma'lumoti" }

    let attempt
    try { attempt = await TestResult.findById(attemptIdRaw) } catch { return { status: 400, message: "Noto'g'ri ID" } }
    if (!attempt) return { status: 404, message: 'Urinish topilmadi' }
    if (attempt.finished_at) return { status: 403, message: 'Test allaqachon yakunlangan', finished: true }
    if (!attempt.attempt_token_hash) return { status: 403, message: 'Urinish tokeni yaroqsiz' }

    const tokenHash = hashToken(attemptToken)
    if (!safeStringCompare(attempt.attempt_token_hash, tokenHash)) return { status: 403, message: 'Urinish tokeni yaroqsiz' }

    return { status: 200, attempt, tokenHash }
}

async function finishAttemptByPolicy({ attemptId, tokenHash, reason, answersJson, securityEventsJson, tabSwitchCount }) {
    const result = await TestResult.findOneAndUpdate(
        { _id: attemptId, finished_at: null, attempt_token_hash: tokenHash },
        { score: 0, answers_json: answersJson, finished_at: new Date(), attempt_token_hash: null, ended_reason: reason, security_events_json: securityEventsJson, tab_switch_count: tabSwitchCount }
    )
    return !!result
}

app.post('/api/test/event', requireSameOrigin, limitTestEventRequests, async (req, res) => {
    try {
        const eventType = normalizeText(String(req.body.eventType || '').toLowerCase(), 40)
        const details = normalizeText(String(req.body.details || ''), MAX_SECURITY_EVENT_DETAILS)
        if (!SECURITY_EVENT_TYPES.has(eventType)) return res.status(400).json({ success: false, message: "Noto'g'ri hodisa ma'lumoti" })

        const resolved = await resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })

        const { attempt, tokenHash } = resolved
        let tabSwitchCount = parseNonNegativeInt(attempt.tab_switch_count)
        if (eventType === 'tab_hidden' || eventType === 'kiosk_focus_lost') tabSwitchCount += 1

        const securityEvents = appendSecurityEvent(attempt.security_events_json, { type: eventType, at: new Date().toISOString(), details: details || undefined })

        if (tabSwitchCount >= TAB_SWITCH_MAX_ALLOWED) {
            const reason = eventType === 'kiosk_focus_lost' ? 'kiosk_focus_limit' : 'tab_switch_limit'
            const finished = await finishAttemptByPolicy({ attemptId: attempt._id, tokenHash, reason, answersJson: attempt.answers_json || {}, securityEventsJson: securityEvents, tabSwitchCount })
            if (!finished) return res.status(409).json({ success: false, message: 'Urinish holati yangilangan, testni qayta tekshiring.' })
            return res.json({
                success: true,
                data: { tabSwitchCount, maxAllowed: TAB_SWITCH_MAX_ALLOWED, autoFinished: true, result: { score: 0, total: attempt.total, percentage: 0, timedOut: false, endedByPolicy: true, reason: reason === 'tab_switch_limit' ? 'Tab almashish limiti oshib ketdi.' : "Kiosk fokus limiti oshib ketdi." } },
            })
        }

        const updateData = { tab_switch_count: tabSwitchCount, security_events_json: securityEvents }
        if (attempt.client_mode === 'kiosk') updateData.last_heartbeat_at = new Date()
        const updated = await TestResult.findOneAndUpdate({ _id: attempt._id, finished_at: null, attempt_token_hash: tokenHash }, updateData)
        if (!updated) return res.status(409).json({ success: false, message: 'Urinish holati yangilangan, testni qayta tekshiring.' })

        return res.json({ success: true, data: { tabSwitchCount, maxAllowed: TAB_SWITCH_MAX_ALLOWED, autoFinished: false } })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/heartbeat', requireSameOrigin, limitTestEventRequests, async (req, res) => {
    try {
        const resolved = await resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })

        const { attempt, tokenHash } = resolved
        const updated = await TestResult.findOneAndUpdate({ _id: attempt._id, finished_at: null, attempt_token_hash: tokenHash }, { last_heartbeat_at: new Date() })
        if (!updated) return res.status(409).json({ success: false, message: 'Heartbeat saqlanmadi, urinish holatini qayta tekshiring.' })

        return res.json({ success: true, data: { heartbeatTimeoutSec: KIOSK_HEARTBEAT_TIMEOUT_SEC } })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/force-finish', requireSameOrigin, limitTestEventRequests, async (req, res) => {
    try {
        const resolved = await resolveAttemptWithToken(req.body.attemptId, req.body.attemptToken)
        if (resolved.status !== 200) return res.status(resolved.status).json({ success: false, message: resolved.message, finished: resolved.finished })

        const { attempt, tokenHash } = resolved
        const rawReason = normalizeText(String(req.body.reason || ''), 50).toLowerCase()
        const reason = FORCE_FINISH_REASONS.has(rawReason) ? rawReason : 'kiosk_policy'
        const details = normalizeText(String(req.body.details || ''), MAX_SECURITY_EVENT_DETAILS)
        const tabSwitchCount = parseNonNegativeInt(attempt.tab_switch_count)
        const securityEvents = appendSecurityEvent(attempt.security_events_json, { type: reason, at: new Date().toISOString(), details: details || undefined })
        const finished = await finishAttemptByPolicy({ attemptId: attempt._id, tokenHash, reason, answersJson: attempt.answers_json || {}, securityEventsJson: securityEvents, tabSwitchCount })
        if (!finished) return res.status(409).json({ success: false, message: 'Urinish allaqachon yakunlangan yoki yangilangan.' })

        return res.json({ success: true, data: { score: 0, total: attempt.total, percentage: 0, timedOut: false, endedByPolicy: true, reason: "Kiosk siyosati bo'yicha test yakunlandi.", ended_reason: reason } })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

app.post('/api/test/submit', requireSameOrigin, limitTestSubmitRequests, async (req, res) => {
    try {
        const attemptToken = normalizeText(String(req.body.attemptToken || ''), 128)
        const answers = req.body.answers
        if (!req.body.attemptId || !attemptToken || !isPlainObject(answers)) return res.status(400).json({ success: false, message: "Noto'g'ri ma'lumot" })

        let attempt
        try { attempt = await TestResult.findById(req.body.attemptId) } catch { return res.status(400).json({ success: false, message: "Noto'g'ri ID" }) }
        if (!attempt) return res.status(404).json({ success: false, message: 'Urinish topilmadi' })
        if (attempt.finished_at) return res.status(403).json({ success: false, message: 'Test allaqachon topshirilgan' })
        if (!attempt.attempt_token_hash) return res.status(403).json({ success: false, message: 'Urinish tokeni yaroqsiz' })

        const tokenHash = hashToken(attemptToken)
        if (!safeStringCompare(attempt.attempt_token_hash, tokenHash)) return res.status(403).json({ success: false, message: 'Urinish tokeni yaroqsiz' })

        const elapsedMs = Date.now() - new Date(attempt.started_at).getTime()
        const timedOut = elapsedMs > (TEST_DURATION_MIN + 1) * 60 * 1000

        const questionOrder = Array.isArray(attempt.question_order) ? attempt.question_order : []
        if (!questionOrder.length) return res.status(400).json({ success: false, message: 'Savollar tartibi buzilgan' })

        const questionDocs = await QuestionBank.find({ _id: { $in: questionOrder } }).lean()
        const questionsById = new Map(questionDocs.map((q) => [String(q._id), parseQuestionRow(q)]))
        if (!questionDocs.length) return res.status(400).json({ success: false, message: 'Savollar topilmadi' })

        const cleanedAnswers = {}
        let score = 0
        for (const questionId of questionOrder) {
            const question = questionsById.get(String(questionId))
            if (!question) continue
            const rawAnswer = answers[String(questionId)]
            const normalizedAnswer = normalizeAnswerByQuestion(question, rawAnswer)
            if (normalizedAnswer !== null) cleanedAnswers[String(questionId)] = normalizedAnswer
            if (isAnswerCorrect(question, normalizedAnswer)) score++
        }

        if (timedOut) score = 0
        const endedReason = timedOut ? 'time_expired' : 'submitted'

        const updated = await TestResult.findOneAndUpdate(
            { _id: attempt._id, finished_at: null, attempt_token_hash: tokenHash },
            { score, answers_json: cleanedAnswers, finished_at: new Date(), attempt_token_hash: null, ended_reason: endedReason }
        )
        if (!updated) return res.status(409).json({ success: false, message: 'Test natijasi allaqachon saqlangan' })

        return res.json({ success: true, data: { score, total: attempt.total, percentage: attempt.total ? Math.round((score / attempt.total) * 100) : 0, timedOut } })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Server xatosi' })
    }
})

// ============ ADMIN: QUESTIONS ============
app.get('/api/admin/questions', requireAuth, async (req, res) => {
    const rows = await QuestionBank.find().sort({ _id: -1 }).lean()
    res.json({ success: true, data: rows.map(parseQuestionRow).map(serializeQuestionForAdmin) })
})

app.post('/api/admin/questions', requireAuth, requireSameOrigin, async (req, res) => {
    const parsed = parseQuestionPayload(req.body)
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error })
    const q = await QuestionBank.create({ text: parsed.value.text, question_type: parsed.value.questionType, question_payload: parsed.value.questionPayload, correct_answer_json: parsed.value.correctAnswer })
    res.json({ success: true, id: q._id })
})

app.put('/api/admin/questions/:id', requireAuth, requireSameOrigin, async (req, res) => {
    const parsed = parseQuestionPayload(req.body)
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error })
    try {
        const updated = await QuestionBank.findByIdAndUpdate(req.params.id, { text: parsed.value.text, question_type: parsed.value.questionType, question_payload: parsed.value.questionPayload, correct_answer_json: parsed.value.correctAnswer })
        if (!updated) return res.status(404).json({ success: false, message: 'Savol topilmadi' })
        res.json({ success: true })
    } catch { return res.status(400).json({ success: false, message: 'Noto`g`ri ID' }) }
})

app.delete('/api/admin/questions/:id', requireAuth, requireSameOrigin, async (req, res) => {
    try {
        const result = await QuestionBank.findByIdAndDelete(req.params.id)
        if (!result) return res.status(404).json({ success: false, message: 'Savol topilmadi' })
        res.json({ success: true })
    } catch { return res.status(400).json({ success: false, message: 'Noto`g`ri ID' }) }
})

app.post('/api/admin/questions/import', requireAuth, requireSameOrigin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Fayl yuklanmagan' })
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(req.file.buffer)
        const sheet = workbook.worksheets[0]
        if (!sheet) return res.status(400).json({ success: false, message: "Excel fayl bo'sh" })

        let added = 0, errors = 0
        const rows = []
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return
            if (rows.length >= MAX_IMPORT_ROWS) { errors++; return }
            const text = normalizeText(String(row.getCell(1).text || ''), MAX_QUESTION_LEN)
            const a = normalizeText(String(row.getCell(2).text || ''), MAX_OPTION_LEN)
            const b = normalizeText(String(row.getCell(3).text || ''), MAX_OPTION_LEN)
            const c = normalizeText(String(row.getCell(4).text || ''), MAX_OPTION_LEN)
            const d = normalizeText(String(row.getCell(5).text || ''), MAX_OPTION_LEN)
            const correct = normalizeText(String(row.getCell(6).text || '').toUpperCase(), 1)
            if (text && a && b && c && d && VALID_OPTIONS.has(correct)) rows.push({ text, a, b, c, d, correct })
            else errors++
        })

        for (const r of rows) {
            try {
                await QuestionBank.create({ text: r.text, question_type: 'single_choice', question_payload: { options: { A: r.a, B: r.b, C: r.c, D: r.d } }, correct_answer_json: { correctOption: r.correct } })
                added++
            } catch { errors++ }
        }

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
        { header: 'Savol', key: 'text', width: 50 }, { header: 'A varianti', key: 'a', width: 25 },
        { header: 'B varianti', key: 'b', width: 25 }, { header: 'C varianti', key: 'c', width: 25 },
        { header: 'D varianti', key: 'd', width: 25 }, { header: "To'g'ri javob (A/B/C/D)", key: 'correct', width: 22 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
    sheet.addRow({ text: 'Wi-Fi qaysi IEEE standartida ishlaydi?', a: '802.3', b: '802.11', c: '802.15', d: '802.16', correct: 'B' })
    sheet.addRow({ text: 'Bluetooth qaysi chastotada ishlaydi?', a: '900 MHz', b: '1.8 GHz', c: '2.4 GHz', d: '5 GHz', correct: 'C' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="savollar-shablon.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

// ============ ADMIN: RESULTS ============
app.get('/api/admin/results', requireAuth, async (req, res) => {
    const rows = await TestResult.find().populate('student_id', 'full_name direction course email phone').sort({ finished_at: -1, started_at: -1 }).lean()
    const data = rows.map((r) => ({
        id: r._id, score: r.score, total: r.total,
        started_at: r.started_at, finished_at: r.finished_at,
        tab_switch_count: r.tab_switch_count, ended_reason: r.ended_reason, client_mode: r.client_mode,
        full_name: r.student_id?.full_name, direction: r.student_id?.direction,
        course: r.student_id?.course, email: r.student_id?.email, phone: r.student_id?.phone,
    }))
    res.json({ success: true, data })
})

app.get('/api/admin/results/excel', requireAuth, async (req, res) => {
    const rows = await TestResult.find({ finished_at: { $ne: null } }).populate('student_id', 'full_name direction course email phone').sort({ score: -1, finished_at: 1 }).lean()
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Natijalar')
    sheet.columns = [
        { header: '#', key: 'n', width: 6 }, { header: 'F.I.Sh', key: 'full_name', width: 30 },
        { header: "Yo'nalish", key: 'direction', width: 28 }, { header: 'Kurs', key: 'course', width: 10 },
        { header: 'Email', key: 'email', width: 26 }, { header: 'Telefon', key: 'phone', width: 18 },
        { header: 'Ball', key: 'score', width: 10 }, { header: 'Jami', key: 'total', width: 10 },
        { header: '%', key: 'pct', width: 8 }, { header: 'Rejim', key: 'client_mode', width: 10 },
        { header: 'Tab switch', key: 'tab_switch_count', width: 12 }, { header: 'Yakun sababi', key: 'ended_reason', width: 22 },
        { header: 'Boshlangan', key: 'started_at', width: 20 }, { header: 'Tugatgan', key: 'finished_at', width: 20 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
    rows.forEach((r, i) => {
        const s = r.student_id || {}
        sheet.addRow({
            n: i + 1, full_name: sanitizeSpreadsheetCell(s.full_name || ''), direction: sanitizeSpreadsheetCell(s.direction || ''),
            course: sanitizeSpreadsheetCell(s.course || ''), email: sanitizeSpreadsheetCell(s.email || ''),
            phone: sanitizeSpreadsheetCell(s.phone || ''), score: r.score, total: r.total,
            pct: r.total ? Math.round((r.score / r.total) * 100) + '%' : '-',
            client_mode: sanitizeSpreadsheetCell(r.client_mode || 'web'),
            tab_switch_count: parseNonNegativeInt(r.tab_switch_count),
            ended_reason: sanitizeSpreadsheetCell(r.ended_reason || 'submitted'),
            started_at: r.started_at ? new Date(r.started_at).toLocaleString('uz') : '',
            finished_at: r.finished_at ? new Date(r.finished_at).toLocaleString('uz') : '',
        })
    })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="test-natijalari.xlsx"')
    await workbook.xlsx.write(res)
    res.end()
})

// ============ KIOSK WATCHDOG ============
async function runKioskHeartbeatWatchdog() {
    try {
        const nowMs = Date.now()
        const timeoutMs = KIOSK_HEARTBEAT_TIMEOUT_SEC * 1000
        const attempts = await TestResult.find({ finished_at: null, client_mode: 'kiosk', attempt_token_hash: { $ne: null } })

        for (const attempt of attempts) {
            const heartbeatMs = attempt.last_heartbeat_at ? new Date(attempt.last_heartbeat_at).getTime() : new Date(attempt.started_at).getTime()
            if (!heartbeatMs || nowMs - heartbeatMs <= timeoutMs) continue
            const securityEvents = appendSecurityEvent(attempt.security_events_json, { type: 'kiosk_heartbeat_lost', at: new Date().toISOString(), details: 'watchdog-timeout' })
            await TestResult.findOneAndUpdate(
                { _id: attempt._id, finished_at: null, client_mode: 'kiosk' },
                { score: 0, finished_at: new Date(), attempt_token_hash: null, ended_reason: 'kiosk_heartbeat_lost', security_events_json: securityEvents, tab_switch_count: parseNonNegativeInt(attempt.tab_switch_count) }
            )
        }
    } catch (err) {
        console.error('Heartbeat watchdog xatosi:', err)
    }
}

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'Excel fayl hajmi 2 MB dan oshmasligi kerak' })
        return res.status(400).json({ success: false, message: 'Faylni yuklashda xatolik' })
    }
    if (err && err.message === 'Faqat .xlsx formatdagi fayl yuklash mumkin.') return res.status(400).json({ success: false, message: err.message })
    if (err) { console.error(err); return res.status(500).json({ success: false, message: 'Server xatosi' }) }
    return next()
})

// ============ START SERVER ============
async function startServer() {
    const mongoUri = MONGODB_URI || 'mongodb://localhost:27017/olimpiada'
    await mongoose.connect(mongoUri)
    console.log('MongoDB ga ulandi!')

    const heartbeatWatchdogTimer = setInterval(runKioskHeartbeatWatchdog, WATCHDOG_INTERVAL_MS)
    if (typeof heartbeatWatchdogTimer.unref === 'function') heartbeatWatchdogTimer.unref()

    app.listen(PORT, () => {
        console.log('\n  Simsiz tarmoqlar olimpiadasi serveri (MongoDB)')
        console.log(`  Ro'yxatdan o'tish:  http://localhost:${PORT}`)
        console.log(`  Admin panel:         http://localhost:${PORT}/login.html`)
        console.log(`  Test sahifasi:       http://localhost:${PORT}/test.html`)
        console.log(`  Admin user:          ${ADMIN_USER}`)
        console.log(`  Test davomiyligi:    ${TEST_DURATION_MIN} daqiqa\n`)
    })
}

startServer().catch((err) => {
    console.error('Server ishga tushmadi:', err)
    process.exit(1)
})
