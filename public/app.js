document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('submitBtn')
    const msg = document.getElementById('message')
    const formData = new FormData(e.target)
    const payload = Object.fromEntries(formData.entries())

    const lang = localStorage.getItem('lang') || 'uz'
    const t = {
        uz: {
            sending: "Yuborilmoqda...",
            submitBtn: "Ro'yxatdan o'tish",
            successSuffix: " Test havolasi sizga alohida yuboriladi.",
            errorDefault: "Xatolik yuz berdi",
            serverError: "Server bilan bog'lanishda xatolik",
        },
        ru: {
            sending: "Отправка...",
            submitBtn: "Зарегистрироваться",
            successSuffix: " Ссылка на тест будет выдана отдельно.",
            errorDefault: "Произошла ошибка",
            serverError: "Ошибка подключения к серверу",
        }
    }[lang] || {}

    const SERVER_MSG_RU = {
        "Barcha maydonlarni to`ldiring": "Заполните все поля",
        "Kurs qiymati noto`g`ri": "Неверное значение курса",
        "Email formati noto`g`ri": "Неверный формат email",
        "Telefon raqam formati noto`g`ri": "Неверный формат номера телефона",
        "Bu email allaqachon ro`yxatdan o`tgan": "Этот email уже зарегистрирован",
        "Muvaffaqiyatli ro`yxatdan o`tdingiz!": "Вы успешно зарегистрировались!",
        "Server xatosi": "Ошибка сервера",
        "Ro`yxatdan o`tish so`rovlari ko`payib ketdi. Keyinroq qayta urinib ko`ring.": "Слишком много запросов. Попробуйте позже.",
    }

    function translateMsg(m) {
        if (!m || lang !== 'ru') return m
        return SERVER_MSG_RU[m] || m
    }

    btn.disabled = true
    btn.textContent = t.sending
    msg.className = 'message hidden'

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (data.success) {
            msg.textContent = "✅ " + translateMsg(data.message) + (t.successSuffix || '')
            msg.className = 'message success'
            e.target.reset()
        } else {
            msg.textContent = '❌ ' + translateMsg(data.message || t.errorDefault)
            msg.className = 'message error'
        }
    } catch (err) {
        msg.textContent = '❌ ' + t.serverError
        msg.className = 'message error'
    } finally {
        btn.disabled = false
        btn.textContent = t.submitBtn
    }
})
