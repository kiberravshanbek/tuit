let registrationOpen = true
const REG_TEXT = {
    uz: { msg:"Ro'yxatdan o'tish yopilgan. Vaqt tugadi.", btn:"Ro'yxatdan o'tish yopildi" },
    ru: { msg:"Регистрация закрыта. Время истекло.", btn:"Регистрация закрыта" }
}

function applyRegistrationState() {
    if (registrationOpen) return
    const lang = localStorage.getItem('lang') || 'uz'
    const t = REG_TEXT[lang] || REG_TEXT.uz
    const form = document.getElementById('regForm')
    const btn = document.getElementById('submitBtn')
    const msg = document.getElementById('message')
    if (form) form.querySelectorAll('input,select,button').forEach((el) => { el.disabled = true })
    if (btn) btn.textContent = t.btn
    if (msg) { msg.textContent = t.msg; msg.className = 'message error' }
}

async function loadRegistrationStatus() {
    try {
        const res = await fetch('/api/registration-status')
        const data = await res.json()
        registrationOpen = !!(data && data.open)
    } catch {
        registrationOpen = true
    }
    applyRegistrationState()
}

loadRegistrationStatus()

document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('submitBtn')
    const msg = document.getElementById('message')
    const formData = new FormData(e.target)
    const payload = Object.fromEntries(formData.entries())
    const lang = localStorage.getItem('lang') || 'uz'

    const TR = {
        uz: { sending:"Yuborilmoqda...", btn:"Ro'yxatdan o'tish", suffix:" Test havolasi sizga alohida yuboriladi.", errDef:"Xatolik yuz berdi", serverErr:"Server bilan bog'lanishda xatolik" },
        ru: { sending:"Отправка...", btn:"Зарегистрироваться", suffix:" Ссылка на тест будет выдана отдельно.", errDef:"Произошла ошибка", serverErr:"Ошибка подключения к серверу" }
    }
    const MSG_RU = {
        "Barcha maydonlarni to`ldiring":"Заполните все поля",
        "Kurs qiymati noto`g`ri":"Неверное значение курса",
        "Email formati noto`g`ri":"Неверный формат email",
        "Telefon raqam formati noto`g`ri":"Неверный формат номера телефона",
        "Bu email allaqachon ro`yxatdan o`tgan":"Этот email уже зарегистрирован",
        "Muvaffaqiyatli ro`yxatdan o`tdingiz!":"Вы успешно зарегистрировались!",
        "Ro`yxatdan o`tish yopilgan. Vaqt tugadi.":"Регистрация закрыта. Время истекло.",
        "Server xatosi":"Ошибка сервера",
    }
    const t = TR[lang] || TR.uz
    const trMsg = (m) => { if (!m||lang!=='ru') return m; return MSG_RU[m]||m }

    if (!registrationOpen) {
        const rt = REG_TEXT[lang] || REG_TEXT.uz
        msg.textContent = rt.msg
        msg.className = 'message error'
        return
    }

    btn.disabled = true; btn.textContent = t.sending
    msg.className = 'message hidden'
    try {
        const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
        const data = await res.json()
        if (data.success) { msg.textContent = "✅ " + trMsg(data.message) + t.suffix; msg.className = 'message success'; e.target.reset() }
        else { msg.textContent = '❌ ' + trMsg(data.message || t.errDef); msg.className = 'message error' }
    } catch { msg.textContent = '❌ ' + t.serverErr; msg.className = 'message error' }
    finally { btn.disabled = false; btn.textContent = t.btn }
})
