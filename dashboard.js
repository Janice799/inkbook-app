// ============================================================
// InkBook — Dashboard Logic (Firebase Connected)
// ============================================================
import { onAuthChange, logoutArtist, getArtistProfile } from './src/auth.js';
import { getArtistBookings, getTodayBookings, getMonthlyStats, updateBookingStatus } from './src/bookings.js';
import { getArtistFlashDesigns, uploadFlashDesign, toggleDesignAvailability, deleteFlashDesign } from './src/gallery.js';
import { db, doc, updateDoc, serverTimestamp } from './src/firebase.js';

// ---- Global State ----
let currentUser = null;
let artistProfile = null;

// ---- Auth Guard ----
onAuthChange(async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;

    // Load artist profile (with retry for new signups)
    let profileResult = await getArtistProfile(user.uid);

    // Retry once after 2 seconds if profile not found (new signup timing issue)
    if (!profileResult.success) {
        await new Promise(r => setTimeout(r, 2000));
        profileResult = await getArtistProfile(user.uid);
    }

    if (profileResult.success) {
        artistProfile = profileResult.data;
        renderArtistInfo(artistProfile);
        loadDashboardData();
    } else {
        // Profile truly doesn't exist — create a basic one from auth data
        const { doc, setDoc, serverTimestamp } = await import('./src/firebase.js');
        const { db } = await import('./src/firebase.js');
        await setDoc(doc(db, 'artists', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            handle: user.email.split('@')[0],
            bio: '',
            location: '',
            specialties: [],
            plan: 'free',
            bookingLink: '',
            avatar: user.photoURL || null,
            stats: { totalBookings: 0, rating: 0, yearsExperience: 0 },
            availability: {
                days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
                startTime: '10:00', endTime: '18:00', slotDuration: 60
            },
            paypal: { email: null, connected: false },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        artistProfile = (await getArtistProfile(user.uid)).data;
        renderArtistInfo(artistProfile);
        loadDashboardData();
    }
});

// ---- Render Artist Info ----
function renderArtistInfo(profile) {
    // Sidebar footer
    const miniName = document.querySelector('.artist-mini-name');
    const miniPlan = document.querySelector('.artist-mini-plan');
    if (miniName) miniName.textContent = `@${profile.handle || 'artist'}`;
    if (miniPlan) miniPlan.textContent = `${(profile.plan || 'free').charAt(0).toUpperCase() + (profile.plan || 'free').slice(1)} Plan`;

    // Top bar booking link
    const linkText = document.querySelector('.link-text');
    if (linkText) {
        const bookingUrl = `${window.location.origin}/book.html?artist=${profile.handle}`;
        linkText.textContent = bookingUrl;
        linkText.dataset.url = bookingUrl;
    }
}

// ---- Load All Dashboard Data ----
async function loadDashboardData() {
    await Promise.all([
        loadOverviewStats(),
        loadTodaySchedule(),
        loadBookingsTable(),
        loadGallery()
    ]);
}

// ---- Overview Stats ----
async function loadOverviewStats() {
    const stats = await getMonthlyStats(currentUser.uid);
    if (!stats.success) return;

    const cards = document.querySelectorAll('.stat-card');
    if (cards[0]) {
        cards[0].querySelector('.stat-card-value').textContent = `$${(stats.data.totalRevenue || 0).toLocaleString()}`;
        cards[0].querySelector('.stat-card-change').textContent = 'This month';
    }
    if (cards[1]) {
        cards[1].querySelector('.stat-card-value').textContent = stats.data.totalBookings || 0;
        cards[1].querySelector('.stat-card-change').textContent = 'Total bookings this month';
    }
    if (cards[2]) {
        cards[2].querySelector('.stat-card-value').textContent = `$${(stats.data.depositsCollected || 0).toLocaleString()}`;
        cards[2].querySelector('.stat-card-change').textContent = 'Deposits collected';
    }
    if (cards[3]) {
        cards[3].querySelector('.stat-card-value').textContent = `${stats.data.noShowRate}%`;
        cards[3].querySelector('.stat-card-change').textContent = 'No-show rate';
    }
}

// ---- Today's Schedule ----
async function loadTodaySchedule() {
    const result = await getTodayBookings(currentUser.uid);
    const scheduleList = document.querySelector('.schedule-list');
    const panelDate = document.querySelector('.panel-date');

    if (panelDate) {
        panelDate.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    if (!scheduleList) return;

    if (!result.success || result.data.length === 0) {
        scheduleList.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                <p style="font-size: 2rem; margin-bottom: 8px;">📭</p>
                <p>No appointments today</p>
                <p style="font-size: 0.85rem; margin-top: 4px;">Share your booking link to get started!</p>
            </div>`;
        return;
    }

    scheduleList.innerHTML = result.data.map(booking => {
        const time = booking.time || 'TBD';
        const statusClass = booking.status === 'completed' ? 'completed' :
            booking.status === 'in_progress' ? 'current' : 'upcoming';
        const statusLabel = booking.status === 'completed' ? '✓ Done' :
            booking.status === 'in_progress' ? '● NOW' : 'Up Next';
        const statusBadge = booking.status === 'completed' ? 'done' :
            booking.status === 'in_progress' ? 'now' : 'next';

        return `
            <div class="schedule-item ${statusClass}">
                <div class="schedule-time">${time}</div>
                <div class="schedule-info">
                    <div class="schedule-client">${booking.clientName || 'Client'}</div>
                    <div class="schedule-design">${booking.designName || 'Custom'}</div>
                </div>
                <div class="schedule-price">$${booking.totalPrice || 0}</div>
                <span class="schedule-status ${statusBadge}">${statusLabel}</span>
            </div>`;
    }).join('');
}

// ---- Bookings Table ----
async function loadBookingsTable(statusFilter = null) {
    const result = await getArtistBookings(currentUser.uid, statusFilter);
    const tableBody = document.querySelector('.bookings-table');
    if (!tableBody) return;

    // Keep header
    const header = tableBody.querySelector('.table-header');
    tableBody.innerHTML = '';
    if (header) tableBody.appendChild(header);

    if (!result.success || result.data.length === 0) {
        tableBody.innerHTML += `
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                <p>No bookings yet. Share your booking link to start receiving appointments!</p>
            </div>`;
        return;
    }

    result.data.forEach(booking => {
        const dateStr = booking.date ? new Date(booking.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD';
        const depositStatus = booking.deposit?.paid ? `$${booking.deposit.amount} ✓` : 'Pending';
        const depositClass = booking.deposit?.paid ? 'deposit-paid' : 'deposit-pending';

        const statusMap = {
            'confirmed': 'upcoming-badge',
            'completed': 'completed-badge',
            'cancelled': 'cancelled-badge',
            'pending': 'active-badge',
            'in_progress': 'active-badge'
        };

        const row = document.createElement('div');
        row.className = 'table-row';
        row.innerHTML = `
            <span class="client-cell"><strong>${booking.clientName}</strong><br/>${booking.clientEmail || ''}</span>
            <span>${booking.designName || 'Custom'}</span>
            <span>${dateStr}, ${booking.time || ''}</span>
            <span class="${depositClass}">${depositStatus}</span>
            <span><span class="status-badge ${statusMap[booking.status] || 'active-badge'}">${booking.status}</span></span>
            <span>
                ${booking.status === 'confirmed' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','completed')">Complete</button>` : ''}
                ${booking.status === 'pending' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','confirmed')">Confirm</button>` : ''}
                ${booking.status !== 'cancelled' && booking.status !== 'completed' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','cancelled')">Cancel</button>` : ''}
            </span>`;
        tableBody.appendChild(row);
    });
}

// Global status update function
window.updateStatus = async (bookingId, newStatus) => {
    const result = await updateBookingStatus(bookingId, newStatus);
    if (result.success) {
        loadBookingsTable();
        loadOverviewStats();
        loadTodaySchedule();
    }
};

// ---- Gallery ----
async function loadGallery() {
    const result = await getArtistFlashDesigns(currentUser.uid);
    const grid = document.querySelector('.gallery-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (result.success && result.data.length > 0) {
        result.data.forEach(design => {
            const card = document.createElement('div');
            card.className = 'gallery-card';
            card.innerHTML = `
                <div class="gallery-img" style="${design.imageUrl ? `background-image: url(${design.imageUrl}); background-size: cover;` : 'background: linear-gradient(135deg, #2d1b69, #1a1a2e);'}">
                    ${!design.imageUrl ? `<span>${design.emoji || '🎨'}</span>` : ''}
                </div>
                <div class="gallery-info">
                    <strong>${design.name}</strong>
                    <span>$${design.price || 0} · ${design.size || ''} · ${design.duration || ''}</span>
                </div>
                <div class="gallery-stats">${design.bookingsCount || 0} bookings</div>
                <div class="gallery-actions" style="padding: 0 12px 12px; display: flex; gap: 8px;">
                    <button class="table-action" onclick="window.toggleDesign('${design.id}', ${!design.available})">${design.available ? 'Hide' : 'Show'}</button>
                    <button class="table-action" style="color: #ff4d4d;" onclick="window.deleteDesign('${design.id}')">Delete</button>
                </div>`;
            grid.appendChild(card);
        });
    }

    // Add "Add New" card
    const addCard = document.createElement('div');
    addCard.className = 'gallery-card add-new';
    addCard.innerHTML = `
        <div class="gallery-img" style="background: var(--bg-secondary); cursor: pointer;"><span>➕</span></div>
        <div class="gallery-info">
            <strong>Add New Design</strong>
            <span>Upload flash art</span>
        </div>`;
    addCard.addEventListener('click', showUploadModal);
    grid.appendChild(addCard);
}

// Gallery actions
window.toggleDesign = async (designId, newState) => {
    await toggleDesignAvailability(designId, newState);
    loadGallery();
};

window.deleteDesign = async (designId) => {
    if (confirm('Delete this design permanently?')) {
        await deleteFlashDesign(designId);
        loadGallery();
    }
};

// ---- Upload Modal ----
function showUploadModal() {
    // Remove existing modal
    document.getElementById('uploadModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'uploadModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
    modal.innerHTML = `
        <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:440px;width:90%;">
            <h3 style="margin-bottom:20px;color:var(--text-primary);">Upload Flash Design</h3>
            <form id="uploadForm" style="display:flex;flex-direction:column;gap:14px;">
                <input type="text" id="designName" placeholder="Design Name" required style="padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);" />
                <input type="number" id="designPrice" placeholder="Price ($)" required style="padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);" />
                <input type="text" id="designSize" placeholder="Size (e.g. 4-5in)" style="padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);" />
                <input type="text" id="designDuration" placeholder="Duration (e.g. 2hrs)" style="padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);" />
                <input type="file" id="designImage" accept="image/*" style="display:none;" />
                <label for="designImage" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-secondary);cursor:pointer;font-size:0.9rem;">
                    <span>📎</span>
                    <span id="fileLabel">Choose Image File</span>
                </label>
                <div style="display:flex;gap:10px;margin-top:8px;">
                    <button type="submit" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Upload</button>
                    <button type="button" id="cancelUpload" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Cancel</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById('cancelUpload').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Show selected filename
    document.getElementById('designImage').addEventListener('change', (e) => {
        const label = document.getElementById('fileLabel');
        label.textContent = e.target.files[0] ? e.target.files[0].name : 'Choose Image File';
        if (e.target.files[0]) label.style.color = 'var(--accent-bright)';
    });

    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.textContent = 'Uploading...';
        btn.disabled = true;

        const imageFile = document.getElementById('designImage').files[0];
        const designData = {
            name: document.getElementById('designName').value,
            price: parseFloat(document.getElementById('designPrice').value),
            size: document.getElementById('designSize').value,
            duration: document.getElementById('designDuration').value,
            available: true
        };

        const result = await uploadFlashDesign(currentUser.uid, designData, imageFile);
        if (result.success) {
            modal.remove();
            loadGallery();
        } else {
            btn.textContent = 'Upload';
            btn.disabled = false;
            alert('Upload failed: ' + result.error);
        }
    });
}

// ---- DOM Ready ----
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('pageTitle');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');

    const titles = {
        overview: 'Overview',
        bookings: 'Bookings',
        gallery: 'Flash Gallery',
        clients: 'Clients',
        earnings: 'Earnings',
        settings: 'Settings'
    };

    // Tab switching
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            tabContents.forEach(t => t.classList.remove('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');
            pageTitle.textContent = titles[tab] || tab;
            sidebar.classList.remove('open');
        });
    });

    // Sidebar toggle
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    // Copy booking link
    const copyBtn = document.getElementById('copyLink');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const url = document.querySelector('.link-text')?.dataset?.url || '';
            navigator.clipboard.writeText(url).then(() => {
                copyBtn.textContent = '✅';
                setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
            });
        });
    }

    // Booking filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.textContent.toLowerCase();
            loadBookingsTable(filter === 'all' ? null : filter === 'upcoming' ? 'confirmed' : filter);
        });
    });

    // Upload design buttons
    document.querySelectorAll('.btn-primary-sm').forEach(btn => {
        if (btn.textContent.includes('Upload')) {
            btn.addEventListener('click', showUploadModal);
        }
    });

    // Logout (add to sidebar)
    const logoutBtn = document.createElement('a');
    logoutBtn.href = '#';
    logoutBtn.className = 'nav-item';
    logoutBtn.innerHTML = '<span class="nav-icon">🚪</span><span>Logout</span>';
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await logoutArtist();
        window.location.href = '/login.html';
    });
    document.querySelector('.sidebar-nav')?.appendChild(logoutBtn);

    // Animate stat cards
    document.querySelectorAll('.stat-card').forEach((card, i) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 + i * 80);
    });

    // ---- SETTINGS TAB ----
    function populateSettings(profile) {
        if (!profile) return;
        const s = (id) => document.getElementById(id);
        if (s('settingName')) s('settingName').value = profile.displayName || '';
        if (s('settingHandle')) s('settingHandle').value = profile.handle || '';
        if (s('settingBio')) s('settingBio').value = profile.bio || '';
        if (s('settingLocation')) s('settingLocation').value = profile.location || '';
        if (s('settingSpecialties')) s('settingSpecialties').value = (profile.specialties || []).join(', ');

        // Availability
        const avail = profile.availability || {};
        if (s('settingStartTime')) s('settingStartTime').value = avail.startTime || '10:00';
        if (s('settingEndTime')) s('settingEndTime').value = avail.endTime || '18:00';
        if (s('settingSlotDuration')) s('settingSlotDuration').value = String(avail.slotDuration || 60);

        // Day checkboxes
        const days = avail.days || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        document.querySelectorAll('#dayCheckboxes input[type="checkbox"]').forEach(cb => {
            cb.checked = days.includes(cb.value);
        });

        // PayPal
        if (s('settingPaypalEmail')) s('settingPaypalEmail').value = (profile.paypal?.email) || '';
    }

    populateSettings(artistProfile);

    // Save Profile
    document.getElementById('profileSettingsForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'Saving...';
        btn.disabled = true;
        try {
            const handle = document.getElementById('settingHandle').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
            await updateDoc(doc(db, 'artists', currentUser.uid), {
                displayName: document.getElementById('settingName').value,
                handle,
                bio: document.getElementById('settingBio').value,
                location: document.getElementById('settingLocation').value,
                specialties: document.getElementById('settingSpecialties').value.split(',').map(s => s.trim()).filter(Boolean),
                updatedAt: serverTimestamp()
            });
            btn.textContent = '✅ Saved!';
            // Update sidebar info
            const miniName = document.querySelector('.user-mini-name');
            if (miniName) miniName.textContent = `@${handle}`;
            setTimeout(() => { btn.textContent = 'Save Profile'; btn.disabled = false; }, 2000);
        } catch (err) {
            btn.textContent = '❌ Error';
            console.error(err);
            setTimeout(() => { btn.textContent = 'Save Profile'; btn.disabled = false; }, 2000);
        }
    });

    // Save Availability
    document.getElementById('availabilityForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'Saving...';
        btn.disabled = true;
        try {
            const days = [];
            document.querySelectorAll('#dayCheckboxes input[type="checkbox"]:checked').forEach(cb => days.push(cb.value));
            await updateDoc(doc(db, 'artists', currentUser.uid), {
                availability: {
                    days,
                    startTime: document.getElementById('settingStartTime').value,
                    endTime: document.getElementById('settingEndTime').value,
                    slotDuration: parseInt(document.getElementById('settingSlotDuration').value)
                },
                updatedAt: serverTimestamp()
            });
            btn.textContent = '✅ Saved!';
            setTimeout(() => { btn.textContent = 'Save Availability'; btn.disabled = false; }, 2000);
        } catch (err) {
            btn.textContent = '❌ Error';
            console.error(err);
            setTimeout(() => { btn.textContent = 'Save Availability'; btn.disabled = false; }, 2000);
        }
    });

    // Save PayPal
    document.getElementById('paypalSettingsForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'Saving...';
        btn.disabled = true;
        try {
            const email = document.getElementById('settingPaypalEmail').value;
            await updateDoc(doc(db, 'artists', currentUser.uid), {
                paypal: { email: email || null, connected: !!email },
                updatedAt: serverTimestamp()
            });
            btn.textContent = '✅ Saved!';
            setTimeout(() => { btn.textContent = 'Save PayPal'; btn.disabled = false; }, 2000);
        } catch (err) {
            btn.textContent = '❌ Error';
            console.error(err);
            setTimeout(() => { btn.textContent = 'Save PayPal'; btn.disabled = false; }, 2000);
        }
    });

    console.log('⚡ InkBook Dashboard loaded');
});
