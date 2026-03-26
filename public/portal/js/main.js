(function() {
    const API = '/api/portal';
    let profile = null;
    let selectedCategory = '';

    const CAT_NAMES = { text: 'Tekstas', visual: 'Dizainas', service: 'Paslaugos' };

    const STATUS_CONFIG = {
        new:         { icon: '🕐', label: 'Pateikta',  sub: 'Peržiūrime jūsų užklausą' },
        in_progress: { icon: '⏳', label: 'Vykdoma',   sub: 'Dirbame prie pakeitimo' },
        completed:   { icon: '✓',  label: 'Atlikta',   sub: 'Pakeitimas įgyvendintas!' },
        rejected:    { icon: '✗',  label: 'Atmesta',   sub: '' }
    };

    const PLAN_LIMITS = { free: 0, start: 0, growth: 3, pro: Infinity };

    // Attachment state
    let attachmentBase64 = '';
    let attachmentName = '';

    // ===================== AUTH =====================
    window.handleGoogleSignIn = async function(response) {
        document.getElementById('loginError').textContent = '';
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
            document.getElementById('loginError').textContent = err.message;
        }
    };

    async function checkSession() {
        try {
            const res = await fetch(`${API}/auth/check`);
            const data = await res.json();
            data.loggedIn ? showDashboard(data.profile) : showLogin();
        } catch { showLogin(); }
    }

    function showLogin() {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
        initGoogle();
    }

    function initGoogle() {
        if (!window.google?.accounts) { setTimeout(initGoogle, 200); return; }
        google.accounts.id.initialize({ client_id: window.GOOGLE_CLIENT_ID, callback: handleGoogleSignIn });
        google.accounts.id.renderButton(
            document.getElementById('googleBtnWrap'),
            { theme: 'filled_black', size: 'large', width: 300, text: 'signin_with', locale: 'lt' }
        );
    }

    // ===================== DASHBOARD =====================
    function showDashboard(p) {
        profile = p;

        // Demo mode: ?demo=free|start|growth|pro to preview each plan
        const demoParam = new URLSearchParams(location.search).get('demo');
        if (demoParam && PLAN_LIMITS.hasOwnProperty(demoParam)) {
            p = { ...p, plan: demoParam };
            if (demoParam === 'growth') { p.changes_used_this_month = 1; }
            if (demoParam === 'free') { p.changes_used_this_month = 0; p.purchased_changes = 0; }
            if (demoParam === 'start') { p.purchased_changes = 0; }
            profile = p;
        }

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';

        const pic = document.getElementById('userPicture');
        if (p.google_picture) { pic.src = p.google_picture; pic.style.display = 'block'; }
        else pic.style.display = 'none';

        const profilePic = document.getElementById('profilePicture');
        if (p.google_picture) { profilePic.src = p.google_picture; profilePic.style.display = 'block'; }
        else profilePic.style.display = 'none';

        const firstName = (p.google_name || '').split(' ')[0] || '';
        document.getElementById('profileName').textContent = p.google_name || p.google_email;

        // Welcome
        document.getElementById('welcomeTitle').textContent = firstName ? `Sveiki, ${firstName}!` : 'Sveiki!';

        updateUI(p);
        if (p.plan !== 'free') loadChanges();
    }

    function updateUI(p) {
        const plan = p.plan;
        const limit = PLAN_LIMITS[plan] ?? 0;
        const used = p.changes_used_this_month || 0;
        const purchased = p.purchased_changes || 0;
        const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);

        // Hide all
        hide('planComparison'); hide('buyCard'); hide('purchasedInfo');
        hide('requestCard'); hide('historySection');

        // Plan badge
        const badge = document.getElementById('planBadge');
        const statusRight = document.getElementById('statusRight');

        if (plan === 'free') {
            badge.textContent = 'Nemokamas';
            badge.className = 'status-plan-badge free';
            statusRight.innerHTML = '';
            document.getElementById('welcomeSub').textContent = 'Pasirinkite planą ir mes sukursime jūsų svetainę.';
            show('planComparison');
            return;
        }

        const planLabel = { start: 'START', growth: 'GROWTH', pro: 'PRO' }[plan] || plan.toUpperCase();
        badge.textContent = planLabel;
        badge.className = 'status-plan-badge ' + plan;

        show('historySection');

        if (plan === 'start') {
            document.getElementById('welcomeSub').textContent = 'Jūsų svetainė aktyvi. Užsakykite pakeitimą, jei norite ką nors pakeisti.';
            statusRight.innerHTML = '<span class="status-msg muted">Pakeitimai neįtraukti</span>';
            show('buyCard');

            if (purchased > 0) {
                show('purchasedInfo');
                document.getElementById('purchasedText').textContent =
                    purchased === 1 ? 'Turite 1 užsakytą pakeitimą' : `Turite ${purchased} užsakytus pakeitimus`;
                show('requestCard');
            }

        } else if (plan === 'growth') {
            if (remaining > 0) {
                document.getElementById('welcomeSub').textContent = 'Pateikite užklausą ir mes pakeitimu pasirūpinsime.';
                statusRight.innerHTML = `<span class="status-msg">${remaining} iš ${limit} pakeitimų liko</span>`;
                show('requestCard');
            } else {
                document.getElementById('welcomeSub').textContent = 'Šį mėnesį panaudojote visus pakeitimus.';
                statusRight.innerHTML = '<span class="status-msg danger">Pakeitimai išnaudoti</span>';
                show('buyCard');

                if (purchased > 0) {
                    show('purchasedInfo');
                    document.getElementById('purchasedText').textContent =
                        purchased === 1 ? 'Turite 1 užsakytą pakeitimą' : `Turite ${purchased} užsakytus pakeitimus`;
                    show('requestCard');
                }
            }

        } else if (plan === 'pro') {
            document.getElementById('welcomeSub').textContent = 'Pateikite užklausą ir mes pakeitimu pasirūpinsime.';
            statusRight.innerHTML = '<span class="status-msg pro">Neriboti pakeitimai</span>';
            show('requestCard');
        }
    }

    // ===================== CATEGORY CARDS =====================
    document.getElementById('categoryCards').addEventListener('click', (e) => {
        const card = e.target.closest('.cat-card');
        if (!card) return;
        selectedCategory = card.dataset.cat;
        document.getElementById('changeCategory').value = selectedCategory;

        // Highlight selected
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // Show form
        document.getElementById('changeForm').style.display = 'block';
        document.getElementById('changeDesc').focus();
    });

    document.getElementById('cancelCat').addEventListener('click', () => {
        selectedCategory = '';
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('selected'));
        document.getElementById('changeForm').style.display = 'none';
        document.getElementById('changeDesc').value = '';
        clearAttachment();
    });

    // ===================== ATTACHMENT =====================
    document.getElementById('changeAttachment').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            alert('Nuotrauka per didelė. Maksimalus dydis: 2MB.');
            e.target.value = '';
            return;
        }
        if (!file.type.startsWith('image/')) {
            alert('Leidžiami tik paveikslėliai (JPG, PNG, WEBP, GIF).');
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            attachmentBase64 = reader.result.split(',')[1]; // strip data:...;base64,
            attachmentName = file.name;
            document.getElementById('previewImg').src = reader.result;
            document.getElementById('attachmentPreview').style.display = 'flex';
            document.getElementById('uploadArea').style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('removeAttachment').addEventListener('click', clearAttachment);

    function clearAttachment() {
        attachmentBase64 = '';
        attachmentName = '';
        document.getElementById('changeAttachment').value = '';
        document.getElementById('attachmentPreview').style.display = 'none';
        document.getElementById('uploadArea').style.display = '';
    }

    // ===================== SUBMIT =====================
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
                body: JSON.stringify({ category: cat, description: desc, attachment_base64: attachmentBase64, attachment_name: attachmentName })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Reset form
            document.getElementById('changeDesc').value = '';
            document.getElementById('changeForm').style.display = 'none';
            document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('selected'));
            selectedCategory = '';
            clearAttachment();

            profile.changes_used_this_month = data.changes_used;
            profile.purchased_changes = data.purchased_changes;
            updateUI(profile);
            loadChanges();
        } catch (err) {
            alert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Pateikti';
        }
    });

    // ===================== BUY CHANGE =====================
    document.getElementById('buyChangeBtn').addEventListener('click', async () => {
        const btn = document.getElementById('buyChangeBtn');
        btn.disabled = true;
        btn.textContent = 'Kraunama...';
        try {
            const res = await fetch(`${API}/buy-change`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            window.location.href = data.url;
        } catch (err) {
            alert(err.message);
            btn.disabled = false;
            btn.textContent = 'Užsakyti pakeitimą · €15';
        }
    });

    // ===================== CHANGE HISTORY =====================
    async function loadChanges() {
        const list = document.getElementById('changesList');
        try {
            const res = await fetch(`${API}/changes`);
            const data = await res.json();
            if (!data.length) {
                list.innerHTML = '<p class="history-empty">Dar neturite užklausų.</p>';
                return;
            }
            list.innerHTML = data.map(c => {
                const s = STATUS_CONFIG[c.status] || STATUS_CONFIG.new;
                const catName = CAT_NAMES[c.category] || c.category;
                const date = formatDate(c.created_at);
                const notes = c.admin_notes ? `<div class="history-notes">${esc(c.admin_notes)}</div>` : '';
                const attach = c.attachment_name ? `<a href="${API}/changes/${c.id}/attachment" target="_blank" class="history-attachment">📎 ${esc(c.attachment_name)}</a>` : '';
                return `
                    <div class="history-item status-${c.status}">
                        <div class="history-icon">${s.icon}</div>
                        <div class="history-content">
                            <div class="history-top">
                                <span class="history-label">${s.label}</span>
                                <span class="history-meta">${catName} · ${date}</span>
                            </div>
                            <div class="history-desc">${esc(c.description)}</div>
                            ${attach}
                            ${s.sub ? `<div class="history-sub">${s.sub}</div>` : ''}
                            ${notes}
                        </div>
                    </div>`;
            }).join('');
        } catch {
            list.innerHTML = '<p class="history-empty">Nepavyko užkrauti.</p>';
        }
    }

    // ===================== LOGOUT =====================
    function logout() {
        fetch(`${API}/auth/logout`, { method: 'POST' }).then(() => { profile = null; showLogin(); });
    }
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // ===================== HELPERS =====================
    function show(id) { document.getElementById(id).style.display = ''; }
    function hide(id) { document.getElementById(id).style.display = 'none'; }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function formatDate(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString('lt-LT', { month: 'long', day: 'numeric' });
    }

    // ===================== INIT =====================
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
