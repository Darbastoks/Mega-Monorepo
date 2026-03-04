const API_URL = '/api/nails/reservations';

// On Login Page
const loginForm = document.querySelector('.login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputStr = loginForm.querySelector('input').value;
        // Super basic client side lock since frontend is local 
        if (inputStr.trim().length > 0) {
            localStorage.setItem('adminToken', 'true');
            window.location.href = 'admin.html';
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
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('adminToken');
            window.location.href = 'admin-login.html';
        });
    }

    let allReservations = [];

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
}
