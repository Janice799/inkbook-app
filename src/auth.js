// ============================================================
// InkBook — Auth Service
// Handles artist registration, login, profile management
// ============================================================
import {
    auth, db, googleProvider,
    signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    doc, setDoc, getDoc, serverTimestamp
} from './firebase.js';

// ---- Artist Registration ----
export async function registerArtist(email, password, profileData) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Create artist profile in Firestore
        await setDoc(doc(db, 'artists', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: profileData.displayName || '',
            handle: profileData.handle || '', // @inkmaster_kai
            bio: profileData.bio || '',
            location: profileData.location || '',
            specialties: profileData.specialties || [],
            plan: 'free', // free | pro | studio
            bookingLink: `book.inkbook.io/${profileData.handle}`,
            avatar: null,
            stats: {
                totalBookings: 0,
                rating: 0,
                yearsExperience: 0
            },
            availability: {
                days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
                startTime: '10:00',
                endTime: '18:00',
                slotDuration: 60 // minutes
            },
            paypal: {
                email: null,
                connected: false
            },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Login ----
export async function loginArtist(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Google Login ----
export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        // Check if profile exists, create if not
        const profileRef = doc(db, 'artists', user.uid);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
            await setDoc(profileRef, {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || '',
                handle: user.email.split('@')[0],
                bio: '',
                location: '',
                specialties: [],
                plan: 'free',
                bookingLink: `book.inkbook.io/${user.email.split('@')[0]}`,
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
        }

        return { success: true, user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Logout ----
export async function logoutArtist() {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Get Artist Profile ----
export async function getArtistProfile(uid) {
    try {
        const profileSnap = await getDoc(doc(db, 'artists', uid));
        if (profileSnap.exists()) {
            return { success: true, data: profileSnap.data() };
        }
        return { success: false, error: 'Profile not found' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Get Artist by Handle (public booking page) ----
export async function getArtistByHandle(handle) {
    try {
        const { getDocs, query, where, collection } = await import('./firebase.js');
        const q = query(collection(db, 'artists'), where('handle', '==', handle));
        const snap = await getDocs(q);
        if (!snap.empty) {
            return { success: true, data: snap.docs[0].data() };
        }
        return { success: false, error: 'Artist not found' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Auth State Observer ----
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}
