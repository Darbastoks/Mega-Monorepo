const API_URL = '/api/nails/reservations';

// On Login Page
const loginForm = document.querySelector('.login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = loginForm.querySelector('input').value;
        try {
            const res = await fetch('/api/nails/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                localStorage.setItem('adminToken', 'true'); // Keep for basic frontend state
                window.location.href = 'admin.html';
            } else {
                alert('Neteisingas slaptažodis');
            }
        } catch (err) {
            alert('Ryšio klaida');
        }
    });
}

// On Admin Dashboard Page
const adminDashboard = document.querySelector('.admin-dashboard');

if (adminDashboard) {
    // Basic protection check
    if (!localStorage.getItem('adminToken')) {
        window.location.href = 'admin-login.html';
    }

    // Logout
    const logoutBtn = document.querySelector('.btn-admin-outline[href="#"]');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await fetch('/api/nails/admin/logout', { method: 'POST' });
            localStorage.removeItem('adminToken');
            window.location.href = 'admin-login.html';
        });
    }

    let allReservations = [];
    let allServices = [];

    async function fetchReservations() {
        try {
            const res = await fetch(API_URL);
            if (!res.ok) throw new Error('Nepavyko užkrauti rezervacijų');

            allReservations = await res.json();
            renderDashboard(allReservations);

        } catch (error) {
            console.error(error);
            const container = document.querySelector('.admin-table-container');
            container.innerHTML = `<p style="color:red;">Klaida kraunant duomenis iš serverio.</p>`;
        }
    }

    function renderDashboard(reservations) {
        updateStats(reservations);
        renderTable(reservations);
        setupFilterTabs();
        initSettingsView();
        loadSettings();
        loadServices();
    }

    function updateStats(reservations) {
        const statsCards = document.querySelectorAll('.stat-card h3');
        if (statsCards.length === 4) {
            const total = reservations.length;
            const pending = reservations.filter(r => r.status === 'pending').length;
            const confirmed = reservations.filter(r => r.status === 'confirmed').length;
            const completed = reservations.filter(r => r.status === 'completed').length;

            statsCards[0].textContent = total;
            statsCards[1].textContent = pending;
            statsCards[2].textContent = confirmed;
            statsCards[3].textContent = completed;
        }
    }

    function renderTable(reservationsArray) {
        const container = document.querySelector('.admin-table-container');

        if (reservationsArray.length === 0) {
            container.innerHTML = `<p>Pagal šiuos filtrus rezervacijų nerasta.</p>`;
            return;
        }

        let html = `
            <table class="table" style="width:100%; text-align:left; border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color);">
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Klientas</th>
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Kontaktai</th>
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Paslauga</th>
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Data / Laikas</th>
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Būsena</th>
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Veiksmas</th>
                    </tr>
                </thead>
                <tbody>
        `;

        reservationsArray.forEach(res => {
            const dateStr = res.date ? `${res.date} ${res.time || ''}`.trim() : 'Nenurodyta';
            let statusColor = '#ffb347'; // pending
            let statusText = 'Laukianti';
            if (res.status === 'confirmed') { statusColor = '#4a90e2'; statusText = 'Patvirtinta'; }
            if (res.status === 'completed') { statusColor = '#50e3c2'; statusText = 'Atlikta'; }
            if (res.status === 'cancelled') { statusColor = '#e74c3c'; statusText = 'Atšaukta'; }

            html += `
                <tr style="border-bottom:1px solid #f0f0f0; transition:background 0.3s;" onmouseover="this.style.background='#fafafa'" onmouseout="this.style.background='white'">
                    <td style="padding:15px; font-weight:600; color:var(--text-main);">${res.name}</td>
                    <td style="padding:15px; font-size:0.9rem; color:var(--text-muted);">${res.phone}</td>
                    <td style="padding:15px; font-size:0.9rem; color:var(--text-main);">${res.service}</td>
                    <td style="padding:15px; font-size:0.9rem; color:var(--text-muted);">${dateStr}</td>
                    <td style="padding:15px;">
                        <span style="background:${statusColor}22; color:${statusColor}; padding:5px 10px; border-radius:12px; font-size:0.75rem; font-weight:600;">
                            ${statusText}
                        </span>
                    </td>
                    <td style="padding:15px;">
                        <select onchange="changeStatus('${res.id}', this.value)" style="padding:5px 10px; border:1px solid var(--border-color); border-radius:6px; font-size:0.8rem; cursor:pointer;">
                            <option disabled selected>Keisti</option>
                            <option value="pending">Į Laukiančią</option>
                            <option value="confirmed">Patvirtinti</option>
                            <option value="completed">Atlikta</option>
                            <option value="cancelled">Atšaukti</option>
                        </select>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
        container.style.padding = '20px'; // Reduce extreme padding for actual table
    }

    window.changeStatus = async (id, newStatus) => {
        try {
            const res = await fetch(`${API_URL}/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                // Refresh data
                fetchReservations();
            } else {
                alert('Nepavyko atnaujinti būsenos.');
            }
        } catch (err) {
            console.error(err);
            alert('Klaida susisiekiant su serveriu.');
        }
    };

    function setupFilterTabs() {
        const tabs = document.querySelectorAll('.filter-tab');
        tabs.forEach(tab => {
            // Remove old listeners by cloning
            const newTab = tab.cloneNode(true);
            tab.parentNode.replaceChild(newTab, tab);

            newTab.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                newTab.classList.add('active');

                const filterText = newTab.textContent.toLowerCase();
                let filtered = allReservations;

                if (filterText.includes('laukiančios')) {
                    filtered = allReservations.filter(r => r.status === 'pending');
                } else if (filterText.includes('patvirtintos')) {
                    filtered = allReservations.filter(r => r.status === 'confirmed');
                } else if (filterText.includes('atliktos')) {
                    filtered = allReservations.filter(r => r.status === 'completed');
                } else if (filterText.includes('atšauktos')) {
                    filtered = allReservations.filter(r => r.status === 'cancelled');
                }

                renderTable(filtered);
            });
        });
    }

    // Search Box Implementation
    const searchInput = document.querySelector('.admin-search input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const searched = allReservations.filter(r =>
                r.name.toLowerCase().includes(val) ||
                r.phone.toLowerCase().includes(val)
            );
            renderTable(searched);
            // Optionally, we could remove the active tab visual state here
        });
    }

    // Initial Load
    fetchReservations();

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
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const workDays = Array.from(document.querySelectorAll('input[name="workDays"]:checked')).map(cb => parseInt(cb.value));
            const startHour = document.getElementById('startHour').value;
            const endHour = document.getElementById('endHour').value;
            const breakStart = document.getElementById('breakStart').value;
            const breakEnd = document.getElementById('breakEnd').value;

            try {
                const res = await fetch('/api/nails/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workingDays: workDays, startHour, endHour, breakStart, breakEnd, blockedDates: currentBlockedDates })
                });
                if (res.ok) alert('Nustatymai išsaugoti');
                else alert('Klaida išsaugant');
            } catch (err) { alert('Tinklo klaida'); }
        });

        // Service form submit
        document.getElementById('serviceForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('serviceId').value;
            const payload = {
                name: document.getElementById('serviceName').value,
                price: document.getElementById('servicePrice').value,
                duration: document.getElementById('serviceDuration').value
            };

            const method = id ? 'PATCH' : 'POST';
            const url = id ? `/api/nails/services/${id}` : '/api/nails/services';

            try {
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    alert('Paslauga išsaugota');
                    document.getElementById('serviceModal').style.display = 'none';
                    loadServices();
                } else { alert('Klaida išsaugant'); }
            } catch (err) { alert('Tinklo klaida'); }
        });
    }

    let currentBlockedDates = [];

    async function loadSettings() {
        try {
            const res = await fetch('/api/nails/settings');
            if (res.ok) {
                const settings = await res.json();
                if (settings) {
                    document.getElementById('startHour').value = settings.startHour;
                    document.getElementById('endHour').value = settings.endHour;
                    document.getElementById('breakStart').value = settings.breakStart || '';
                    document.getElementById('breakEnd').value = settings.breakEnd || '';
                    document.querySelectorAll('input[name="workDays"]').forEach(cb => {
                        cb.checked = settings.workingDays.includes(parseInt(cb.value));
                    });
                    currentBlockedDates = settings.blockedDates || [];
                    renderBlockedDates();
                }
            }
        } catch (err) { }
    }

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
        if (currentBlockedDates.includes(date)) { alert('Ši data jau pridėta'); return; }
        currentBlockedDates.push(date);
        currentBlockedDates.sort();
        renderBlockedDates();
        input.value = '';
        saveBlockedDates();
    };

    window.removeBlockedDate = function(date) {
        currentBlockedDates = currentBlockedDates.filter(d => d !== date);
        renderBlockedDates();
        saveBlockedDates();
    };

    async function saveBlockedDates() {
        const workDays = Array.from(document.querySelectorAll('input[name="workDays"]:checked')).map(cb => parseInt(cb.value));
        try {
            await fetch('/api/nails/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workingDays: workDays,
                    startHour: document.getElementById('startHour').value,
                    endHour: document.getElementById('endHour').value,
                    breakStart: document.getElementById('breakStart').value,
                    breakEnd: document.getElementById('breakEnd').value,
                    blockedDates: currentBlockedDates
                })
            });
        } catch (err) { }
    }

    async function loadServices() {
        try {
            const res = await fetch('/api/nails/services');
            if (res.ok) {
                allServices = await res.json();
                renderServices();
            }
        } catch (err) { }
    }

    function renderServices() {
        const tbody = document.getElementById('servicesBody');
        tbody.innerHTML = allServices.map(s => `
            <tr style="border-bottom: 1px solid var(--border-light)">
                <td style="padding: 0.75rem;"><strong>${s.name}</strong></td>
                <td style="padding: 0.75rem;">${s.duration} min</td>
                <td style="padding: 0.75rem;">${s.price} €</td>
                <td style="padding: 0.75rem;">
                    <button onclick="editService(${s.id})" style="background:transparent; border:none; cursor:pointer;" title="Redaguoti">✏️</button>
                    <button onclick="deleteService(${s.id})" style="background:transparent; border:none; cursor:pointer; color:red;" title="Ištrinti">🗑</button>
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
        const s = allServices.find(srv => srv.id === id);
        if (!s) return;
        document.getElementById('serviceId').value = s.id;
        document.getElementById('serviceName').value = s.name;
        document.getElementById('servicePrice').value = s.price;
        document.getElementById('serviceDuration').value = s.duration;
        document.getElementById('serviceModalTitle').textContent = 'Redaguoti Paslaugą';
        document.getElementById('serviceModal').style.display = 'flex';
    };

    window.deleteService = async function (id) {
        if (!confirm('Ar tikrai norite ištrinti šią paslaugą?')) return;
        try {
            const res = await fetch(`/api/nails/services/${id}`, { method: 'DELETE' });
            if (res.ok) {
                alert('Paslauga ištrinta');
                loadServices();
            } else alert('Klaida trinant');
        } catch (err) { alert('Tinklo klaida'); }
    };
}
