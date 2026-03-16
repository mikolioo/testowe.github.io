document.addEventListener('DOMContentLoaded', () => {
    // 1. Menu Dostępności
    const menuBtn = document.getElementById('menuBtn');
    const menuContent = document.getElementById('menuContent');
    
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        menuContent.classList.toggle('active');
    };

    window.onclick = () => menuContent.classList.remove('active');

    // 2. Dynamiczne Opinie (Kwadratowe karty)
    fetch('testimonials.json')
        .then(r => r.json())
        .then(data => {
            const track = document.getElementById('testimonial-track');
            // Powielamy dla efektu płynnego przejścia
            const items = [...data, ...data, ...data];
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
                    <p style="font-style: italic; color: #555;">"${item.text}"</p>
                `;
                track.appendChild(card);
            });
        });

    // 3. Inicjalizacja animacji przy scrollowaniu
    AOS.init({
        duration: 1000,
        once: false, // Animacje odpalają się za każdym razem gdy wjeżdżają
        mirror: true
    });
});

// Funkcje accessibility
function setAccessibility(type) {
    if(type === 'contrast') document.body.classList.toggle('high-contrast');
    if(type === 'font') {
        const currentSize = document.body.style.fontSize || "16px";
        document.body.style.fontSize = parseInt(currentSize) + 2 + "px";
    }
}
