// ============================================================
// InkBook — Dashboard Logic (Firebase Connected)
// ============================================================
import { onAuthChange, logoutArtist, getArtistProfile } from './src/auth.js';
import { getArtistBookings, getTodayBookings, getMonthlyStats, updateBookingStatus, createBooking } from './src/bookings.js';
import { getArtistFlashDesigns, uploadFlashDesign, toggleDesignAvailability, deleteFlashDesign } from './src/gallery.js';
import { db, doc, setDoc, updateDoc, serverTimestamp } from './src/firebase.js';

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
        const rawDate = booking.date?.toDate ? booking.date.toDate() : (booking.date ? new Date(booking.date) : null);
        const dateStr = rawDate ? rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
        const depositAmt = booking.depositAmount || booking.deposit?.amount || 0;
        const depositPaid = booking.depositPaid || booking.deposit?.paid || false;
        const depositStatus = depositPaid ? `$${depositAmt} ✓` : `$${depositAmt}`;
        const depositClass = depositPaid ? 'deposit-paid' : 'deposit-pending';

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
            <span class="client-cell"><strong>${booking.clientName || 'Client'}</strong><br/>${booking.clientEmail || ''}</span>
            <span>${booking.designName || 'Custom'}</span>
            <span>${dateStr}, ${booking.timeSlot || booking.time || ''}</span>
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
            const isHidden = design.available === false;
            card.innerHTML = `
                <div class="gallery-img" style="position:relative;${design.imageUrl ? `background-image: url(${design.imageUrl}); background-size: cover; background-position: center; cursor:pointer;` : 'background: linear-gradient(135deg, #2d1b69, #1a1a2e); cursor:pointer;'}${isHidden ? ' opacity:0.5; filter:grayscale(0.5);' : ''}">
                    ${!design.imageUrl ? `<span>${design.emoji || '🎨'}</span>` : ''}
                    ${isHidden ? '<span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);padding:2px 8px;border-radius:4px;font-size:0.7rem;color:#ff9800;">Hidden</span>' : ''}
                </div>
                <div class="gallery-info">
                    <strong>${design.name}</strong>
                    <span>$${design.price || 0} · ${design.size || ''} · ${design.duration || ''}</span>
                </div>
                <div class="gallery-stats">${design.bookingsCount || 0} bookings</div>
                <div class="gallery-actions" style="padding: 0 12px 12px; display: flex; gap: 8px;">
                    <button class="table-action edit-btn">✏️ Edit</button>
                    <button class="table-action toggle-btn">${isHidden ? '👁️ Publish' : '🙈 Hide'}</button>
                    <button class="table-action del-btn" style="color: #ff4d4d;">🗑️</button>
                </div>`;
            // Click image → open full
            card.querySelector('.gallery-img').addEventListener('click', () => {
                if (design.imageUrl) window.open(design.imageUrl, '_blank');
            });
            // Edit
            card.querySelector('.edit-btn').addEventListener('click', () => showEditDesignModal(design));
            // Toggle
            card.querySelector('.toggle-btn').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.textContent = '...'; btn.disabled = true;
                await toggleDesignAvailability(design.id, !design.available !== false ? false : true);
                loadGallery();
            });
            // Delete
            card.querySelector('.del-btn').addEventListener('click', async () => {
                if (confirm('Delete this design permanently?')) {
                    await deleteFlashDesign(design.id);
                    loadGallery();
                }
            });
            grid.appendChild(card);
        });
    }

    // Add New card
    const addCard = document.createElement('div');
    addCard.className = 'gallery-card add-new';
    addCard.innerHTML = `
        <div class="gallery-img" style="background: var(--bg-secondary); cursor: pointer;"><span>➕</span></div>
        <div class="gallery-info"><strong>Add New Design</strong><span>Upload flash art</span></div>`;
    addCard.addEventListener('click', showUploadModal);
    grid.appendChild(addCard);
}

// ---- Edit Design Modal ----
function showEditDesignModal(design) {
    document.getElementById('editDesignModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editDesignModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
    modal.innerHTML = `
        <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto;">
            <h3 style="margin-bottom:16px;color:var(--text-primary);">✏️ Edit Design</h3>
            ${design.imageUrl ? `<img src="${design.imageUrl}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:16px;" />` : ''}
            <form id="editDesignForm" style="display:flex;flex-direction:column;gap:12px;">
                <div>
                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Design Name</label>
                    <input type="text" id="editName" value="${design.name || ''}" required style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Price ($)</label>
                        <input type="number" id="editPrice" value="${design.price || 0}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Size</label>
                        <input type="text" id="editSize" value="${design.size || ''}" placeholder="e.g. 4-5in" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                </div>
                <div>
                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Duration</label>
                    <input type="text" id="editDuration" value="${design.duration || ''}" placeholder="e.g. 2hrs" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                </div>
                <div style="display:flex;gap:10px;margin-top:8px;">
                    <button type="submit" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Save Changes</button>
                    <button type="button" id="cancelEditDesign" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Cancel</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('cancelEditDesign').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('editDesignForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
            await updateDoc(doc(db, 'flash_designs', design.id), {
                name: document.getElementById('editName').value,
                price: parseFloat(document.getElementById('editPrice').value) || 0,
                size: document.getElementById('editSize').value,
                duration: document.getElementById('editDuration').value,
                updatedAt: serverTimestamp()
            });
            btn.textContent = '✅ Saved!';
            setTimeout(() => { modal.remove(); loadGallery(); }, 800);
        } catch (err) {
            console.error('Edit error:', err);
            btn.textContent = '❌ Error';
            setTimeout(() => { btn.textContent = 'Save Changes'; btn.disabled = false; }, 2000);
        }
    });
}

// ---- Upload Modal ----
function showUploadModal() {
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
                    <span>📎</span><span id="fileLabel">Choose Image File</span>
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
    document.getElementById('designImage').addEventListener('change', (e) => {
        const label = document.getElementById('fileLabel');
        label.textContent = e.target.files[0] ? e.target.files[0].name : 'Choose Image File';
        if (e.target.files[0]) label.style.color = 'var(--accent-bright)';
    });
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.textContent = 'Uploading...'; btn.disabled = true;
        const imageFile = document.getElementById('designImage').files[0];
        const designData = {
            name: document.getElementById('designName').value,
            price: parseFloat(document.getElementById('designPrice').value),
            size: document.getElementById('designSize').value,
            duration: document.getElementById('designDuration').value,
            available: true
        };
        const result = await uploadFlashDesign(currentUser.uid, designData, imageFile);
        if (result.success) { modal.remove(); loadGallery(); }
        else { btn.textContent = 'Upload'; btn.disabled = false; alert('Upload failed: ' + result.error); }
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

    // ---- Manual Booking ----
    document.getElementById('manualBookingBtn')?.addEventListener('click', () => {
        document.getElementById('manualBookingModal')?.remove();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const defaultDate = tomorrow.toISOString().split('T')[0];

        const modal = document.createElement('div');
        modal.id = 'manualBookingModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;">
                <h3 style="margin-bottom:20px;color:var(--text-primary);">📅 New Manual Booking</h3>
                <form id="manualBookingForm" style="display:flex;flex-direction:column;gap:14px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Client Name *</label>
                            <input type="text" id="mbClientName" required placeholder="John Doe" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Client Email *</label>
                            <input type="email" id="mbClientEmail" required placeholder="john@email.com" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Phone</label>
                            <input type="tel" id="mbClientPhone" placeholder="555-1234" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Client Age *</label>
                            <input type="number" id="mbClientAge" required min="18" placeholder="18+" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Design / Description *</label>
                        <input type="text" id="mbDesignName" required placeholder="Rose vine sleeve" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Date *</label>
                            <input type="date" id="mbDate" required value="${tomorrow.getFullYear()}-${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getDate().toString().padStart(2, '0')}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Time *</label>
                            <select id="mbTime" required style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                <option value="09:00">9:00 AM</option>
                                <option value="09:30">9:30 AM</option>
                                <option value="10:00">10:00 AM</option>
                                <option value="10:30">10:30 AM</option>
                                <option value="11:00">11:00 AM</option>
                                <option value="11:30">11:30 AM</option>
                                <option value="12:00">12:00 PM</option>
                                <option value="12:30">12:30 PM</option>
                                <option value="13:00">1:00 PM</option>
                                <option value="13:30">1:30 PM</option>
                                <option value="14:00" selected>2:00 PM</option>
                                <option value="14:30">2:30 PM</option>
                                <option value="15:00">3:00 PM</option>
                                <option value="15:30">3:30 PM</option>
                                <option value="16:00">4:00 PM</option>
                                <option value="16:30">4:30 PM</option>
                                <option value="17:00">5:00 PM</option>
                                <option value="17:30">5:30 PM</option>
                                <option value="18:00">6:00 PM</option>
                                <option value="18:30">6:30 PM</option>
                                <option value="19:00">7:00 PM</option>
                                <option value="19:30">7:30 PM</option>
                                <option value="20:00">8:00 PM</option>
                                <option value="20:30">8:30 PM</option>
                                <option value="21:00">9:00 PM</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Duration (hrs)</label>
                            <input type="number" id="mbDuration" value="2" min="1" max="12" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Total Price ($) *</label>
                            <input type="number" id="mbPrice" required placeholder="200" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Deposit ($)</label>
                            <input type="number" id="mbDeposit" placeholder="100" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Status</label>
                            <select id="mbStatus" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                <option value="confirmed">Confirmed</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Deposit Paid?</label>
                            <select id="mbDepositPaid" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                <option value="yes">Yes — Paid</option>
                                <option value="no" selected>No — Not yet</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button type="submit" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Create Booking</button>
                        <button type="button" id="cancelManualBooking" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Cancel</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);

        document.getElementById('cancelManualBooking').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.getElementById('manualBookingForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.textContent = 'Creating...';
            btn.disabled = true;

            const price = parseFloat(document.getElementById('mbPrice').value) || 0;
            const deposit = parseFloat(document.getElementById('mbDeposit').value) || Math.round(price * 0.5);

            const result = await createBooking({
                artistId: currentUser.uid,
                artistHandle: artistProfile?.handle || '',
                clientName: document.getElementById('mbClientName').value,
                clientEmail: document.getElementById('mbClientEmail').value,
                clientPhone: document.getElementById('mbClientPhone').value,
                clientAge: parseInt(document.getElementById('mbClientAge').value),
                designId: null,
                designName: document.getElementById('mbDesignName').value,
                designType: 'custom',
                date: document.getElementById('mbDate').value,
                timeSlot: document.getElementById('mbTime').value,
                estimatedDuration: parseInt(document.getElementById('mbDuration').value) * 60,
                totalPrice: price,
                depositAmount: deposit,
                consentSigned: true
            });

            if (result.success) {
                // Update status + deposit paid
                const status = document.getElementById('mbStatus').value;
                const paid = document.getElementById('mbDepositPaid').value === 'yes';
                await updateDoc(doc(db, 'bookings', result.bookingId), {
                    status,
                    depositPaid: paid
                });

                btn.textContent = '✅ Created!';
                setTimeout(() => {
                    modal.remove();
                    loadBookingsTable();
                    loadEarnings();
                }, 1000);
            } else {
                btn.textContent = '❌ Error';
                console.error(result.error);
                setTimeout(() => { btn.textContent = 'Create Booking'; btn.disabled = false; }, 2000);
            }
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

    // ---- Quick Action Buttons ----
    // 1. Share Booking Link
    document.getElementById('actionShareLink')?.addEventListener('click', () => {
        if (!artistProfile?.handle) return;
        const url = `${window.location.origin}/book.html?artist=${artistProfile.handle}`;
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('actionShareLink');
            btn.querySelector('.action-label').textContent = '✅ Link Copied!';
            setTimeout(() => { btn.querySelector('.action-label').textContent = 'Share Booking Link'; }, 2000);
        });
    });

    // 2. Add Flash Design → go to gallery tab + open upload modal
    document.getElementById('actionAddFlash')?.addEventListener('click', () => {
        document.querySelector('[data-tab="gallery"]')?.click();
        setTimeout(() => showUploadModal(), 300);
    });

    // 3. Send Reminder → show reminder modal
    document.getElementById('actionSendReminder')?.addEventListener('click', () => {
        document.getElementById('reminderModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'reminderModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:480px;width:90%;">
                <h3 style="margin-bottom:16px;color:var(--text-primary);">📧 Send Booking Reminder</h3>
                <p style="color:var(--text-secondary);margin-bottom:12px;font-size:0.9rem;">
                    Select clients to send email reminders.
                </p>
                <label id="selectAllLabel" style="display:flex;align-items:center;gap:8px;padding:8px 0;margin-bottom:8px;border-bottom:1px solid var(--border);color:var(--text-primary);cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <input type="checkbox" id="selectAllReminders" checked /> Select All
                    <span id="selectedCount" style="margin-left:auto;color:var(--text-muted);font-weight:400;">0 selected</span>
                </label>
                <div id="reminderList" style="max-height:260px;overflow-y:auto;margin-bottom:16px;">
                    <p style="color:var(--text-muted);font-size:0.85rem;">Loading upcoming bookings...</p>
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="sendSelectedReminders" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Send Selected</button>
                    <button id="closeReminder" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const updateCount = () => {
            const checks = document.querySelectorAll('.reminder-check');
            const checked = document.querySelectorAll('.reminder-check:checked');
            document.getElementById('selectedCount').textContent = `${checked.length} selected`;
            document.getElementById('selectAllReminders').checked = checked.length === checks.length && checks.length > 0;
        };

        // Load upcoming bookings with checkboxes
        (async () => {
            const result = await getArtistBookings(currentUser.uid);
            const list = document.getElementById('reminderList');
            if (result.success && result.data.length > 0) {
                const upcoming = result.data.filter(b => b.status === 'confirmed' || b.status === 'pending');
                if (upcoming.length === 0) {
                    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No upcoming bookings to remind.</p>';
                    document.getElementById('selectAllLabel').style.display = 'none';
                    return;
                }
                list.innerHTML = upcoming.map((b, i) => {
                    const rawDate = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
                    const dateStr = rawDate ? rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                    return `
                    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;">
                        <input type="checkbox" class="reminder-check" data-idx="${i}" data-name="${b.clientName || ''}" data-email="${b.clientEmail || ''}" checked />
                        <div style="flex:1;">
                            <strong style="color:var(--text-primary);font-size:0.9rem;">${b.clientName || 'Client'}</strong>
                            <span style="color:var(--text-muted);font-size:0.75rem;margin-left:6px;">${b.clientEmail || ''}</span>
                        </div>
                        <span style="color:var(--text-secondary);font-size:0.75rem;white-space:nowrap;">${dateStr} ${b.timeSlot || b.time || ''}</span>
                    </label>`;
                }).join('');
                updateCount();

                // Checkbox change listeners
                list.querySelectorAll('.reminder-check').forEach(cb => cb.addEventListener('change', updateCount));
            } else {
                list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No bookings found.</p>';
                document.getElementById('selectAllLabel').style.display = 'none';
            }
        })();

        // Select All toggle
        document.getElementById('selectAllReminders')?.addEventListener('change', (e) => {
            document.querySelectorAll('.reminder-check').forEach(cb => { cb.checked = e.target.checked; });
            updateCount();
        });

        // Send Selected
        document.getElementById('sendSelectedReminders')?.addEventListener('click', () => {
            const selected = document.querySelectorAll('.reminder-check:checked');
            if (selected.length === 0) {
                const btn = document.getElementById('sendSelectedReminders');
                btn.textContent = '⚠️ Select at least 1';
                setTimeout(() => { btn.textContent = 'Send Selected'; }, 1500);
                return;
            }
            const btn = document.getElementById('sendSelectedReminders');
            btn.textContent = `✅ ${selected.length} Reminder(s) Queued!`;
            btn.disabled = true;
            setTimeout(() => modal.remove(), 1500);
        });
        document.getElementById('closeReminder')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });

    // 4. View Reports → show earnings summary modal
    document.getElementById('actionViewReports')?.addEventListener('click', async () => {
        document.getElementById('reportModal')?.remove();
        const stats = await getMonthlyStats(currentUser.uid);
        const s = stats.success ? stats.data : { total: 0, completed: 0, cancelled: 0, revenue: 0 };
        const modal = document.createElement('div');
        modal.id = 'reportModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:480px;width:90%;">
                <h3 style="margin-bottom:20px;color:var(--text-primary);">📊 Monthly Report</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:1.8rem;font-weight:700;color:var(--accent-bright);">${s.total}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Total Bookings</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:1.8rem;font-weight:700;color:var(--success);">$${s.revenue}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Revenue</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:1.8rem;font-weight:700;color:var(--text-primary);">${s.completed}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Completed</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:1.8rem;font-weight:700;color:var(--danger);">${s.cancelled}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Cancelled</div>
                    </div>
                </div>
                <button id="closeReport" style="width:100%;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Close</button>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('closeReport')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });

    // ---- EARNINGS TAB ----
    async function loadEarnings() {
        const result = await getArtistBookings(currentUser.uid);
        if (!result.success) return;

        const bookings = result.data;
        const completed = bookings.filter(b => b.status === 'completed');
        const confirmed = bookings.filter(b => b.status === 'confirmed');
        const totalRevenue = completed.reduce((sum, b) => sum + (parseFloat(b.deposit) || 0), 0);
        const depositCollected = confirmed.reduce((sum, b) => sum + (parseFloat(b.deposit) || 0), 0);

        const el = (id) => document.getElementById(id);
        if (el('earningsTotal')) el('earningsTotal').textContent = `$${totalRevenue.toLocaleString()}`;
        if (el('earningsBookings')) el('earningsBookings').textContent = `From ${completed.length} completed bookings`;
        if (el('earningsDeposits')) el('earningsDeposits').textContent = `$${depositCollected.toLocaleString()}`;
        if (el('earningsPending')) el('earningsPending').textContent = `${confirmed.length} pending bookings`;

        // Transaction list
        const txList = el('earningsTransactionList');
        if (txList) {
            if (bookings.length === 0) {
                txList.innerHTML = '<p style="padding:24px;color:var(--text-muted);font-size:0.9rem;">No transactions yet. Bookings will appear here.</p>';
                return;
            }
            const sorted = [...bookings].sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.date || 0);
                const dateB = b.createdAt?.toDate?.() || new Date(b.date || 0);
                return dateB - dateA;
            }).slice(0, 20);

            txList.innerHTML = sorted.map(b => {
                const icon = b.status === 'cancelled' ? '⚠' : '↓';
                const iconClass = b.status === 'cancelled' ? 'forfeit-icon' : 'deposit-icon';
                const amountClass = b.status === 'cancelled' ? 'positive' : 'positive';
                const label = b.status === 'cancelled' ? 'Cancelled' : b.status === 'completed' ? 'Completed' : 'Deposit';
                return `
                    <div class="transaction">
                        <div class="tx-icon ${iconClass}">${icon}</div>
                        <div class="tx-info">
                            <strong>${label} — ${b.clientName || 'Client'}</strong>
                            <span>${b.designName || 'Booking'} · ${b.date || ''}</span>
                        </div>
                        <span class="tx-amount ${amountClass}">+$${b.deposit || 0}</span>
                    </div>
                `;
            }).join('');
        }
    }

    loadEarnings();

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
            await setDoc(doc(db, 'artists', currentUser.uid), {
                displayName: document.getElementById('settingName').value,
                handle,
                bio: document.getElementById('settingBio').value,
                location: document.getElementById('settingLocation').value,
                specialties: document.getElementById('settingSpecialties').value.split(',').map(s => s.trim()).filter(Boolean),
                updatedAt: serverTimestamp()
            }, { merge: true });
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
            await setDoc(doc(db, 'artists', currentUser.uid), {
                availability: {
                    days,
                    startTime: document.getElementById('settingStartTime').value,
                    endTime: document.getElementById('settingEndTime').value,
                    slotDuration: parseInt(document.getElementById('settingSlotDuration').value)
                },
                updatedAt: serverTimestamp()
            }, { merge: true });
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
            await setDoc(doc(db, 'artists', currentUser.uid), {
                paypal: { email: email || null, connected: !!email },
                updatedAt: serverTimestamp()
            }, { merge: true });
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
