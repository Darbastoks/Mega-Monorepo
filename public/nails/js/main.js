document.addEventListener('DOMContentLoaded', () => {
    // Mobile menu toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            const icon = hamburger.querySelector('i');
            if (navLinks.classList.contains('active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }

    // Close mobile menu when clicking a link
    const links = document.querySelectorAll('.nav-links a');
    links.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 900) {
                navLinks.classList.remove('active');
                const icon = hamburger.querySelector('i');
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    });

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('appear');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.fade-in').forEach(element => {
        observer.observe(element);
    });
    // Time fetching logic
    const bDate = document.getElementById('bDate');
    const bTime = document.getElementById('bTime');

    if (bDate && bTime) {
        // Prevent picking past dates
        const today = new Date().toISOString().split('T')[0];
        bDate.setAttribute('min', today);

        bDate.addEventListener('change', async () => {
            const selectedDate = bDate.value;
            if (!selectedDate) {
                bTime.innerHTML = '<option value="" disabled selected>Pirmiau pasirinkite datą</option>';
                bTime.disabled = true;
                return;
            }

            bTime.innerHTML = '<option value="" disabled selected>Kraunama...</option>';
            bTime.disabled = true;

            try {
                const response = await fetch(`/api/nails/available-times?date=${selectedDate}`);
                const data = await response.json();

                const bookedTimes = data.bookedTimes || [];

                // Define working hours 09:00 to 18:00
                const allTimes = [
                    '09:00', '10:00', '11:00', '12:00', '13:00',
                    '14:00', '15:00', '16:00', '17:00', '18:00'
                ];

                const availableTimes = allTimes.filter(t => !bookedTimes.includes(t));

                if (availableTimes.length === 0) {
                    bTime.innerHTML = '<option value="" disabled selected>Visi laikai užimti šią dieną</option>';
                } else {
                    bTime.innerHTML = '<option value="" disabled selected>Pasirinkite laiką</option>';
                    availableTimes.forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t;
                        opt.textContent = t;
                        bTime.appendChild(opt);
                    });
                    bTime.disabled = false;
                }

            } catch (err) {
                console.error(err);
                bTime.innerHTML = '<option value="" disabled selected>Klaida kraunant laikus</option>';
            }
        });
    }

    // Booking Form Submission to Node.js / SQLite Backend
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = bookingForm.querySelector('.btn-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Siunčiama...';

            const payload = {
                name: document.getElementById('bName').value,
                phone: document.getElementById('bPhone').value,
                service: document.getElementById('bService').value,
                date: document.getElementById('bDate').value,
                time: document.getElementById('bTime').value,
                notes: document.getElementById('bNotes').value,
                website_url_fake: document.getElementById('website_url_fake').value // Honeypot
            };

            try {
                const response = await fetch('/api/nails/reservations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    alert('Registracija sėkminga! Su jumis susisieksime patvirtinti laiką.');
                    bookingForm.reset();
                    document.getElementById('bTime').innerHTML = '<option value="" disabled selected>Pirmiau pasirinkite datą</option>';
                    document.getElementById('bTime').disabled = true;
                } else {
                    const data = await response.json();
                    alert(data.error || 'Įvyko klaida registruojantis.');
                }
            } catch (err) {
                alert('Tinklo klaida. Bandykite dar kartą vėliau.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Pateikti užklausą';
            }
        });
    }
});
