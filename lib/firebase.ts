// lib/firebase.ts
import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG || '{}'))
    });
}

export const db = admin.firestore();