import axios from 'axios';
import { supabaseA } from '../lib/supabase'; 
// @ts-ignore
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
// @ts-ignore
import { point, polygon } from '@turf/helpers';
import fs from 'fs';
import path from 'path';

// 1. FLOTA COMPLETA
const FLOTA_PERMITIDA: Record<string, string> = {
  "101": "Buseta", "9": "Vans", "6": "Vans", "102": "Bus", "103": "Bus", "104": "Bus", "105": "Buseta",
  "106": "Buseta", "107": "Bus", "108": "Bus", "109": "Bus", "110": "Bus",
  "111": "Buseta", "112": "Bus", "113": "Bus", "114": "Bus", "115": "Bus",
  "116": "Bus", "117": "Buseta", "118": "Bus", "119": "Bus", "120": "Bus",
  "121": "Buseta", "122": "Bus", "123": "Bus", "124": "Buseta", "125": "Bus",
  "126": "Bus", "127": "Bus", "128": "Buseta", "129": "Bus", "130": "Bus",
  "131": "Bus", "132": "Bus", "133": "Buseta", "134": "Buseta", "135": "Bus",
  "136": "Bus", "137": "Bus", "138": "Bus", "139": "Bus", "140": "Buseta",
  "141": "Buseta", "142": "Buseta", "143": "Buseta", "144": "Bus", "145": "Bus",
  "146": "Bus", "147": "Bus", "148": "Buseta", "149": "Buseta", "150": "Buseta",
  "151": "Microbus", "152": "Microbus", "153": "Microbus", "154": "Microbus", "155": "Microbus",
  "156": "Microbus", "157": "Bus", "158": "Microbus", "159": "Microbus", "160": "Microbus",
  "161": "Microbus", "162": "Microbus", "163": "Microbus", "164": "Microbus", "165": "Microbus",
  "166": "Microbus", "167": "Microbus", "168": "Microbus", "169": "Buseta", "170": "Microbus",
  "171": "Bus", "172": "Microbus", "173": "Bus", "174": "Bus", "175": "Bus",
  "176": "Bus", "177": "Buseta", "178": "Microbus", "179": "Microbus", "180": "Microbus",
  "181": "Microbus", "182": "Microbus", "183": "Microbus", "184": "Buseta", "185": "Microbus",
  "186": "Microbus", "187": "Microbus", "188": "Microbus", "189": "Microbus", "190": "Microbus",
  "191": "Microbus", "192": "Microbus", "193": "Microbus", "194": "Microbus", "195": "Microbus",
  "196": "Microbus", "197": "Bus", "198": "Microbus",
  "1": "Vans", "2": "Vans", "3": "Vans", "4": "Vans", "5": "Vans", "7": "Vans", "8": "Vans"
};

// 2. GEOCERCAS
let geocercasData: any = { features: [] };
try {
    const ruta1 = path.join(process.cwd(), 'geocercas.json');
    if (fs.existsSync(ruta1)) geocercasData = JSON.parse(fs.readFileSync(ruta1, 'utf8'));
} catch (e) {}

// CACHÉ DE DATOS SUPABASE
let cacheTurnos: any[] = [];
let lastCacheTime = 0;

async function obtenerTurnosDelDia() {
    const now = Date.now();
    if (cacheTurnos.length > 0 && (now - lastCacheTime < 120000)) return cacheTurnos;

    const hoyStr = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
    
    // Consulta con relación PROFUNDA
    const { data } = await supabaseA
        .from('operacion_diaria')
        .select(`
            vehiculo_id,
            horario_id,
            tabla_original_id,
            Vehículos!inner(numero_interno),
            Horarios!inner(
                hora, 
                origen, 
                destino,
                tabla_rodamiento(descripcion)
            )
        `)
        .eq('fecha', hoyStr);
    
    // Aplanamos el resultado para que sea fácil de usar
    if (data) {
        cacheTurnos = data.map((t: any) => {
            const hObj = t.Horarios;
            // Buscamos tabla en Horarios
            const tablaObj = hObj?.tabla_rodamiento;
            const nombreTabla = Array.isArray(tablaObj) ? tablaObj[0]?.descripcion : tablaObj?.descripcion;

            return {
                bus: String(t.Vehículos?.numero_interno),
                hora: hObj?.hora,
                origen: hObj?.origen,
                destino: hObj?.destino,
                tabla: nombreTabla || "Sin Asignar",
                // Minutos del día para ordenar
                minutos: hObj?.hora ? 
                    parseInt(hObj.hora.split(':')[0])*60 + parseInt(hObj.hora.split(':')[1]) : 0
            };
        });
    }
    
    lastCacheTime = now;
    return cacheTurnos;
}

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  
  try {
    // 1. OBTENER PLAN DEL DÍA
    const turnosHoy = await obtenerTurnosDelDia();

    // 2. OBTENER POSICIONES GPS EN VIVO
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    const searchRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1025,"from":0,"to":0}&sid=${sid}`);
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const unidades = searchRes.data.items || [];
    
    // 3. PROCESAMIENTO
    const ahora = new Date();
    const ahoraCol = new Date(ahora.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const minutosAhora = ahoraCol.getHours() * 60 + ahoraCol.getMinutes();

    const flotaEnVivo = unidades.map((u: any) => {
        if (!u.pos) return null;
        const nombreLimpio = u.nm.replace(/^0+/, '').trim();
        const tipoVehiculo = FLOTA_PERMITIDA[nombreLimpio];
        
        if (!tipoVehiculo) return null; 

        // --- BUSCAR TURNO ACTIVO (LÓGICA MEJORADA) ---
        let infoTurno = {
            tabla: "Sin Asignar",
            ruta: "Sin Ruta",
            hora_salida: "--:--",
            tiempo_viaje: "Inactivo"
        };

        const turnosBus = turnosHoy.filter((t: any) => t.bus === nombreLimpio);
        
        if (turnosBus.length > 0) {
            // Ordenar por hora
            turnosBus.sort((a: any, b: any) => a.minutos - b.minutos);

            let turnoActivo = null;
            let menorDiferencia = 99999;

            // Buscamos el turno cuya hora de salida esté más cerca de AHORA
            for (const t of turnosBus) {
                const diff = Math.abs(t.minutos - minutosAhora);
                
                // Si la diferencia es menor y está dentro de una ventana razonable (4 horas)
                if (diff < menorDiferencia && diff < 240) { 
                    menorDiferencia = diff;
                    turnoActivo = t;
                }
            }

            if (turnoActivo) {
                const diff = minutosAhora - turnoActivo.minutos;
                const textoTiempo = diff >= 0 ? `Viajando hace ${diff} min` : `Sale en ${Math.abs(diff)} min`;

                infoTurno = {
                    tabla: turnoActivo.tabla, 
                    ruta: `${turnoActivo.origen} ➝ ${turnoActivo.destino}`,
                    hora_salida: turnoActivo.hora,
                    tiempo_viaje: textoTiempo
                };
            }
        }

        // --- DETECCIÓN DE GEOCERCA ---
        let geocercaActual = "EN RUTA";
        if (geocercasData.features.length > 0) {
            try {
                const pt = point([u.pos.x, u.pos.y]);
                for (const feature of geocercasData.features) {
                    if (booleanPointInPolygon(pt, polygon(feature.geometry.coordinates))) {
                        geocercaActual = feature.properties.nombre;
                        break;
                    }
                }
            } catch (e) {}
        }

        return {
            bus: nombreLimpio,
            tipo: tipoVehiculo,
            lat: u.pos.y,
            lon: u.pos.x,
            velocidad: u.pos.s,
            estado_geocerca: geocercaActual,
            
            // DATOS ENRIQUECIDOS
            tabla: infoTurno.tabla, 
            ruta: infoTurno.ruta,
            hora_salida: infoTurno.hora_salida,
            estado_tiempo: infoTurno.tiempo_viaje
        };
    }).filter((u: any) => u !== null);

    res.status(200).json({ total: flotaEnVivo.length, buses: flotaEnVivo });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}