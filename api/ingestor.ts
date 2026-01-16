import { supabaseA } from '../lib/supabase';
import { db } from '../lib/firebase';
import axios from 'axios';
// @ts-ignore
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
// @ts-ignore
import { point, polygon } from '@turf/helpers';
import fs from 'fs';
import path from 'path';

// --- CONFIGURACIÓN ---
const INTERVALO_MS = 30000; // Ejecutar cada 30 segundos
const TOKEN = process.env.WIALON_TOKEN;

// Cargar Geocercas (Ruta absoluta para evitar errores en VPS)
const geocercasPath = path.resolve(__dirname, '../geocercas.json');
let geocercasData: any = { features: [] };
try {
    if (fs.existsSync(geocercasPath)) {
        geocercasData = JSON.parse(fs.readFileSync(geocercasPath, 'utf8'));
    } else {
        console.warn("⚠️ No se encontró geocercas.json en:", geocercasPath);
    }
} catch (e) { console.error("Error cargando geocercas:", e); }

// --- FUNCIONES AUXILIARES ---
async function obtenerPosiciones() {
    if (!TOKEN) throw new Error("Falta WIALON_TOKEN");
    try {
        const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${TOKEN}"}`);
        const sid = login.data.eid;
        if (!sid) return [];

        const search = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1025,"from":0,"to":0}&sid=${sid}`);
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        
        return search.data.items || [];
    } catch (e) {
        console.error("Error Wialon:", e);
        return [];
    }
}

// --- BUCLE PRINCIPAL ---
async function cicloIngesta() {
    console.time("Ciclo Ingesta");
    const ahora = new Date();
    
    try {
        // 1. Obtener Datos GPS
        const unidades = await obtenerPosiciones();
        if (unidades.length === 0) {
            console.log("⚠️ Wialon no devolvió unidades.");
            return;
        }

        // 2. Procesar (Detectar Geocercas)
        const batch = db.batch();
        let contador = 0;

        for (const u of unidades) {
            if (!u.pos) continue;
            
            const nombreLimpio = u.nm.replace(/^0+/, '').trim();
            let geocerca = "EN RUTA";
            
            // Detección de Polígono
            if (geocercasData.features.length > 0) {
                const pt = point([u.pos.x, u.pos.y]);
                for (const feature of geocercasData.features) {
                    if (booleanPointInPolygon(pt, polygon(feature.geometry.coordinates))) {
                        geocerca = feature.properties.nombre;
                        break;
                    }
                }
            }

            // Preparar escritura en Firebase
            const docRef = db.collection('flota_en_vivo').doc(nombreLimpio);
            batch.set(docRef, {
                bus: nombreLimpio,
                lat: u.pos.y,
                lon: u.pos.x,
                velocidad: u.pos.s,
                estado_geocerca: geocerca,
                last_update: admin.firestore.FieldValue.serverTimestamp(),
                fecha_iso: ahora.toISOString()
            }, { merge: true }); // Merge para no borrar datos extras si los hubiera

            contador++;
            // Firebase permite max 500 en batch, si nos pasamos, ejecutamos y reiniciamos
            if (contador >= 490) {
                await batch.commit();
                contador = 0;
            }
        }

        if (contador > 0) await batch.commit();
        console.log(`✅ [${ahora.toLocaleTimeString()}] ${unidades.length} buses actualizados.`);

    } catch (error) {
        console.error("🔥 Error en ciclo:", error);
    }
    console.timeEnd("Ciclo Ingesta");
}

// --- ARRANQUE ---
console.log("🚀 Ingestor Wialon -> Firebase Iniciado");
import admin from 'firebase-admin'; // Necesario para FieldValue

// Ejecutar inmediatamente
cicloIngesta();

// Programar infinito
setInterval(cicloIngesta, INTERVALO_MS);