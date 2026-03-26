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
        start: 'START planas',
        growth: 'GROWTH planas',
        pro: 'PRO planas'
    };

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
        document.getElementById('menuSalonName').textContent = p.salon_name || 'Jūsų salonas';

        updateCredits(p);
        loadChanges();
    }

    function updateCredits(p) {
        const limit = getLimit(p.plan);
        const used = p.changes_used_this_month;
        const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);

        const label = document.getElementById('creditsLabel');
        const fill = document.getElementById('creditsFill');
        const upgradeRow = document.getElementById('upgradeRow');
        const requestSection = document.getElementById('newRequestSection');
        const creditsSection = document.getElementById('creditsSection');

        // Reset classes
        label.className = 'credits-label';
        fill.className = 'credits-bar-fill';

        if (limit === 0) {
            // START — no changes included
            label.textContent = 'Pakeitimai neįtraukti';
            label.classList.add('danger');
            fill.style.width = '100%';
            fill.classList.add('low');
            upgradeRow.style.display = 'flex';
            requestSection.style.display = 'none';
            creditsSection.style.display = 'block';
        } else if (limit === Infinity) {
            // PRO — unlimited
            label.textContent = `Pateikta: ${used} šį mėnesį · Neribota`;
            fill.style.width = '0%';
            upgradeRow.style.display = 'none';
            requestSection.style.display = 'block';
            creditsSection.style.display = 'block';
        } else {
            // GROWTH — progress bar
            const pct = Math.min((used / limit) * 100, 100);
            fill.style.width = pct + '%';
            creditsSection.style.display = 'block';

            if (remaining <= 0) {
                label.textContent = 'Pakeitimai išnaudoti';
                label.classList.add('danger');
                fill.classList.add('low');
                upgradeRow.style.display = 'flex';
                requestSection.style.display = 'none';
            } else if (remaining === 1) {
                label.textContent = `Liko: ${remaining}/${limit} pakeitimas`;
                label.classList.add('warning');
                fill.classList.add('warning');
                upgradeRow.style.display = 'none';
                requestSection.style.display = 'block';
            } else {
                label.textContent = `Liko: ${remaining}/${limit} pakeitimai`;
                upgradeRow.style.display = 'none';
                requestSection.style.display = 'block';
            }
        }
    }

    function getLimit(plan) {
        if (plan === 'start') return 0;
        if (plan === 'growth') return 3;
        return Infinity;
    }

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
            updateCredits(profile);
            loadChanges();
        } catch (err) {
            alert('Klaida: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Pateikti užklausą';
        }
    });

    // Logout (both buttons)
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
