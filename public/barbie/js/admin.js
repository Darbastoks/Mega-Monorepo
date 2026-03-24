// ==========================================
//  G Spot Barbershop — Admin Dashboard JS
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
        const res = await fetch('/api/barbie/admin/check');
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
            const res = await fetch('/api/barbie/admin/login', {
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
        await fetch('/api/barbie/admin/logout', { method: 'POST' });
        window.location.reload();
    });
}

// --- Load Bookings ---
async function loadBookings() {
    try {
        const res = await fetch('/api/barbie/admin/bookings');
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
        const res = await fetch(`/api/barbie/admin/bookings/${id}`, {
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
        const res = await fetch(`/api/barbie/admin/bookings/${id}`, {
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
            const res = await fetch('/api/barbie/admin/change-password', {
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

// --- Settings ---
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

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveAllSettings();
    });

    loadSettings();
}

function getSettingsPayload() {
    return {
        workingDays: Array.from(document.querySelectorAll('input[name="workDays"]:checked')).map(cb => parseInt(cb.value)),
        startHour: document.getElementById('startHour').value,
        endHour: document.getElementById('endHour').value,
        blockedDates: currentBlockedDates,
        breaks: currentBreaks
    };
}

async function saveAllSettings() {
    try {
        const res = await fetch('/api/barbie/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getSettingsPayload())
        });
        if (res.ok) showToast('✅', 'Nustatymai išsaugoti');
        else {
            const errData = await res.json().catch(() => ({}));
            showToast('❌', 'Klaida: ' + (errData.error || res.status));
        }
    } catch (err) { showToast('❌', 'Tinklo klaida: ' + err.message); }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/barbie/settings');
        if (res.ok) {
            const settings = await res.json();
            if (settings) {
                document.getElementById('startHour').value = settings.startHour;
                document.getElementById('endHour').value = settings.endHour;
                document.querySelectorAll('input[name="workDays"]').forEach(cb => {
                    cb.checked = settings.workingDays.includes(parseInt(cb.value));
                });
                currentBlockedDates = settings.blockedDates || [];
                currentBreaks = settings.breaks || [];
                renderBlockedDates();
                renderBreaks();
                renderSettingsSummary(settings);
            }
        }
    } catch (err) { }
}

function renderSettingsSummary(settings) {
    const card = document.getElementById('settingsSummaryCard');
    if (!card) return;
    const dayNames = ['Se', 'Pr', 'An', 'Tr', 'Kt', 'Pn', 'Še'];
    const days = (settings.workingDays || []).sort().map(d => dayNames[d]).join(', ');
    document.getElementById('summaryWorkDays').textContent = days || 'Nenustatyta';
    document.getElementById('summaryHours').textContent = `${settings.startHour || '—'} – ${settings.endHour || '—'}`;
    const breaks = (settings.breaks || []).map(b => `${b.start}–${b.end}`).join(', ');
    document.getElementById('summaryBreaks').textContent = breaks || 'Nėra';
    const blocked = settings.blockedDates || [];
    document.getElementById('summaryBlocked').textContent = blocked.length > 0 ? `${blocked.length} d. (${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? '…' : ''})` : 'Nėra';
    card.style.display = 'block';
}

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
    saveAllSettings();
};

window.removeBreak = function(index) {
    currentBreaks.splice(index, 1);
    renderBreaks();
    saveAllSettings();
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
    saveAllSettings();
};

window.removeBlockedDate = function(date) {
    currentBlockedDates = currentBlockedDates.filter(d => d !== date);
    renderBlockedDates();
    saveAllSettings();
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
            const res = await fetch('/api/barbie/admin/bookings');
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
            const res = await fetch('/api/barbie/admin/emergency-cancel', {
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

            let resultHtml = `<p style="font-weight:600; color:#10b981;">Atšaukta sėkmingai!</p>`;
            resultHtml += `<p style="font-size:0.9rem;">Atšaukta registracijų: <strong>${data.cancelledCount}</strong></p>`;
            resultHtml += `<p style="font-size:0.9rem;">Informuota el. paštu: <strong>${data.emailedCount}</strong></p>`;

            if (data.needsPhoneCall && data.needsPhoneCall.length > 0) {
                resultHtml += `<p style="font-size:0.9rem; color:#fbbf24; margin-top:0.5rem; font-weight:500;">Paskambinkite šiems klientams:</p>`;
                data.needsPhoneCall.forEach(c => {
                    resultHtml += `<div class="emergency-preview-item"><span>${c.name}</span><a href="tel:${c.phone}" style="color:#fbbf24;">${c.phone}</a></div>`;
                });
            }

            emergencyResult.innerHTML = resultHtml;
            emergencyResult.style.display = 'block';
            emergencyPreview.style.display = 'none';
            emergencyConfirmBtn.style.display = 'none';

            // Refresh bookings list
            if (typeof loadBookings === 'function') loadBookings();

        } catch (err) {
            emergencyResult.innerHTML = `<p style="color:#ef4444;">Klaida: ${err.message}</p>`;
            emergencyResult.style.display = 'block';
            emergencyConfirmBtn.disabled = false;
            emergencyConfirmBtn.textContent = 'Atšaukti registracijas';
        }
    });
})();

// Make functions globally available
window.updateBookingStatus = updateBookingStatus;
window.deleteBooking = deleteBooking;
