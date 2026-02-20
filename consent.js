// ============================================================
// InkBook — Digital Consent Form Logic
// ============================================================
import { db } from './src/firebase.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

// Get booking ID from URL
const params = new URLSearchParams(window.location.search);
const bookingId = params.get('booking');

// ---- Load Booking Info ----
async function loadBookingInfo() {
    const info = document.getElementById('bookingInfo');
    if (!bookingId) {
        info.textContent = '⚠️ No booking ID provided. Please use the link sent by your artist.';
        document.getElementById('consentForm').style.display = 'none';
        return null;
    }
    try {
        const snap = await getDoc(doc(db, 'bookings', bookingId));
        if (!snap.exists()) {
            info.textContent = '⚠️ Booking not found. Please check the link.';
            document.getElementById('consentForm').style.display = 'none';
            return null;
        }
        const b = snap.data();

        // Check if consent already submitted
        if (b.consentSigned) {
            document.getElementById('consentForm').style.display = 'none';
            document.getElementById('successMessage').style.display = 'block';
            const signedDate = b.consentSignedAt?.toDate ? b.consentSignedAt.toDate() : new Date(b.consentSignedAt);
            document.getElementById('submittedTime').textContent =
                `Signed on ${signedDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
            return null;
        }

        const rawDate = b.date?.toDate ? b.date.toDate() : (b.date ? new Date(b.date) : null);
        const dateStr = rawDate ? rawDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
        info.innerHTML = `<strong>${b.designName || 'Tattoo Appointment'}</strong> · ${dateStr} ${b.timeSlot || ''}<br/>Artist appointment — please complete this form before your session.`;

        // Pre-fill client info
        if (b.clientName) document.getElementById('cfName').value = b.clientName;
        if (b.clientEmail) document.getElementById('cfEmail').value = b.clientEmail;
        if (b.clientPhone) document.getElementById('cfPhone').value = b.clientPhone;

        // Set today's date as default
        document.getElementById('cfSignDate').value = new Date().toISOString().split('T')[0];

        return b;
    } catch (err) {
        info.textContent = '⚠️ Error loading booking. Please try again.';
        return null;
    }
}

// ---- Signature Canvas ----
function initSignatureCanvas() {
    const canvas = document.getElementById('signatureCanvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let hasSignature = false;

    // Set canvas resolution
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        ctx.scale(2, 2);
        ctx.strokeStyle = '#f0f0f5';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    }

    function startDraw(e) {
        e.preventDefault();
        isDrawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastX = pos.x;
        lastY = pos.y;
        hasSignature = true;
    }

    function stopDraw() {
        isDrawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);

    document.getElementById('clearSignature').addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasSignature = false;
    });

    return {
        hasSignature: () => hasSignature,
        getDataURL: () => canvas.toDataURL('image/png')
    };
}

// ---- Form Submit ----
async function init() {
    const booking = await loadBookingInfo();
    if (!booking) return;

    const sig = initSignatureCanvas();

    document.getElementById('consentForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!sig.hasSignature()) {
            alert('Please provide your signature.');
            return;
        }

        const btn = document.getElementById('submitConsent');
        btn.textContent = 'Submitting...';
        btn.disabled = true;

        // Gather medical conditions
        const medicalChecks = [];
        document.querySelectorAll('input[name="medical"]:checked').forEach(cb => {
            medicalChecks.push(cb.value);
        });

        const consentData = {
            clientName: document.getElementById('cfName').value,
            dateOfBirth: document.getElementById('cfDob').value,
            phone: document.getElementById('cfPhone').value,
            email: document.getElementById('cfEmail').value,
            address: document.getElementById('cfAddress').value,
            idType: document.getElementById('cfIdType').value,
            ageVerified: document.getElementById('cfAge18').checked,
            medicalConditions: medicalChecks,
            medicalNotes: document.getElementById('cfMedicalNotes').value,
            riskAcknowledged: document.getElementById('cfRiskAck').checked,
            aftercareAgreed: document.getElementById('cfAftercare').checked,
            liabilityWaiver: document.getElementById('cfWaiver').checked,
            signatureData: sig.getDataURL(),
            signDate: document.getElementById('cfSignDate').value,
            signedAt: new Date().toISOString(),
            bookingId: bookingId
        };

        try {
            // Save consent form as sub-document
            await setDoc(doc(db, 'consent_forms', bookingId), consentData);

            // Update booking with consent status
            await updateDoc(doc(db, 'bookings', bookingId), {
                consentSigned: true,
                consentSignedAt: serverTimestamp(),
                consentClientName: consentData.clientName
            });

            // Show success
            document.getElementById('consentForm').style.display = 'none';
            document.getElementById('successMessage').style.display = 'block';
            document.getElementById('submittedTime').textContent =
                `Signed on ${new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        } catch (err) {
            btn.textContent = '❌ Error — try again';
            btn.disabled = false;
            console.error('Consent save error:', err);
        }
    });
}

init();
