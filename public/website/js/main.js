// Loading screen
window.addEventListener('load', () => {
    const loader = document.getElementById('loadingScreen');
    if (loader) {
        setTimeout(() => {
            loader.classList.add('fade-out');
            setTimeout(() => loader.remove(), 400);
        }, 800);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // ============ TYPEWRITER EFFECT ============
    (function initTypewriter() {
        const el = document.getElementById('typewriter');
        if (!el) return;
        const words = ['kirpykloms', 'barberiams', 'nagų salonams', 'grožio studijoms'];
        let wordIdx = 0, charIdx = 0, isDeleting = false;

        function tick() {
            const word = words[wordIdx];
            if (isDeleting) {
                charIdx--;
                el.textContent = word.substring(0, charIdx);
                if (charIdx === 0) {
                    isDeleting = false;
                    wordIdx = (wordIdx + 1) % words.length;
                    setTimeout(tick, 300);
                    return;
                }
                setTimeout(tick, 40);
            } else {
                charIdx++;
                el.textContent = word.substring(0, charIdx);
                if (charIdx === word.length) {
                    isDeleting = true;
                    setTimeout(tick, 2000);
                    return;
                }
                setTimeout(tick, 80);
            }
        }
        setTimeout(tick, 500);
    })();

    // ============ SCROLL PROGRESS BAR ============
    (function initScrollProgress() {
        const bar = document.getElementById('scrollProgress');
        if (!bar) return;
        window.addEventListener('scroll', function() {
            var h = document.documentElement.scrollHeight - window.innerHeight;
            bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
        }, { passive: true });
    })();

    // ============ MOBILE MENU (slide-in + overlay) ============
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    const menuOverlay = document.querySelector('.menu-overlay');

    function closeMenu() {
        if (!navLinks) return;
        navLinks.classList.remove('active');
        if (menuOverlay) menuOverlay.classList.remove('active');
        const icon = hamburger && hamburger.querySelector('i');
        if (icon) { icon.classList.remove('fa-times'); icon.classList.add('fa-bars'); }
    }

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('active');
            if (menuOverlay) menuOverlay.classList.toggle('active', isOpen);
            const icon = hamburger.querySelector('i');
            icon.classList.toggle('fa-bars', !isOpen);
            icon.classList.toggle('fa-times', isOpen);
        });
    }

    if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

    // Close mobile menu when clicking a link
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeMenu();
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

    // Testimonials carousel
    const carousel = document.querySelector('.testimonials-carousel');
    const track = document.querySelector('.testimonials-track');
    if (carousel && track) {
        const cards = Array.from(track.querySelectorAll('.testimonial-card'));
        const totalOriginal = cards.length;
        let currentIndex = 0;
        let autoInterval;

        // Clone first 3 cards for seamless loop
        const clonesNeeded = Math.min(3, totalOriginal);
        for (let i = 0; i < clonesNeeded; i++) {
            track.appendChild(cards[i].cloneNode(true));
        }

        function getCardStep() {
            const card = track.querySelector('.testimonial-card');
            return card.offsetWidth + 24; // card width + gap
        }

        let isTransitioning = false;

        function advance() {
            if (isTransitioning) return;
            currentIndex++;
            const step = getCardStep();
            track.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)';
            track.style.transform = 'translateX(-' + (currentIndex * step) + 'px)';

            if (currentIndex >= totalOriginal) {
                isTransitioning = true;
                setTimeout(function() {
                    track.style.transition = 'none';
                    currentIndex = 0;
                    track.style.transform = 'translateX(0)';
                    // Force reflow before allowing next transition
                    track.offsetHeight;
                    isTransitioning = false;
                }, 650);
            }
        }

        function startAuto() {
            stopAuto();
            autoInterval = setInterval(advance, 3500);
        }

        function stopAuto() {
            clearInterval(autoInterval);
        }

        carousel.addEventListener('mouseenter', stopAuto);
        carousel.addEventListener('mouseleave', startAuto);

        // Touch/swipe support
        let touchStartX = 0;
        carousel.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            stopAuto();
        }, { passive: true });
        carousel.addEventListener('touchend', (e) => {
            const diff = touchStartX - e.changedTouches[0].screenX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    advance();
                } else if (!isTransitioning && currentIndex > 0) {
                    currentIndex--;
                    const step = getCardStep();
                    track.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)';
                    track.style.transform = 'translateX(-' + (currentIndex * step) + 'px)';
                }
            }
            startAuto();
        }, { passive: true });

        startAuto();
    }

    // FAQ accordion
    document.querySelectorAll('.faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.parentElement;
            const wasActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item.active').forEach(el => el.classList.remove('active'));
            if (!wasActive) item.classList.add('active');
        });
    });

    // ============ FLIP CARDS ============
    document.querySelectorAll('.flip-card').forEach(card => {
        card.addEventListener('click', () => {
            const wasFlipped = card.classList.contains('flipped');
            document.querySelectorAll('.flip-card.flipped').forEach(c => c.classList.remove('flipped'));
            if (!wasFlipped) card.classList.add('flipped');
        });
    });

    // ============ ABOUT ICON BOUNCE ON SCROLL ============
    const aboutIcons = document.querySelectorAll('.about-value-icon');
    if (aboutIcons.length) {
        const iconObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const icons = entry.target.querySelectorAll('.about-value-icon');
                    icons.forEach((icon, i) => {
                        setTimeout(() => icon.classList.add('icon-visible'), i * 150);
                    });
                    iconObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });
        const aboutSection = document.querySelector('.about-values');
        if (aboutSection) iconObserver.observe(aboutSection);
    }

    // ============ STEP SEQUENTIAL ANIMATION ============
    const steps = document.querySelectorAll('.step');
    if (steps.length) {
        const stepObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const allSteps = entry.target.querySelectorAll('.step');
                    allSteps.forEach((step, i) => {
                        setTimeout(() => step.classList.add('step-visible'), i * 200);
                    });
                    stepObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });
        const stepsGrid = document.querySelector('.steps-grid');
        if (stepsGrid) stepObserver.observe(stepsGrid);
    }

    // ============ COMPARISON ANIMATED ITEMS ============
    const compSection = document.querySelector('.comparison');
    if (compSection) {
        const compObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const items = compSection.querySelectorAll('.comparison-col ul li');
                    items.forEach((li, i) => {
                        setTimeout(() => li.classList.add('comp-visible'), i * 100);
                    });
                    compObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });
        compObserver.observe(compSection);
    }

    // ============ SUBTLE PARALLAX ============
    if (window.innerWidth > 768) {
        const auroraGlows = document.querySelectorAll('.aurora-glow-1, .aurora-glow-2, .aurora-glow-3');
        const floorGlow = document.querySelector('.floor-glow');
        let ticking = false;

        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    const y = window.scrollY;
                    auroraGlows.forEach(el => {
                        el.style.transform = 'translateY(' + (y * 0.3) + 'px)';
                    });
                    if (floorGlow) {
                        floorGlow.style.transform = 'translateY(' + (y * 0.15) + 'px)';
                    }
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

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

    // Wire checkout buttons — show overlay first, then proceed to Stripe
    const checkoutOverlay = document.getElementById('checkout-overlay');
    const checkoutClose = document.getElementById('checkout-close');
    const checkoutPayBtn = document.getElementById('checkout-pay-btn');
    const checkoutPlanName = document.getElementById('checkout-plan-name');
    const checkoutPlanPrice = document.getElementById('checkout-plan-price');
    let pendingPriceId = null;

    const planNames = { start: 'START', growth: 'GROWTH', pro: 'PRO' };
    const planPrices = {
        start: { monthly: '25€<span>/mėn</span>', annual: '199€<span>/metus</span>' },
        growth: { monthly: '39€<span>/mėn</span>', annual: '349€<span>/metus</span>' },
        pro: { monthly: '59€<span>/mėn</span>', annual: '399€<span>/metus</span>' }
    };

    function showCheckoutOverlay(plan, billingCycle, priceId) {
        pendingPriceId = priceId;
        if (checkoutPlanName) checkoutPlanName.textContent = planNames[plan] || plan.toUpperCase();
        if (checkoutPlanPrice) checkoutPlanPrice.innerHTML = planPrices[plan] ? planPrices[plan][billingCycle] : '';
        if (checkoutOverlay) { checkoutOverlay.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    }

    function hideCheckoutOverlay() {
        if (checkoutOverlay) { checkoutOverlay.style.display = 'none'; document.body.style.overflow = ''; }
        pendingPriceId = null;
    }

    if (checkoutClose) checkoutClose.addEventListener('click', hideCheckoutOverlay);
    if (checkoutOverlay) checkoutOverlay.addEventListener('click', (e) => { if (e.target === checkoutOverlay) hideCheckoutOverlay(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCheckoutOverlay(); });

    if (checkoutPayBtn) {
        checkoutPayBtn.addEventListener('click', async () => {
            if (!pendingPriceId || checkoutPayBtn.disabled) return;
            checkoutPayBtn.disabled = true;
            checkoutPayBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kraunama...';

            try {
                const res = await fetch('/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priceId: pendingPriceId }),
                });
                const data = await res.json();
                if (data.url) {
                    window.location.href = data.url;
                } else {
                    throw new Error(data.error || 'Nežinoma klaida');
                }
            } catch (e) {
                console.error('Checkout error:', e);
                alert('Nepavyko atidaryti mokėjimo. Bandykite dar kartą.');
                checkoutPayBtn.disabled = false;
                checkoutPayBtn.innerHTML = '<i class="fas fa-lock"></i> Apmokėti dabar';
            }
        });
    }

    planBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const plan = this.dataset.plan;
            const billingCycle = isAnnual ? 'annual' : 'monthly';
            const priceId = prices[plan] && prices[plan][billingCycle];

            if (!priceId) {
                alert('Šiuo metu mokėjimai dar nesukonfigūruoti. Susisiekite su mumis tiesiogiai.');
                return;
            }

            showCheckoutOverlay(plan, billingCycle, priceId);
        });
    });
}());

