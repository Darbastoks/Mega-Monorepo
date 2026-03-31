document.addEventListener('DOMContentLoaded', () => {
    // Current Year for Footer
    document.getElementById('year').textContent = new Date().getFullYear();

    // Navbar Scroll Effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Booking Form Submission
    const bookingForm = document.getElementById('bookingForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.childNodes[0]; // Text node
    const spinner = document.getElementById('btnSpinner');
    const formMessage = document.getElementById('formMessage');

    // --- Time Slot Logic for Hair (flatpickr) ---
    const dateInput = document.getElementById('date');
    const timeSelect = document.getElementById('time');
    let monthAvailability = {};

    const fetchTimes = async () => {
        const date = dateInput.value;
        if (!date) { timeSelect.disabled = true; return; }
        timeSelect.innerHTML = '<option value="" disabled selected>Kraunama...</option>';
        timeSelect.disabled = true;
        const serviceInput = document.getElementById('service');
        const serviceName = serviceInput ? encodeURIComponent(serviceInput.value) : '';
        try {
            const response = await fetch(`/api/demo-hair/bookings/times/${date}?service=${serviceName}`);
            const availableSlots = await response.json();
            if (availableSlots.length === 0) {
                timeSelect.innerHTML = '<option value="" disabled selected>Visi laikai užimti šią dieną</option>';
            } else {
                timeSelect.innerHTML = '<option value="" disabled selected>Pasirinkite laiką</option>';
                availableSlots.forEach(slot => {
                    const option = document.createElement('option');
                    option.value = slot;
                    option.textContent = slot;
                    timeSelect.appendChild(option);
                });
                timeSelect.disabled = false;
            }
        } catch (error) {
            console.error('Error fetching times:', error);
            timeSelect.innerHTML = '<option value="" disabled selected>Klaida kraunant laikus</option>';
        }
    };

    async function loadMonthAvailability(year, month, instance) {
        try {
            const res = await fetch(`/api/demo-hair/availability-month?year=${year}&month=${month}`);
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

    const serviceInput = document.getElementById('service');
    if (serviceInput) {
        serviceInput.addEventListener('change', fetchTimes);
    }

    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // UI State: Loading
        spinner.style.display = 'inline-block';
        submitBtn.disabled = true;
        formMessage.className = 'form-message'; // reset

        const formData = {
            name: document.getElementById('name').value,
            phone: document.getElementById('phone').value,
            email: document.getElementById('email').value,
            service: document.getElementById('service').value,
            date: dateInput.value,
            time: timeSelect.value,
            message: document.getElementById('message').value,
            website_url_fake: document.getElementById('website_url_fake').value // Honeypot Field
        };

        if (!formData.time) {
            formMessage.textContent = 'Prašome pasirinkti laiką.';
            formMessage.classList.add('msg-error');
            spinner.style.display = 'none';
            submitBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch('/api/demo-hair/book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                formMessage.textContent = 'Ačiū! Jūsų užklausa buvo gauta.';
                formMessage.classList.add('msg-success');
                bookingForm.reset();
                timeSelect.disabled = true;
                timeSelect.innerHTML = '<option value="" disabled selected>Pirma pasirinkite datą...</option>';
            } else {
                formMessage.textContent = data.error || 'Įvyko klaida. Prašome bandyti dar kartą.';
                formMessage.classList.add('msg-error');
            }
        } catch (error) {
            console.error('Error submitting form:', error);
            formMessage.textContent = 'Tinklo klaida. Prašome bandyti vėliau.';
            formMessage.classList.add('msg-error');
        } finally {
            // UI State: Reset
            spinner.style.display = 'none';
            submitBtn.disabled = false;
        }
    });
});
