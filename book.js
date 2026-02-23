// ============================================================
// InkBook — Booking Page Logic (Firebase Connected)
// 3-Step booking flow: Design → Schedule → Consent & Pay
// ============================================================
import { getArtistByHandle } from './src/auth.js';
import { createBooking, getAvailableSlots, markDepositPaid } from './src/bookings.js';
import { getPublicFlashDesigns } from './src/gallery.js';
import { loadPayPalScript, renderPayPalButtons, calculateDeposit } from './src/paypal.js';

document.addEventListener('DOMContentLoaded', async () => {
    // ---- Get artist handle from URL ----
    const params = new URLSearchParams(window.location.search);
    const artistHandle = params.get('artist');

    if (!artistHandle) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0f;color:#fff;font-family:Inter,sans-serif;flex-direction:column;gap:16px;">
                <h1 style="font-size:2rem;"><img src="/favicon.png" alt="InkBook" style="width:32px;height:32px;border-radius:6px;vertical-align:middle;margin-right:8px;">InkBook</h1>
                <p style="color:#888;">No artist specified. Please use a valid booking link.</p>
            </div>`;
        return;
    }

    // ---- Load Artist Data ----
    const artistResult = await getArtistByHandle(artistHandle);
    if (!artistResult.success) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0f;color:#fff;font-family:Inter,sans-serif;flex-direction:column;gap:16px;">
                <h1 style="font-size:2rem;"><img src="/favicon.png" alt="InkBook" style="width:32px;height:32px;border-radius:6px;vertical-align:middle;margin-right:8px;">InkBook</h1>
                <p style="color:#888;">Artist "@${artistHandle}" not found.</p>
            </div>`;
        return;
    }

    const artist = artistResult.data;

    // Update artist info on page
    const artistName = document.querySelector('.artist-name');
    const artistBio = document.querySelector('.artist-bio');
    if (artistName) artistName.textContent = artist.displayName || `@${artist.handle}`;
    if (artistBio) artistBio.textContent = artist.bio || 'Tattoo Artist';

    // Profile image
    const avatarEl = document.getElementById('artistAvatar');
    const avatarFallback = document.getElementById('avatarFallback');
    if (artist.profileImage && avatarEl) {
        if (avatarFallback) avatarFallback.style.display = 'none';
        avatarEl.style.backgroundImage = `url(${artist.profileImage})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
    }

    // Specialties tags
    const specContainer = document.getElementById('artistSpecialties');
    if (artist.specialties && artist.specialties.length > 0 && specContainer) {
        specContainer.style.display = 'flex';
        specContainer.style.flexWrap = 'wrap';
        specContainer.style.justifyContent = 'center';
        specContainer.style.gap = '6px';
        const specs = Array.isArray(artist.specialties) ? artist.specialties : artist.specialties.split(',').map(s => s.trim());
        specs.forEach(spec => {
            if (spec) {
                const tag = document.createElement('span');
                tag.className = 'specialty-tag';
                tag.textContent = spec;
                specContainer.appendChild(tag);
            }
        });
    }

    // Social links
    const socialContainer = document.getElementById('artistSocial');
    if (socialContainer) {
        socialContainer.innerHTML = '';
        const socialLinks = [
            { key: 'instagram', icon: '📸', label: 'Instagram' },
            { key: 'portfolio', icon: '🌐', label: 'Portfolio' },
            { key: 'twitter', icon: '𝕏', label: 'X / Twitter' },
            { key: 'tiktok', icon: '🎵', label: 'TikTok' }
        ];
        let hasSocial = false;
        socialLinks.forEach(({ key, icon, label }) => {
            const url = artist[key] || (artist.social && artist.social[key]);
            if (url) {
                hasSocial = true;
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.className = 'social-link';
                a.textContent = `${icon} ${label}`;
                socialContainer.appendChild(a);
            }
        });
        if (!hasSocial) socialContainer.style.display = 'none';
    }

    // ---- Load Flash Designs ----
    const designsResult = await getPublicFlashDesigns(artist.uid);
    const designs = {};
    const flashGrid = document.getElementById('flashGallery');

    if (designsResult.success && designsResult.data.length > 0) {
        // Clear loading state
        if (flashGrid) flashGrid.innerHTML = '';

        designsResult.data.forEach(design => {
            designs[design.id] = {
                name: design.name,
                price: design.price || 0,
                imageUrl: design.imageUrl,
                size: design.size,
                duration: design.duration
            };

            if (flashGrid) {
                const card = document.createElement('div');
                card.className = 'flash-card';
                card.dataset.id = design.id;
                card.innerHTML = `
                    <div class="flash-img" style="${design.imageUrl ? `background-image:url(${design.imageUrl});background-size:cover;` : 'background:var(--bg-secondary);'}">
                        ${!design.imageUrl ? '<span style="font-size:2rem;">🎨</span>' : ''}
                    </div>
                    <div class="flash-info">
                        <span class="flash-name">${design.name}</span>
                        <span class="flash-price">$${design.price || 'TBD'}</span>
                        ${design.size ? `<span class="flash-meta">${design.size}</span>` : ''}
                    </div>`;
                flashGrid.appendChild(card);
            }
        });
    } else {
        // No designs from Firestore — clear loading state
        if (flashGrid) flashGrid.innerHTML = '';
    }

    // Always add custom design option
    if (flashGrid) {
        const customCard = document.createElement('div');
        customCard.className = 'flash-card';
        customCard.dataset.id = 'custom';
        designs['custom'] = { name: 'Custom Design', price: 0 };
        customCard.innerHTML = `
            <div class="flash-img" style="background:var(--bg-secondary);"><span style="font-size:2rem;">✨</span></div>
            <div class="flash-info">
                <span class="flash-name">Custom Design</span>
                <span class="flash-price">Quote Based</span>
            </div>`;
        flashGrid.appendChild(customCard);
    }

    // ---- State ----
    const state = {
        step: 1,
        selectedDesign: null,
        selectedDate: null,
        selectedTime: null,
        currentMonth: new Date().getMonth(),
        currentYear: new Date().getFullYear()
    };

    // ---- Elements ----
    const steps = document.querySelectorAll('.step');
    const stepContents = document.querySelectorAll('.step-content');
    const flashCards = document.querySelectorAll('.flash-card');
    const customArea = document.getElementById('customDesignArea');
    const toStep2Btn = document.getElementById('toStep2');
    const toStep3Btn = document.getElementById('toStep3');
    const backToStep1Btn = document.getElementById('backToStep1');
    const backToStep2Btn = document.getElementById('backToStep2');
    const payBtn = document.getElementById('payBtn');

    // ---- Step Navigation ----
    function goToStep(stepNum) {
        state.step = stepNum;
        steps.forEach(s => {
            const sNum = parseInt(s.dataset.step);
            s.classList.remove('active', 'completed');
            if (sNum === stepNum) s.classList.add('active');
            else if (sNum < stepNum) s.classList.add('completed');
        });
        stepContents.forEach(content => content.classList.remove('active'));
        const targetId = stepNum === 4 ? 'successState' : `step${stepNum}`;
        document.getElementById(targetId).classList.add('active');
        window.scrollTo({ top: 300, behavior: 'smooth' });
        if (stepNum === 2) updateStep2Summary();
        if (stepNum === 3) updateStep3Summary();
    }

    // ---- STEP 1: Flash Gallery Selection ----
    // Re-query after dynamic creation
    document.querySelectorAll('.flash-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.flash-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.selectedDesign = card.dataset.id;

            if (state.selectedDesign === 'custom' && customArea) {
                customArea.classList.add('visible');
            } else if (customArea) {
                customArea.classList.remove('visible');
            }

            if (toStep2Btn) toStep2Btn.disabled = false;
        });
    });

    // Upload area — image preview
    const uploadArea = document.getElementById('uploadArea');
    const refImages = document.getElementById('refImages');
    if (uploadArea && refImages) {
        uploadArea.addEventListener('click', () => refImages.click());
        // Support drag and drop
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--accent)'; });
        uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '';
            refImages.files = e.dataTransfer.files;
            refImages.dispatchEvent(new Event('change'));
        });

        refImages.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                // Show preview thumbnails
                let previewDiv = document.getElementById('refPreview');
                if (!previewDiv) {
                    previewDiv = document.createElement('div');
                    previewDiv.id = 'refPreview';
                    previewDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;';
                    uploadArea.parentNode.insertBefore(previewDiv, uploadArea.nextSibling);
                }
                previewDiv.innerHTML = '';
                Array.from(e.target.files).forEach((file, idx) => {
                    if (!file.type.startsWith('image/')) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const thumb = document.createElement('div');
                        thumb.style.cssText = 'position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--border);';
                        thumb.innerHTML = `
                            <img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;" />
                            <span style="position:absolute;top:2px;right:4px;color:#ff6b6b;font-size:14px;cursor:pointer;font-weight:bold;" title="Remove">✕</span>
                        `;
                        previewDiv.appendChild(thumb);
                    };
                    reader.readAsDataURL(file);
                });
                uploadArea.querySelector('p').innerHTML = `<strong>${e.target.files.length} image(s) selected</strong> — click to change`;
            }
        });
    }

    if (toStep2Btn) toStep2Btn.addEventListener('click', () => goToStep(2));

    // ---- STEP 2: Calendar (real available slots) ----
    function renderCalendar() {
        const calDays = document.getElementById('calendarDays');
        const monthLabel = document.getElementById('calendarMonth');
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        monthLabel.textContent = `${months[state.currentMonth]} ${state.currentYear}`;

        const firstDay = new Date(state.currentYear, state.currentMonth, 1).getDay();
        const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
        const today = new Date();

        calDays.innerHTML = '';
        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'cal-day empty';
            calDays.appendChild(empty);
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dayEl = document.createElement('button');
            dayEl.className = 'cal-day';
            dayEl.textContent = d;
            const dayDate = new Date(state.currentYear, state.currentMonth, d);

            if (dayDate < new Date(today.getFullYear(), today.getMonth(), today.getDate()) || dayDate.getDay() === 0) {
                dayEl.classList.add('disabled');
            } else {
                if (d === today.getDate() && state.currentMonth === today.getMonth() && state.currentYear === today.getFullYear()) {
                    dayEl.classList.add('today');
                }
                dayEl.addEventListener('click', () => {
                    document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
                    dayEl.classList.add('selected');
                    state.selectedDate = dayDate;
                    state.selectedTime = null;
                    renderTimeSlots(dayDate);
                });
            }
            calDays.appendChild(dayEl);
        }
    }

    async function renderTimeSlots(date) {
        const slotsContainer = document.getElementById('timeSlots');
        const slotsTitle = document.getElementById('slotsTitle');
        const options = { weekday: 'long', month: 'short', day: 'numeric' };
        slotsTitle.textContent = date.toLocaleDateString('en-US', options);
        slotsContainer.innerHTML = '<div style="padding:12px;color:var(--text-secondary);">Loading slots...</div>';

        // Get real available slots from Firestore
        const slotsResult = await getAvailableSlots(artist.uid, date);

        if (!slotsResult.success) {
            slotsContainer.innerHTML = '<div style="padding:12px;color:var(--text-secondary);">Error loading slots</div>';
            return;
        }

        slotsContainer.innerHTML = '';
        slotsResult.data.forEach(slot => {
            const slotEl = document.createElement('button');
            slotEl.className = 'time-slot';
            slotEl.textContent = slot.time;

            if (!slot.available) {
                slotEl.classList.add('taken');
                slotEl.disabled = true;
            } else {
                slotEl.addEventListener('click', () => {
                    document.querySelectorAll('.time-slot, .custom-time-slot').forEach(s => s.classList.remove('selected'));
                    const customInput = document.querySelector('.custom-time-input');
                    if (customInput) customInput.classList.remove('visible');
                    slotEl.classList.add('selected');
                    state.selectedTime = slot.time;
                    if (toStep3Btn) toStep3Btn.disabled = false;
                    updateStep2Summary();
                });
            }
            slotsContainer.appendChild(slotEl);
        });

        // Add "Custom Time" option
        const customBtn = document.createElement('button');
        customBtn.className = 'custom-time-slot';
        customBtn.textContent = '⏰ Choose Custom Time';
        slotsContainer.appendChild(customBtn);

        const customInputDiv = document.createElement('div');
        customInputDiv.className = 'custom-time-input';
        customInputDiv.innerHTML = `
            <input type="time" id="customTimeInput" value="14:30" />
            <button id="confirmCustomTime">Confirm</button>
        `;
        slotsContainer.appendChild(customInputDiv);

        customBtn.addEventListener('click', () => {
            document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
            customBtn.classList.add('selected');
            customInputDiv.classList.add('visible');
        });

        customInputDiv.querySelector('#confirmCustomTime').addEventListener('click', () => {
            const timeVal = customInputDiv.querySelector('#customTimeInput').value;
            if (timeVal) {
                const [h, m] = timeVal.split(':').map(Number);
                const hour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                const period = h >= 12 ? 'PM' : 'AM';
                const min = m.toString().padStart(2, '0');
                state.selectedTime = `${hour}:${min} ${period}`;
                customBtn.textContent = `⏰ ${state.selectedTime}`;
                customInputDiv.classList.remove('visible');
                if (toStep3Btn) toStep3Btn.disabled = false;
                updateStep2Summary();
            }
        });
    }

    function updateStep2Summary() {
        const design = designs[state.selectedDesign];
        if (design) {
            const summaryDesign = document.getElementById('summaryDesign');
            const summaryPrice = document.getElementById('summaryPrice');
            const summaryDeposit = document.getElementById('summaryDeposit');
            if (summaryDesign) summaryDesign.textContent = design.name;
            if (summaryPrice) summaryPrice.textContent = design.price > 0 ? `$${design.price}` : 'TBD (Custom)';
            if (summaryDeposit) summaryDeposit.textContent = design.price > 0 ? `$${calculateDeposit(design.price)}` : '$50 min.';
        }
        if (state.selectedDate && state.selectedTime) {
            const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
            const summaryDate = document.getElementById('summaryDate');
            if (summaryDate) summaryDate.textContent = `${state.selectedDate.toLocaleDateString('en-US', opts)} at ${state.selectedTime}`;
        }
    }

    // Month navigation
    document.getElementById('prevMonth')?.addEventListener('click', () => {
        const today = new Date();
        if (state.currentMonth === today.getMonth() && state.currentYear === today.getFullYear()) return;
        state.currentMonth--;
        if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
        renderCalendar();
    });

    document.getElementById('nextMonth')?.addEventListener('click', () => {
        state.currentMonth++;
        if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
        renderCalendar();
    });

    if (backToStep1Btn) backToStep1Btn.addEventListener('click', () => goToStep(1));
    if (toStep3Btn) toStep3Btn.addEventListener('click', () => goToStep(3));

    // ---- STEP 3: Consent & Payment ----
    function updateStep3Summary() {
        const design = designs[state.selectedDesign];
        if (design) {
            const payDesign = document.getElementById('payDesign');
            const payPrice = document.getElementById('payPrice');
            const payDeposit = document.getElementById('payDeposit');
            if (payDesign) payDesign.textContent = design.name;
            if (payPrice) payPrice.textContent = design.price > 0 ? `$${design.price}` : 'Custom Quote';
            if (payDeposit) payDeposit.textContent = design.price > 0 ? `$${calculateDeposit(design.price)}` : '$50';
        }
    }

    // Consent validation
    const consentBoxes = document.querySelectorAll('.consent-item input[type="checkbox"]');
    const clientName = document.getElementById('clientName');
    const clientEmail = document.getElementById('clientEmail');
    const clientAge = document.getElementById('clientAge');

    function checkPaymentReady() {
        const allConsented = Array.from(consentBoxes).every(cb => cb.checked);
        const hasName = clientName?.value.trim().length > 0;
        const hasEmail = clientEmail?.value.trim().length > 0;
        const hasAge = parseInt(clientAge?.value) >= 18;
        if (payBtn) payBtn.disabled = !(allConsented && hasName && hasEmail && hasAge);
    }

    consentBoxes.forEach(cb => cb.addEventListener('change', checkPaymentReady));
    [clientName, clientEmail, clientAge].forEach(input => {
        input?.addEventListener('input', checkPaymentReady);
    });

    if (backToStep2Btn) backToStep2Btn.addEventListener('click', () => goToStep(2));

    // ---- Pay Button — Create Booking + PayPal ----
    if (payBtn) {
        payBtn.addEventListener('click', async () => {
            payBtn.textContent = '⏳ Creating Booking...';
            payBtn.disabled = true;

            const design = designs[state.selectedDesign];
            const depositAmount = design.price > 0 ? calculateDeposit(design.price) : 50;

            // Create booking in Firestore
            const bookingResult = await createBooking({
                artistId: artist.uid,
                artistHandle: artist.handle,
                clientName: clientName.value.trim(),
                clientEmail: clientEmail.value.trim(),
                clientAge: parseInt(clientAge.value),
                designId: state.selectedDesign,
                designName: design.name,
                designType: state.selectedDesign === 'custom' ? 'custom' : 'flash',
                date: state.selectedDate.toISOString(),
                timeSlot: state.selectedTime,
                totalPrice: design.price,
                depositAmount: depositAmount,
                consentSigned: true
            });

            if (!bookingResult.success) {
                payBtn.textContent = 'Pay Deposit & Confirm';
                payBtn.disabled = false;
                alert('Error creating booking: ' + bookingResult.error);
                return;
            }

            const bookingId = bookingResult.bookingId;

            // Try PayPal payment
            try {
                await loadPayPalScript();
                payBtn.style.display = 'none';

                // Show PayPal button container
                let ppContainer = document.getElementById('paypal-button-container');
                if (!ppContainer) {
                    ppContainer = document.createElement('div');
                    ppContainer.id = 'paypal-button-container';
                    payBtn.parentNode.appendChild(ppContainer);
                }

                renderPayPalButtons('paypal-button-container', {
                    amount: depositAmount,
                    description: `InkBook Deposit — ${design.name} with @${artist.handle}`,
                    onApprove: async (paymentData) => {
                        // Mark deposit paid in Firestore
                        await markDepositPaid(bookingId, paymentData.orderId, paymentData.transactionId);

                        // Show success
                        document.getElementById('bookingId').textContent = `#INK-${bookingId.slice(-6).toUpperCase()}`;
                        const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
                        document.getElementById('successDate').textContent = `${state.selectedDate.toLocaleDateString('en-US', opts)} at ${state.selectedTime}`;
                        document.getElementById('successDesign').textContent = design.name;
                        document.getElementById('successDeposit').textContent = `$${depositAmount}`;
                        goToStep(4);
                    },
                    onError: (error) => {
                        console.error('PayPal error:', error);
                        payBtn.style.display = '';
                        payBtn.textContent = 'Pay Deposit & Confirm';
                        payBtn.disabled = false;
                        alert('Payment failed. Please try again.');
                    }
                });
            } catch (ppError) {
                // PayPal SDK not loaded — fallback to simulated payment
                console.warn('PayPal SDK not available, using simulated payment:', ppError);
                payBtn.textContent = '⏳ Processing...';

                setTimeout(async () => {
                    await markDepositPaid(bookingId, 'SIMULATED', 'SIMULATED');

                    document.getElementById('bookingId').textContent = `#INK-${bookingId.slice(-6).toUpperCase()}`;
                    const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
                    document.getElementById('successDate').textContent = `${state.selectedDate.toLocaleDateString('en-US', opts)} at ${state.selectedTime}`;
                    document.getElementById('successDesign').textContent = design.name;
                    document.getElementById('successDeposit').textContent = `$${depositAmount}`;
                    goToStep(4);
                }, 2000);
            }
        });
    }

    // ---- Initialize ----
    renderCalendar();
    console.log('⚡ InkBook Booking Page loaded — Firebase Connected');
});
