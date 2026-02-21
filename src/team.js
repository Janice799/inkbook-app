import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
    query, where, serverTimestamp, orderBy
} from 'firebase/firestore';

// Get all team members for a shop owner
export async function getTeamMembers(ownerId) {
    try {
        const q = query(
            collection(db, 'team_members'),
            where('ownerId', '==', ownerId)
        );
        const snapshot = await getDocs(q);
        const members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sort client-side (avoids composite index requirement)
        members.sort((a, b) => {
            const ta = a.createdAt?.toDate?.() || new Date(0);
            const tb = b.createdAt?.toDate?.() || new Date(0);
            return tb - ta;
        });
        return { success: true, data: members };
    } catch (error) {
        return { success: false, error: error.message, data: [] };
    }
}

// Add a team member
export async function addTeamMember(ownerId, memberData) {
    try {
        const docRef = await addDoc(collection(db, 'team_members'), {
            ownerId,
            ...memberData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return { success: true, id: docRef.id };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Update a team member
export async function updateTeamMember(memberId, data) {
    try {
        await updateDoc(doc(db, 'team_members', memberId), {
            ...data,
            updatedAt: serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Delete a team member
export async function deleteTeamMember(memberId) {
    try {
        await deleteDoc(doc(db, 'team_members', memberId));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
