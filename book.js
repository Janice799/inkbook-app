// InkBook — Booking Page Logic
// 3-Step booking flow: Design → Schedule → Consent & Pay

document.addEventListener('DOMContentLoaded', () => {
    // ---- State ----
    const state = {
        step: 1,
        selectedDesign: null,
        selectedDate: null,
        selectedTime: null,
        currentMonth: new Date().getMonth(),
        currentYear: new Date().getFullYear()
    };

    const designs = {
        1: { name: 'Rose Vine', price: 200 },
        2: { name: 'Serpent Wrap', price: 180 },
        3: { name: 'Lunar Moth', price: 150 },
        4: { name: 'Dragon Coil', price: 250 },
        5: { name: 'Lightning Bolt', price: 120 },
        custom: { name: 'Custom Design', price: 0 }
    };

    const timeOptions = [
        '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM',
        '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'
    ];

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

        // Update step indicators
        steps.forEach(s => {
            const sNum = parseInt(s.dataset.step);
            s.classList.remove('active', 'completed');
            if (sNum === stepNum) s.classList.add('active');
            else if (sNum < stepNum) s.classList.add('completed');
        });

        // Show correct content
        stepContents.forEach(content => content.classList.remove('active'));
        const targetId = stepNum === 4 ? 'successState' : `step${stepNum}`;
        document.getElementById(targetId).classList.add('active');

        // Scroll to top
        window.scrollTo({ top: 300, behavior: 'smooth' });

        // Update summaries
        if (stepNum === 2) updateStep2Summary();
        if (stepNum === 3) updateStep3Summary();
    }

    // ---- STEP 1: Flash Gallery ----
    flashCards.forEach(card => {
        card.addEventListener('click', () => {
            // Deselect all
            flashCards.forEach(c => c.classList.remove('selected'));
            // Select this one
            card.classList.add('selected');
            state.selectedDesign = card.dataset.id;

            // Show/hide custom area
            if (state.selectedDesign === 'custom') {
                customArea.classList.add('visible');
            } else {
                customArea.classList.remove('visible');
            }

            // Enable next button
            toStep2Btn.disabled = false;
        });
    });

    // Upload area click
    const uploadArea = document.getElementById('uploadArea');
    const refImages = document.getElementById('refImages');
    if (uploadArea && refImages) {
        uploadArea.addEventListener('click', () => refImages.click());
        refImages.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                uploadArea.querySelector('p').innerHTML = `<strong>${files.length} file(s) selected</strong>`;
            }
        });
    }

    toStep2Btn.addEventListener('click', () => goToStep(2));

    // ---- STEP 2: Calendar ----
    function renderCalendar() {
        const calDays = document.getElementById('calendarDays');
        const monthLabel = document.getElementById('calendarMonth');
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        monthLabel.textContent = `${months[state.currentMonth]} ${state.currentYear}`;

        const firstDay = new Date(state.currentYear, state.currentMonth, 1).getDay();
        const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
        const today = new Date();

        calDays.innerHTML = '';

        // Empty cells for days before first
        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'cal-day empty';
            calDays.appendChild(empty);
        }

        // Actual days
        for (let d = 1; d <= daysInMonth; d++) {
            const dayEl = document.createElement('button');
            dayEl.className = 'cal-day';
            dayEl.textContent = d;

            const dayDate = new Date(state.currentYear, state.currentMonth, d);

            // Disable past days & Sundays
            if (dayDate < new Date(today.getFullYear(), today.getMonth(), today.getDate()) || dayDate.getDay() === 0) {
                dayEl.classList.add('disabled');
            } else {
                // Today marker
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

    function renderTimeSlots(date) {
        const slotsContainer = document.getElementById('timeSlots');
        const slotsTitle = document.getElementById('slotsTitle');
        const options = { weekday: 'long', month: 'short', day: 'numeric' };
        slotsTitle.textContent = date.toLocaleDateString('en-US', options);

        slotsContainer.innerHTML = '';

        // Simulate some taken slots
        const takenSlots = [2, 5]; // Random taken slots

        timeOptions.forEach((time, i) => {
            const slot = document.createElement('button');
            slot.className = 'time-slot';
            slot.textContent = time;

            if (takenSlots.includes(i)) {
                slot.classList.add('taken');
                slot.disabled = true;
            } else {
                slot.addEventListener('click', () => {
                    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
                    slot.classList.add('selected');
                    state.selectedTime = time;
                    toStep3Btn.disabled = false;
                    updateStep2Summary();
                });
            }

            slotsContainer.appendChild(slot);
        });
    }

    function updateStep2Summary() {
        const design = designs[state.selectedDesign];
        if (design) {
            document.getElementById('summaryDesign').textContent = design.name;
            if (design.price > 0) {
                document.getElementById('summaryPrice').textContent = `$${design.price}`;
                document.getElementById('summaryDeposit').textContent = `$${Math.round(design.price / 2)}`;
            } else {
                document.getElementById('summaryPrice').textContent = 'TBD (Custom)';
                document.getElementById('summaryDeposit').textContent = '$50 min.';
            }
        }
        if (state.selectedDate && state.selectedTime) {
            const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
            document.getElementById('summaryDate').textContent =
                `${state.selectedDate.toLocaleDateString('en-US', options)} at ${state.selectedTime}`;
        }
    }

    // Month navigation
    document.getElementById('prevMonth').addEventListener('click', () => {
        const today = new Date();
        if (state.currentMonth === today.getMonth() && state.currentYear === today.getFullYear()) return;
        state.currentMonth--;
        if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        state.currentMonth++;
        if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
        renderCalendar();
    });

    backToStep1Btn.addEventListener('click', () => goToStep(1));
    toStep3Btn.addEventListener('click', () => goToStep(3));

    // ---- STEP 3: Consent & Payment ----
    function updateStep3Summary() {
        const design = designs[state.selectedDesign];
        if (design) {
            document.getElementById('payDesign').textContent = design.name;
            if (design.price > 0) {
                document.getElementById('payPrice').textContent = `$${design.price}`;
                document.getElementById('payDeposit').textContent = `$${Math.round(design.price / 2)}`;
            } else {
                document.getElementById('payPrice').textContent = 'Custom Quote';
                document.getElementById('payDeposit').textContent = '$50';
            }
        }
    }

    // Consent validation
    const consentBoxes = document.querySelectorAll('.consent-item input[type="checkbox"]');
    const clientName = document.getElementById('clientName');
    const clientEmail = document.getElementById('clientEmail');
    const clientAge = document.getElementById('clientAge');

    function checkPaymentReady() {
        const allConsented = Array.from(consentBoxes).every(cb => cb.checked);
        const hasName = clientName.value.trim().length > 0;
        const hasEmail = clientEmail.value.trim().length > 0;
        const hasAge = parseInt(clientAge.value) >= 18;
        payBtn.disabled = !(allConsented && hasName && hasEmail && hasAge);
    }

    consentBoxes.forEach(cb => cb.addEventListener('change', checkPaymentReady));
    [clientName, clientEmail, clientAge].forEach(input => {
        input.addEventListener('input', checkPaymentReady);
    });

    backToStep2Btn.addEventListener('click', () => goToStep(2));

    // Pay button — simulated
    payBtn.addEventListener('click', () => {
        payBtn.textContent = '⏳ Processing...';
        payBtn.disabled = true;

        setTimeout(() => {
            // Fill success state
            const design = designs[state.selectedDesign];
            document.getElementById('bookingId').textContent = `#INK-${Date.now().toString().slice(-6)}`;
            const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
            document.getElementById('successDate').textContent =
                `${state.selectedDate.toLocaleDateString('en-US', options)} at ${state.selectedTime}`;
            document.getElementById('successDesign').textContent = design.name;
            document.getElementById('successDeposit').textContent =
                design.price > 0 ? `$${Math.round(design.price / 2)}` : '$50';

            goToStep(4);
        }, 2000);
    });

    // ---- Initialize ----
    renderCalendar();
    console.log('⚡ InkBook Booking Page loaded');
});
