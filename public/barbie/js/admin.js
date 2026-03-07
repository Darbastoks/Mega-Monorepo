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
    initSettingsView();
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
        loadSettings();
        loadServices();
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

// Make functions globally available
window.updateBookingStatus = updateBookingStatus;
window.deleteBooking = deleteBooking;

// ==================== SETTINGS & SERVICES ====================

function initSettingsView() {
    document.getElementById('viewSettingsBtn').addEventListener('click', () => {
        document.getElementById('bookingsSection').style.display = 'none';
        document.getElementById('settingsSection').style.display = 'block';
        document.getElementById('viewSettingsBtn').style.display = 'none';
        document.getElementById('viewBookingsBtn').style.display = 'inline-block';
    });
    document.getElementById('viewBookingsBtn').addEventListener('click', () => {
        document.getElementById('bookingsSection').style.display = 'block';
        document.getElementById('settingsSection').style.display = 'none';
        document.getElementById('viewSettingsBtn').style.display = 'inline-block';
        document.getElementById('viewBookingsBtn').style.display = 'none';
    });

    // Settings form submit
    const settingsForm = document.getElementById('settingsForm');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    // Quick Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('startHour').value = btn.dataset.start;
            document.getElementById('endHour').value = btn.dataset.end;
        });
    });

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveSettingsBtn.classList.add('btn-loading');

        const workDays = Array.from(document.querySelectorAll('input[name="workDays"]:checked')).map(cb => parseInt(cb.value));
        const startHour = document.getElementById('startHour').value;
        const endHour = document.getElementById('endHour').value;

        try {
            const res = await fetch('/api/barbie/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workingDays: workDays, startHour, endHour })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('✅', 'Darbo laikas išsaugotas');
            } else {
                if (res.status === 401) {
                    alert('Sesija pasibaigė. Prašome prisijungti iš naujo.');
                    window.location.reload();
                } else {
                    showToast('❌', 'Klaida: ' + (data.details || data.error || 'Serverio klaida'));
                }
            }
        } catch (err) {
            showToast('❌', 'Tinklo klaida');
        } finally {
            saveSettingsBtn.classList.remove('btn-loading');
        }
    });

    // Service form submit
    document.getElementById('serviceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('serviceId').value;
        const payload = {
            name: document.getElementById('serviceName').value,
            price: document.getElementById('servicePrice').value,
            duration: document.getElementById('serviceDuration').value,
            description: document.getElementById('serviceDesc').value
        };

        const method = id ? 'PATCH' : 'POST';
        const url = id ? `/api/barbie/services/${id}` : '/api/barbie/services';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast('✅', 'Paslauga išsaugota');
                document.getElementById('serviceModal').style.display = 'none';
                loadServices();
            } else { showToast('❌', 'Klaida išsaugant'); }
        } catch (err) { showToast('❌', 'Tinklo klaida'); }
    });
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
            }
        }
    } catch (err) { }
}

async function loadServices() {
    try {
        const res = await fetch('/api/barbie/services');
        if (res.ok) {
            allServices = await res.json();
            renderServices();
        }
    } catch (err) { }
}

function renderServices() {
    const tbody = document.getElementById('servicesBody');
    tbody.innerHTML = allServices.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${s.duration} min</td>
            <td>${s.price} €</td>
            <td>
                <button class="action-btn action-confirm" onclick="editService('${s._id}')">✏️</button>
                <button class="action-btn action-delete" onclick="deleteService('${s._id}')">🗑</button>
            </td>
        </tr>
    `).join('');
}

window.openAddServiceModal = function () {
    document.getElementById('serviceId').value = '';
    document.getElementById('serviceForm').reset();
    document.getElementById('serviceModalTitle').textContent = 'Pridėti Paslaugą';
    document.getElementById('serviceModal').style.display = 'flex';
};

window.editService = function (id) {
    const s = allServices.find(srv => srv._id === id);
    if (!s) return;
    document.getElementById('serviceId').value = s._id;
    document.getElementById('serviceName').value = s.name;
    document.getElementById('servicePrice').value = s.price;
    document.getElementById('serviceDuration').value = s.duration;
    document.getElementById('serviceDesc').value = s.description || '';
    document.getElementById('serviceModalTitle').textContent = 'Redaguoti Paslaugą';
    document.getElementById('serviceModal').style.display = 'flex';
};

window.deleteService = async function (id) {
    if (!confirm('Ar tikrai norite ištrinti šią paslaugą?')) return;
    try {
        const res = await fetch(`/api/barbie/services/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('✅', 'Paslauga ištrinta');
            loadServices();
        } else showToast('❌', 'Klaida trinant');
    } catch (err) { showToast('❌', 'Tinklo klaida'); }
};
