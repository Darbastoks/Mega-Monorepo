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

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', e => {
            const id = link.getAttribute('href');
            if (id === '#') return;
            const target = document.querySelector(id);
            if (target) {
                e.preventDefault();
                const offset = 80; // navbar height
                const top = target.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });

    // Active nav link highlight on scroll
    const sections = document.querySelectorAll('section[id]');
    const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

    const navObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                navAnchors.forEach(a => {
                    a.classList.toggle('nav-active', a.getAttribute('href') === '#' + id);
                });
            }
        });
    }, { rootMargin: '-40% 0px -55% 0px' });

    sections.forEach(s => navObserver.observe(s));

    // FAQ accordion
    document.querySelectorAll('.faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.parentElement;
            const wasActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item.active').forEach(el => el.classList.remove('active'));
            if (!wasActive) item.classList.add('active');
        });
    });

    // Stats count-up on scroll
    const statNums = document.querySelectorAll('.stat-number');
    if (statNums.length) {
        const statObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.target, 10);
                    const suffix = el.dataset.suffix || '';
                    const prefix = el.dataset.prefix || '';
                    const duration = 1200;
                    const start = performance.now();
                    function tick(now) {
                        const t = Math.min((now - start) / duration, 1);
                        const ease = 1 - Math.pow(1 - t, 3);
                        el.textContent = prefix + Math.round(target * ease) + suffix;
                        if (t < 1) requestAnimationFrame(tick);
                    }
                    requestAnimationFrame(tick);
                    statObserver.unobserve(el);
                }
            });
        }, { threshold: 0.5 });
        statNums.forEach(el => statObserver.observe(el));
    }
});

// ================================================================
// PRICING TOGGLE & STRIPE CHECKOUT
// ================================================================
(async function initPricing() {
    const toggle = document.getElementById('billing-toggle');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual = document.getElementById('label-annual');
    const priceDisplays = document.querySelectorAll('.pricing-card .price');
    const planBtns = document.querySelectorAll('.plan-btn');

    if (!toggle || planBtns.length === 0) return;

    // Fetch price IDs from server (not secret — just plan slugs)
    let prices = {};
    try {
        const res = await fetch('/api/prices');
        prices = await res.json();
    } catch (e) {
        console.warn('Could not load price IDs from server:', e.message);
    }

    let isAnnual = false;

    // Animated price counter
    function animateValue(el, from, to, duration, suffix, prefix) {
        const start = performance.now();
        prefix = prefix || '';
        function tick(now) {
            const t = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            const val = Math.round(from + (to - from) * ease);
            el.innerHTML = prefix + val + '€<span>' + suffix + '</span>';
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function extractPrice(html) {
        // Extract the main price number (ignoring old-price spans)
        const clean = html.replace(/<span class="old-price">.*?<\/span>\s*/g, '');
        const m = clean.match(/(\d+)€/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function extractOldPrice(html) {
        const m = html.match(/<span class="old-price">(\d+)€<\/span>/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function updateToggleUI() {
        if (isAnnual) {
            labelMonthly.classList.remove('active');
            labelAnnual.classList.add('active');
        } else {
            labelMonthly.classList.add('active');
            labelAnnual.classList.remove('active');
        }

        priceDisplays.forEach(el => {
            const fromHtml = isAnnual ? el.dataset.monthlyHtml : el.dataset.annualHtml;
            const toHtml = isAnnual ? el.dataset.annualHtml : el.dataset.monthlyHtml;
            if (!toHtml) return;

            const fromVal = extractPrice(fromHtml);
            const toVal = extractPrice(toHtml);
            const suffix = isAnnual ? '/metus' : '/mėn';
            const oldPrice = extractOldPrice(toHtml);
            const prefix = oldPrice ? '<span class="old-price">' + oldPrice + '€</span> ' : '';

            animateValue(el, fromVal, toVal, 600, suffix, prefix);
        });
    }

    toggle.addEventListener('change', function () {
        isAnnual = this.checked;
        updateToggleUI();
    });

    // Wire checkout buttons
    planBtns.forEach(btn => {
        btn.addEventListener('click', async function () {
            const plan = this.dataset.plan; // 'start' | 'growth' | 'pro'
            const billingCycle = isAnnual ? 'annual' : 'monthly';
            const priceId = prices[plan] && prices[plan][billingCycle];

            if (!priceId) {
                alert('Šiuo metu mokėjimai dar nesukonfigūruoti. Susisiekite su mumis tiesiogiai.');
                return;
            }

            const originalText = this.textContent;
            this.textContent = 'Kraunama...';
            this.disabled = true;

            try {
                const res = await fetch('/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priceId }),
                });
                const data = await res.json();

                if (data.url) {
                    window.location.href = data.url;
                } else {
                    throw new Error(data.error || 'Nežinoma klaida');
                }
            } catch (e) {
                console.error('Checkout error:', e);
                alert('Nepavyko atidaryti mokėjimo. Bandykite dar kartą arba susisiekite su mumis.');
                this.textContent = originalText;
                this.disabled = false;
            }
        });
    });
}());

