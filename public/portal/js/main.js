(function() {
    const API = '/api/portal';
    let profile = null;

    const CATEGORY_LABELS = {
        text: 'Teksto pakeitimai',
        visual: 'Vizualiniai pakeitimai',
        service: 'Paslaugos / kainos'
    };

    const STATUS_LABELS = {
        new: 'Nauja',
        in_progress: 'Vykdoma',
        completed: 'Atlikta',
        rejected: 'Atmesta'
    };

    const PLAN_NAMES = {
        free: 'Nemokamas',
        start: 'START planas',
        growth: 'GROWTH planas',
        pro: 'PRO planas'
    };

    const PLAN_LIMITS = { free: 0, start: 0, growth: 3, pro: Infinity };

    // Google Sign-In callback
    window.handleGoogleSignIn = async function(response) {
        const loginError = document.getElementById('loginError');
        loginError.textContent = '';
        try {
            const res = await fetch(`${API}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Prisijungimas nepavyko');
            showDashboard(data.profile);
        } catch (err) {
            loginError.textContent = err.message;
        }
    };

    async function checkSession() {
        try {
            const res = await fetch(`${API}/auth/check`);
            const data = await res.json();
            if (data.loggedIn) {
                showDashboard(data.profile);
            } else {
                showLogin();
            }
        } catch {
            showLogin();
        }
    }

    function showLogin() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
        initGoogleButton();
    }

    function initGoogleButton() {
        if (!window.google || !window.google.accounts) {
            setTimeout(initGoogleButton, 200);
            return;
        }
        google.accounts.id.initialize({
            client_id: window.GOOGLE_CLIENT_ID,
            callback: handleGoogleSignIn
        });
        google.accounts.id.renderButton(
            document.getElementById('googleBtnWrap'),
            { theme: 'filled_black', size: 'large', width: 300, text: 'signin_with', locale: 'lt' }
        );
    }

    function showDashboard(p) {
        profile = p;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';

        // Header
        document.getElementById('userName').textContent = p.google_name || p.google_email;
        const pic = document.getElementById('userPicture');
        if (p.google_picture) { pic.src = p.google_picture; pic.style.display = 'block'; }
        else { pic.style.display = 'none'; }

        // Profile card
        const profilePic = document.getElementById('profilePicture');
        if (p.google_picture) { profilePic.src = p.google_picture; profilePic.style.display = 'block'; }
        else { profilePic.style.display = 'none'; }

        document.getElementById('profileName').textContent = p.google_name || p.google_email;
        document.getElementById('profilePlan').textContent = PLAN_NAMES[p.plan] || p.plan;

        updatePortalUI(p);
        if (p.plan !== 'free') loadChanges();
    }

    function updatePortalUI(p) {
        const plan = p.plan;
        const limit = PLAN_LIMITS[plan] ?? 0;
        const used = p.changes_used_this_month || 0;
        const purchased = p.purchased_changes || 0;

        // Hide everything first
        hide('creditsSection');
        hide('buyChangeRow');
        hide('purchasedRow');
        hide('upgradeRow');
        hide('planComparison');
        hide('newRequestSection');
        hide('changesHistory');

        if (plan === 'free') {
            // FREE: show plan comparison only
            show('planComparison');
            show('upgradeRow');
            document.getElementById('upgradeText').textContent = 'Pasirinkite planą';
            return;
        }

        // All paid plans see change history
        show('changesHistory');

        if (plan === 'start') {
            // START: 0 included, can buy one-off
            show('creditsSection');
            const label = document.getElementById('creditsLabel');
            const fill = document.getElementById('creditsFill');
            label.textContent = 'Pakeitimai neįtraukti į planą';
            label.className = 'credits-label danger';
            fill.style.width = '100%';
            fill.className = 'credits-bar-fill low';

            show('buyChangeRow');
            show('upgradeRow');
            document.getElementById('upgradeText').textContent = 'Atnaujinkite į GROWTH — 3 pakeit./mėn';

            if (purchased > 0) {
                show('purchasedRow');
                document.getElementById('purchasedCount').textContent = purchased;
                show('newRequestSection');
            }

        } else if (plan === 'growth') {
            // GROWTH: 3/month progress bar
            show('creditsSection');
            const remaining = Math.max(0, limit - used);
            const pct = Math.min((used / limit) * 100, 100);

            const label = document.getElementById('creditsLabel');
            const fill = document.getElementById('creditsFill');

            label.className = 'credits-label';
            fill.className = 'credits-bar-fill';
            fill.style.width = pct + '%';

            if (remaining <= 0) {
                label.textContent = 'Pakeitimai išnaudoti';
                label.classList.add('danger');
                fill.classList.add('low');
                show('buyChangeRow');
                show('upgradeRow');
                document.getElementById('upgradeText').textContent = 'Atnaujinkite į PRO — neriboti pakeitimai';

                if (purchased > 0) {
                    show('purchasedRow');
                    document.getElementById('purchasedCount').textContent = purchased;
                    show('newRequestSection');
                }
            } else if (remaining === 1) {
                label.textContent = `Liko: ${remaining}/${limit} pakeitimas`;
                label.classList.add('warning');
                fill.classList.add('warning');
                show('newRequestSection');
            } else {
                label.textContent = `Liko: ${remaining}/${limit} pakeitimai`;
                show('newRequestSection');
            }

        } else if (plan === 'pro') {
            // PRO: unlimited
            show('creditsSection');
            const label = document.getElementById('creditsLabel');
            const fill = document.getElementById('creditsFill');
            label.textContent = `Pateikta: ${used} šį mėnesį · Neribota`;
            label.className = 'credits-label';
            fill.style.width = '0%';
            fill.className = 'credits-bar-fill';
            show('newRequestSection');
        }
    }

    function show(id) { document.getElementById(id).style.display = ''; }
    function hide(id) { document.getElementById(id).style.display = 'none'; }

    async function loadChanges() {
        const list = document.getElementById('changesList');
        try {
            const res = await fetch(`${API}/changes`);
            const data = await res.json();
            if (!data.length) {
                list.innerHTML = '<p class="empty-state">Dar nėra pakeitimų užklausų.</p>';
                return;
            }
            list.innerHTML = data.map(c => `
                <div class="change-item">
                    <div class="change-item-left">
                        <div class="change-category">${CATEGORY_LABELS[c.category] || c.category}</div>
                        <div class="change-desc">${escHtml(c.description)}</div>
                        ${c.admin_notes ? `<div class="change-admin-notes">${escHtml(c.admin_notes)}</div>` : ''}
                        <div class="change-date">${formatDate(c.created_at)}</div>
                    </div>
                    <span class="change-status status-${c.status}">${STATUS_LABELS[c.status] || c.status}</span>
                </div>
            `).join('');
        } catch {
            list.innerHTML = '<p class="empty-state">Nepavyko užkrauti.</p>';
        }
    }

    // Submit change request
    document.getElementById('changeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submitBtn');
        const cat = document.getElementById('changeCategory').value;
        const desc = document.getElementById('changeDesc').value.trim();
        if (!cat || !desc) return;

        btn.disabled = true;
        btn.textContent = 'Siunčiama...';
        try {
            const res = await fetch(`${API}/changes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category: cat, description: desc })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            document.getElementById('changeCategory').value = '';
            document.getElementById('changeDesc').value = '';

            profile.changes_used_this_month = data.changes_used;
            profile.purchased_changes = data.purchased_changes;
            updatePortalUI(profile);
            loadChanges();
        } catch (err) {
            alert('Klaida: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Pateikti užklausą';
        }
    });

    // Buy a change
    document.getElementById('buyChangeBtn').addEventListener('click', async () => {
        const btn = document.getElementById('buyChangeBtn');
        btn.disabled = true;
        try {
            const res = await fetch(`${API}/buy-change`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            window.location.href = data.url;
        } catch (err) {
            alert('Klaida: ' + err.message);
            btn.disabled = false;
        }
    });

    // Logout
    function logout() {
        fetch(`${API}/auth/logout`, { method: 'POST' }).then(() => {
            profile = null;
            showLogin();
        });
    }
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('logoutBtn2').addEventListener('click', logout);

    // Helpers
    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Init
    async function init() {
        try {
            const res = await fetch(`${API}/config`);
            const data = await res.json();
            window.GOOGLE_CLIENT_ID = data.googleClientId;
            checkSession();
        } catch {
            document.getElementById('loginError').textContent = 'Nepavyko prisijungti prie serverio.';
        }
    }

    init();
})();
