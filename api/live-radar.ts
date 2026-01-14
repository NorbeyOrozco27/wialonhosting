import axios from 'axios';
// @ts-ignore
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
// @ts-ignore
import { point, polygon } from '@turf/helpers';
import fs from 'fs';
import path from 'path';

// --- CARGA SEGURA DE GEOCERCAS ---
let geocercasData: any = { features: [] };

try {
    // Intentamos buscar en la raíz del proyecto
    const ruta1 = path.join(process.cwd(), 'geocercas.json');
    const ruta2 = path.resolve(__dirname, '../geocercas.json');
    
    let rutaFinal = "";
    
    if (fs.existsSync(ruta1)) rutaFinal = ruta1;
    else if (fs.existsSync(ruta2)) rutaFinal = ruta2;

    if (rutaFinal) {
        const raw = fs.readFileSync(rutaFinal, 'utf8');
        geocercasData = JSON.parse(raw);
        console.log(`✅ Geocercas cargadas: ${geocercasData.features.length} zonas.`);
    } else {
        console.error("⚠️ ADVERTENCIA: No se encontró el archivo 'geocercas.json'. El radar funcionará solo con GPS.");
    }
} catch (e) {
    console.error("❌ Error cargando geocercas:", e);
}
// ---------------------------------

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
      return res.status(500).json({ error: "Falta WIALON_TOKEN en .env" });
  }

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    if (!sid) return res.status(500).json({ error: "Login falló en Wialon" });

    // 2. PEDIR POSICIÓN DE TODA LA FLOTA (1 sola llamada eficiente)
    const searchParams = {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*",
        sortType: "sys_name"
      },
      force: 1,
      flags: 1025, // Base + Última Posición
      from: 0,
      to: 0
    };

    const searchRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params=${JSON.stringify(searchParams)}&sid=${sid}`
    );

    // Logout rápido para no saturar sesiones
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const unidades = searchRes.data.items || [];
    
    // 3. PROCESAR DATOS + GEOCERCAS
    const flotaEnVivo = unidades.map((u: any) => {
        // Si no tiene posición, lo ignoramos
        if (!u.pos) return null;
        
        const nombreLimpio = u.nm.replace(/^0+/, '').trim();
        let geocercaActual = "EN RUTA";
        
        // Detección de Polígonos (Turf.js)
        if (geocercasData.features.length > 0) {
            try {
                const pt = point([u.pos.x, u.pos.y]); // [Lon, Lat]
                
                for (const feature of geocercasData.features) {
                    if (feature.geometry && feature.geometry.coordinates) {
                        const poly = polygon(feature.geometry.coordinates);
                        if (booleanPointInPolygon(pt, poly)) {
                            geocercaActual = feature.properties.nombre;
                            break; // Ya encontramos donde está, salimos del bucle
                        }
                    }
                }
            } catch (err) {
                // Si falla el cálculo geométrico, no rompemos todo el proceso
                console.error("Error calculando polígono:", err);
            }
        }

        return {
            bus: nombreLimpio,
            lat: u.pos.y,
            lon: u.pos.x,
            velocidad: u.pos.s,
            curso: u.pos.c,
            estado_geocerca: geocercaActual,
            t: u.pos.t,
            hora_legible: new Date(u.pos.t * 1000).toLocaleTimeString('es-CO', {timeZone: 'America/Bogota'})
        };
    }).filter((u: any) => u !== null);

    res.status(200).json({ 
        total: flotaEnVivo.length, 
        timestamp: new Date().toISOString(),
        buses: flotaEnVivo 
    });

  } catch (e: any) {
    console.error("Error en Live Radar:", e.message);
    res.status(500).json({ error: e.message });
  }
}