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
            if (window.innerWidth <= 768) {
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

    // Navbar scroll effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4)';
        } else {
            navbar.style.boxShadow = 'none';
        }
    });

    // Mouse interactive glow
    const cursorGlow = document.querySelector('.cursor-glow');
    if (cursorGlow) {
        document.addEventListener('mousemove', (e) => {
            requestAnimationFrame(() => {
                cursorGlow.style.left = `${e.clientX}px`;
                cursorGlow.style.top = `${e.clientY}px`;
            });
        });
    }

    // Interactive text glow
    const glowTexts = document.querySelectorAll('h1, h2, h3, .price, .badge');
    glowTexts.forEach(el => {
        el.style.setProperty('--mouse-x', '50%');
        el.style.setProperty('--mouse-y', '50%');

        el.addEventListener('mousemove', e => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            el.style.setProperty('--mouse-x', `${x}px`);
            el.style.setProperty('--mouse-y', `${y}px`);
            el.classList.add('glow-active');
        });

        el.addEventListener('mouseleave', () => {
            el.classList.remove('glow-active');
            el.style.setProperty('--mouse-x', '50%');
            el.style.setProperty('--mouse-y', '50%');
        });
    });

    // Modal Preview Logic for Service Cards
    const serviceCards = document.querySelectorAll('.service-card');
    const modal = document.getElementById('previewModal');
    const modalImg = document.getElementById('previewImage');
    const closeBtn = document.querySelector('.close-modal');

    if (modal && modalImg && closeBtn) {
        serviceCards.forEach(card => {
            card.addEventListener('click', (e) => {
                // Ignore clicks if somehow an actual link is clicked inside the card
                if (e.target.tagName !== 'A') {
                    const imgSrc = card.getAttribute('data-preview');
                    if (imgSrc) {
                        modalImg.src = imgSrc;
                        modal.classList.add('show');
                        document.body.style.overflow = 'hidden'; // Prevent scrolling in background
                    }
                }
            });
        });

        const closeModal = () => {
            modal.classList.remove('show');
            document.body.style.overflow = 'auto'; // Restore scrolling
            setTimeout(() => { modalImg.src = ''; }, 300); // Clear image after transition
        };

        closeBtn.addEventListener('click', closeModal);

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });
    }

    // --- NEW: Time Slot Logic for Velora ---
    const dateInput = document.getElementById('contactDate');
    const timeSelect = document.getElementById('contactTime');
    const timeSlots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

    if (dateInput && timeSelect) {
        dateInput.addEventListener('change', async () => {
            const date = dateInput.value;
            if (!date) {
                timeSelect.disabled = true;
                return;
            }

            timeSelect.innerHTML = '<option value="" disabled selected>Kraunama...</option>';
            timeSelect.disabled = true;

            try {
                const response = await fetch(`/api/velora/bookings/times/${date}`);
                const bookedTimes = await response.json();

                timeSelect.innerHTML = '<option value="" disabled selected>Pasirinkite laiką</option>';
                timeSlots.forEach(slot => {
                    const isBooked = bookedTimes.includes(slot);
                    const option = document.createElement('option');
                    option.value = slot;
                    option.textContent = slot;
                    if (isBooked) {
                        option.disabled = true;
                        option.textContent += ' (Užimta)';
                    }
                    timeSelect.appendChild(option);
                });
                timeSelect.disabled = false;
            } catch (error) {
                console.error('Error fetching times:', error);
                timeSelect.innerHTML = '<option value="" disabled selected>Klaida</option>';
            }
        });
    }

    // Contact Form Submission
    const contactForm = document.getElementById('veloraContactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = contactForm.querySelector('button');
            const originalText = btn.textContent;

            const formData = {
                name: document.getElementById('contactName').value,
                email: document.getElementById('contactEmail').value,
                date: document.getElementById('contactDate').value,
                time: document.getElementById('contactTime').value,
                message: document.getElementById('contactMessage').value
            };

            if (!formData.date || !formData.time) {
                alert('Prašome pasirinkti datą ir laiką.');
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Siunčiama...';

            try {
                const response = await fetch('/api/velora/leads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (response.ok) {
                    alert('Ačiū! Jūsų rezervacija gauta. Susisieksime netrukus.');
                    contactForm.reset();
                    timeSelect.disabled = true;
                    timeSelect.innerHTML = '<option value="">Pasirinkite datą</option>';
                } else {
                    const data = await response.json();
                    alert(data.error || 'Apgailestaujame, įvyko klaida. Bandykite dar kartą.');
                }
            } catch (error) {
                console.error('Error submitting form:', error);
                alert('Tinklo klaida. Patikrinkite ryšį.');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }
});

// ==================== PRICING TOGGLE (Monthly / Annual) ====================
(function () {
    const monthlyBtn = document.getElementById('toggleMonthly');
    const annualBtn = document.getElementById('toggleAnnual');
    const pill = document.querySelector('.toggle-pill');
    if (!monthlyBtn || !annualBtn || !pill) return;

    let isMonthly = true;

    // Position the pill on the active button
    function updatePill() {
        const activeBtn = isMonthly ? monthlyBtn : annualBtn;
        pill.style.width = activeBtn.offsetWidth + 'px';
        pill.style.transform = `translateX(${activeBtn.offsetLeft - 4}px)`;
    }

    // Update all card prices
    function updatePrices() {
        const cards = document.querySelectorAll('.pricing-card');
        cards.forEach(card => {
            const priceEl = card.querySelector('.price');
            const billingEl = card.querySelector('.billing-note');
            if (!priceEl) return;

            if (isMonthly) {
                const price = card.dataset.monthlyPrice;
                const period = card.dataset.monthlyPeriod;
                const oldPrice = card.dataset.monthlyOld;

                if (oldPrice) {
                    priceEl.innerHTML = `<span class="old-price">${oldPrice}€</span> ${price}€<span>${period}</span>`;
                } else {
                    priceEl.innerHTML = `${price}€<span>${period}</span>`;
                }
                if (billingEl) billingEl.textContent = 'Mokama kas mėnesį';
            } else {
                const price = card.dataset.annualPrice;
                const period = card.dataset.annualPeriod;
                const oldPrice = card.dataset.annualOld;

                if (oldPrice) {
                    priceEl.innerHTML = `<span class="old-price">${oldPrice}€</span> ${price}€<span>${period}</span>`;
                } else {
                    priceEl.innerHTML = `${price}€<span>${period}</span>`;
                }
                if (billingEl) billingEl.textContent = 'Mokama iš karto už visus metus';
            }
        });

        // Show/hide savings on all cards
        document.querySelectorAll('.annual-savings').forEach(el => {
            el.style.display = isMonthly ? 'none' : 'block';
        });
    }

    monthlyBtn.addEventListener('click', () => {
        if (isMonthly) return;
        isMonthly = true;
        monthlyBtn.classList.add('active');
        annualBtn.classList.remove('active');
        updatePill();
        updatePrices();
    });

    annualBtn.addEventListener('click', () => {
        if (!isMonthly) return;
        isMonthly = false;
        annualBtn.classList.add('active');
        monthlyBtn.classList.remove('active');
        updatePill();
        updatePrices();
    });

    // Initial pill size
    updatePill();
    window.addEventListener('resize', updatePill);
})();

// ==================== INTERACTIVE STARFIELD ====================
function initStarfield(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let stars = [];
    let mouseX = null;
    let mouseY = null;
    const STAR_COUNT = 180;
    const MAGNETIC_RADIUS = 250;
    const PULL_STRENGTH = 0.35;

    function resizeCanvas() {
        const section = canvas.parentElement;
        canvas.width = section.offsetWidth;
        canvas.height = section.offsetHeight;
    }

    function createStars() {
        stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                baseX: 0,
                baseY: 0,
                size: 0.5 + Math.random() * 2,
                opacity: Math.random(),
                speed: 0.005 + Math.random() * 0.02,
                phase: Math.random() * Math.PI * 2,
                offsetX: 0,
                offsetY: 0,
            });
            stars[i].baseX = stars[i].x;
            stars[i].baseY = stars[i].y;
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const time = Date.now() * 0.001;

        for (const star of stars) {
            star.opacity = 0.2 + 0.8 * Math.abs(Math.sin(time * star.speed * 10 + star.phase));

            let targetOffsetX = 0;
            let targetOffsetY = 0;

            if (mouseX !== null && mouseY !== null) {
                const dx = mouseX - star.baseX;
                const dy = mouseY - star.baseY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < MAGNETIC_RADIUS) {
                    const force = 1 - dist / MAGNETIC_RADIUS;
                    targetOffsetX = dx * force * PULL_STRENGTH;
                    targetOffsetY = dy * force * PULL_STRENGTH;
                }
            }

            star.offsetX += (targetOffsetX - star.offsetX) * 0.08;
            star.offsetY += (targetOffsetY - star.offsetY) * 0.08;

            const drawX = star.baseX + star.offsetX;
            const drawY = star.baseY + star.offsetY;

            ctx.beginPath();
            ctx.arc(drawX, drawY, star.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctx.fill();
        }

        requestAnimationFrame(animate);
    }

    const section = canvas.parentElement;
    section.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    });

    section.addEventListener('mouseleave', () => {
        mouseX = null;
        mouseY = null;
    });

    window.addEventListener('resize', () => {
        resizeCanvas();
        createStars();
    });

    resizeCanvas();
    createStars();
    animate();
}

// Initialize starfields on both sections
initStarfield('pricingStarfield');
initStarfield('servicesStarfield');

