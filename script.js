document.addEventListener('DOMContentLoaded', () => {
    // 1. Menu Ustawień
    const btn = document.getElementById('settingsBtn');
    const menu = document.getElementById('settingsMenu');
    btn.onclick = () => menu.classList.toggle('active');

    // 2. Obsługa opinii (Kwadratowe karty)
    fetch('testimonials.json')
        .then(r => r.json())
        .then(data => {
            const track = document.getElementById('testimonial-container');
            // Podwajamy dane dla płynnego zapętlenia
            const list = [...data, ...data]; 
            list.forEach(t => {
                const card = document.createElement('div');
                card.className = 'testimonial-card';
                card.innerHTML = `
                    <div class="user-info">
                        <img src="https://i.pravatar.cc/150?u=${t.name}" class="avatar">
                        <div>
                            <div class="user-name">${t.name}</div>
                            <div class="user-label">KLIENT</div>
                        </div>
                    </div>
                    <p>"${t.text}"</p>
                `;
                track.appendChild(card);
            });
        });

    AOS.init({ duration: 1200 });
});

// Funkcje dostępności
function toggleContrast() { document.body.classList.toggle('high-contrast'); }
function changeFontSize(size) { document.body.style.zoom = size; }
