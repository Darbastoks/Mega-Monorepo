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

    // --- NEW: Time Slot Logic for Hair ---
    const dateInput = document.getElementById('date');
    const timeSelect = document.getElementById('time');
    const timeSlots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

    const fetchTimes = async () => {
        const date = dateInput.value;
        if (!date) {
            timeSelect.disabled = true;
            return;
        }

        timeSelect.innerHTML = '<option value="" disabled selected>Kraunama...</option>';
        timeSelect.disabled = true;

        const serviceInput = document.getElementById('service');
        const serviceName = serviceInput ? encodeURIComponent(serviceInput.value) : '';

        try {
            const response = await fetch(`/api/hair/bookings/times/${date}?service=${serviceName}`);
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

    dateInput.addEventListener('change', fetchTimes);
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
            const response = await fetch('/api/hair/book', {
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
