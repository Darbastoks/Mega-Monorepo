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
    const closeBtn = modal ? modal.querySelector('.close-modal') : null;

    if (modal && modalImg && closeBtn) {
        serviceCards.forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A') {
                    const imgSrc = card.getAttribute('data-preview');
                    if (imgSrc) {
                        modalImg.src = imgSrc;
                        modal.classList.add('show');
                        document.body.style.overflow = 'hidden';
                    }
                }
            });
        });

        const closeModal = () => {
            modal.classList.remove('show');
            document.body.style.overflow = 'auto';
            setTimeout(() => { modalImg.src = ''; }, 300);
        };

        closeBtn.addEventListener('click', closeModal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });
    }

    // FAQ Accordion
    document.querySelectorAll('.faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            const isOpen = item.classList.contains('active');
            document.querySelectorAll('.faq-item.active').forEach(open => {
                if (open !== item) open.classList.remove('active');
            });
            item.classList.toggle('active', !isOpen);
        });
    });
});

// ================================================================
// PRICING, ADD-ONS & STRIPE CHECKOUT
// ================================================================
(async function initPricing() {
    const toggle = document.getElementById('billing-toggle');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual = document.getElementById('label-annual');
    const priceDisplays = document.querySelectorAll('.pricing-card .price');
    const planBtns = document.querySelectorAll('.plan-btn');
    const purchaseModal = document.getElementById('purchaseModal');

    if (!toggle || planBtns.length === 0) return;

    // State
    let catalog = { plans: {}, addons: {} };
    let isAnnual = false;
    let selectedPlan = null;
    let selectedAddons = new Set();

    // Fetch catalog from server
    try {
        const res = await fetch('/api/prices');
        catalog = await res.json();
    } catch (e) {
        console.warn('Could not load prices:', e.message);
    }

    const billingCycle = () => isAnnual ? 'annual' : 'monthly';
    const cycleLabel = () => isAnnual ? '/metus' : '/mėn';

    // --- Toggle UI ---
    function updateToggleUI() {
        if (isAnnual) {
            labelMonthly.classList.remove('active');
            labelAnnual.classList.add('active');
        } else {
            labelMonthly.classList.add('active');
            labelAnnual.classList.remove('active');
        }
        priceDisplays.forEach(el => {
            const html = isAnnual ? el.dataset.annualHtml : el.dataset.monthlyHtml;
            if (html) el.innerHTML = html;
        });
    }

    toggle.addEventListener('change', function () {
        isAnnual = this.checked;
        updateToggleUI();
        // Re-render modal if open
        if (purchaseModal && purchaseModal.classList.contains('show')) {
            renderPlanHeader();
            renderAddons();
            renderSummary();
        }
    });

    // --- Plan button click: open purchase modal ---
    planBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            selectedPlan = this.dataset.plan;
            selectedAddons.clear();
            openPurchaseModal();
        });
    });

    // --- Purchase Modal ---
    if (!purchaseModal) return;

    function openPurchaseModal() {
        renderPlanHeader();
        renderAddons();
        showPurchaseStep(1);
        purchaseModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closePurchaseModal() {
        purchaseModal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }

    document.getElementById('closePurchaseModal').addEventListener('click', closePurchaseModal);
    purchaseModal.addEventListener('click', (e) => {
        if (e.target === purchaseModal) closePurchaseModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && purchaseModal.classList.contains('show')) {
            closePurchaseModal();
        }
    });

    // --- Modal step navigation ---
    function showPurchaseStep(step) {
        document.querySelectorAll('.purchase-step-content').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.pstep) === step);
        });
        document.querySelectorAll('.purchase-step').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.pstep) === step);
        });
        if (step === 2) renderSummary();
    }

    document.getElementById('toSummary').addEventListener('click', () => showPurchaseStep(2));
    document.getElementById('skipAddons').addEventListener('click', () => {
        selectedAddons.clear();
        showPurchaseStep(2);
    });
    document.getElementById('backToAddons').addEventListener('click', () => showPurchaseStep(1));

    // --- Render plan header ---
    function renderPlanHeader() {
        const header = document.getElementById('purchasePlanHeader');
        const plan = catalog.plans[selectedPlan];
        if (!plan || !header) return;
        const cycle = billingCycle();
        header.innerHTML = `
            <span class="plan-name">${plan.label} planas</span>
            <span class="plan-price">${plan[cycle].display}€${cycleLabel()}</span>
        `;
    }

    // --- Render add-on cards ---
    function renderAddons() {
        const grid = document.getElementById('addonsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        for (const [key, addon] of Object.entries(catalog.addons)) {
            const cycle = billingCycle();
            const price = addon[cycle].display;
            const isSelected = selectedAddons.has(key);

            const card = document.createElement('div');
            card.className = `addon-card${isSelected ? ' selected' : ''}`;
            card.dataset.addon = key;
            card.innerHTML = `
                <div class="addon-icon"><i class="fas ${addon.icon}"></i></div>
                <div class="addon-info">
                    <h4>${addon.label}</h4>
                    <p>${addon.description}</p>
                </div>
                <div class="addon-price">+${price}€${cycleLabel()}</div>
                <div class="addon-check">${isSelected ? '<i class="fas fa-check"></i>' : ''}</div>
            `;
            card.addEventListener('click', () => {
                if (selectedAddons.has(key)) {
                    selectedAddons.delete(key);
                } else {
                    selectedAddons.add(key);
                }
                renderAddons();
            });
            grid.appendChild(card);
        }
    }

    // --- Render order summary ---
    function renderSummary() {
        const summaryEl = document.getElementById('orderSummary');
        const totalEl = document.getElementById('orderTotal');
        if (!summaryEl || !totalEl) return;

        const cycle = billingCycle();
        const plan = catalog.plans[selectedPlan];
        if (!plan) return;

        let total = plan[cycle].display;

        let html = `<div class="order-line plan-line">
            <span class="line-label"><i class="fas fa-crown" style="color:#22d3ee;margin-right:6px"></i>${plan.label} planas</span>
            <span class="line-price">${plan[cycle].display}€${cycleLabel()}</span>
        </div>`;

        for (const key of selectedAddons) {
            const addon = catalog.addons[key];
            if (!addon) continue;
            const price = addon[cycle].display;
            total += price;
            html += `<div class="order-line">
                <span class="line-label"><i class="fas ${addon.icon}" style="color:#94a3b8;margin-right:6px;font-size:0.85em"></i>${addon.label}</span>
                <span class="line-price">+${price}€${cycleLabel()}</span>
            </div>`;
        }

        summaryEl.innerHTML = html;
        totalEl.innerHTML = `<span>Iš viso:</span><span>${total}€${cycleLabel()}</span>`;
    }

    // --- Checkout ---
    document.getElementById('checkoutBtn').addEventListener('click', async function () {
        const cycle = billingCycle();
        const plan = catalog.plans[selectedPlan];
        if (!plan) return;

        const priceIds = [plan[cycle].priceId];
        for (const key of selectedAddons) {
            const addon = catalog.addons[key];
            if (addon) priceIds.push(addon[cycle].priceId);
        }

        // Save to localStorage for thank-you page
        localStorage.setItem('velora_order', JSON.stringify({
            plan: selectedPlan,
            addons: Array.from(selectedAddons),
            billingCycle: cycle,
        }));

        const originalText = this.innerHTML;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kraunama...';
        this.disabled = true;

        try {
            const res = await fetch('/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priceIds }),
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
            this.innerHTML = originalText;
            this.disabled = false;
        }
    });
}());

// ================================================================
// ONBOARDING WIZARD FORM (thank-you.html)
// ================================================================
(async function initWizard() {
    const form = document.getElementById('onboarding-form');
    if (!form) return;

    // Read order data from localStorage
    let order = JSON.parse(localStorage.getItem('velora_order') || '{}');

    // Fallback: if no plan in localStorage, fetch from Stripe session
    if (!order.plan) {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        if (sessionId) {
            try {
                const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
                if (res.ok) {
                    const data = await res.json();
                    order = { plan: data.plan, addons: data.addons };
                    localStorage.setItem('velora_order', JSON.stringify(order));
                }
            } catch (e) {
                console.warn('Could not fetch session data:', e.message);
            }
        }
    }

    const purchasedAddons = new Set(order.addons || []);

    const steps = Array.from(form.querySelectorAll('.wizard-step'));
    const progressSteps = Array.from(form.querySelectorAll('.progress-step'));
    const progressBar = document.getElementById('progress-bar');
    const btnPrev = form.querySelector('.wizard-prev');
    const btnNext = form.querySelector('.wizard-next');
    const btnSubmit = form.querySelector('.wizard-submit');
    const successEl = document.getElementById('form-success');

    // Track toggle choices
    const choices = {};
    let currentStep = 0;

    // Hide add-on steps that weren't purchased
    steps.forEach(step => {
        const addonKey = step.dataset.addon;
        if (addonKey && !purchasedAddons.has(addonKey)) {
            step.dataset.hidden = 'true';
        }
    });

    function getVisibleStepIndices() {
        const indices = [];
        steps.forEach((step, i) => {
            // Skip hidden add-on steps
            if (step.dataset.hidden === 'true') return;
            // Skip conditional steps where user chose "No"
            const cond = step.dataset.conditional;
            if (cond && choices[cond] === false) return;
            indices.push(i);
        });
        return indices;
    }

    function showStep(index) {
        steps.forEach((s, i) => {
            s.classList.toggle('active', i === index);
        });

        const visibleIndices = getVisibleStepIndices();
        const currentVisiblePos = visibleIndices.indexOf(index);
        const totalVisible = visibleIndices.length;

        progressSteps.forEach((ps, i) => {
            const stepNum = parseInt(ps.dataset.step) - 1;
            ps.classList.remove('active', 'completed');
            if (visibleIndices.indexOf(stepNum) === -1) {
                ps.style.display = 'none';
            } else {
                ps.style.display = 'flex';
                const visPos = visibleIndices.indexOf(stepNum);
                if (visPos < currentVisiblePos) {
                    ps.classList.add('completed');
                } else if (visPos === currentVisiblePos) {
                    ps.classList.add('active');
                }
            }
        });

        const pct = totalVisible > 1 ? (currentVisiblePos / (totalVisible - 1)) * 100 : 0;
        progressBar.style.width = pct + '%';

        btnPrev.style.display = currentVisiblePos > 0 ? 'inline-flex' : 'none';

        const isLast = currentVisiblePos === totalVisible - 1;
        btnNext.style.display = isLast ? 'none' : 'inline-flex';
        btnSubmit.style.display = isLast ? 'inline-flex' : 'none';

        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function getNextVisibleStep(from, direction) {
        const visibleIndices = getVisibleStepIndices();
        const currentVisiblePos = visibleIndices.indexOf(from);
        const nextPos = currentVisiblePos + direction;
        if (nextPos < 0 || nextPos >= visibleIndices.length) return -1;
        return visibleIndices[nextPos];
    }

    function validateStep(index) {
        const step = steps[index];
        const requiredInputs = step.querySelectorAll('input[required], textarea[required], select[required]');
        let valid = true;

        requiredInputs.forEach(input => {
            const group = input.closest('.form-group');
            const condParent = input.closest('.conditional-fields');
            if (condParent && condParent.style.display === 'none') return;

            if (!input.value.trim()) {
                group.classList.add('has-error');
                valid = false;
            } else {
                group.classList.remove('has-error');
            }

            if (input.type === 'email' && input.value.trim()) {
                const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRe.test(input.value.trim())) {
                    group.classList.add('has-error');
                    valid = false;
                }
            }
        });

        return valid;
    }

    // Toggle choice buttons (Yes/No)
    form.addEventListener('click', function(e) {
        const btn = e.target.closest('.choice-btn');
        if (!btn) return;

        const toggleEl = btn.closest('.toggle-choice');
        const field = toggleEl.dataset.field;
        const value = btn.dataset.value;

        toggleEl.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        choices[field] = value === 'yes';

        const conditionals = form.querySelectorAll(`.conditional-fields[data-show-when="${field}=yes"]`);
        conditionals.forEach(cf => {
            if (value === 'yes') {
                cf.style.display = 'block';
                cf.classList.add('visible');
            } else {
                cf.style.display = 'none';
                cf.classList.remove('visible');
            }
        });

        if (steps[currentStep].dataset.conditional === field) {
            showStep(currentStep);
        }
    });

    form.addEventListener('input', function(e) {
        const group = e.target.closest('.form-group');
        if (group) group.classList.remove('has-error');
    });

    btnNext.addEventListener('click', function() {
        if (!validateStep(currentStep)) return;
        const step = steps[currentStep];
        const cond = step.dataset.conditional;
        if (cond && choices[cond] === undefined) return;

        const next = getNextVisibleStep(currentStep, 1);
        if (next === -1) return;
        currentStep = next;
        showStep(currentStep);
    });

    btnPrev.addEventListener('click', function() {
        const prev = getNextVisibleStep(currentStep, -1);
        if (prev === -1) return;
        currentStep = prev;
        showStep(currentStep);
    });

    // Submit
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!validateStep(currentStep)) return;

        const val = (id) => {
            const el = form.querySelector('#' + id);
            return el ? el.value.trim() : '';
        };

        const data = {
            // Order metadata
            plan: order.plan || '',
            addons: order.addons || [],
            billing_cycle: order.billingCycle || '',

            // Core fields
            business_type: val('business_type'),
            salon_name: val('salon_name'),
            phone: val('phone'),
            email: val('email'),
            instagram: val('instagram'),
            facebook: val('facebook'),
            address: val('address'),
            services_prices: val('services_prices'),
            working_hours: val('working_hours'),

            // Design
            has_logo: choices.has_logo === true,
            preferred_colors: val('preferred_colors'),
            design_style: (function() {
                const checked = form.querySelector('input[name="design_style"]:checked');
                return checked ? checked.value : '';
            })(),
            brand_vibe: val('brand_vibe'),

            // Gallery
            gallery_count: val('gallery_count'),
            gallery_categories: val('gallery_categories'),

            // Add-on: Gift Cards
            gift_denominations: val('gift_denominations'),
            gift_design: val('gift_design'),

            // Add-on: Memberships
            membership_tiers: val('membership_tiers'),
            membership_perks: val('membership_perks'),

            // Add-on: Email Reminders
            email_timing: val('email_timing'),
            email_language: val('email_language'),

            // Add-on: SMS
            sms_timing: val('sms_timing'),
            sms_language: val('sms_language'),

            // Add-on: Inventory
            inventory_categories: val('inventory_categories'),
            inventory_notes: val('inventory_notes'),

            // Add-on: Products
            product_categories: val('product_categories'),
            product_pricing: val('product_pricing'),
            product_image_notes: val('product_image_notes'),

            // Extra
            notes: val('notes'),
        };

        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Siunčiama...';

        try {
            const res = await fetch('https://velora-ops.onrender.com/webhook/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                throw new Error('Serverio klaida: ' + res.status);
            }

            // Clear order from localStorage
            localStorage.removeItem('velora_order');

            form.style.display = 'none';
            successEl.style.display = 'block';
        } catch (err) {
            console.error('Onboarding submit error:', err);
            alert('Nepavyko išsiųsti formos. Bandykite dar kartą arba susisiekite su mumis el. paštu velorastudios.lt@gmail.com');
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Pateikti informaciją';
        }
    });

    // Initialize
    showStep(0);
}());
