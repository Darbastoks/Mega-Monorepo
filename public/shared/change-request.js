/**
 * Change Request Widget
 * Adds a €25 one-time change request modal to any salon admin panel.
 * Include this script in admin.html and ensure there's a button with id="requestChangeBtn".
 */
(function() {
    const CLOUD_NAME = 'dpg1rxaqy';
    const UPLOAD_PRESET = 'velora_onboarding';
    const UPLOAD_URL = 'https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/image/upload';
    const OPS_URL = 'https://velora-ops.onrender.com';

    const openBtn = document.getElementById('requestChangeBtn');
    if (!openBtn) return;

    // Inject modal HTML
    const modalDiv = document.createElement('div');
    modalDiv.id = 'changeRequestModal';
    modalDiv.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:1000; align-items:center; justify-content:center;';
    modalDiv.innerHTML = `
        <div style="max-width:500px; width:90%; background:var(--bg-card, var(--card-bg, #1a1a2e)); padding:2rem; border-radius:12px; border:1px solid rgba(34,211,238,0.2); max-height:80vh; overflow-y:auto; color:var(--text-main, #f0f0f0);">
            <h3 style="color:#22d3ee; margin-bottom:0.5rem;">✏️ Užsakyti pakeitimą</h3>
            <p style="opacity:0.6; margin-bottom:1.5rem; font-size:0.85rem;">Aprašykite ką norite pakeisti svetainėje. Pakeitimo kaina — <strong style="color:#22d3ee;">€25</strong> (vienkartinis mokestis).</p>
            <div style="margin-bottom:1rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Ką norite pakeisti? *</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:0.75rem;" id="cr-types">
                    <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; cursor:pointer; font-size:0.85rem;"><input type="checkbox" name="crType" value="logo"> Logotipas</label>
                    <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; cursor:pointer; font-size:0.85rem;"><input type="checkbox" name="crType" value="photos"> Nuotraukos / Galerija</label>
                    <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; cursor:pointer; font-size:0.85rem;"><input type="checkbox" name="crType" value="colors"> Spalvos / Dizainas</label>
                    <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; cursor:pointer; font-size:0.85rem;"><input type="checkbox" name="crType" value="text"> Tekstai / Turinys</label>
                    <label style="display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:6px; cursor:pointer; font-size:0.85rem;"><input type="checkbox" name="crType" value="other"> Kita</label>
                </div>
            </div>
            <div style="margin-bottom:1rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Aprašymas *</label>
                <textarea id="crDescription" rows="4" required placeholder="Detaliai aprašykite norimą pakeitimą..." style="width:100%; padding:0.75rem; border:1px solid rgba(255,255,255,0.15); border-radius:8px; background:rgba(255,255,255,0.05); color:inherit; resize:vertical; font-family:inherit;"></textarea>
            </div>
            <div style="margin-bottom:1.5rem;">
                <label style="display:block; margin-bottom:0.5rem; font-weight:500;">Failai (neprivaloma)</label>
                <p style="font-size:0.78rem; opacity:0.5; margin-bottom:0.5rem;">Naujas logotipas, nuotraukos ar kiti failai</p>
                <div id="crUploadZone" style="border:2px dashed rgba(255,255,255,0.12); border-radius:8px; padding:20px; text-align:center; cursor:pointer;">
                    <input type="file" id="crFiles" multiple accept="image/*" style="display:none;">
                    <i class="fas fa-cloud-upload-alt" style="font-size:1.2rem; color:rgba(34,211,238,0.5); margin-bottom:4px;"></i>
                    <p style="font-size:0.82rem; opacity:0.5; margin:0;">Paspauskite arba vilkite failus</p>
                </div>
                <div id="crPreviews" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;"></div>
            </div>
            <div style="background:rgba(34,211,238,0.06); border:1px solid rgba(34,211,238,0.15); border-radius:8px; padding:12px 16px; margin-bottom:1.5rem;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; opacity:0.7;">Pakeitimo kaina</span>
                    <span style="font-size:1.1rem; font-weight:600; color:#22d3ee;">€25</span>
                </div>
                <p style="font-size:0.75rem; opacity:0.4; margin:4px 0 0;">Pakeitimas bus atliktas per 1–3 darbo dienas po apmokėjimo</p>
            </div>
            <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                <button type="button" id="crClose" style="padding:0.6rem 1.2rem; background:transparent; border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:inherit; cursor:pointer; font-family:inherit;">Atšaukti</button>
                <button type="button" id="crSubmit" style="padding:0.6rem 1.5rem; background:linear-gradient(135deg,#22d3ee,#0ea5e9); color:#0a0e17; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-family:inherit;">Apmokėti €25</button>
            </div>
        </div>`;
    document.body.appendChild(modalDiv);

    const modal = modalDiv;
    const closeBtn = document.getElementById('crClose');
    const submitBtn = document.getElementById('crSubmit');
    const uploadZone = document.getElementById('crUploadZone');
    const fileInput = document.getElementById('crFiles');
    const previews = document.getElementById('crPreviews');
    let uploadedUrls = [];

    openBtn.addEventListener('click', function() { modal.style.display = 'flex'; });
    closeBtn.addEventListener('click', function() { modal.style.display = 'none'; });
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });

    uploadZone.addEventListener('click', function() { fileInput.click(); });
    uploadZone.addEventListener('dragover', function(e) { e.preventDefault(); uploadZone.style.borderColor = '#22d3ee'; });
    uploadZone.addEventListener('dragleave', function() { uploadZone.style.borderColor = 'rgba(255,255,255,0.12)'; });
    uploadZone.addEventListener('drop', function(e) { e.preventDefault(); uploadZone.style.borderColor = 'rgba(255,255,255,0.12)'; handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', function() { handleFiles(fileInput.files); fileInput.value = ''; });

    async function handleFiles(files) {
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.size > 5 * 1024 * 1024 || !f.type.startsWith('image/')) continue;
            var fd = new FormData();
            fd.append('file', f); fd.append('upload_preset', UPLOAD_PRESET); fd.append('folder', 'velora-onboarding/changes');
            try {
                var res = await fetch(UPLOAD_URL, { method: 'POST', body: fd });
                var data = await res.json();
                if (data.secure_url) {
                    uploadedUrls.push(data.secure_url);
                    var thumb = document.createElement('div');
                    thumb.style.cssText = 'position:relative; width:60px; height:60px; border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);';
                    var img = document.createElement('img');
                    img.src = data.secure_url; img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    var removeBtn = document.createElement('button');
                    removeBtn.type = 'button'; removeBtn.textContent = '✕';
                    removeBtn.style.cssText = 'position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:#f87171;border:none;color:#fff;font-size:0.5rem;cursor:pointer;display:flex;align-items:center;justify-content:center;';
                    (function(url, el, btn) {
                        btn.addEventListener('click', function() {
                            var idx = uploadedUrls.indexOf(url);
                            if (idx > -1) uploadedUrls.splice(idx, 1);
                            el.remove();
                        });
                    })(data.secure_url, thumb, removeBtn);
                    thumb.appendChild(img); thumb.appendChild(removeBtn);
                    previews.appendChild(thumb);
                }
            } catch(e) { /* skip */ }
        }
    }

    submitBtn.addEventListener('click', async function() {
        var types = [];
        document.querySelectorAll('input[name="crType"]:checked').forEach(function(c) { types.push(c.value); });
        var desc = document.getElementById('crDescription').value.trim();
        if (!desc) { alert('Aprašykite ką norite pakeisti'); return; }
        if (types.length === 0) { alert('Pasirinkite bent vieną pakeitimo tipą'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Kraunama...';

        try {
            var salonSlug = window.location.pathname.split('/')[1] || 'unknown';
            var res = await fetch(OPS_URL + '/webhook/change-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ salon: salonSlug, types: types, description: desc, file_urls: uploadedUrls })
            });
            var result = await res.json();
            if (result.checkout_url) {
                window.location.href = result.checkout_url;
            } else {
                alert('Klaida kuriant mokėjimą. Bandykite dar kartą.');
                submitBtn.disabled = false; submitBtn.textContent = 'Apmokėti €25';
            }
        } catch(e) {
            alert('Ryšio klaida. Bandykite dar kartą.');
            submitBtn.disabled = false; submitBtn.textContent = 'Apmokėti €25';
        }
    });
}());
