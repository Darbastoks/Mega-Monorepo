/* Velora Studio - Admin Dashboard JS */

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initLogin();
    initFilters();
    initSearch();
});

let allLeads = [];
let currentFilter = 'all';

// --- Auth ---
async function checkSession() {
    try {
        const res = await fetch('/api/velora/admin/leads');
        if (res.ok) {
            showDashboard();
            loadLeads();
        }
    } catch (err) { /* Not logged in */ }
}

function initLogin() {
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('loginError');

        try {
            const res = await fetch('/api/velora/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                showDashboard();
                loadLeads();
            } else {
                const data = await res.json();
                errorEl.textContent = data.error || 'Prisijungti nepavyko';
            }
        } catch (err) { errorEl.textContent = 'Serverio klaida'; }
    });
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/velora/admin/logout', { method: 'POST' });
        window.location.reload();
    });
}

// --- Data ---
async function loadLeads() {
    try {
        const res = await fetch('/api/velora/admin/leads');
        if (res.status === 401) { window.location.reload(); return; }
        allLeads = await res.json();
        updateStats();
        renderLeads();
    } catch (err) { console.error('Failed to load leads', err); }
}

function updateStats() {
    document.getElementById('statTotal').textContent = allLeads.length;
    document.getElementById('statNew').textContent = allLeads.filter(l => l.status === 'new').length;
    document.getElementById('statContacted').textContent = allLeads.filter(l => l.status === 'contacted').length;
    const resolvedEl = document.getElementById('statResolved');
    if (resolvedEl) resolvedEl.textContent = allLeads.filter(l => l.status === 'resolved').length;
}

// --- Login Starfield ---
(function initLoginStarfield() {
    const canvas = document.getElementById('loginStarfield');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let stars = [];
    const COUNT = 120;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function create() {
        stars = [];
        for (let i = 0; i < COUNT; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: 0.5 + Math.random() * 2,
                speed: 0.005 + Math.random() * 0.02,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const t = Date.now() * 0.001;
        for (const s of stars) {
            const opacity = 0.15 + 0.85 * Math.abs(Math.sin(t * s.speed * 10 + s.phase));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${opacity})`;
            ctx.fill();
        }
        requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => { resize(); create(); });
    resize(); create(); draw();
})();

function renderLeads() {
    const tbody = document.getElementById('leadsTableBody');
    const search = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allLeads;
    if (currentFilter !== 'all') filtered = filtered.filter(l => l.status === currentFilter);
    if (search) {
        filtered = filtered.filter(l =>
            l.name.toLowerCase().includes(search) ||
            l.email.toLowerCase().includes(search) ||
            (l.message && l.message.toLowerCase().includes(search))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        document.getElementById('noLeads').style.display = 'block';
        return;
    }

    document.getElementById('noLeads').style.display = 'none';
    tbody.innerHTML = filtered.map(lead => `
        <tr>
            <td>
                <span class="lead-date">${lead.date || '-'}<br><small>${lead.time || ''}</small></span>
            </td>
            <td><span class="lead-name">${lead.name}</span></td>
            <td><a href="mailto:${lead.email}" style="color:var(--primary-color)">${lead.email}</a></td>
            <td><div class="lead-msg" title="${lead.message}">${lead.message || '-'}</div></td>
            <td>
                <select class="status-select" onchange="updateStatus('${lead._id}', this.value)">
                    <option value="new" ${lead.status === 'new' ? 'selected' : ''}>Nauja</option>
                    <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Susisiekta</option>
                    <option value="resolved" ${lead.status === 'resolved' ? 'selected' : ''}>Išspręsta</option>
                    <option value="cancelled" ${lead.status === 'cancelled' ? 'selected' : ''}>Atšaukta</option>
                </select>
            </td>
            <td>
                <button class="action-btn action-delete" onclick="deleteLead('${lead._id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// --- Actions ---
async function updateStatus(id, status) {
    try {
        const res = await fetch(`/api/velora/admin/leads/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            showToast('Užklausa atnaujinta');
            loadLeads();
        }
    } catch (err) { showToast('Klaida atnaujinant'); }
}

async function deleteLead(id) {
    if (!confirm('Ar tikrai norite ištrinti šią užklausą?')) return;
    try {
        const res = await fetch(`/api/velora/admin/leads/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Užklausa ištrinta');
            loadLeads();
        }
    } catch (err) { showToast('Klaida trinant'); }
}

// --- UI Helpers ---
function initFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            renderLeads();
        });
    });
}

function initSearch() {
    document.getElementById('searchInput').addEventListener('input', () => {
        renderLeads();
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Global scope for HTML onclick
window.updateStatus = updateStatus;
window.deleteLead = deleteLead;
