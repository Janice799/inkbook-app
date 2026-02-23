// ============================================================
// InkBook — PayPal Integration
// Handles deposit payments via PayPal Smart Buttons
// ============================================================
//
// SETUP GUIDE:
// 1. Go to https://developer.paypal.com
// 2. Create a REST API app (Sandbox first, then Live)
// 3. Copy your Client ID below
// 4. For live payments, change 'sandbox' to 'live' in loadPayPalScript()
//
// FLOW:
// Client picks design → Books slot → Fills consent → Pays deposit via PayPal
// → Order created → Captured → Booking confirmed in Firestore
// ============================================================

const PAYPAL_CLIENT_ID = 'AaG5r1RQWNIYr30P21qOaHXUC242afKF97UtmHrHCq0fKSl4s7B02BFwqcZIxneJ3rz2BqTnSGmq1YvW';
const PAYPAL_MODE = 'sandbox'; // 'sandbox' or 'live'

// ---- Load PayPal SDK Script ----
export function loadPayPalScript() {
    return new Promise((resolve, reject) => {
        // Don't load twice
        if (document.querySelector('script[data-paypal]')) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&locale=en_US`;
        script.setAttribute('data-paypal', 'true');
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
        document.head.appendChild(script);
    });
}

// ---- Render PayPal Buttons ----
export function renderPayPalButtons(containerId, { amount, description, onApprove, onError }) {
    if (!window.paypal) {
        console.error('PayPal SDK not loaded');
        return;
    }

    // Clear existing buttons
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';

    window.paypal.Buttons({
        style: {
            layout: 'vertical',
            color: 'black',
            shape: 'rect',
            label: 'pay',
            height: 45
        },

        // Create Order
        createOrder: (data, actions) => {
            return actions.order.create({
                purchase_units: [{
                    description: description || 'InkBook Deposit',
                    amount: {
                        currency_code: 'USD',
                        value: amount.toString()
                    }
                }]
            });
        },

        // On Approve — Capture the payment
        onApprove: async (data, actions) => {
            try {
                const order = await actions.order.capture();
                console.log('✅ PayPal payment captured:', order);

                const transactionId = order.purchase_units[0].payments.captures[0].id;

                if (onApprove) {
                    onApprove({
                        orderId: data.orderID,
                        transactionId,
                        payerEmail: order.payer.email_address,
                        payerName: `${order.payer.name.given_name} ${order.payer.name.surname}`,
                        amount: order.purchase_units[0].amount.value,
                        status: order.status
                    });
                }
            } catch (error) {
                console.error('Payment capture error:', error);
                if (onError) onError(error);
            }
        },

        // On Cancel
        onCancel: () => {
            console.log('Payment cancelled by user');
        },

        // On Error
        onError: (err) => {
            console.error('PayPal Error:', err);
            if (onError) onError(err);
        }
    }).render(`#${containerId}`);
}

// ---- Calculate Deposit Amount ----
export function calculateDeposit(totalPrice, percentage = 50) {
    return Math.round(totalPrice * (percentage / 100));
}

// ---- Format Currency ----
export function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}
