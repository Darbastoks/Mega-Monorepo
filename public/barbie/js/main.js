// ==========================================
//  G Spot Barbershop — Main Frontend JS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initHeroParticles();
    initCounterAnimation();
    initScrollReveal();
    loadServices();
    initBookingForm();
});

// --- Navbar scroll effect & mobile toggle ---
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    // Close mobile menu on link click
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });
}

// --- Hero floating particles ---
function initHeroParticles() {
    const container = document.getElementById('heroParticles');
    if (!container) return;

    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'hero-particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 6 + 's';
        particle.style.animationDuration = (4 + Math.random() * 4) + 's';
        particle.style.width = (2 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;
        container.appendChild(particle);
    }
}

// --- Counter animation for hero stats ---
function initCounterAnimation() {
    const counters = document.querySelectorAll('.stat-number[data-target]');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseInt(el.dataset.target);
                animateCounter(el, target);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(c => observer.observe(c));
}

function animateCounter(el, target) {
    const duration = 2000;
    const start = performance.now();

    function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.floor(eased * target).toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = target.toLocaleString() + '+';
        }
    }

    requestAnimationFrame(update);
}

// --- Scroll reveal animations ---
function initScrollReveal() {
    const revealElements = document.querySelectorAll(
        '.about-card, .service-card, .gallery-item, .info-card, .section-header'
    );

    revealElements.forEach(el => el.classList.add('reveal'));

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('revealed');
                }, i * 100);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    revealElements.forEach(el => observer.observe(el));
}

// --- Load services from API ---
async function loadServices() {
    try {
        const res = await fetch('/api/barbie/services');
        const services = await res.json();

        // Render service cards
        const grid = document.getElementById('servicesGrid');
        if (grid) {
            grid.innerHTML = services.map(s => `
                <div class="service-card reveal">
                    <div class="service-card-header">
                        <h3>${s.name}</h3>
                        <span class="service-price">${s.price}€</span>
                    </div>
                    <p class="service-desc">${s.description || ''}</p>
                    <span class="service-duration">🕐 ~${s.duration} min</span>
                    <button class="service-book-btn" onclick="scrollToBooking('${s.name}')">
                        Registruotis →
                    </button>
                </div>
            `).join('');

            // Re-init reveal for dynamic content
            grid.querySelectorAll('.reveal').forEach(el => {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            entry.target.classList.add('revealed');
                            observer.unobserve(entry.target);
                        }
                    });
                }, { threshold: 0.1 });
                observer.observe(el);
            });
        }

        // Populate booking form select
        const select = document.getElementById('bookingService');
        if (select) {
            services.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.name;
                opt.textContent = `${s.name} — ${s.price}€`;
                select.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('Failed to load services:', err);
    }
}

// Scroll to booking and pre-select service
function scrollToBooking(serviceName) {
    const select = document.getElementById('bookingService');
    if (select) {
        select.value = serviceName;
    }
    document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
}

// --- Booking Form ---
function initBookingForm() {
    const form = document.getElementById('bookingForm');
    const dateInput = document.getElementById('bookingDate');
    const timeInput = document.getElementById('bookingTime');
    const slotsGrid = document.getElementById('timeSlotsGrid');

    if (!form || !dateInput || !timeInput || !slotsGrid) return;

    // Set min date to today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    dateInput.min = todayStr;

    // Set max date to 30 days from now
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 30);
    dateInput.max = maxDate.toISOString().split('T')[0];

    const fetchTimes = async () => {
        const date = dateInput.value;
        if (!date) return;

        slotsGrid.innerHTML = '<p class="time-placeholder">Kraunama...</p>';
        timeInput.value = ''; // Reset selected time

        const serviceInput = document.getElementById('bookingService');
        const serviceName = serviceInput ? encodeURIComponent(serviceInput.value) : '';

        try {
            const res = await fetch(`/api/barbie/bookings/times/${date}?service=${serviceName}`);
            const availableSlots = await res.json();

            if (!availableSlots || availableSlots.length === 0) {
                slotsGrid.innerHTML = '<p class="time-placeholder">Nėra laisvų laikų (arba nedirbame)</p>';
                return;
            }

            slotsGrid.innerHTML = ''; // Clear picker
            availableSlots.forEach(time => {
                const chip = document.createElement('div');
                chip.className = 'time-chip';
                chip.textContent = time;
                chip.addEventListener('click', () => {
                    // Remove active from others
                    slotsGrid.querySelectorAll('.time-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    timeInput.value = time;
                });
                slotsGrid.appendChild(chip);
            });
        } catch (err) {
            slotsGrid.innerHTML = '<p class="time-placeholder">Klaida kraunant laikus</p>';
            console.error(err);
        }
    };

    // When date or service changes, load available times dynamically
    dateInput.addEventListener('change', fetchTimes);
    const serviceDropdown = document.getElementById('bookingService');
    if (serviceDropdown) serviceDropdown.addEventListener('change', fetchTimes);

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('bookingSubmit');
        submitBtn.disabled = true;
        submitBtn.querySelector('span').textContent = 'Siunčiama...';

        const formData = {
            name: document.getElementById('bookingName').value.trim(),
            phone: document.getElementById('bookingPhone').value.trim(),
            email: document.getElementById('bookingEmail').value.trim(),
            service: document.getElementById('bookingService').value,
            date: document.getElementById('bookingDate').value,
            time: document.getElementById('bookingTime').value,
            message: document.getElementById('bookingMessage').value.trim(),
            website_url_fake: document.getElementById('website_url_fake').value // Anti-Spam Honeypot
        };

        try {
            const res = await fetch('/api/barbie/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await res.json();

            if (res.ok) {
                showToast('✅', data.message);
                form.reset();
                document.getElementById('bookingTime').innerHTML = '<option value="">Pirma pasirinkite datą...</option>';
            } else {
                showToast('❌', data.error);
            }
        } catch (err) {
            showToast('❌', 'Tinklo klaida. Bandykite dar kartą.');
        }

        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'Registruotis';
    });
}

// --- Toast notification ---
function showToast(icon, message) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Make scrollToBooking available globally
window.scrollToBooking = scrollToBooking;
