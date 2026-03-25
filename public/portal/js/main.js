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

    // Check existing session on load
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

        document.getElementById('userName').textContent = p.google_name || p.google_email;
        const pic = document.getElementById('userPicture');
        if (p.google_picture) { pic.src = p.google_picture; pic.style.display = 'block'; }
        else { pic.style.display = 'none'; }

        document.getElementById('salonName').textContent = p.salon_name || 'Jūsų salonas';

        updatePlanCard(p);
        loadChanges();
    }

    function updatePlanCard(p) {
        const badge = document.getElementById('planBadge');
        const planName = p.plan.toUpperCase();
        badge.textContent = planName;
        badge.className = 'plan-badge ' + p.plan;

        const limit = getLimit(p.plan);
        const left = limit === Infinity ? '∞' : Math.max(0, limit - p.changes_used_this_month);
        const used = p.changes_used_this_month;

        const circle = document.getElementById('changesCircle');
        document.getElementById('changesLeft').textContent = left;

        if (limit === Infinity) {
            circle.className = 'changes-circle';
            document.getElementById('changesText').textContent = `Pakeitimų: ${used} šį mėnesį (neribota)`;
        } else {
            const remaining = limit - used;
            circle.className = 'changes-circle' + (remaining <= 0 ? ' empty' : remaining === 1 ? ' warning' : '');
            document.getElementById('changesText').textContent = `Pakeitimų: ${used}/${limit} šį mėnesį`;
        }

        const upgradeCard = document.getElementById('upgradeCard');
        const requestSection = document.getElementById('newRequestSection');
        if (limit !== Infinity && used >= limit) {
            upgradeCard.style.display = 'block';
            requestSection.style.display = 'none';
        } else {
            upgradeCard.style.display = 'none';
            requestSection.style.display = 'block';
        }
    }

    function getLimit(plan) {
        if (plan === 'start') return 1;
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
            updatePlanCard(profile);
            loadChanges();
        } catch (err) {
            alert('Klaida: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Pateikti užklausą';
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch(`${API}/auth/logout`, { method: 'POST' });
        profile = null;
        showLogin();
    });

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

    // Fetch Google Client ID then init
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
