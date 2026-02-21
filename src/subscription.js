// ============================================================
// InkBook — Subscription Management
// PayPal Subscription via REST API (approval URL redirect)
// ============================================================
//
// ARCHITECTURE:
// 1. Artist clicks "Upgrade to Pro/Studio" on Dashboard
// 2. We call PayPal REST API to create a subscription
// 3. Artist is redirected to PayPal to approve
// 4. After approval, artist returns to dashboard
// 5. We verify subscription status & update Firestore
// ============================================================

import { db } from './firebase.js';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

// ---- PayPal Configuration ----
const PAYPAL_CLIENT_ID = 'AaG5r1RQWNIYr30P21qOaHXUC242afKF97UtmHrHCq0fKSl4s7B02BFwqcZIxneJ3rz2BqTnSGmq1YvW';
const PAYPAL_SECRET = ''; // Set in env for production — NOT used client-side
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com'; // Change to 'https://api-m.paypal.com' for live

// ---- Real PayPal Plan IDs (created via MCP) ----
const PLAN_IDS = {
    pro: 'P-9AF467780W709505JNGMSCFI',     // $19/mo
    studio: 'P-4JX32214KE1849721NGMSCFQ'   // $39/mo
};

const PLAN_DETAILS = {
    pro: {
        name: 'Pro',
        price: 19,
        features: [
            'Unlimited Bookings',
            'Unlimited Gallery',
            'Earnings Dashboard',
            'Priority Support',
            'Client Management'
        ]
    },
    studio: {
        name: 'Studio',
        price: 39,
        features: [
            'Everything in Pro',
            'Up to 10 Artists',
            'Team Dashboard',
            'Branded Portal (Coming Soon)',
            'API Access (Coming Soon)'
        ]
    }
};

// ---- Get PayPal Access Token ----
async function getAccessToken() {
    const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`)
        },
        body: 'grant_type=client_credentials'
    });
    const data = await response.json();
    return data.access_token;
}

// ---- Create Subscription & Get Approval URL ----
export async function createSubscription(planType) {
    if (!PLAN_IDS[planType]) {
        return { success: false, error: `Unknown plan: ${planType}` };
    }

    try {
        const accessToken = await getAccessToken();
        const returnBase = window.location.origin;

        const response = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                plan_id: PLAN_IDS[planType],
                application_context: {
                    brand_name: 'ARK InkBook',
                    locale: 'en-US',
                    shipping_preference: 'NO_SHIPPING',
                    user_action: 'SUBSCRIBE_NOW',
                    return_url: `${returnBase}/dashboard.html?subscription=success&plan=${planType}`,
                    cancel_url: `${returnBase}/dashboard.html?subscription=cancelled`
                }
            })
        });

        const data = await response.json();

        if (data.id) {
            // Find approval URL
            const approveLink = data.links?.find(l => l.rel === 'approve');
            return {
                success: true,
                subscriptionId: data.id,
                approvalUrl: approveLink?.href || null,
                status: data.status
            };
        } else {
            return { success: false, error: data.message || 'Failed to create subscription' };
        }
    } catch (error) {
        console.error('Create subscription error:', error);
        return { success: false, error: error.message };
    }
}

// ---- Get Subscription Status ----
export async function getSubscriptionStatus(subscriptionId) {
    try {
        const accessToken = await getAccessToken();
        const response = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Activate Subscription in Firestore ----
export async function activateSubscription(artistUid, { subscriptionId, planType }) {
    try {
        const artistRef = doc(db, 'artists', artistUid);
        await updateDoc(artistRef, {
            plan: planType,
            subscription: {
                id: subscriptionId,
                status: 'ACTIVE',
                planType: planType,
                startDate: serverTimestamp(),
                nextBillingDate: null
            },
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error('Error activating subscription:', error);
        return { success: false, error: error.message };
    }
}

// ---- Cancel Subscription ----
export async function cancelPayPalSubscription(subscriptionId, reason = 'User requested cancellation') {
    try {
        const accessToken = await getAccessToken();
        const response = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ reason })
        });

        // 204 = success
        return { success: response.status === 204 };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Cancel in Firestore ----
export async function cancelSubscription(artistUid) {
    try {
        const artistRef = doc(db, 'artists', artistUid);
        await updateDoc(artistRef, {
            plan: 'free',
            'subscription.status': 'CANCELLED',
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        return { success: false, error: error.message };
    }
}

// ---- Handle Return from PayPal ----
export function handleSubscriptionReturn() {
    const params = new URLSearchParams(window.location.search);
    const subStatus = params.get('subscription');
    const plan = params.get('plan');
    const subscriptionId = params.get('subscription_id');

    if (subStatus === 'success' && plan) {
        return { status: 'success', plan, subscriptionId };
    } else if (subStatus === 'cancelled') {
        return { status: 'cancelled' };
    }
    return null;
}

// ---- Utility Functions ----
export function getPlanDetails(planType) {
    return PLAN_DETAILS[planType] || null;
}

export function getAllPlans() {
    return PLAN_DETAILS;
}

export function isPaidPlan(plan) {
    return plan === 'pro' || plan === 'studio';
}

export function getPlanId(planType) {
    return PLAN_IDS[planType] || null;
}
