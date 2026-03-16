document.addEventListener('DOMContentLoaded', () => {
    // 1. MENU HAMBURGER - Naprawione
    const menuBtn = document.getElementById('menuBtn');
    const menuContent = document.getElementById('menuContent');
    
    if (menuBtn && menuContent) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            menuContent.classList.toggle('active');
        };
        // Zamykanie przy kliknięciu obok
        window.onclick = () => menuContent.classList.remove('active');
    }

    // 2. OPINIE - Pobieranie z pliku z zabezpieczeniem
    const track = document.getElementById('testimonial-track');
    if (track) {
        fetch('testimonials.json')
            .then(response => {
                if (!response.ok) throw new Error('Brak pliku');
                return response.json();
            })
            .then(data => {
                const items = [...data, ...data, ...data]; // Powielenie dla płynnego ruchu
                items.forEach(item => {
                    const card = document.createElement('div');
                    card.className = 'testimonial-card';
                    card.innerHTML = `
                        <div class="user-info">
                            <img src="https://ui-avatars.com/api/?name=${item.name}&background=76b82a&color=fff" alt="User">
                            <div>
                                <strong>${item.name}</strong><br>
                                <small style="color:var(--primary)">KLIENT</small>
                            </div>
                        </div>
                        <p style="font-style: italic; color: #ccc;">"${item.text}"</p>
                    `;
                    track.appendChild(card);
                });
            })
            .catch(err => {
                console.log("Opinie wczytane statycznie przez błąd pliku");
                track.innerHTML = '<p style="padding: 20px;">Wczytywanie opinii...</p>';
            });
    }
});

// 3. FUNKCJE DOSTĘPNOŚCI (Wybór z menu)
function setAccessibility(type) {
    if(type === 'contrast') document.body.classList.toggle('high-contrast');
    if(type === 'font') {
        const currentSize = window.getComputedStyle(document.body).fontSize;
        document.body.style.fontSize = (parseFloat(currentSize) + 2) + "px";
    }
}
