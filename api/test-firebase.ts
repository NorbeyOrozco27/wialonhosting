// api/test-firebase.ts
import { db } from '../lib/firebase.js';

export default async function handler(req: any, res: any) {
  try {
    const docRef = db.collection('prueba_conexion').doc('test_01');
    
    await docRef.set({
      mensaje: "¡Conexión exitosa!",
      timestamp: new Date(),
      usuario: "Norbey"
    });

    res.status(200).json({ 
      success: true, 
      mensaje: "Se escribió correctamente en la colección 'prueba_conexion'" 
    });

  } catch (error: any) {
    console.error("Error Firebase:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      credenciales_presentes: !!process.env.FIREBASE_CONFIG
    });
  }
}