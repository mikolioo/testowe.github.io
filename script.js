document.addEventListener('DOMContentLoaded', () => {
    // 1. Menu Dostępności - Dodane zabezpieczenie (if), żeby nie wywalało błędu gdy przycisku nie ma
    const menuBtn = document.getElementById('menuBtn');
    const menuContent = document.getElementById('menuContent');
    
    if (menuBtn && menuContent) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            menuContent.classList.toggle('active');
        };
        window.onclick = () => menuContent.classList.remove('active');
    }

    // 2. Opinie (Kwadratowe karty) - DANE WPISANE NA SZTYWNO (BRAK BŁĘDU FETCH)
    const track = document.getElementById('testimonial-track');
    if (track) {
        const data = [
            { name: "xNothing", text: "Dobrze wykonany skrypt" },
            { name: "Milos18", text: "Polecam plugin na /duel" },
            { name: "Aspas", text: "Kurs renderów Polecam" }
        ];

        // Powielamy dla efektu płynnego przejścia (Marquee)
        const items = [...data, ...data, ...data, ...data];
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
    }

    // 3. Inicjalizacja animacji - ZABEZPIECZONA
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 1000,
            once: true // Zmień na true, żeby uniknąć migotania przy błędach deployu
        });
    }
});

// Funkcje accessibility - Wyniesione poza DOMContentLoaded, żeby były dostępne globalnie
function setAccessibility(type) {
    if(type === 'contrast') document.body.classList.toggle('high-contrast');
    if(type === 'font') {
        const currentSize = window.getComputedStyle(document.body).getPropertyValue('font-size');
        document.body.style.fontSize = (parseFloat(currentSize) + 2) + "px";
    }
}
