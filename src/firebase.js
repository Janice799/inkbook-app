// ============================================================
// InkBook — Firebase Configuration
// ============================================================
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Firebase config — Replace with your actual config from Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyAM-iL8jpJzVgVxC3m_yd28jQhy1l3jzRc",
    authDomain: "ark-inkbook-app.firebaseapp.com",
    projectId: "ark-inkbook-app",
    storageBucket: "ark-inkbook-app.firebasestorage.app",
    messagingSenderId: "481626664789",
    appId: "1:481626664789:web:e970f5d2b71207839749dc",
    measurementId: "G-G9Y6M2G3YZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export {
    app, auth, db, storage, googleProvider,
    // Auth
    signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    // Firestore
    collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, onSnapshot, serverTimestamp, Timestamp,
    // Storage
    ref, uploadBytes, getDownloadURL
};
