// ============================================================
// InkBook — Bookings Service
// CRUD operations for bookings, calendar, deposits
// ============================================================
import {
    db,
    collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc,
    query, where, orderBy, onSnapshot, serverTimestamp, Timestamp
} from './firebase.js';

// ---- Create Booking ----
export async function createBooking(bookingData) {
    try {
        const bookingRef = await addDoc(collection(db, 'bookings'), {
            // Artist
            artistId: bookingData.artistId,
            artistHandle: bookingData.artistHandle,

            // Client Info
            clientName: bookingData.clientName,
            clientEmail: bookingData.clientEmail,
            clientPhone: bookingData.clientPhone || '',
            clientAge: bookingData.clientAge,

            // Design
            designId: bookingData.designId,
            designName: bookingData.designName,
            designType: bookingData.designType, // 'flash' | 'custom'
            customDescription: bookingData.customDescription || '',

            // Schedule
            date: Timestamp.fromDate(new Date(bookingData.date)),
            timeSlot: bookingData.timeSlot,
            estimatedDuration: bookingData.estimatedDuration || 60,

            // Pricing
            totalPrice: bookingData.totalPrice,
            depositAmount: bookingData.depositAmount,
            depositPaid: false,

            // Payment
            paypalOrderId: null,
            paypalTransactionId: null,

            // Consent
            consentSigned: bookingData.consentSigned || false,
            consentTimestamp: bookingData.consentSigned ? serverTimestamp() : null,

            // Status: pending | confirmed | in_progress | completed | cancelled | no_show
            status: 'pending',

            // Timestamps
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, bookingId: bookingRef.id };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Get Artist Bookings ----
export async function getArtistBookings(artistId, statusFilter = null) {
    try {
        let q;
        if (statusFilter) {
            q = query(
                collection(db, 'bookings'),
                where('artistId', '==', artistId),
                where('status', '==', statusFilter)
            );
        } else {
            q = query(
                collection(db, 'bookings'),
                where('artistId', '==', artistId)
            );
        }

        const snap = await getDocs(q);
        const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sort client-side (newest first)
        bookings.sort((a, b) => {
            const dateA = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0);
            const dateB = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0);
            return dateB - dateA;
        });
        return { success: true, data: bookings };
    } catch (error) {
        console.error('getArtistBookings error:', error);
        return { success: false, error: error.message };
    }
}

// ---- Get Today's Bookings ----
export async function getTodayBookings(artistId) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const q = query(
            collection(db, 'bookings'),
            where('artistId', '==', artistId),
            where('date', '>=', Timestamp.fromDate(today)),
            where('date', '<', Timestamp.fromDate(tomorrow))
        );

        const snap = await getDocs(q);
        const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        bookings.sort((a, b) => {
            const dA = a.date?.toDate ? a.date.toDate() : new Date(0);
            const dB = b.date?.toDate ? b.date.toDate() : new Date(0);
            return dA - dB;
        });
        return { success: true, data: bookings };
    } catch (error) {
        console.error('getTodayBookings error:', error);
        return { success: false, error: error.message };
    }
}

// ---- Get Available Slots for a Date ----
export async function getAvailableSlots(artistId, date) {
    try {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        // Get existing bookings for this date
        const q = query(
            collection(db, 'bookings'),
            where('artistId', '==', artistId),
            where('date', '>=', Timestamp.fromDate(dayStart)),
            where('date', '<', Timestamp.fromDate(dayEnd)),
            where('status', 'in', ['pending', 'confirmed', 'in_progress'])
        );

        const snap = await getDocs(q);
        const bookedSlots = snap.docs.map(d => d.data().timeSlot);

        // Get artist availability
        const artistSnap = await getDoc(doc(db, 'artists', artistId));
        const artist = artistSnap.data();
        const { startTime, endTime } = artist.availability;

        // Generate all possible slots
        const allSlots = generateTimeSlots(startTime, endTime);

        // Mark booked slots
        const slots = allSlots.map(slot => ({
            time: slot,
            available: !bookedSlots.includes(slot)
        }));

        return { success: true, data: slots };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function generateTimeSlots(start, end) {
    const slots = [];
    let [startH] = start.split(':').map(Number);
    const [endH] = end.split(':').map(Number);

    while (startH < endH) {
        const hour = startH > 12 ? startH - 12 : startH;
        const period = startH >= 12 ? 'PM' : 'AM';
        slots.push(`${hour}:00 ${period}`);
        startH++;
    }
    return slots;
}

// ---- Update Booking Status ----
export async function updateBookingStatus(bookingId, status) {
    try {
        await updateDoc(doc(db, 'bookings', bookingId), {
            status,
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Mark Deposit as Paid ----
export async function markDepositPaid(bookingId, paypalOrderId, paypalTransactionId) {
    try {
        await updateDoc(doc(db, 'bookings', bookingId), {
            depositPaid: true,
            paypalOrderId,
            paypalTransactionId,
            status: 'confirmed',
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Real-time Listener for Artist Bookings ----
export function listenToBookings(artistId, callback) {
    const q = query(
        collection(db, 'bookings'),
        where('artistId', '==', artistId)
    );

    return onSnapshot(q, (snap) => {
        const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        bookings.sort((a, b) => {
            const dA = a.date?.toDate ? a.date.toDate() : new Date(0);
            const dB = b.date?.toDate ? b.date.toDate() : new Date(0);
            return dB - dA;
        });
        callback(bookings);
    });
}

// ---- Get Monthly Stats ----
export async function getMonthlyStats(artistId) {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const q = query(
            collection(db, 'bookings'),
            where('artistId', '==', artistId),
            where('date', '>=', Timestamp.fromDate(monthStart)),
            where('date', '<=', Timestamp.fromDate(monthEnd))
        );

        const snap = await getDocs(q);
        const bookings = snap.docs.map(d => d.data());

        const stats = {
            totalBookings: bookings.length,
            completedBookings: bookings.filter(b => b.status === 'completed').length,
            cancelledBookings: bookings.filter(b => b.status === 'cancelled').length,
            noShows: bookings.filter(b => b.status === 'no_show').length,
            totalRevenue: bookings
                .filter(b => b.status === 'completed')
                .reduce((sum, b) => sum + (b.totalPrice || 0), 0),
            depositsCollected: bookings
                .filter(b => b.depositPaid)
                .reduce((sum, b) => sum + (b.depositAmount || 0), 0)
        };

        stats.noShowRate = stats.totalBookings > 0
            ? Math.round((stats.noShows / stats.totalBookings) * 100)
            : 0;

        return { success: true, data: stats };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
