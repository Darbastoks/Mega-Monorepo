// ==========================================
//  G Spot Barbershop — Main Frontend JS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initHeroParticles();
    initCounterAnimation();
    initScrollReveal();
    initBookingForm();
});

// --- Navbar scroll effect & mobile toggle ---
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    if (!navbar || !navToggle || !navLinks) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

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
        const eased = 1 - Math.pow(1 - progress, 3);
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

// --- Booking Form ---
function initBookingForm() {
    const form = document.getElementById('bookingForm');
    if (!form) return;

    const dateInput = document.getElementById('bookingDate');
    const timeSelect = document.getElementById('bookingTime');
    const serviceSelect = document.getElementById('bookingService');

    if (!dateInput || !timeSelect) return;

    // --- flatpickr color-coded calendar ---
    let monthAvailability = {};

    const fetchTimes = async () => {
        const date = dateInput.value;
        if (!date) return;
        timeSelect.innerHTML = '<option value="">Kraunama...</option>';
        try {
            const res = await fetch(`/api/barbie/bookings/times/${date}`);
            const slots = await res.json();
            if (!slots || slots.length === 0) {
                timeSelect.innerHTML = '<option value="">Šią dieną laisvų laikų nėra</option>';
            } else {
                timeSelect.innerHTML = '<option value="">Pasirinkite laiką...</option>';
                slots.forEach(slot => {
                    const option = document.createElement('option');
                    option.value = slot;
                    option.textContent = slot;
                    timeSelect.appendChild(option);
                });
            }
        } catch (err) {
            console.error('Failed to load slots:', err);
            timeSelect.innerHTML = '<option value="">Klaida kraunant laikus</option>';
        }
    };

    async function loadMonthAvailability(year, month, instance) {
        try {
            const res = await fetch(`/api/barbie/availability-month?year=${year}&month=${month}`);
            monthAvailability = await res.json();
            instance.redraw();
        } catch (err) { console.error('Month availability error:', err); }
    }

    const fp = flatpickr(dateInput, {
        locale: 'lt',
        dateFormat: 'Y-m-d',
        minDate: 'today',
        disableMobile: true,
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const dt = dayElem.dateObj;
            const dateStr = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
            const status = monthAvailability[dateStr];
            if (status === 'red' || status === 'closed') dayElem.classList.add('day-red');
            else if (status === 'yellow') dayElem.classList.add('day-yellow');
            else if (status === 'green') dayElem.classList.add('day-green');
        },
        onChange: function() { fetchTimes(); },
        onMonthChange: function(sel, str, inst) { loadMonthAvailability(inst.currentYear, inst.currentMonth + 1, inst); },
        onOpen: function(sel, str, inst) { loadMonthAvailability(inst.currentYear, inst.currentMonth + 1, inst); }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('bookingSubmit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Siunčiama...</span>';

        const formData = {
            name: document.getElementById('bookingName').value,
            phone: document.getElementById('bookingPhone').value,
            email: document.getElementById('bookingEmail').value,
            service: document.getElementById('bookingService').value,
            date: document.getElementById('bookingDate').value,
            time: document.getElementById('bookingTime').value,
            message: document.getElementById('bookingMessage').value,
            website_url_fake: document.getElementById('website_url_fake').value
        };

        try {
            const res = await fetch('/api/barbie/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await res.json();

            if (res.ok) {
                showToast('✅', 'Registracija sėkminga! Susisieksime su jumis.');
                form.reset();
                timeSelect.innerHTML = '<option value="">Pirma pasirinkite datą...</option>';
            } else {
                showToast('❌', data.error || 'Serverio klaida');
            }
        } catch (err) {
            showToast('❌', 'Tinklo klaida. Bandykite dar kartą.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Registruotis</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>';
        }
    });
}

function showToast(icon, message) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastIcon || !toastMessage) return;

    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

// Helper per User Request to pre-select service when clicking "scrollToBooking" if it existed
window.scrollToBooking = (serviceName) => {
    const select = document.getElementById('bookingService');
    if (select) select.value = serviceName;
    document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
};
