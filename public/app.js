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
        "Server xatosi":"Ошибка сервера",
    }
    const t = TR[lang] || TR.uz
    const trMsg = (m) => { if (!m||lang!=='ru') return m; return MSG_RU[m]||m }

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
