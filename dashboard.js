// ============================================================
// InkBook — Dashboard Logic (Firebase Connected)
// ============================================================
import { onAuthChange, logoutArtist, getArtistProfile } from './src/auth.js';
import { getArtistBookings, getTodayBookings, getMonthlyStats, updateBookingStatus, createBooking } from './src/bookings.js';
import { getArtistFlashDesigns, uploadFlashDesign, toggleDesignAvailability, deleteFlashDesign } from './src/gallery.js';
import { getTeamMembers, addTeamMember, updateTeamMember, deleteTeamMember } from './src/team.js';
import { createSubscription, activateSubscription, cancelSubscription, cancelPayPalSubscription, handleSubscriptionReturn, getSubscriptionStatus, isPaidPlan } from './src/subscription.js';
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
        loadRecentActivity(),
        loadBookingsTable(),
        loadGallery(),
        loadClients(),
        loadNotifications()
    ]);
    // Earnings is inside DOMContentLoaded scope, call it separately
    if (typeof window._loadEarnings === 'function') window._loadEarnings();
}

// ---- Recent Activity ----
async function loadRecentActivity() {
    const result = await getArtistBookings(currentUser.uid);
    const container = document.getElementById('activityList');
    if (!container) return;

    if (!result.success || result.data.length === 0) {
        container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">No recent activity yet.</p>';
        return;
    }

    // Build activity items from bookings (sorted by newest first)
    const activities = [];
    const now = new Date();

    result.data.forEach(b => {
        const createdAt = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : null);
        const rawDate = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
        const timeAgo = createdAt ? getTimeAgo(createdAt, now) : '';

        if (b.depositPaid) {
            activities.push({ type: 'deposit', text: `Deposit received from <strong>${b.clientName || 'Client'}</strong>`, meta: `$${b.depositAmount || 0} · ${b.designName || 'Booking'} · ${timeAgo}`, time: createdAt || rawDate });
        }

        if (b.status === 'confirmed' || b.status === 'pending') {
            activities.push({ type: 'booking', text: `New booking from <strong>${b.clientName || 'Client'}</strong>`, meta: `${b.designName || 'Booking'} · ${rawDate ? rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · ${timeAgo}`, time: createdAt || rawDate });
        }

        if (b.consentSigned) {
            activities.push({ type: 'consent', text: `Consent form signed by <strong>${b.clientName || 'Client'}</strong>`, meta: `${b.designName || 'Booking'}`, time: createdAt || rawDate });
        }

        if (b.status === 'cancelled') {
            activities.push({ type: 'cancel', text: `<strong>${b.clientName || 'Client'}</strong> cancelled${b.depositPaid ? ' — deposit forfeited' : ''}`, meta: `$${b.depositAmount || 0} retained · ${timeAgo}`, time: createdAt || rawDate });
        }
    });

    // Sort by time, newest first, take top 8
    activities.sort((a, b) => (b.time || 0) - (a.time || 0));
    const top = activities.slice(0, 8);

    if (top.length === 0) {
        container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">No recent activity yet.</p>';
        return;
    }

    container.innerHTML = top.map(a => `
        <div class="activity-item">
            <div class="activity-dot ${a.type}"></div>
            <div class="activity-info">
                <span class="activity-text">${a.text}</span>
                <span class="activity-meta">${a.meta}</span>
            </div>
        </div>
    `).join('');
}

function getTimeAgo(date, now) {
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- Notifications ----
async function loadNotifications() {
    const result = await getArtistBookings(currentUser.uid);
    if (!result.success) return;

    const notifs = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    result.data.forEach(b => {
        const rawDate = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
        const dateStr = rawDate ? rawDate.toISOString().split('T')[0] : '';
        const displayDate = rawDate ? rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

        // Today's bookings
        if (dateStr === today && (b.status === 'confirmed' || b.status === 'pending')) {
            notifs.push({ icon: '📅', title: `Appointment today`, detail: `${b.clientName || 'Client'} — ${b.timeSlot || ''} · ${b.designName || 'Booking'}`, time: b.timeSlot || '', type: 'today' });
        }

        // Pending bookings need confirmation
        if (b.status === 'pending') {
            notifs.push({ icon: '⏳', title: `Pending confirmation`, detail: `${b.clientName || 'Client'} — ${displayDate} · ${b.designName || 'Booking'}`, time: displayDate, type: 'pending' });
        }

        // Recent bookings (created within last 24h)
        const createdAt = b.createdAt?.toDate ? b.createdAt.toDate() : null;
        if (createdAt && (now - createdAt) < 24 * 60 * 60 * 1000) {
            notifs.push({ icon: '🆕', title: `New booking received`, detail: `${b.clientName || 'Client'} — ${displayDate} · ${b.designName || 'Booking'}`, time: 'Just now', type: 'new' });
        }
    });

    // Remove duplicates (same booking can be both 'new' and 'pending')
    const seen = new Set();
    const unique = notifs.filter(n => {
        const key = n.title + n.detail;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Update badge
    const badge = document.getElementById('notifBadge');
    if (badge) {
        if (unique.length > 0) {
            badge.textContent = unique.length > 9 ? '9+' : unique.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // Render list
    const list = document.getElementById('notifList');
    if (list) {
        if (unique.length === 0) {
            list.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No notifications</p>';
        } else {
            list.innerHTML = unique.map(n => `
                <div class="notif-item" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:4px;background:var(--bg-primary);transition:background 0.2s;cursor:pointer;" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='var(--bg-primary)'">
                    <span style="font-size:1.2rem;flex-shrink:0;margin-top:2px;">${n.icon}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;color:var(--text-primary);font-size:0.85rem;">${n.title}</div>
                        <div style="color:var(--text-secondary);font-size:0.75rem;margin-top:2px;">${n.detail}</div>
                    </div>
                    <span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">${n.time}</span>
                </div>
            `).join('');
            // Click notification → go to Bookings tab
            list.querySelectorAll('.notif-item').forEach(item => {
                item.addEventListener('click', () => {
                    document.getElementById('notifDropdown').style.display = 'none';
                    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                    const bookingsNav = document.querySelector('[data-tab="bookings"]');
                    if (bookingsNav) bookingsNav.classList.add('active');
                    document.getElementById('tab-bookings')?.classList.add('active');
                    document.getElementById('pageTitle').textContent = 'Bookings';
                });
            });
        }
    }
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
            <span><span class="status-badge ${statusMap[booking.status] || 'active-badge'}">${booking.status}</span>${booking.consentSigned ? '<span style="display:block;font-size:0.6rem;color:#00c853;margin-top:3px;">📋 Consent ✓</span>' : '<span style="display:block;font-size:0.6rem;color:#ffab00;margin-top:3px;">📋 No consent</span>'}</span>
            <span style="display:flex;flex-direction:column;gap:4px;">
                <button class="table-action view-booking-btn" style="background:var(--accent);color:#fff;border-radius:6px;">View</button>
                ${!booking.consentSigned ? `<button class="table-action send-consent-btn" style="color:#4ecdc4;border-color:#4ecdc4;">📋 Consent</button>` : ''}
                ${booking.status === 'confirmed' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','completed')">Complete</button>` : ''}
                ${booking.status === 'pending' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','confirmed')">Confirm</button>` : ''}
                ${booking.status !== 'cancelled' && booking.status !== 'completed' ? `<button class="table-action" onclick="window.updateStatus('${booking.id}','cancelled')">Cancel</button>` : ''}
            </span>`;
        // View button listener
        row.querySelector('.view-booking-btn').addEventListener('click', () => showBookingDetailModal(booking));
        // Consent button listener
        const consentBtn = row.querySelector('.send-consent-btn');
        if (consentBtn) {
            consentBtn.addEventListener('click', async () => {
                const consentUrl = `${window.location.origin}/consent.html?booking=${booking.id}`;
                try {
                    await navigator.clipboard.writeText(consentUrl);
                    consentBtn.textContent = '✅ Copied!';
                    setTimeout(() => { consentBtn.textContent = '📋 Consent'; }, 2000);
                } catch {
                    prompt('Copy this consent form link:', consentUrl);
                }
            });
        }
        tableBody.appendChild(row);
    });
}

// ---- Booking Detail/Edit Modal ----
function showBookingDetailModal(booking) {
    document.getElementById('bookingDetailModal')?.remove();
    const rawDate = booking.date?.toDate ? booking.date.toDate() : (booking.date ? new Date(booking.date) : null);
    const dateVal = rawDate ? rawDate.toISOString().split('T')[0] : '';
    const timeVal = booking.timeSlot || booking.time || '14:00';

    const modal = document.createElement('div');
    modal.id = 'bookingDetailModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
    modal.innerHTML = `
        <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;">
            <h3 style="margin-bottom:20px;color:var(--text-primary);">📋 Booking Details</h3>
            <form id="editBookingForm" style="display:flex;flex-direction:column;gap:14px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Client Name</label>
                        <input type="text" id="ebName" value="${booking.clientName || ''}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Email</label>
                        <input type="email" id="ebEmail" value="${booking.clientEmail || ''}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Phone</label>
                        <input type="text" id="ebPhone" value="${booking.clientPhone || ''}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Age</label>
                        <input type="number" id="ebAge" value="${booking.clientAge || ''}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                </div>
                <div>
                    <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Design / Description</label>
                    <input type="text" id="ebDesign" value="${booking.designName || ''}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Date</label>
                        <input type="date" id="ebDate" value="${dateVal}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Time</label>
                        <input type="time" id="ebTime" value="${timeVal}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Total Price ($)</label>
                        <input type="number" id="ebPrice" value="${booking.totalPrice || 0}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Deposit ($)</label>
                        <input type="number" id="ebDeposit" value="${booking.depositAmount || booking.deposit?.amount || 0}" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Status</label>
                        <select id="ebStatus" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                            <option value="pending" ${booking.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="confirmed" ${booking.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="completed" ${booking.status === 'completed' ? 'selected' : ''}>Completed</option>
                            <option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </div>
                </div>

                <!-- PayPal Payment Info -->
                <div style="background:var(--bg-primary);border-radius:10px;padding:14px;border:1px solid var(--border);">
                    <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">💳 Payment Info</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:0.8rem;color:var(--text-secondary);">Deposit Status</span>
                        <span style="font-size:0.8rem;font-weight:600;color:${booking.depositPaid ? '#00c853' : '#ffab00'};">${booking.depositPaid ? '✅ Paid' : '⏳ Unpaid'}</span>
                    </div>
                    ${booking.paypalOrderId && booking.paypalOrderId !== 'SIMULATED' ? `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:0.8rem;color:var(--text-secondary);">PayPal Order</span>
                        <span style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;">${booking.paypalOrderId}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:0.8rem;color:var(--text-secondary);">Transaction ID</span>
                        <span style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;">${booking.paypalTransactionId || '—'}</span>
                    </div>` : ''}
                    ${booking.refunded ? `<div style="font-size:0.8rem;color:#ff4d4d;margin-top:4px;">🔄 Refund issued: $${booking.refundAmount || booking.depositAmount || 0}</div>` : ''}
                    ${booking.depositPaid && !booking.refunded ? `<button type="button" id="refundBtn" style="margin-top:8px;width:100%;padding:10px;background:rgba(255,77,77,0.1);border:1px solid rgba(255,77,77,0.3);border-radius:8px;color:#ff4d4d;cursor:pointer;font-weight:600;font-size:0.85rem;">🔄 Issue Refund ($${booking.depositAmount || 0})</button>` : ''}
                </div>

                <!-- Consent Form Status -->
                <div style="background:var(--bg-primary);border-radius:10px;padding:14px;border:1px solid var(--border);">
                    <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">📋 Consent Form</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:0.8rem;color:var(--text-secondary);">Status</span>
                        <span style="font-size:0.8rem;font-weight:600;color:${booking.consentSigned ? '#00c853' : '#ffab00'};">${booking.consentSigned ? '✅ Signed' : '⏳ Not signed'}</span>
                    </div>
                    ${!booking.consentSigned ? `<button type="button" id="copyConsentLink" style="margin-top:8px;width:100%;padding:10px;background:rgba(78,205,196,0.1);border:1px solid rgba(78,205,196,0.3);border-radius:8px;color:#4ecdc4;cursor:pointer;font-weight:600;font-size:0.85rem;">📋 Copy Consent Form Link</button>` : ''}
                </div>

                <div style="display:flex;gap:10px;margin-top:8px;">
                    <button type="submit" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Save Changes</button>
                    <button type="button" id="closeBookingDetail" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Close</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('closeBookingDetail').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Refund button
    const refundBtn = document.getElementById('refundBtn');
    if (refundBtn) {
        refundBtn.addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to refund $${booking.depositAmount || 0} to ${booking.clientName}?`)) return;
            refundBtn.textContent = '🔄 Processing...'; refundBtn.disabled = true;
            try {
                await updateDoc(doc(db, 'bookings', booking.id), {
                    refunded: true,
                    refundAmount: booking.depositAmount || 0,
                    refundedAt: serverTimestamp(),
                    status: 'cancelled'
                });
                refundBtn.textContent = '✅ Refunded!';
                setTimeout(() => { modal.remove(); loadBookingsTable(); loadOverviewStats(); }, 1000);
            } catch (err) {
                refundBtn.textContent = '❌ Error';
                setTimeout(() => { refundBtn.textContent = `🔄 Issue Refund ($${booking.depositAmount || 0})`; refundBtn.disabled = false; }, 2000);
            }
        });
    }

    // Copy consent link
    const copyConsentBtn = document.getElementById('copyConsentLink');
    if (copyConsentBtn) {
        copyConsentBtn.addEventListener('click', async () => {
            const url = `${window.location.origin}/consent.html?booking=${booking.id}`;
            try {
                await navigator.clipboard.writeText(url);
                copyConsentBtn.textContent = '✅ Link Copied!';
            } catch { prompt('Copy this link:', url); }
            setTimeout(() => { copyConsentBtn.textContent = '📋 Copy Consent Form Link'; }, 2000);
        });
    }

    document.getElementById('editBookingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
            await updateDoc(doc(db, 'bookings', booking.id), {
                clientName: document.getElementById('ebName').value,
                clientEmail: document.getElementById('ebEmail').value,
                clientPhone: document.getElementById('ebPhone').value,
                clientAge: parseInt(document.getElementById('ebAge').value) || null,
                designName: document.getElementById('ebDesign').value,
                date: document.getElementById('ebDate').value,
                timeSlot: document.getElementById('ebTime').value,
                totalPrice: parseFloat(document.getElementById('ebPrice').value) || 0,
                depositAmount: parseFloat(document.getElementById('ebDeposit').value) || 0,
                status: document.getElementById('ebStatus').value,
                updatedAt: serverTimestamp()
            });
            btn.textContent = '✅ Saved!';
            setTimeout(() => { modal.remove(); loadBookingsTable(); loadOverviewStats(); }, 800);
        } catch (err) {
            console.error('Edit booking error:', err);
            btn.textContent = '❌ Error';
            setTimeout(() => { btn.textContent = 'Save Changes'; btn.disabled = false; }, 2000);
        }
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

// ---- Clients ----
async function loadClients() {
    const result = await getArtistBookings(currentUser.uid);
    const container = document.getElementById('clientsList');
    if (!container) return;

    if (!result.success || result.data.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">No clients yet. Clients will appear here once you have bookings.</p>';
        return;
    }

    // Group by client email or name
    const clientMap = {};
    result.data.forEach(b => {
        const key = (b.clientEmail || b.clientName || 'Unknown').toLowerCase();
        if (!clientMap[key]) {
            clientMap[key] = {
                name: b.clientName || 'Client',
                email: b.clientEmail || '',
                phone: b.clientPhone || '',
                age: b.clientAge || '',
                bookings: [],
                totalSpent: 0
            };
        }
        clientMap[key].bookings.push(b);
        if (b.status !== 'cancelled') clientMap[key].totalSpent += (b.totalPrice || 0);
    });

    const clients = Object.values(clientMap).sort((a, b) => b.bookings.length - a.bookings.length);
    renderClients(clients, container);

    // Search
    document.getElementById('clientSearch')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = clients.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q));
        renderClients(filtered, container);
    });
}

function renderClients(clients, container) {
    if (clients.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">No matching clients.</p>';
        return;
    }
    container.innerHTML = '';
    clients.forEach(c => {
        const lastBooking = c.bookings[0];
        const lastRaw = lastBooking?.date?.toDate ? lastBooking.date.toDate() : (lastBooking?.date ? new Date(lastBooking.date) : null);
        const lastDateStr = lastRaw ? lastRaw.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const statusCounts = { confirmed: 0, completed: 0, cancelled: 0, pending: 0 };
        c.bookings.forEach(b => { if (statusCounts[b.status] !== undefined) statusCounts[b.status]++; });

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:16px;padding:14px 16px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer;transition:background 0.2s;';
        row.onmouseover = () => row.style.background = 'var(--bg-primary)';
        row.onmouseout = () => row.style.background = 'transparent';
        row.innerHTML = `
            <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-dim));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1rem;flex-shrink:0;">${c.name.charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="color:var(--text-primary);font-size:0.95rem;">${c.name}</strong>
                    ${c.age ? `<span style="color:var(--text-muted);font-size:0.75rem;">Age ${c.age}</span>` : ''}
                </div>
                <div style="color:var(--text-secondary);font-size:0.8rem;margin-top:2px;">${c.email}${c.phone ? ` · ${c.phone}` : ''}</div>
            </div>
            <div style="text-align:center;">
                <div style="font-weight:700;color:var(--text-primary);font-size:1.1rem;">${c.bookings.length}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">bookings</div>
            </div>
            <div style="text-align:center;">
                <div style="font-weight:700;color:var(--accent-bright);font-size:1.1rem;">$${c.totalSpent}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">spent</div>
            </div>
            <div style="text-align:right;min-width:90px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">${lastDateStr}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">✅${statusCounts.completed} 📅${statusCounts.confirmed} ❌${statusCounts.cancelled}</div>
            </div>`;
        row.addEventListener('click', () => showClientDetailModal(c));
        container.appendChild(row);
    });
}

function showClientDetailModal(client) {
    document.getElementById('clientDetailModal')?.remove();
    const c = client;
    const modal = document.createElement('div');
    modal.id = 'clientDetailModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const bookingRows = c.bookings.sort((a, b) => {
        const da = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0);
        const db2 = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0);
        return db2 - da;
    }).map(b => {
        const d = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
        const ds = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const statusColor = { completed: '#00c853', confirmed: '#4ecdc4', cancelled: '#ff4d4d', pending: '#ffab00' }[b.status] || '#999';
        const reminderLogs = (b.reminders || []).map(r => {
            const rd = new Date(r);
            return rd.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        });
        return `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
                <div style="flex:1;">
                    <div style="font-size:0.85rem;color:var(--text-primary);">${b.designName || 'Custom'}</div>
                    <div style="font-size:0.7rem;color:var(--text-muted);">${ds} ${b.timeSlot || ''}</div>
                </div>
                <span style="font-size:0.7rem;text-transform:uppercase;color:${statusColor};font-weight:600;">${b.status}</span>
                <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary);">$${b.totalPrice || 0}</span>
            </div>
            ${reminderLogs.length ? `<div style="margin-top:6px;padding-left:20px;">
                ${reminderLogs.map(r => `<div style="font-size:0.65rem;color:#4ecdc4;margin-bottom:2px;">📧 Reminder sent: ${r}</div>`).join('')}
            </div>` : ''}
        </div>`;
    }).join('');

    modal.innerHTML = `
        <div style="background:var(--bg-secondary);border-radius:16px;padding:0;max-width:560px;width:92%;max-height:90vh;overflow-y:auto;">
            <div style="padding:24px 28px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;">
                <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-dim));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.4rem;flex-shrink:0;">${c.name.charAt(0).toUpperCase()}</div>
                <div style="flex:1;">
                    <h3 style="color:var(--text-primary);margin:0 0 4px;font-size:1.1rem;">${c.name}</h3>
                    <div style="color:var(--text-muted);font-size:0.8rem;">${c.bookings.length} bookings · $${c.totalSpent} spent</div>
                </div>
                <button id="closeClientModal" style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <div style="padding:20px 28px;">
                <h4 style="color:var(--text-secondary);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Contact Info</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
                    <div>
                        <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Name</label>
                        <input type="text" id="cdName" value="${c.name}" style="width:100%;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.85rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Age</label>
                        <input type="text" id="cdAge" value="${c.age || ''}" style="width:100%;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.85rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Email</label>
                        <input type="email" id="cdEmail" value="${c.email}" style="width:100%;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.85rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.7rem;color:var(--text-muted);margin-bottom:3px;">Phone</label>
                        <input type="text" id="cdPhone" value="${c.phone || ''}" style="width:100%;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.85rem;" />
                    </div>
                </div>
                <button id="saveClientInfo" style="width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem;margin-bottom:20px;">💾 Save Changes</button>
                <h4 style="color:var(--text-secondary);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Booking History</h4>
                <div style="max-height:250px;overflow-y:auto;">
                    ${bookingRows || '<p style="color:var(--text-muted);font-size:0.85rem;">No bookings</p>'}
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('closeClientModal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Save client info → update all bookings for this client
    document.getElementById('saveClientInfo').addEventListener('click', async () => {
        const btn = document.getElementById('saveClientInfo');
        btn.textContent = 'Saving...'; btn.disabled = true;
        const newName = document.getElementById('cdName').value;
        const newAge = document.getElementById('cdAge').value;
        const newEmail = document.getElementById('cdEmail').value;
        const newPhone = document.getElementById('cdPhone').value;
        try {
            for (const b of c.bookings) {
                await updateDoc(doc(db, 'bookings', b.id), {
                    clientName: newName,
                    clientAge: newAge,
                    clientEmail: newEmail,
                    clientPhone: newPhone
                });
            }
            btn.textContent = '✅ Saved!';
            setTimeout(() => { modal.remove(); loadClients(); }, 800);
        } catch (err) {
            btn.textContent = '❌ Error'; btn.disabled = false;
        }
    });
}

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
            // Reload tab-specific data
            if (tab === 'settings') {
                if (typeof window._loadTeamGrid === 'function') window._loadTeamGrid();
                if (typeof window._loadSubscriptionUI === 'function') window._loadSubscriptionUI();
            }
            if (tab === 'earnings' && typeof window._loadEarnings === 'function') window._loadEarnings();
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

    // ---- Notification Bell ----
    const notifBell = document.getElementById('notifBell');
    const notifDropdown = document.getElementById('notifDropdown');
    if (notifBell && notifDropdown) {
        notifBell.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.style.display = notifDropdown.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!notifDropdown.contains(e.target) && !notifBell.contains(e.target)) {
                notifDropdown.style.display = 'none';
            }
        });
        document.getElementById('clearNotifs')?.addEventListener('click', () => {
            document.getElementById('notifList').innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No notifications</p>';
            const badge = document.getElementById('notifBadge');
            if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
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
                            <input type="time" id="mbTime" required value="14:00" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
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
                    const lastReminder = b.reminders?.length ? b.reminders[b.reminders.length - 1] : null;
                    const lastSent = lastReminder ? new Date(lastReminder).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
                    return `
                    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;">
                        <input type="checkbox" class="reminder-check" data-booking-id="${b.id}" data-name="${b.clientName || ''}" data-email="${b.clientEmail || ''}" checked />
                        <div style="flex:1;">
                            <strong style="color:var(--text-primary);font-size:0.9rem;">${b.clientName || 'Client'}</strong>
                            <span style="color:var(--text-muted);font-size:0.75rem;margin-left:6px;">${b.clientEmail || ''}</span>
                            ${lastSent ? `<div style="font-size:0.65rem;color:#4ecdc4;margin-top:2px;">Last reminder: ${lastSent}</div>` : ''}
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

        // Send Selected — save reminder timestamp to Firestore
        document.getElementById('sendSelectedReminders')?.addEventListener('click', async () => {
            const selected = document.querySelectorAll('.reminder-check:checked');
            if (selected.length === 0) {
                const btn = document.getElementById('sendSelectedReminders');
                btn.textContent = '⚠️ Select at least 1';
                setTimeout(() => { btn.textContent = 'Send Selected'; }, 1500);
                return;
            }
            const btn = document.getElementById('sendSelectedReminders');
            btn.textContent = 'Sending...'; btn.disabled = true;
            const now = new Date().toISOString();
            try {
                for (const cb of selected) {
                    const bookingId = cb.dataset.bookingId;
                    if (bookingId) {
                        const bookingRef = doc(db, 'bookings', bookingId);
                        // Get current reminders array, append new timestamp
                        const { getDoc: getDocFn } = await import('firebase/firestore');
                        const snap = await getDocFn(bookingRef);
                        const existing = snap.data()?.reminders || [];
                        existing.push(now);
                        await updateDoc(bookingRef, { reminders: existing });
                    }
                }
                btn.textContent = `✅ ${selected.length} Reminder(s) Sent!`;
                setTimeout(() => modal.remove(), 1500);
            } catch (err) {
                btn.textContent = '❌ Error sending';
                setTimeout(() => { btn.textContent = 'Send Selected'; btn.disabled = false; }, 2000);
            }
        });
        document.getElementById('closeReminder')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });

    // 4. View Reports → show earnings summary modal
    document.getElementById('actionViewReports')?.addEventListener('click', async () => {
        document.getElementById('reportModal')?.remove();
        const stats = await getMonthlyStats(currentUser.uid);
        const s = stats.success ? stats.data : { totalBookings: 0, completedBookings: 0, cancelledBookings: 0, totalRevenue: 0, depositsCollected: 0, noShowRate: 0 };
        const now = new Date();
        const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const modal = document.createElement('div');
        modal.id = 'reportModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:520px;width:92%;">
                <h3 style="margin-bottom:6px;color:var(--text-primary);">📊 Monthly Report</h3>
                <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:20px;">${monthName}</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:2rem;font-weight:700;color:var(--accent-bright);">${s.totalBookings}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Total Bookings</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:2rem;font-weight:700;color:#00c853;">$${s.totalRevenue}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Revenue</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:2rem;font-weight:700;color:var(--text-primary);">${s.completedBookings}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Completed</div>
                    </div>
                    <div style="background:var(--bg-primary);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:2rem;font-weight:700;color:#ff4d4d;">${s.cancelledBookings}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Cancelled</div>
                    </div>
                </div>
                <div style="display:flex;gap:12px;margin-bottom:20px;">
                    <div style="flex:1;background:var(--bg-primary);padding:14px;border-radius:10px;text-align:center;">
                        <div style="font-size:1.2rem;font-weight:700;color:#4ecdc4;">$${s.depositsCollected}</div>
                        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">Deposits Collected</div>
                    </div>
                    <div style="flex:1;background:var(--bg-primary);padding:14px;border-radius:10px;text-align:center;">
                        <div style="font-size:1.2rem;font-weight:700;color:#ffab00;">${s.noShowRate}%</div>
                        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">No-Show Rate</div>
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
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const completed = bookings.filter(b => b.status === 'completed');
        const confirmed = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending');
        const refunded = bookings.filter(b => b.refunded);

        // This month's completed
        const monthCompleted = completed.filter(b => {
            const d = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
            return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        });

        const PLATFORM_FEE_RATE = 0.05; // 5%

        const totalRevenue = monthCompleted.reduce((sum, b) => sum + (parseFloat(b.totalPrice) || 0), 0);
        const totalFees = Math.round(totalRevenue * PLATFORM_FEE_RATE * 100) / 100;
        const netRevenue = Math.round((totalRevenue - totalFees) * 100) / 100;
        const depositCollected = confirmed.reduce((sum, b) => sum + (parseFloat(b.depositAmount) || parseFloat(b.deposit?.amount) || 0), 0);
        const totalRefunds = refunded.reduce((sum, b) => sum + (parseFloat(b.refundAmount) || parseFloat(b.depositAmount) || 0), 0);

        const el = (id) => document.getElementById(id);
        if (el('earningsTotal')) el('earningsTotal').textContent = `$${totalRevenue.toLocaleString()}`;
        if (el('earningsBookings')) el('earningsBookings').textContent = `From ${monthCompleted.length} completed bookings`;
        if (el('earningsDeposits')) el('earningsDeposits').textContent = `$${depositCollected.toLocaleString()}`;
        if (el('earningsPending')) el('earningsPending').textContent = `${confirmed.length} upcoming bookings`;

        // Fee / Net / Refund cards
        if (el('earningsFees')) el('earningsFees').textContent = `$${totalFees.toLocaleString()}`;
        if (el('earningsFeeNote')) el('earningsFeeNote').textContent = `${monthCompleted.length} completed bookings`;
        if (el('earningsNet')) el('earningsNet').textContent = `$${netRevenue.toLocaleString()}`;
        if (el('earningsRefunds')) el('earningsRefunds').textContent = `$${totalRefunds.toLocaleString()}`;
        if (el('earningsRefundNote')) el('earningsRefundNote').textContent = `${refunded.length} refunded`;

        // Transaction list with per-booking fee/net
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
                const price = b.totalPrice || 0;
                const deposit = b.depositAmount || b.deposit?.amount || 0;
                const fee = Math.round(price * PLATFORM_FEE_RATE * 100) / 100;
                const net = Math.round((price - fee) * 100) / 100;
                const rawDate = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
                const dateStr = rawDate ? rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                let icon, iconClass, label, amount, feeInfo;
                if (b.status === 'completed') {
                    icon = '✅'; iconClass = 'deposit-icon'; label = 'Completed'; amount = `+$${price}`;
                    feeInfo = `<span style="font-size:0.7rem;color:#ff6b6b;">Fee -$${fee}</span> <span style="font-size:0.7rem;color:#00c853;">Net $${net}</span>`;
                } else if (b.status === 'cancelled') {
                    icon = '❌'; iconClass = 'forfeit-icon'; label = 'Cancelled';
                    amount = b.refunded ? `-$${b.refundAmount || deposit}` : '$0';
                    feeInfo = b.refunded ? '<span style="font-size:0.7rem;color:#ffab00;">Refunded</span>' : '';
                } else if (b.status === 'confirmed') {
                    icon = '📅'; iconClass = 'deposit-icon'; label = 'Confirmed'; amount = deposit > 0 ? `Deposit $${deposit}` : `$${price}`;
                    feeInfo = `<span style="font-size:0.7rem;color:var(--text-muted);">Est. fee $${fee}</span>`;
                } else {
                    icon = '⏳'; iconClass = 'deposit-icon'; label = 'Pending'; amount = `$${price}`;
                    feeInfo = '';
                }
                return `
                    <div class="transaction">
                        <div class="tx-icon ${iconClass}">${icon}</div>
                        <div class="tx-info">
                            <strong>${label} — ${b.clientName || 'Client'}</strong>
                            <span>${b.designName || 'Booking'} · ${dateStr} ${b.timeSlot || ''}</span>
                        </div>
                        <div style="text-align:right;">
                            <span class="tx-amount ${b.status === 'completed' ? 'positive' : ''}">${amount}</span>
                            <div>${feeInfo || ''}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    window._loadEarnings = loadEarnings;
    loadEarnings();

    // ---- TEAM MEMBERS ----
    async function loadTeamGrid() {
        const grid = document.getElementById('teamGrid');
        if (!grid) return;
        try {
            const result = await getTeamMembers(currentUser.uid);
            const members = result.success ? result.data : [];

            grid.innerHTML = '';

            // Render member cards
            members.forEach(m => {
                const card = document.createElement('div');
                card.style.cssText = 'background:var(--bg-primary);border:1px solid var(--border);border-radius:12px;padding:20px;position:relative;transition:border-color 0.2s;';
                card.onmouseover = () => card.style.borderColor = 'var(--accent)';
                card.onmouseout = () => card.style.borderColor = 'var(--border)';
                const roleColor = m.role === 'artist' ? 'var(--accent-bright)' : '#4ecdc4';
                const roleLabel = m.role === 'artist' ? '🎨 Artist' : '👤 Staff';
                card.innerHTML = `
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                        <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,${roleColor},var(--accent-dim));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.2rem;flex-shrink:0;">${(m.name || '?').charAt(0).toUpperCase()}</div>
                        <div>
                            <strong style="color:var(--text-primary);font-size:1rem;">${m.name || 'Unnamed'}</strong>
                            <div style="font-size:0.75rem;color:${roleColor};margin-top:2px;">${roleLabel}</div>
                        </div>
                    </div>
                    ${m.specialties ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">✨ ${m.specialties}</div>` : ''}
                    ${m.workDays ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">📅 ${m.workDays}</div>` : ''}
                    ${m.startTime ? `<div style="font-size:0.75rem;color:var(--text-muted);">🕐 ${m.startTime} — ${m.endTime || '18:00'}</div>` : ''}
                    <div style="display:flex;gap:8px;margin-top:14px;">
                        <button class="edit-member-btn" style="flex:1;padding:8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:0.8rem;">✏️ Edit</button>
                        <button class="del-member-btn" style="padding:8px 12px;background:none;border:1px solid rgba(255,77,77,0.3);border-radius:6px;color:#ff4d4d;cursor:pointer;font-size:0.8rem;">🗑️</button>
                    </div>`;
                card.querySelector('.edit-member-btn').addEventListener('click', () => showTeamModal(m));
                card.querySelector('.del-member-btn').addEventListener('click', async () => {
                    if (confirm(`Delete ${m.name}?`)) {
                        await deleteTeamMember(m.id);
                        loadTeamGrid();
                    }
                });
                grid.appendChild(card);
            });

            if (members.length === 0) {
                grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;grid-column:1/-1;">No team members yet. Click "+ Add Member" to add your first artist or staff.</p>';
            }
        } catch (err) {
            console.error('loadTeamGrid error:', err);
            grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;grid-column:1/-1;">No team members yet. Click "+ Add Member" to add your first artist or staff.</p>';
        }
    }
    window._loadTeamGrid = loadTeamGrid;

    function showTeamModal(existing) {
        document.getElementById('teamModal')?.remove();
        const isEdit = !!existing;
        const m = existing || {};
        const modal = document.createElement('div');
        modal.id = 'teamModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        modal.innerHTML = `
            <div style="background:var(--bg-secondary);border-radius:16px;padding:32px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto;">
                <h3 style="margin-bottom:20px;color:var(--text-primary);">${isEdit ? '✏️ Edit Member' : '➕ Add Team Member'}</h3>
                <form id="teamMemberForm" style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Name *</label>
                        <input type="text" id="tmName" value="${m.name || ''}" required style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Role *</label>
                            <select id="tmRole" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                <option value="artist" ${m.role === 'artist' || !m.role ? 'selected' : ''}>🎨 Artist</option>
                                <option value="staff" ${m.role === 'staff' ? 'selected' : ''}>👤 Staff</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Specialties</label>
                            <input type="text" id="tmSpecialties" value="${m.specialties || ''}" placeholder="e.g. Realism, Color" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                        </div>
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Email</label>
                        <input type="email" id="tmEmail" value="${m.email || ''}" placeholder="team@example.com" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Phone</label>
                        <input type="text" id="tmPhone" value="${m.phone || ''}" placeholder="(555) 123-4567" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;" />
                    </div>
                    <div>
                        <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:8px;">Working Days</label>
                        <div id="tmDaysCheckboxes" style="display:flex;gap:6px;flex-wrap:wrap;">
                            ${['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => {
            const existingDays = (m.workDays || 'MON,TUE,WED,THU,FRI').split(',').map(s => s.trim());
            const checked = existingDays.includes(d) ? 'checked' : '';
            return `<label style="display:flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);user-select:none;">
                                    <input type="checkbox" value="${d}" ${checked} style="accent-color:var(--accent);cursor:pointer;" />
                                    ${d}
                                </label>`;
        }).join('')}
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">Start Time</label>
                            <select id="tmStart" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                ${(() => {
                const startVal = m.startTime || '10:00';
                let opts = '';
                for (let h = 0; h < 24; h++) {
                    for (let min = 0; min < 60; min += 30) {
                        const val = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
                        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        const ampm = h < 12 ? 'AM' : 'PM';
                        const label = h12 + ':' + String(min).padStart(2, '0') + ' ' + ampm;
                        opts += '<option value="' + val + '"' + (val === startVal ? ' selected' : '') + '>' + label + '</option>';
                    }
                }
                return opts;
            })()}
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">End Time</label>
                            <select id="tmEnd" style="width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:0.9rem;">
                                ${(() => {
                const endVal = m.endTime || '18:00';
                let opts = '';
                for (let h = 0; h < 24; h++) {
                    for (let min = 0; min < 60; min += 30) {
                        const val = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
                        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        const ampm = h < 12 ? 'AM' : 'PM';
                        const label = h12 + ':' + String(min).padStart(2, '0') + ' ' + ampm;
                        opts += '<option value="' + val + '"' + (val === endVal ? ' selected' : '') + '>' + label + '</option>';
                    }
                }
                return opts;
            })()}
                            </select>
                        </div>
                    </div>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <button type="submit" style="flex:1;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">${isEdit ? 'Save Changes' : 'Add Member'}</button>
                        <button type="button" id="cancelTeam" style="flex:1;padding:12px;background:var(--bg-primary);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;">Cancel</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('cancelTeam').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.getElementById('teamMemberForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.textContent = 'Saving...'; btn.disabled = true;
            const data = {
                name: document.getElementById('tmName').value,
                role: document.getElementById('tmRole').value,
                specialties: document.getElementById('tmSpecialties').value,
                email: document.getElementById('tmEmail').value,
                phone: document.getElementById('tmPhone').value,
                workDays: Array.from(document.querySelectorAll('#tmDaysCheckboxes input[type="checkbox"]:checked')).map(cb => cb.value).join(','),
                startTime: document.getElementById('tmStart').value,
                endTime: document.getElementById('tmEnd').value
            };
            try {
                if (isEdit) {
                    await updateTeamMember(existing.id, data);
                } else {
                    await addTeamMember(currentUser.uid, data);
                }
                btn.textContent = '✅ Saved!';
                setTimeout(() => { modal.remove(); loadTeamGrid(); }, 600);
            } catch (err) {
                btn.textContent = '❌ Error';
                setTimeout(() => { btn.textContent = isEdit ? 'Save Changes' : 'Add Member'; btn.disabled = false; }, 2000);
            }
        });
    }

    document.getElementById('addTeamMemberBtn')?.addEventListener('click', () => showTeamModal(null));
    loadTeamGrid();

    // ---- SETTINGS TAB ----
    function populateSettings(profile) {
        if (!profile) return;
        const s = (id) => document.getElementById(id);
        if (s('settingName')) s('settingName').value = profile.displayName || '';
        if (s('settingHandle')) s('settingHandle').value = profile.handle || '';
        if (s('settingBio')) s('settingBio').value = profile.bio || '';
        if (s('settingLocation')) s('settingLocation').value = profile.location || '';
        if (s('settingSpecialties')) s('settingSpecialties').value = (profile.specialties || []).join(', ');

        // Profile image preview
        if (profile.profileImage && s('profileImagePreview')) {
            s('profileImagePreview').innerHTML = `<img src="${profile.profileImage}" style="width:100%;height:100%;object-fit:cover;" />`;
        }

        // SNS links
        if (s('settingInstagram')) s('settingInstagram').value = profile.instagram || '';
        if (s('settingPortfolio')) s('settingPortfolio').value = profile.portfolio || '';
        if (s('settingTwitter')) s('settingTwitter').value = profile.twitter || '';
        if (s('settingTiktok')) s('settingTiktok').value = profile.tiktok || '';

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

    // Profile image upload handler
    let pendingProfileImage = null;
    const imgPreview = document.getElementById('profileImagePreview');
    const imgInput = document.getElementById('profileImageInput');
    if (imgPreview && imgInput) {
        imgPreview.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            // Resize to max 300px to keep Firestore doc small
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX = 300;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                        else { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    pendingProfileImage = canvas.toDataURL('image/jpeg', 0.8);
                    imgPreview.innerHTML = `<img src="${pendingProfileImage}" style="width:100%;height:100%;object-fit:cover;" />`;
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Save Profile
    document.getElementById('profileSettingsForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'Saving...';
        btn.disabled = true;
        try {
            const handle = document.getElementById('settingHandle').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
            const profileData = {
                displayName: document.getElementById('settingName').value,
                handle,
                bio: document.getElementById('settingBio').value,
                location: document.getElementById('settingLocation').value,
                specialties: document.getElementById('settingSpecialties').value.split(',').map(s => s.trim()).filter(Boolean),
                instagram: document.getElementById('settingInstagram')?.value || '',
                portfolio: document.getElementById('settingPortfolio')?.value || '',
                twitter: document.getElementById('settingTwitter')?.value || '',
                tiktok: document.getElementById('settingTiktok')?.value || '',
                updatedAt: serverTimestamp()
            };
            // Only include image if changed
            if (pendingProfileImage) {
                profileData.profileImage = pendingProfileImage;
                pendingProfileImage = null;
            }
            await setDoc(doc(db, 'artists', currentUser.uid), profileData, { merge: true });
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

    // ============================================================
    // Subscription Management
    // ============================================================
    function loadSubscriptionUI() {
        if (!artistProfile) return;
        const plan = artistProfile.plan || 'free';
        const sub = artistProfile.subscription;

        // Update current plan display
        const planNameEl = document.getElementById('currentPlanName');
        const planStatusEl = document.getElementById('currentPlanStatus');
        const upgradeCards = document.getElementById('planUpgradeCards');
        const activePanel = document.getElementById('activeSubscriptionPanel');

        if (planNameEl) {
            const planLabels = { free: 'Free (Independent)', pro: 'Pro', studio: 'Studio' };
            planNameEl.textContent = planLabels[plan] || 'Free (Independent)';
        }

        if (isPaidPlan(plan) && sub && sub.status === 'ACTIVE') {
            // Show active subscription panel
            if (upgradeCards) upgradeCards.style.display = 'none';
            if (activePanel) {
                activePanel.style.display = 'block';
                const label = document.getElementById('activePlanLabel');
                const subId = document.getElementById('activeSubId');
                if (label) label.textContent = `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan — $${plan === 'pro' ? 19 : 39}/mo`;
                if (subId) subId.textContent = `Subscription: ${sub.id || 'N/A'}`;
            }
            if (planStatusEl) planStatusEl.textContent = '✅ Active subscription';
        } else {
            // Show upgrade cards
            if (upgradeCards) upgradeCards.style.display = 'grid';
            if (activePanel) activePanel.style.display = 'none';
            if (planStatusEl) planStatusEl.textContent = 'Upgrade to unlock all features';
        }

        // Update sidebar plan label
        const miniPlan = document.querySelector('.artist-mini-plan');
        if (miniPlan) {
            const labels = { free: 'Free Plan', pro: 'Pro Plan', studio: 'Studio Plan' };
            miniPlan.textContent = labels[plan] || 'Free Plan';
        }
    }
    window._loadSubscriptionUI = loadSubscriptionUI;

    window._upgradeSubscription = async function (planType) {
        if (!currentUser) return;

        const btn = document.getElementById(planType === 'pro' ? 'upgradePro' : 'upgradeStudio');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Redirecting to PayPal...';
        }

        try {
            // Create subscription via PayPal REST API
            const result = await createSubscription(planType);

            if (result.success && result.approvalUrl) {
                // Save pending subscription ID in localStorage for return
                localStorage.setItem('pendingSubscription', JSON.stringify({
                    subscriptionId: result.subscriptionId,
                    planType,
                    artistUid: currentUser.uid
                }));
                // Redirect to PayPal for approval
                window.location.href = result.approvalUrl;
            } else {
                throw new Error(result.error || 'Failed to create subscription');
            }
        } catch (err) {
            console.error('Subscription creation failed:', err);
            if (btn) {
                btn.disabled = false;
                btn.textContent = `Upgrade to ${planType.charAt(0).toUpperCase() + planType.slice(1)}`;
            }
            alert(`Subscription error: ${err.message}`);
        }
    };

    window._cancelSubscription = async function () {
        if (!currentUser) return;
        if (!confirm('Are you sure you want to cancel your subscription? You will be downgraded to the Free plan.')) return;

        const sub = artistProfile?.subscription;

        // Cancel on PayPal if we have a subscription ID
        if (sub?.id && !sub.id.startsWith('SIM-')) {
            const paypalResult = await cancelPayPalSubscription(sub.id);
            if (!paypalResult.success) {
                console.warn('PayPal cancellation failed, updating Firestore anyway');
            }
        }

        // Cancel in Firestore
        const result = await cancelSubscription(currentUser.uid);
        if (result.success) {
            artistProfile.plan = 'free';
            if (artistProfile.subscription) artistProfile.subscription.status = 'CANCELLED';
            loadSubscriptionUI();
            alert('Subscription cancelled. You are now on the Free plan.');
        } else {
            alert('Error cancelling subscription. Please try again.');
        }
    };

    // ---- Handle PayPal Subscription Return ----
    async function checkSubscriptionReturn() {
        const returnData = handleSubscriptionReturn();
        if (!returnData) return;

        if (returnData.status === 'success') {
            // Get pending subscription from localStorage
            const pending = JSON.parse(localStorage.getItem('pendingSubscription') || 'null');
            localStorage.removeItem('pendingSubscription');

            if (pending && currentUser) {
                // Verify subscription status with PayPal
                let subscriptionId = pending.subscriptionId;
                if (returnData.subscriptionId) {
                    subscriptionId = returnData.subscriptionId;
                }

                // Activate in Firestore
                const result = await activateSubscription(currentUser.uid, {
                    subscriptionId,
                    planType: pending.planType
                });

                if (result.success) {
                    artistProfile.plan = pending.planType;
                    artistProfile.subscription = {
                        id: subscriptionId,
                        status: 'ACTIVE',
                        planType: pending.planType
                    };
                    loadSubscriptionUI();
                    alert(`🎉 Welcome to ${pending.planType.charAt(0).toUpperCase() + pending.planType.slice(1)}! Your plan is now active.`);
                }
            }

            // Clean up URL
            window.history.replaceState({}, '', '/dashboard.html');
            // Switch to Settings tab
            document.querySelector('[data-tab="settings"]')?.click();
        } else if (returnData.status === 'cancelled') {
            alert('Subscription was cancelled. No changes made.');
            window.history.replaceState({}, '', '/dashboard.html');
        }
    }

    // Check on page load
    checkSubscriptionReturn();

    console.log('⚡ InkBook Dashboard loaded');
});

