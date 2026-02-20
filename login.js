// ============================================================
// InkBook — Login Page Logic
// ============================================================
import { registerArtist, loginArtist, loginWithGoogle, loginAsGuest, onAuthChange } from './src/auth.js';

const signInForm = document.getElementById('signInForm');
const signUpForm = document.getElementById('signUpForm');
const toast = document.getElementById('toast');

// ---- Toggle Forms ----
document.getElementById('showSignUp')?.addEventListener('click', (e) => {
    e.preventDefault();
    signInForm.classList.add('hidden');
    signUpForm.classList.remove('hidden');
});

document.getElementById('showSignIn')?.addEventListener('click', (e) => {
    e.preventDefault();
    signUpForm.classList.add('hidden');
    signInForm.classList.remove('hidden');
});

// ---- Email Sign In ----
document.getElementById('emailSignIn')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    showToast('Signing in...', 'info');
    const result = await loginArtist(email, password);

    if (result.success) {
        showToast('Welcome back! Redirecting...', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
    } else {
        showToast(result.error, 'error');
    }
});

// ---- Email Sign Up ----
document.getElementById('emailSignUp')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const handle = document.getElementById('signupHandle').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const location = document.getElementById('signupLocation').value;

    showToast('Creating your account...', 'info');
    const result = await registerArtist(email, password, {
        displayName: name,
        handle: handle.toLowerCase().replace(/[^a-z0-9_]/g, ''),
        location
    });

    if (result.success) {
        showToast('Account created! Welcome to InkBook 🎉', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1500);
    } else {
        showToast(result.error, 'error');
    }
});

// ---- Google Sign In / Up ----
document.getElementById('googleSignIn')?.addEventListener('click', handleGoogle);
document.getElementById('googleSignUp')?.addEventListener('click', handleGoogle);

async function handleGoogle() {
    showToast('Connecting to Google...', 'info');
    const result = await loginWithGoogle();

    if (result.success) {
        showToast('Welcome to InkBook! 🎉', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
    } else {
        showToast(result.error, 'error');
    }
}

// ---- Auth State: Redirect if already logged in ----
onAuthChange((user) => {
    if (user) {
        window.location.href = '/dashboard.html';
    }
});

// ---- Guest Login ----
document.getElementById('guestLoginBtn')?.addEventListener('click', async () => {
    const nickname = document.getElementById('guestNickname')?.value.trim();
    if (!nickname) {
        showToast('Please enter a nickname', 'error');
        return;
    }
    if (nickname.length < 2) {
        showToast('Nickname must be at least 2 characters', 'error');
        return;
    }

    showToast('Entering as guest...', 'info');
    const result = await loginAsGuest(nickname);

    if (result.success) {
        showToast(`Welcome, ${nickname}! 🎨`, 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
    } else {
        showToast(result.error, 'error');
    }
});

// ---- Toast Helper ----
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type}`;

    if (type !== 'info') {
        setTimeout(() => { toast.classList.add('hidden'); }, 4000);
    }
}
