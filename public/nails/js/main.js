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
        let monthAvailability = {};

        const fetchTimes = async () => {
            const selectedDate = bDate.value;
            if (!selectedDate) {
                bTime.innerHTML = '<option value="" disabled selected>Pirmiau pasirinkite datą</option>';
                bTime.disabled = true;
                return;
            }
            bTime.innerHTML = '<option value="" disabled selected>Kraunama...</option>';
            bTime.disabled = true;
            const serviceInput = document.getElementById('bService');
            const serviceName = serviceInput ? encodeURIComponent(serviceInput.value) : '';
            try {
                const response = await fetch(`/api/nails/available-times?date=${selectedDate}&service=${serviceName}`);
                const data = await response.json();
                const availableTimes = data.availableSlots || [];
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
        };

        async function loadMonthAvailability(year, month, instance) {
            try {
                const res = await fetch(`/api/nails/availability-month?year=${year}&month=${month}`);
                monthAvailability = await res.json();
                instance.redraw();
            } catch (err) { console.error('Month availability error:', err); }
        }

        const fp = flatpickr(bDate, {
            locale: 'lt',
            dateFormat: 'Y-m-d',
            minDate: 'today',
            disableMobile: true,
            onDayCreate: function(dObj, dStr, fp, dayElem) {
                const dt = dayElem.dateObj;
                const today = new Date(); today.setHours(0,0,0,0);
                if (dt < today) { dayElem.classList.add('day-red'); return; }
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

        const bService = document.getElementById('bService');
        if (bService) {
            bService.addEventListener('change', fetchTimes);
        }
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
