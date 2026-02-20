// ============================================================
// InkBook — Flash Gallery Service
// Manages flash designs: upload, list, toggle, delete
// Images are uploaded to Firebase Storage under artists/{uid}/flash/
// ============================================================
import {
    db, storage,
    collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp,
    ref, uploadBytes, getDownloadURL
} from './firebase.js';

// ---- Upload Flash Design ----
export async function uploadFlashDesign(artistId, designData, imageFile) {
    try {
        let imageUrl = null;

        // Upload image to Storage if provided
        if (imageFile) {
            const fileName = `${Date.now()}_${imageFile.name}`;
            const storageRef = ref(storage, `artists/${artistId}/flash/${fileName}`);
            const snapshot = await uploadBytes(storageRef, imageFile);
            imageUrl = await getDownloadURL(snapshot.ref);
        }

        // Save design to Firestore
        const designRef = await addDoc(collection(db, 'flash_designs'), {
            artistId,
            name: designData.name,
            description: designData.description || '',
            price: designData.price,
            size: designData.size || '',
            duration: designData.duration || '',
            style: designData.style || '',
            imageUrl,
            available: true,
            bookingCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, designId: designRef.id };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Get Artist's Flash Designs ----
export async function getArtistFlashDesigns(artistId) {
    try {
        const q = query(
            collection(db, 'flash_designs'),
            where('artistId', '==', artistId),
            orderBy('createdAt', 'desc')
        );

        const snap = await getDocs(q);
        const designs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { success: true, data: designs };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Get Available Flash Designs (public, for booking page) ----
export async function getPublicFlashDesigns(artistId) {
    try {
        const q = query(
            collection(db, 'flash_designs'),
            where('artistId', '==', artistId),
            where('available', '==', true),
            orderBy('createdAt', 'desc')
        );

        const snap = await getDocs(q);
        const designs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { success: true, data: designs };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Toggle Design Availability ----
export async function toggleDesignAvailability(designId, available) {
    try {
        await updateDoc(doc(db, 'flash_designs', designId), {
            available,
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Delete Flash Design ----
export async function deleteFlashDesign(designId) {
    try {
        // Note: Image in Storage is not deleted for simplicity
        await deleteDoc(doc(db, 'flash_designs', designId));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ---- Increment Booking Count ----
export async function incrementDesignBookingCount(designId) {
    try {
        const designSnap = await getDoc(doc(db, 'flash_designs', designId));
        if (designSnap.exists()) {
            const currentCount = designSnap.data().bookingCount || 0;
            await updateDoc(doc(db, 'flash_designs', designId), {
                bookingCount: currentCount + 1,
                updatedAt: serverTimestamp()
            });
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
