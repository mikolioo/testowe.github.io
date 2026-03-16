document.addEventListener('DOMContentLoaded', () => {
    const testimonialContainer = document.getElementById('testimonial-container');

    // 1. Pobieranie opinii z pliku testimonials.json
    fetch('testimonials.json')
        .then(response => response.json())
        .then(data => {
            let currentIndex = 0;

            function showTestimonial(index) {
                const t = data[index];
                testimonialContainer.innerHTML = `
                    <div class="testimonial-card">
                        <div class="stars">⭐⭐⭐⭐⭐</div>
                        <p style="font-style: italic; font-size: 1.2rem;">"${t.text}"</p>
                        <h4 style="margin-top: 20px;">- ${t.name}</h4>
                    </div>
                `;
            }

            // Inicjalizacja pierwszej opinii
            showTestimonial(0);

            // 2. Automatyczny Slider co 5 sekund
            setInterval(() => {
                currentIndex = (currentIndex + 1) % data.length;
                showTestimonial(currentIndex);
            }, 5000);
        })
        .catch(err => console.error("Błąd ładowania opinii:", err));

    // Smooth scroll dla linków nawigacji
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
});
