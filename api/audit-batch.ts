// api/audit-batch.ts - VERSIÓN FINAL LOCAL (Mapa + Salida + Rionegro Fix)
import { supabaseA } from '../lib/supabase';
import { db } from '../lib/firebase';
import { obtenerMensajesRaw } from '../lib/wialon';
import { obtenerCoordenadas, calcularDistancia } from '../lib/config';
import axios from 'axios';

interface Turno {
    vehiculo_id: number;
    horario_id: number;
    fecha?: string;
}
interface Horario {
    id: number;
    hora: string;
    origen: string;
    destino: string;
}

// Interface para el match encontrado
interface MatchData {
    hora_real: string;
    diferencia: number;
    distancia: number;
    estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO";
    lat: number; // Latitud real del evento
    lon: number; // Longitud real del evento
}

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  // 1. Sincronización hora Wialon
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     if (unitRes.data.item?.lmsg) fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
  } catch (e) { console.log("⚠️ Fallo sincro Wialon"); }

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  // Ventana de 26 horas para cubrir el día completo y margen de error
 // Ventana EXACTA de hoy (Desde las 00:00:00 hora Colombia)
  const fechaHoyInicio = new Date(fechaReferencia);
  fechaHoyInicio.setHours(0, 0, 0, 0); // Inicio del día
  
  // Ajuste de zona horaria si el servidor no está en Colombia
  // (Si fechaReferencia ya viene ajustada de Wialon, esto basta)
  const inicioTS = Math.floor(fechaHoyInicio.getTime() / 1000);

  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const fechaHoyLocal = new Date(fechaReferencia.toLocaleString("en-US", {timeZone: "America/Bogota"}));

  try {
    // 2. Obtener Plan de Supabase (Solo hoy)
    console.log(`🔎 Auditando fecha: ${hoyCol}`);
    const { data: plan, error } = await supabaseA
        .from('operacion_diaria')
        .select('vehiculo_id, horario_id, fecha') 
        .eq('fecha', hoyCol);

    if (error || !plan || plan.length === 0) return res.json({ msg: "Sin plan hoy" });
    console.log(`📊 Plan: ${plan.length} viajes.`);

    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');
    
    // 3. Mapeo de IDs Wialon
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    
    const searchRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1,"from":0,"to":5000}&sid=${sid}`);
    
    const wialonUnitsMap: Record<string, number> = {};
    if (searchRes.data.items) {
        searchRes.data.items.forEach((u: any) => {
             const cleanName = u.nm.replace(/^0+/, '').trim();
             wialonUnitsMap[cleanName] = u.id;
        });
    }
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const busesEnPlan = [...new Set(plan.map((p: any) => {
        const v = vehiculos?.find((v: any) => v.id === p.vehiculo_id);
        return v ? String(v.numero_interno) : null;
    }))].filter(x => x);

    const idsParaConsultar = busesEnPlan.map(num => wialonUnitsMap[num as string]).filter(x => x);
    const trazasGPS = await obtenerMensajesRaw(idsParaConsultar, inicioTS, finTS);

    // 4. Proceso de Auditoría
    let auditados = 0;
    const logs: string[] = [];
    const planTipado = plan as Turno[];

    for (const turno of planTipado) {
        const vInfo = vehiculos?.find((v: any) => v.id === turno.vehiculo_id);
        const hInfo = horarios?.find((h: any) => h.id === turno.horario_id) as Horario;
        if (!vInfo || !hInfo) continue;
        
        const numBus = String(vInfo.numero_interno);
        const esRionegro = hInfo.origen.toUpperCase().includes("RIO") || hInfo.origen.toUpperCase().includes("NEGRO");

        const wialonID = wialonUnitsMap[numBus];
        if (!wialonID) continue;

        const traza = trazasGPS.find((t: any) => t.unitId === wialonID);
        if (!traza || !traza.messages || traza.messages.length === 0) continue;

        const coordsOrigen = obtenerCoordenadas(hInfo.origen || "");
        if (!coordsOrigen) {
             if (esRionegro) console.log(`🕵️ RIONEGRO ERROR: No hay coords para "${hInfo.origen}"`);
             continue;
        }

        const [hP, mP] = hInfo.hora.split(':').map(Number);
        const minutosProg = hP * 60 + mP;
        
        // Ordenamos mensajes por tiempo
        const mensajesOrdenados = traza.messages.sort((a: any, b: any) => a.t - b.t);
        
        // 🔥 RADIO DE 150 METROS (Confirmado para Bahía -> Salida)
        const RADIO_TOLERANCIA_METROS = 150; 

        let mejorMatch: MatchData | null = null;
        let ultimoPuntoAdentro = null;
        let minimaDistancia = 99999;

        for (const msg of mensajesOrdenados) {
            if (!msg.pos) continue;

            // Filtro de fecha: Ignora mensajes de ayer
            const fechaGPS = new Date(msg.t * 1000);
            const fechaGPSLocal = new Date(fechaGPS.toLocaleString("en-US", {timeZone: "America/Bogota"}));
            if (fechaGPSLocal.getDate() !== fechaHoyLocal.getDate()) continue;

            const dist = calcularDistancia(msg.pos.y, msg.pos.x, coordsOrigen.lat, coordsOrigen.lon);
            if(dist < minimaDistancia) minimaDistancia = dist;

            const estaAdentro = dist <= RADIO_TOLERANCIA_METROS;

            let horasGPS = fechaGPS.getUTCHours() - 5;
            if (horasGPS < 0) horasGPS += 24;
            const minutosGPS = horasGPS * 60 + fechaGPS.getUTCMinutes();

            // Ventana de búsqueda alrededor del turno (-30 a +120 min)
            if (minutosGPS < (minutosProg - 30) || minutosGPS > (minutosProg + 120)) continue;

            if (estaAdentro) {
                // El bus está en la bahía
                ultimoPuntoAdentro = {
                    t: msg.t,
                    minutos: minutosGPS,
                    distancia: dist,
                    lat: msg.pos.y, // Guardamos coords para el mapa
                    lon: msg.pos.x,
                    hora_formato: `${horasGPS.toString().padStart(2,'0')}:${fechaGPS.getUTCMinutes().toString().padStart(2,'0')}:00`
                };
            } else {
                // El bus acaba de salir (estaba adentro, ahora está afuera)
                if (ultimoPuntoAdentro) {
                    const saltoTiempo = msg.t - ultimoPuntoAdentro.t;
                    // Solo validamos si salió hace menos de 15 min (evita falsos positivos por pérdida de señal)
                    if (saltoTiempo < 900) { 
                        const diffReal = ultimoPuntoAdentro.minutos - minutosProg;
                        let estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO" = "A TIEMPO";
                        if (diffReal > 5) estado = "RETRASADO";
                        if (diffReal < -10) estado = "ADELANTADO";

                        mejorMatch = {
                            hora_real: ultimoPuntoAdentro.hora_formato,
                            diferencia: diffReal,
                            distancia: Math.round(ultimoPuntoAdentro.distancia),
                            estado: estado,
                            lat: ultimoPuntoAdentro.lat, // Coordenada real de la salida
                            lon: ultimoPuntoAdentro.lon
                        };
                        break; // Salida encontrada, paramos.
                    }
                    ultimoPuntoAdentro = null;
                }
            }
        }
        
        // --- 🕵️ DIAGNÓSTICO RIONEGRO ---
        if (esRionegro && !mejorMatch) {
            console.log(`🕵️ RIONEGRO ALERTA: Bus ${numBus} (${hInfo.hora}). Min Dist: ${Math.round(minimaDistancia)}m.`);
        }

        if (mejorMatch) {
            auditados++;
            const docId = `${numBus}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
            
            await db.collection('auditoria_viajes').doc(docId).set({
                bus: numBus,
                origen_programado: hInfo.origen,
                destino_programado: hInfo.destino,
                programado: hInfo.hora,
                gps_salida_detectada: mejorMatch.hora_real,
                geocerca_origen: coordsOrigen.nombre,
                distancia_metros: mejorMatch.distancia,
                retraso_minutos: mejorMatch.diferencia,
                estado: mejorMatch.estado,
                
                // COORDENADAS PARA EL MAPA
                latitud_real: mejorMatch.lat, 
                longitud_real: mejorMatch.lon,

                evento: "SALIDA",
                fecha: hoyCol,
                timestamp: new Date(),
                origen_datos: "RAW_GPS_FINAL_150m"
            }, { merge: true });

            logs.push(`✅ ${numBus} SALIÓ ${mejorMatch.hora_real}`);
        }
    }

    return res.json({ success: true, resumen: { auditados }, logs: logs.slice(0, 50) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}