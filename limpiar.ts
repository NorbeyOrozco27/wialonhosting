// limpiar.ts
import { config } from 'dotenv';
import admin from 'firebase-admin';

config();

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG || '{}'))
    });
}

const db = admin.firestore();

async function borrarTodo() {
    console.log("🔥 Iniciando borrado de colección 'auditoria_viajes'...");
    const snapshot = await db.collection('auditoria_viajes').get();
    
    if (snapshot.size === 0) {
        console.log("✅ La colección ya está vacía.");
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`✅ Se borraron ${snapshot.size} documentos.`);
}

borrarTodo();