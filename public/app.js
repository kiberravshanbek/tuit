document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('submitBtn')
    const msg = document.getElementById('message')
    const formData = new FormData(e.target)
    const payload = Object.fromEntries(formData.entries())

    btn.disabled = true
    btn.textContent = 'Yuborilmoqda...'
    msg.className = 'message hidden'

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (data.success) {
            msg.textContent = "✅ " + data.message + " Test havolasi sizga alohida yuboriladi."
            msg.className = 'message success'
            e.target.reset()
        } else {
            msg.textContent = '❌ ' + (data.message || 'Xatolik yuz berdi')
            msg.className = 'message error'
        }
    } catch (err) {
        msg.textContent = '❌ Server bilan bog\'lanishda xatolik'
        msg.className = 'message error'
    } finally {
        btn.disabled = false
        btn.textContent = "Ro'yxatdan o'tish"
    }
})

