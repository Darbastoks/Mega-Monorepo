const API_URL = '/api/demo-nails/reservations';

// On Login Page
const loginForm = document.querySelector('.login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = loginForm.querySelector('input').value;
        try {
            const res = await fetch('/api/demo-nails/admin/login', {
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
            await fetch('/api/demo-nails/admin/logout', { method: 'POST' });
            localStorage.removeItem('adminToken');
            window.location.href = 'admin-login.html';
        });
    }

    let allReservations = [];
    let allServices = [];

    async function fetchReservations() {
        try {
            const res = await fetch(API_URL);
            if (res.status === 401) {
                localStorage.removeItem('adminToken');
                window.location.href = 'admin-login.html';
                return;
            }
            if (!res.ok) throw new Error('Nepavyko užkrauti rezervacijų');

            allReservations = await res.json();
            updateStats(allReservations);
            renderTable(allReservations);
            setupFilterTabs();

        } catch (error) {
            console.error(error);
            const container = document.querySelector('.admin-table-container');
            container.innerHTML = `<p style="color:red;">Klaida kraunant duomenis iš serverio.</p>`;
        }
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
                        <th style="padding:15px; color:var(--text-muted); font-size:0.85rem;">Darbuotojas</th>
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
                    <td style="padding:15px; font-size:0.9rem; color:var(--text-muted);">${res.staff_name || '-'}</td>
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

    // Initial Load — settings/services init independently of reservations
    initSettingsView();
    loadStaff();
    loadServices();
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
            const url = id ? `/api/demo-nails/services/${id}` : '/api/demo-nails/services';

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
    let currentBreaks = [];
    let allStaff = [];
    let activeStaffId = null;

    // ---- STAFF MULTI-TAB SYSTEM ----
    async function loadStaff() {
        try {
            const res = await fetch('/api/demo-nails/staff');
            if (res.ok) {
                allStaff = await res.json();
                if (allStaff.length > 0 && !activeStaffId) activeStaffId = allStaff[0].id;
                renderStaffTabs();
                if (activeStaffId) loadStaffSettings(activeStaffId);
            }
        } catch(e) { console.error('Failed to load staff', e); }
    }

    function renderStaffTabs() {
        const container = document.getElementById('staffTabs');
        if (!container) return;
        container.innerHTML = allStaff.map(s => {
            const isActive = s.id === activeStaffId;
            return `<button onclick="switchStaff(${s.id})" style="padding:8px 16px; border-radius:8px; border:1px solid ${isActive ? 'var(--primary-color)' : 'var(--border-light)'}; background:${isActive ? 'rgba(255,91,187,0.12)' : 'transparent'}; color:${isActive ? 'var(--primary-color)' : 'var(--text-muted)'}; cursor:pointer; font-family:inherit; font-weight:${isActive ? '600' : '400'}; font-size:0.9rem; transition:all 0.2s;">${s.name}</button>`;
        }).join('');
    }

    window.switchStaff = function(id) {
        activeStaffId = id;
        renderStaffTabs();
        loadStaffSettings(id);
    };

    async function loadStaffSettings(staffId) {
        try {
            const res = await fetch(`/api/demo-nails/staff/${staffId}/settings`);
            if (res.ok) {
                const settings = await res.json();
                currentBreaks = settings.breaks || [];
                currentBlockedDates = settings.blockedDates || [];
                renderStaffSettingsPanel(settings);
                renderSettingsSummary(settings);
            }
        } catch(e) { console.error('Failed to load staff settings', e); }
    }

    function renderStaffSettingsPanel(settings) {
        const panel = document.getElementById('staffSettingsPanel');
        if (!panel) return;
        const staff = allStaff.find(s => s.id === activeStaffId);
        const dayLabels = ['Se','Pr','An','Tr','Kt','Pn','Še'];
        const daysHTML = dayLabels.map((label, i) => {
            const checked = (settings.workingDays || []).includes(i) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" name="staffWorkDays" value="${i}" ${checked}> ${label}</label>`;
        }).join(' ');

        panel.innerHTML = `
            <div style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;color:var(--text-muted);">Vardas</label>
                <div style="display:flex;gap:8px;">
                    <input type="text" id="staffNameInput" value="${staff ? staff.name : ''}" style="flex:1;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;">
                    <button onclick="saveStaffName()" style="padding:0.5rem 1rem;background:var(--primary-color);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;">Saugoti</button>
                </div>
            </div>
            <form id="staffSettingsForm" onsubmit="event.preventDefault();saveStaffSettings();">
                <div style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:0.5rem;font-weight:500;">Darbo Dienos</label>
                    <div style="display:flex;flex-wrap:wrap;gap:10px;">${daysHTML}</div>
                </div>
                <div style="display:flex;gap:1rem;margin-bottom:1rem;">
                    <div style="flex:1;"><label style="display:block;margin-bottom:0.25rem;font-weight:500;">Pradžia</label><input type="time" id="staffStartHour" value="${settings.startHour || '09:00'}" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;"></div>
                    <div style="flex:1;"><label style="display:block;margin-bottom:0.25rem;font-weight:500;">Pabaiga</label><input type="time" id="staffEndHour" value="${settings.endHour || '18:00'}" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;"></div>
                </div>
                <div style="margin-bottom:1rem;padding-top:0.75rem;border-top:1px solid var(--border-light);">
                    <label style="display:block;margin-bottom:0.5rem;font-weight:500;">Pertraukos</label>
                    <small style="color:var(--text-muted);display:block;margin-bottom:0.5rem;">Iki 4 pertraukų per dieną</small>
                    <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:end;">
                        <div style="flex:1;"><label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;color:var(--text-muted);">Nuo</label><input type="time" id="breakStartInput" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;"></div>
                        <div style="flex:1;"><label style="display:block;margin-bottom:0.25rem;font-size:0.85rem;color:var(--text-muted);">Iki</label><input type="time" id="breakEndInput" style="width:100%;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;"></div>
                        <button type="button" onclick="addBreak()" style="padding:0.5rem 0.75rem;background:var(--primary-color);color:#fff;border:none;border-radius:6px;cursor:pointer;">+</button>
                    </div>
                    <div id="breaksList" style="display:flex;flex-direction:column;gap:6px;"></div>
                </div>
                <div style="margin-bottom:1rem;padding-top:0.75rem;border-top:1px solid var(--border-light);">
                    <label style="display:block;margin-bottom:0.5rem;font-weight:500;">Nedarbo Dienos</label>
                    <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
                        <input type="date" id="blockedDateInput" style="flex:1;padding:0.5rem;border:1px solid var(--border-light);border-radius:6px;font-family:inherit;">
                        <button type="button" onclick="addBlockedDate()" style="padding:0.5rem 0.75rem;background:var(--primary-color);color:#fff;border:none;border-radius:6px;cursor:pointer;">+</button>
                    </div>
                    <div id="blockedDatesList" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
                </div>
                <button type="submit" class="btn-submit" style="width:100%;">Išsaugoti Darbo Laiką</button>
            </form>
            ${allStaff.length > 1 ? `<button onclick="deleteStaff(${activeStaffId})" style="width:100%;margin-top:0.75rem;padding:0.5rem;background:transparent;border:1px solid #e74c3c;color:#e74c3c;border-radius:6px;cursor:pointer;font-family:inherit;">Ištrinti darbuotoją</button>` : ''}
        `;
        renderBreaks();
        renderBlockedDates();
    }

    window.saveStaffSettings = async function() {
        const payload = {
            workingDays: Array.from(document.querySelectorAll('input[name="staffWorkDays"]:checked')).map(cb => parseInt(cb.value)),
            startHour: document.getElementById('staffStartHour').value,
            endHour: document.getElementById('staffEndHour').value,
            breaks: currentBreaks,
            blockedDates: currentBlockedDates
        };
        try {
            const res = await fetch(`/api/demo-nails/staff/${activeStaffId}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) alert('Nustatymai išsaugoti');
            else alert('Klaida išsaugant');
        } catch(e) { alert('Tinklo klaida'); }
    };

    window.saveStaffName = async function() {
        const name = document.getElementById('staffNameInput').value.trim();
        if (!name) return;
        try {
            await fetch(`/api/demo-nails/staff/${activeStaffId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            loadStaff();
        } catch(e) { alert('Klaida'); }
    };

    window.addStaffPrompt = async function() {
        const name = prompt('Naujo darbuotojo vardas:');
        if (!name || !name.trim()) return;
        try {
            await fetch('/api/demo-nails/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            loadStaff();
        } catch(e) { alert('Klaida'); }
    };

    window.deleteStaff = async function(id) {
        if (allStaff.length <= 1) { alert('Turi likti bent vienas darbuotojas'); return; }
        if (!confirm('Ar tikrai norite ištrinti šį darbuotoją?')) return;
        try {
            await fetch(`/api/demo-nails/staff/${id}`, { method: 'DELETE' });
            activeStaffId = null;
            loadStaff();
        } catch(e) { alert('Klaida'); }
    };

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
            <span style="background: rgba(255,91,187,0.12); color: var(--primary-color); padding: 4px 10px; border-radius: 8px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">
                ${br.start} - ${br.end}
                <button onclick="removeBreak(${i})" style="background:none; border:none; color:var(--primary-color); cursor:pointer; font-size:1rem; padding:0; line-height:1;">&times;</button>
            </span>
        `).join('');
    }

    window.addBreak = function() {
        if (currentBreaks.length >= 4) { alert('Maksimaliai 4 pertraukos'); return; }
        const start = document.getElementById('breakStartInput').value;
        const end = document.getElementById('breakEndInput').value;
        if (!start || !end) { alert('Nurodykite pertraukos pradžią ir pabaigą'); return; }
        if (end <= start) { alert('Pabaiga turi būti vėliau nei pradžia'); return; }
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
        if (currentBlockedDates.includes(date)) { alert('Ši data jau pridėta'); return; }
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

    async function loadServices() {
        try {
            const res = await fetch('/api/demo-nails/services');
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
            const res = await fetch(`/api/demo-nails/services/${id}`, { method: 'DELETE' });
            if (res.ok) {
                alert('Paslauga ištrinta');
                loadServices();
            } else alert('Klaida trinant');
        } catch (err) { alert('Tinklo klaida'); }
    };
}

// ==================== EMERGENCY CANCELLATION ====================
(function() {
    const emergencyBtn = document.getElementById('emergencyCancelBtn');
    const emergencyModal = document.getElementById('emergencyModal');
    if (!emergencyBtn || !emergencyModal) return;

    const emergencyDate = document.getElementById('emergencyDate');
    const emergencyFullDay = document.getElementById('emergencyFullDay');
    const emergencyTimeRange = document.getElementById('emergencyTimeRange');
    const emergencyReason = document.getElementById('emergencyReason');
    const emergencyPreview = document.getElementById('emergencyPreview');
    const emergencyResult = document.getElementById('emergencyResult');
    const emergencyConfirmBtn = document.getElementById('emergencyConfirmBtn');
    const emergencyCloseBtn = document.getElementById('emergencyCloseBtn');

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
    });

    emergencyCloseBtn.addEventListener('click', () => { emergencyModal.style.display = 'none'; });
    emergencyModal.addEventListener('click', (e) => { if (e.target === emergencyModal) emergencyModal.style.display = 'none'; });

    emergencyFullDay.addEventListener('change', () => {
        emergencyTimeRange.style.display = emergencyFullDay.checked ? 'none' : 'block';
        loadPreview();
    });
    emergencyDate.addEventListener('change', loadPreview);
    document.getElementById('emergencyStartTime')?.addEventListener('change', loadPreview);
    document.getElementById('emergencyEndTime')?.addEventListener('change', loadPreview);

    async function loadPreview() {
        const date = emergencyDate.value;
        if (!date) { emergencyPreview.style.display = 'none'; emergencyConfirmBtn.disabled = true; return; }

        try {
            const res = await fetch('/api/demo-nails/reservations');
            const all = await res.json();
            let filtered = all.filter(b => b.date === date && b.status !== 'cancelled');

            if (!emergencyFullDay.checked) {
                const start = document.getElementById('emergencyStartTime').value;
                const end = document.getElementById('emergencyEndTime').value;
                if (start && end) filtered = filtered.filter(b => b.time >= start && b.time <= end);
            }

            if (filtered.length === 0) {
                emergencyPreview.innerHTML = '<p style="opacity:0.5; font-size:0.9rem;">Šią dieną registracijų nėra. Data bus užblokuota.</p>';
            } else {
                const withEmail = filtered.filter(b => b.email);
                const noEmail = filtered.filter(b => !b.email);
                let html = '<p style="font-weight:500; margin-bottom:0.5rem;">Paveiktos registracijos:</p>';
                if (withEmail.length > 0) {
                    html += `<p style="font-size:0.8rem; color:#22c55e; margin-bottom:0.3rem;">Bus informuoti el. paštu (${withEmail.length}):</p>`;
                    withEmail.forEach(b => { html += `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.9rem;"><span>${b.name} — ${b.time} — ${b.service}</span><span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:0.75rem;">El. paštas</span></div>`; });
                }
                if (noEmail.length > 0) {
                    html += `<p style="font-size:0.8rem; color:#fbbf24; margin-top:0.5rem; margin-bottom:0.3rem;">Reikia informuoti telefonu (${noEmail.length}):</p>`;
                    noEmail.forEach(b => { html += `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.9rem;"><span>${b.name} — ${b.time} — ${b.phone}</span><span style="background:rgba(251,191,36,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:0.75rem;">Skambinti</span></div>`; });
                }
                emergencyPreview.innerHTML = html;
            }
            emergencyPreview.style.display = 'block';
            emergencyConfirmBtn.disabled = false;
        } catch (err) {
            emergencyPreview.innerHTML = '<p style="color:#ef4444;">Klaida kraunant duomenis</p>';
            emergencyPreview.style.display = 'block';
        }
    }

    emergencyConfirmBtn.addEventListener('click', async () => {
        const date = emergencyDate.value;
        if (!date) return;
        emergencyConfirmBtn.disabled = true;
        emergencyConfirmBtn.textContent = 'Atšaukiama...';

        try {
            const res = await fetch('/api/demo-nails/admin/emergency-cancel', {
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

            let html = `<p style="font-weight:600; color:#10b981; margin-bottom:0.5rem;">Atšaukta sėkmingai! (${data.cancelledCount} registr.)</p>`;
            if (data.clients && data.clients.length > 0) {
                html += `<p style="font-size:0.85rem; opacity:0.7; margin-bottom:0.5rem;">Informuokite klientus:</p>`;
                data.clients.forEach((c, i) => {
                    const clipText = `${c.name} | ${c.phone} | ${c.service} | ${c.date} ${c.time}`;
                    html += `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem;">
                        <div style="font-size:0.9rem;margin-bottom:0.5rem;"><strong>${c.name}</strong> <span style="opacity:0.6;font-size:0.8rem;">— ${c.time} — ${c.service}</span></div>
                        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                            <button style="padding:4px 10px;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;background:rgba(99,102,241,0.2);color:#818cf8;" onclick="navigator.clipboard.writeText('${clipText.replace(/'/g,"\\'")}');this.textContent='Nukopijuota!';">Kopijuoti</button>
                            <a href="tel:${c.phone}" style="padding:4px 10px;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;background:rgba(34,197,94,0.2);color:#22c55e;text-decoration:none;">Skambinti</a>
                            <a href="sms:${c.phone}" style="padding:4px 10px;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;background:rgba(59,130,246,0.2);color:#60a5fa;text-decoration:none;">Žinutė</a>
                            ${c.email ? `<button id="nailsSB${i}" style="padding:4px 10px;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;background:rgba(251,191,36,0.2);color:#fbbf24;" onclick="nailsSendEmail(${i},'${c.email.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}')">Siųsti el. laišką</button>` : ''}
                        </div>
                    </div>`;
                });
            }
            emergencyResult.innerHTML = html;
            emergencyResult.style.display = 'block';
            emergencyPreview.style.display = 'none';
            emergencyConfirmBtn.style.display = 'none';
            if (typeof loadReservations === 'function') loadReservations();
        } catch (err) {
            emergencyResult.innerHTML = `<p style="color:#ef4444;">Klaida: ${err.message}</p>`;
            emergencyResult.style.display = 'block';
            emergencyConfirmBtn.disabled = false;
            emergencyConfirmBtn.textContent = 'Atšaukti registracijas';
        }
    });

    window.nailsSendEmail = async function(idx, email, name) {
        const btn = document.getElementById('nailsSB' + idx);
        const msg = `Sveiki,\n\nlabai atsiprašau, tačiau dėl netikėtai susiklosčiusios skubios situacijos šiandien negalėsiu dalyvauti / būti darbe. Suprantu, kad tai gali sukelti nepatogumų, ir nuoširdžiai apgailestauju dėl to.\n\nLabai vertinu Jūsų supratingumą. Primenu, kad vizito laiką galite patogiai pakeisti per registracijos sistemą mano svetainėje – taip rasite Jums tinkamiausią laiką.\n\nDar kartą atsiprašau ir dėkoju už kantrybę.\n\nPagarbiai,\nVelora Nails`;
        btn.disabled = true; btn.textContent = 'Siunčiama...';
        try {
            const res = await fetch('/api/demo-nails/admin/send-cancel-email', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: email, clientName: name, message: msg })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            btn.textContent = 'Išsiųsta!'; btn.style.background = '#10b981';
        } catch (err) {
            btn.textContent = 'Klaida!'; btn.style.background = '#ef4444';
            alert('Nepavyko: ' + err.message);
            setTimeout(() => { btn.disabled = false; btn.textContent = 'Siųsti'; btn.style.background = ''; }, 3000);
        }
    };
})();
