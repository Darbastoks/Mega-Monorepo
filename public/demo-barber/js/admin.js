// ==========================================
//  Velora Barber — Admin Dashboard JS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    checkAdminSession();
    initLoginForm();
    initLogout();
    initFilters();
    initSearch();
    initChangePassword();
    initSettings();
});

let allBookings = [];
let allServices = [];
let currentFilter = 'all';

// --- Check if already logged in ---
async function checkAdminSession() {
    try {
        const res = await fetch('/api/demo-barber/admin/check');
        if (res.ok) {
            showDashboard();
            loadBookings();
        }
    } catch (err) {
        // Not logged in, show login form
    }
}

// --- Login ---
function initLoginForm() {
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/demo-barber/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok) {
                showDashboard();
                loadBookings();
            } else {
                errorEl.textContent = data.error;
            }
        } catch (err) {
            errorEl.textContent = 'Tinklo klaida';
        }
    });
}

function showDashboard() {
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
}

// --- Logout ---
function initLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/demo-barber/admin/logout', { method: 'POST' });
        window.location.reload();
    });
}

// --- Load Bookings ---
async function loadBookings() {
    try {
        const res = await fetch('/api/demo-barber/admin/bookings');
        if (!res.ok) {
            if (res.status === 401) {
                window.location.reload();
                return;
            }
            throw new Error('Failed to load');
        }

        allBookings = await res.json();
        updateStats();
        renderBookings();
    } catch (err) {
        console.error('Failed to load bookings:', err);
    }
}

// --- Update Stats ---
function updateStats() {
    document.getElementById('statTotal').textContent = allBookings.length;
    document.getElementById('statPending').textContent = allBookings.filter(b => b.status === 'pending').length;
    document.getElementById('statConfirmed').textContent = allBookings.filter(b => b.status === 'confirmed').length;
    document.getElementById('statCompleted').textContent = allBookings.filter(b => b.status === 'completed').length;
}

// --- Render Bookings Table ---
function renderBookings() {
    const tbody = document.getElementById('bookingsBody');
    const emptyState = document.getElementById('emptyState');
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allBookings;

    // Filter by status
    if (currentFilter !== 'all') {
        filtered = filtered.filter(b => b.status === currentFilter);
    }

    // Filter by search
    if (searchQuery) {
        filtered = filtered.filter(b =>
            b.name.toLowerCase().includes(searchQuery) ||
            b.phone.includes(searchQuery) ||
            (b.email && b.email.toLowerCase().includes(searchQuery))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    tbody.innerHTML = filtered.map(b => `
        <tr>
            <td>#${b.id}</td>
            <td><strong>${escapeHtml(b.name)}</strong></td>
            <td>${escapeHtml(b.phone)}</td>
            <td>${escapeHtml(b.staff_name || '—')}</td>
            <td>${escapeHtml(b.service)}</td>
            <td>${formatDate(b.date)}</td>
            <td>${b.time}</td>
            <td><span class="status-badge status-${b.status}">${getStatusText(b.status)}</span></td>
            <td>${getActionButtons(b)}</td>
        </tr>
    `).join('');
}

function getStatusText(status) {
    const map = {
        pending: 'Laukia',
        confirmed: 'Patvirtinta',
        completed: 'Atlikta',
        cancelled: 'Atšaukta'
    };
    return map[status] || status;
}

function getActionButtons(booking) {
    let buttons = '';

    if (booking.status === 'pending') {
        buttons += `<button class="action-btn action-confirm" onclick="updateBookingStatus(${booking.id}, 'confirmed')">✓ Patvirtinti</button>`;
        buttons += `<button class="action-btn action-cancel" onclick="updateBookingStatus(${booking.id}, 'cancelled')">✗ Atšaukti</button>`;
    }

    if (booking.status === 'confirmed') {
        buttons += `<button class="action-btn action-complete" onclick="updateBookingStatus(${booking.id}, 'completed')">✓ Atlikta</button>`;
        buttons += `<button class="action-btn action-cancel" onclick="updateBookingStatus(${booking.id}, 'cancelled')">✗ Atšaukti</button>`;
    }

    buttons += `<button class="action-btn action-delete" onclick="deleteBooking(${booking.id})">🗑</button>`;

    return buttons;
}

// --- Update booking status ---
async function updateBookingStatus(id, status) {
    try {
        const res = await fetch(`/api/demo-barber/admin/bookings/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        if (res.ok) {
            showToast('✅', 'Statusas atnaujintas');
            loadBookings();
        } else {
            showToast('❌', 'Klaida atnaujinant statusą');
        }
    } catch (err) {
        showToast('❌', 'Tinklo klaida');
    }
}

// --- Delete booking ---
async function deleteBooking(id) {
    if (!confirm('Ar tikrai norite ištrinti šią registraciją?')) return;

    try {
        const res = await fetch(`/api/demo-barber/admin/bookings/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('✅', 'Registracija ištrinta');
            loadBookings();
        } else {
            showToast('❌', 'Klaida trinant registraciją');
        }
    } catch (err) {
        showToast('❌', 'Tinklo klaida');
    }
}

// --- Filters ---
function initFilters() {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderBookings();
        });
    });
}

// --- Search ---
function initSearch() {
    let timeout;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(renderBookings, 300);
    });
}

// --- Change Password ---
function initChangePassword() {
    const form = document.getElementById('changePasswordForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;

        try {
            const res = await fetch('/api/demo-barber/admin/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await res.json();

            if (res.ok) {
                showToast('✅', data.message);
                document.getElementById('passwordModal').style.display = 'none';
                form.reset();
            } else {
                showToast('❌', data.error);
            }
        } catch (err) {
            showToast('❌', 'Tinklo klaida');
        }
    });
}

// --- Multi-Staff Settings ---
let allStaff = [];
let activeStaffId = null;
let currentBlockedDates = [];
let currentBreaks = [];

function initSettings() {
    const viewSettingsBtn = document.getElementById('viewSettingsBtn');
    const viewBookingsBtn = document.getElementById('viewBookingsBtn');
    if (!viewSettingsBtn) return;

    viewSettingsBtn.addEventListener('click', () => {
        document.getElementById('bookingsSection').style.display = 'none';
        document.querySelector('.admin-filters').style.display = 'none';
        document.getElementById('settingsSection').style.display = 'block';
        viewSettingsBtn.style.display = 'none';
        viewBookingsBtn.style.display = 'inline-flex';
    });
    viewBookingsBtn.addEventListener('click', () => {
        document.getElementById('bookingsSection').style.display = 'block';
        document.querySelector('.admin-filters').style.display = 'flex';
        document.getElementById('settingsSection').style.display = 'none';
        viewSettingsBtn.style.display = 'inline-flex';
        viewBookingsBtn.style.display = 'none';
    });

    document.getElementById('addStaffBtn').addEventListener('click', async () => {
        const name = prompt('Darbuotojo vardas:');
        if (!name || !name.trim()) return;
        try {
            const res = await fetch('/api/demo-barber/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            if (res.ok) {
                const d = await res.json();
                activeStaffId = d.id;
                await loadStaff();
                showToast('✅', 'Darbuotojas pridėtas');
            }
        } catch(err) { showToast('❌', 'Klaida'); }
    });

    loadStaff();
}

async function loadStaff() {
    try {
        const res = await fetch('/api/demo-barber/staff');
        allStaff = await res.json();
        renderStaffTabs();
        if (allStaff.length > 0 && !activeStaffId) {
            activeStaffId = allStaff[0].id;
        }
        if (activeStaffId) loadStaffSettings(activeStaffId);
    } catch(err) { console.error('Staff load error:', err); }
}

function renderStaffTabs() {
    const container = document.getElementById('staffTabs');
    container.innerHTML = allStaff.map(s => `
        <button onclick="switchStaff(${s.id})" style="padding:0.5rem 1rem; border-radius:8px; border:1px solid ${s.id === activeStaffId ? '#c9a96e' : 'rgba(255,255,255,0.15)'}; background:${s.id === activeStaffId ? 'rgba(201,169,110,0.15)' : 'transparent'}; color:${s.id === activeStaffId ? '#c9a96e' : 'inherit'}; cursor:pointer; font-size:0.9rem; font-weight:${s.id === activeStaffId ? '600' : '400'};">
            ${escapeHtml(s.name)}
        </button>
    `).join('');
}

window.switchStaff = function(staffId) {
    activeStaffId = staffId;
    renderStaffTabs();
    loadStaffSettings(staffId);
};

async function loadStaffSettings(staffId) {
    try {
        const res = await fetch(`/api/demo-barber/staff/${staffId}/settings`);
        const settings = await res.json();
        currentBreaks = settings.breaks || [];
        currentBlockedDates = settings.blockedDates || [];
        renderStaffSettingsPanel(settings);
    } catch(err) { console.error('Staff settings load error:', err); }
}

function renderStaffSettingsPanel(settings) {
    const panel = document.getElementById('staffSettingsPanel');
    const inputStyle = 'width:100%; padding:0.5rem; border:1px solid rgba(255,255,255,0.15); border-radius:4px; background:rgba(255,255,255,0.05); color:inherit; font-family:inherit;';
    const days = [
        { v: 1, l: 'Pr' }, { v: 2, l: 'An' }, { v: 3, l: 'Tr' }, { v: 4, l: 'Kt' },
        { v: 5, l: 'Pn' }, { v: 6, l: 'Še' }, { v: 0, l: 'Se' }
    ];
    const workingDays = settings.workingDays || [];

    panel.innerHTML = `
        <div style="max-width:500px; background:rgba(255,255,255,0.05); padding:1.5rem; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <input type="text" id="staffNameInput" value="${escapeHtml(settings.name)}"
                    style="font-size:1.1rem; font-weight:600; background:transparent; border:1px solid transparent; border-radius:4px; color:inherit; padding:0.25rem 0.5rem; font-family:inherit; flex:1;"
                    onblur="saveStaffName()" onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
                    onblur="this.style.borderColor='transparent'; saveStaffName()">
                <button onclick="deleteStaff(${settings.id})" style="padding:0.4rem 0.8rem; background:transparent; border:1px solid #ef4444; border-radius:6px; color:#ef4444; cursor:pointer; font-size:0.8rem; margin-left:0.5rem;" ${allStaff.length <= 1 ? 'disabled title="Turi likti bent vienas darbuotojas"' : ''}>Pašalinti</button>
            </div>
            <form id="staffSettingsForm" onsubmit="event.preventDefault(); saveStaffSettings();">
                <div style="margin-bottom:1rem;">
                    <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Darbo Dienos</label>
                    <div style="display:flex; flex-wrap:wrap; gap:10px;">
                        ${days.map(d => `<label><input type="checkbox" name="staffWorkDays" value="${d.v}" ${workingDays.includes(d.v) ? 'checked' : ''}> ${d.l}</label>`).join('')}
                    </div>
                </div>
                <div style="display:flex; gap:1rem; margin-bottom:1rem;">
                    <div style="flex:1;">
                        <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Pradžia</label>
                        <input type="time" id="staffStartHour" value="${settings.startHour || '09:00'}" required style="${inputStyle}">
                    </div>
                    <div style="flex:1;">
                        <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Pabaiga</label>
                        <input type="time" id="staffEndHour" value="${settings.endHour || '18:30'}" required style="${inputStyle}">
                    </div>
                </div>
                <div style="margin-bottom:1rem; padding-top:1rem; border-top:1px solid rgba(255,255,255,0.1);">
                    <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Pertraukos</label>
                    <small style="opacity:0.5; display:block; margin-bottom:0.5rem;">Iki 4 pertraukų per dieną</small>
                    <div style="display:flex; gap:0.5rem; margin-bottom:0.75rem; align-items:end;">
                        <div style="flex:1;">
                            <label style="display:block; margin-bottom:0.25rem; font-size:0.85rem; opacity:0.6;">Nuo</label>
                            <input type="time" id="breakStartInput" style="${inputStyle}">
                        </div>
                        <div style="flex:1;">
                            <label style="display:block; margin-bottom:0.25rem; font-size:0.85rem; opacity:0.6;">Iki</label>
                            <input type="time" id="breakEndInput" style="${inputStyle}">
                        </div>
                        <button type="button" onclick="addBreak()" class="btn btn-primary" style="padding:0.5rem 1rem;">+</button>
                    </div>
                    <div id="breaksList" style="display:flex; flex-direction:column; gap:6px;"></div>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Išsaugoti Darbo Laiką</button>
            </form>
            <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid rgba(255,255,255,0.1);">
                <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Nedarbo Dienos</label>
                <small style="opacity:0.5; display:block; margin-bottom:0.5rem;">Atostogos, šventės ar kitos laisvos dienos</small>
                <div style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
                    <input type="date" id="blockedDateInput" style="flex:1; ${inputStyle}">
                    <button type="button" onclick="addBlockedDate()" class="btn btn-primary" style="padding:0.5rem 1rem;">+</button>
                </div>
                <div id="blockedDatesList" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
            </div>
        </div>
    `;
    renderBreaks();
    renderBlockedDates();
}

window.saveStaffName = async function() {
    const nameInput = document.getElementById('staffNameInput');
    if (!nameInput || !activeStaffId) return;
    const name = nameInput.value.trim();
    if (!name) return;
    try {
        await fetch(`/api/demo-barber/staff/${activeStaffId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        await loadStaff();
    } catch(err) {}
};

window.saveStaffSettings = async function() {
    if (!activeStaffId) return;
    const payload = {
        workingDays: Array.from(document.querySelectorAll('input[name="staffWorkDays"]:checked')).map(cb => parseInt(cb.value)),
        startHour: document.getElementById('staffStartHour').value,
        endHour: document.getElementById('staffEndHour').value,
        breaks: currentBreaks,
        blockedDates: currentBlockedDates
    };
    try {
        const res = await fetch(`/api/demo-barber/staff/${activeStaffId}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) showToast('✅', 'Nustatymai išsaugoti');
        else {
            const errData = await res.json().catch(() => ({}));
            showToast('❌', 'Klaida: ' + (errData.error || res.status));
        }
    } catch(err) { showToast('❌', 'Tinklo klaida: ' + err.message); }
};

window.deleteStaff = async function(staffId) {
    if (!confirm('Ar tikrai norite pašalinti šį darbuotoją?')) return;
    try {
        const res = await fetch(`/api/demo-barber/staff/${staffId}`, { method: 'DELETE' });
        if (res.ok) {
            activeStaffId = null;
            await loadStaff();
            showToast('✅', 'Darbuotojas pašalintas');
        } else {
            const d = await res.json();
            showToast('❌', d.error || 'Klaida');
        }
    } catch(err) { showToast('❌', 'Tinklo klaida'); }
};

// --- Breaks (multiple) ---
function renderBreaks() {
    const container = document.getElementById('breaksList');
    if (!container) return;
    container.innerHTML = currentBreaks.map((br, i) => `
        <span style="background: rgba(52,152,219,0.15); color: #3498db; padding: 4px 10px; border-radius: 8px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">
            ${br.start} - ${br.end}
            <button onclick="removeBreak(${i})" style="background:none; border:none; color:#3498db; cursor:pointer; font-size:1rem; padding:0; line-height:1;">&times;</button>
        </span>
    `).join('');
}

window.addBreak = function() {
    if (currentBreaks.length >= 4) { showToast('⚠️', 'Maksimaliai 4 pertraukos'); return; }
    const start = document.getElementById('breakStartInput').value;
    const end = document.getElementById('breakEndInput').value;
    if (!start || !end) { showToast('⚠️', 'Nurodykite pertraukos pradžią ir pabaigą'); return; }
    if (end <= start) { showToast('⚠️', 'Pabaiga turi būti vėliau nei pradžia'); return; }
    currentBreaks.push({ start, end });
    currentBreaks.sort((a, b) => a.start.localeCompare(b.start));
    renderBreaks();
    document.getElementById('breakStartInput').value = '';
    document.getElementById('breakEndInput').value = '';
    saveStaffSettings();
};

window.removeBreak = function(index) {
    currentBreaks.splice(index, 1);
    renderBreaks();
    saveStaffSettings();
};

// --- Blocked Dates ---
function renderBlockedDates() {
    const container = document.getElementById('blockedDatesList');
    if (!container) return;
    container.innerHTML = currentBlockedDates.map(d => `
        <span style="background: rgba(231,76,60,0.15); color: #e74c3c; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 6px;">
            ${d}
            <button onclick="removeBlockedDate('${d}')" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:1rem; padding:0; line-height:1;">&times;</button>
        </span>
    `).join('');
}

window.addBlockedDate = function() {
    const input = document.getElementById('blockedDateInput');
    const date = input.value;
    if (!date) return;
    if (currentBlockedDates.includes(date)) { showToast('⚠️', 'Ši data jau pridėta'); return; }
    currentBlockedDates.push(date);
    currentBlockedDates.sort();
    renderBlockedDates();
    input.value = '';
    saveStaffSettings();
};

window.removeBlockedDate = function(date) {
    currentBlockedDates = currentBlockedDates.filter(d => d !== date);
    renderBlockedDates();
    saveStaffSettings();
};

// --- Helpers ---
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('lt-LT', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function showToast(icon, message) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// ==================== EMERGENCY CANCELLATION ====================
(function() {
    const emergencyBtn = document.getElementById('emergencyCancelBtn');
    const emergencyModal = document.getElementById('emergencyModal');
    const emergencyDate = document.getElementById('emergencyDate');
    const emergencyFullDay = document.getElementById('emergencyFullDay');
    const emergencyTimeRange = document.getElementById('emergencyTimeRange');
    const emergencyReason = document.getElementById('emergencyReason');
    const emergencyPreview = document.getElementById('emergencyPreview');
    const emergencyPreviewList = document.getElementById('emergencyPreviewList');
    const emergencyResult = document.getElementById('emergencyResult');
    const emergencyConfirmBtn = document.getElementById('emergencyConfirmBtn');
    const emergencyCloseBtn = document.getElementById('emergencyCloseBtn');

    let previewBookings = [];

    emergencyBtn.addEventListener('click', () => {
        emergencyModal.style.display = 'flex';
        emergencyDate.value = '';
        emergencyFullDay.checked = true;
        emergencyTimeRange.style.display = 'none';
        emergencyReason.value = '';
        emergencyPreview.style.display = 'none';
        emergencyResult.style.display = 'none';
        emergencyConfirmBtn.disabled = true;
        emergencyConfirmBtn.style.display = '';
        previewBookings = [];
    });

    emergencyCloseBtn.addEventListener('click', () => { emergencyModal.style.display = 'none'; });
    emergencyModal.addEventListener('click', (e) => { if (e.target === emergencyModal) emergencyModal.style.display = 'none'; });

    emergencyFullDay.addEventListener('change', () => {
        emergencyTimeRange.style.display = emergencyFullDay.checked ? 'none' : 'block';
        loadPreview();
    });

    emergencyDate.addEventListener('change', loadPreview);

    async function loadPreview() {
        const date = emergencyDate.value;
        if (!date) { emergencyPreview.style.display = 'none'; emergencyConfirmBtn.disabled = true; return; }

        try {
            const res = await fetch('/api/demo-barber/admin/bookings');
            const all = await res.json();
            let filtered = all.filter(b => b.date === date && b.status !== 'cancelled');

            if (!emergencyFullDay.checked) {
                const start = document.getElementById('emergencyStartTime').value;
                const end = document.getElementById('emergencyEndTime').value;
                if (start && end) filtered = filtered.filter(b => b.time >= start && b.time <= end);
            }

            previewBookings = filtered;
            if (filtered.length === 0) {
                emergencyPreviewList.innerHTML = '<p style="opacity:0.5; font-size:0.9rem;">Šią dieną registracijų nėra. Data bus užblokuota.</p>';
                emergencyPreview.style.display = 'block';
                emergencyConfirmBtn.disabled = false;
                return;
            }

            const withEmail = filtered.filter(b => b.email);
            const noEmail = filtered.filter(b => !b.email);

            let html = '';
            if (withEmail.length > 0) {
                html += `<p style="font-size:0.8rem; color:#22c55e; margin-bottom:0.3rem;">Bus informuoti el. paštu (${withEmail.length}):</p>`;
                withEmail.forEach(b => {
                    html += `<div class="emergency-preview-item"><span>${b.name} — ${b.time} — ${b.service}</span><span class="emergency-badge-email">El. paštas</span></div>`;
                });
            }
            if (noEmail.length > 0) {
                html += `<p style="font-size:0.8rem; color:#fbbf24; margin-top:0.5rem; margin-bottom:0.3rem;">Reikia informuoti telefonu (${noEmail.length}):</p>`;
                noEmail.forEach(b => {
                    html += `<div class="emergency-preview-item"><span>${b.name} — ${b.time} — ${b.phone}</span><span class="emergency-badge-phone">Skambinti</span></div>`;
                });
            }

            emergencyPreviewList.innerHTML = html;
            emergencyPreview.style.display = 'block';
            emergencyConfirmBtn.disabled = false;
        } catch (err) {
            emergencyPreviewList.innerHTML = '<p style="color:#ef4444;">Klaida kraunant duomenis</p>';
            emergencyPreview.style.display = 'block';
        }
    }

    document.getElementById('emergencyStartTime')?.addEventListener('change', loadPreview);
    document.getElementById('emergencyEndTime')?.addEventListener('change', loadPreview);

    emergencyConfirmBtn.addEventListener('click', async () => {
        const date = emergencyDate.value;
        if (!date) return;

        emergencyConfirmBtn.disabled = true;
        emergencyConfirmBtn.textContent = 'Atšaukiama...';

        try {
            const res = await fetch('/api/demo-barber/admin/emergency-cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date,
                    fullDay: emergencyFullDay.checked,
                    startTime: document.getElementById('emergencyStartTime').value,
                    endTime: document.getElementById('emergencyEndTime').value,
                    reason: emergencyReason.value
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            let resultHtml = `<p style="font-weight:600; color:#10b981; margin-bottom:0.5rem;">Atšaukta sėkmingai! (${data.cancelledCount} registr.)</p>`;

            if (data.clients && data.clients.length > 0) {
                resultHtml += `<p style="font-size:0.85rem; opacity:0.7; margin-bottom:0.5rem;">Informuokite klientus:</p>`;
                data.clients.forEach((c, i) => {
                    const clipText = `${c.name} | ${c.phone} | ${c.service} | ${c.date} ${c.time}`;
                    resultHtml += `<div class="ec-client-card">
                        <div class="ec-client-info"><strong>${c.name}</strong> <span>— ${c.time} — ${c.service}</span></div>
                        <div class="ec-actions">
                            <button class="ec-action-btn ec-btn-copy" onclick="navigator.clipboard.writeText('${clipText.replace(/'/g,"\\'")}');this.textContent='Nukopijuota!';">Kopijuoti</button>
                            <a href="tel:${c.phone}" class="ec-action-btn ec-btn-call">Skambinti</a>
                            <a href="sms:${c.phone}" class="ec-action-btn ec-btn-sms">Žinutė</a>
                            ${c.email ? `<button class="ec-action-btn ec-btn-email" id="ecSendBtn${i}" onclick="sendEmergencyEmail(${i},'${c.email.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}')">Siųsti el. laišką</button>` : ''}
                        </div>
                    </div>`;
                });
            }

            emergencyResult.innerHTML = resultHtml;
            emergencyResult.style.display = 'block';
            emergencyPreview.style.display = 'none';
            emergencyConfirmBtn.style.display = 'none';

            if (typeof loadBookings === 'function') loadBookings();

        } catch (err) {
            emergencyResult.innerHTML = `<p style="color:#ef4444;">Klaida: ${err.message}</p>`;
            emergencyResult.style.display = 'block';
            emergencyConfirmBtn.disabled = false;
            emergencyConfirmBtn.textContent = 'Atšaukti registracijas';
        }
    });

    window.sendEmergencyEmail = async function(idx, email, name) {
        const btn = document.getElementById('ecSendBtn' + idx);
        const msg = `Sveiki,\n\nlabai atsiprašau, tačiau dėl netikėtai susiklosčiusios skubios situacijos šiandien negalėsiu dalyvauti / būti darbe. Suprantu, kad tai gali sukelti nepatogumų, ir nuoširdžiai apgailestauju dėl to.\n\nLabai vertinu Jūsų supratingumą. Primenu, kad vizito laiką galite patogiai pakeisti per registracijos sistemą mano svetainėje – taip rasite Jums tinkamiausią laiką.\n\nDar kartą atsiprašau ir dėkoju už kantrybę.\n\nPagarbiai,\nVelora Barber`;
        btn.disabled = true;
        btn.textContent = 'Siunčiama...';
        try {
            const res = await fetch('/api/demo-barber/admin/send-cancel-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: email, clientName: name, message: msg })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            btn.textContent = 'Išsiųsta!';
            btn.style.background = '#10b981';
        } catch (err) {
            btn.textContent = 'Klaida!';
            btn.style.background = '#ef4444';
            alert('Nepavyko: ' + err.message);
            setTimeout(() => { btn.disabled = false; btn.textContent = 'Siųsti'; btn.style.background = ''; }, 3000);
        }
    };
})();

// Make functions globally available
window.updateBookingStatus = updateBookingStatus;
window.deleteBooking = deleteBooking;
