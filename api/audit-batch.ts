// api/audit-batch.ts - CORREGIDO (Match de nombres y Lógica de Origen)
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
// CORRECCIÓN AQUÍ: Importamos la función correcta para datos crudos
import { obtenerMensajesRaw } from '../lib/wialon.js'; 
import { auditarMovimiento } from '../lib/util.js';
import { calcularDistancia, obtenerCoordenadas } from '../lib/config.js'; // Asegúrate que config.ts tenga obtenerCoordenadas
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  // 1. Sincronización de Hora (Wialon vs Servidor)
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     if (unitRes.data.item?.lmsg) fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
  } catch (e) {}

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  const inicioTS = finTS - (24 * 3600); 
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. OBTENER PLAN (Incluyendo ORIGEN)
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. MAPEO DE IDS WIALON (Necesario para Raw Data)
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    
    // Traemos todos los buses para saber sus IDs internos
    const searchRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1,"from":0,"to":5000}&sid=${sid}`);
    
    const wialonUnitsMap: Record<string, number> = {};
    if (searchRes.data.items) {
        searchRes.data.items.forEach((u: any) => {
             const cleanName = u.nm.replace(/^0+/, '').trim();
             wialonUnitsMap[cleanName] = u.id;
        });
    }
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 4. DESCARGAR TRAZAS GPS (Usando obtenerMensajesRaw)
    const busesEnPlan = [...new Set(plan.map(p => {
        const v = vehiculos?.find(v => v.id === p.vehiculo_id);
        return v ? String(v.numero_interno) : null;
    }))].filter(x => x);

    const idsParaConsultar = busesEnPlan.map(num => wialonUnitsMap[num as string]).filter(x => x);
    
    // Aquí usamos la función correcta importada de wialon.ts
    const trazasGPS = await obtenerMensajesRaw(idsParaConsultar, inicioTS, finTS);

    // 5. AUDITORÍA (Cruzando Plan vs GPS Raw)
    let auditados = 0;
    const logs: string[] = [];

    for (const turno of plan) {
        const vInfo = vehiculos?.find(v => v.id === turno.vehiculo_id);
        const hInfo = horarios?.find(h => h.id === turno.horario_id);
        
        if (!vInfo || !hInfo) continue;
        
        const numBus = String(vInfo.numero_interno);
        const wialonID = wialonUnitsMap[numBus];
        if (!wialonID) continue;

        const traza = trazasGPS.find((t: any) => t.unitId === wialonID);
        if (!traza || !traza.messages || traza.messages.length === 0) continue;

        // AUDITAR SALIDA (ORIGEN)
        const audit = auditarMovimiento(
            hInfo.origen, // Validamos el ORIGEN
            hInfo.hora, 
            0, 0, "" // Placeholder inicial
        );
        
        // Si no podemos identificar el origen, saltamos
        if (!audit) continue; 
        
        // Buscamos manualmente en la traza GPS
        // Necesitamos encontrar el punto GPS más cercano al ORIGEN a la hora programada
        const coordsOrigen = obtenerCoordenadas(hInfo.origen);
        if (!coordsOrigen) continue;

        let mejorMatch = null;
        let menorDistancia = 999999;
        
        // Convertir hora programada a minutos del día
        const [hP, mP] = hInfo.hora.split(':').map(Number);
        const minutosProg = hP * 60 + mP;

        for (const msg of traza.messages) {
            if (!msg.pos) continue;

            // Hora GPS (Corregida a Colombia -5)
            const fechaGPS = new Date(msg.t * 1000);
            let horasGPS = fechaGPS.getUTCHours() - 5;
            if (horasGPS < 0) horasGPS += 24;
            const minutosGPS = horasGPS * 60 + fechaGPS.getUTCMinutes();

            // Ventana de tiempo: Buscamos si el bus estuvo en el origen +/- 90 min de la hora de salida
            if (Math.abs(minutosGPS - minutosProg) > 90) continue;

            const dist = calcularDistancia(msg.pos.y, msg.pos.x, coordsOrigen.lat, coordsOrigen.lon);

            // Si está en el radio de la terminal (ej: 800m)
            if (dist < 800) {
                // Buscamos el momento en que estuvo MÁS CERCA o el primero que entró
                if (dist < menorDistancia) {
                    menorDistancia = dist;
                    mejorMatch = {
                        hora_real: `${horasGPS.toString().padStart(2,'0')}:${fechaGPS.getUTCMinutes().toString().padStart(2,'0')}:00`,
                        diferencia: minutosGPS - minutosProg,
                        distancia: Math.round(dist)
                    };
                }
            }
        }

        if (mejorMatch) {
            auditados++;
            const estado = mejorMatch.diferencia > 5 ? "RETRASADO" : (mejorMatch.diferencia < -10 ? "ADELANTADO" : "A TIEMPO");
            
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
                estado: estado,
                evento: "SALIDA",
                fecha: hoyCol,
                timestamp: new Date(),
                origen_datos: "RAW_GPS"
            }, { merge: true });

            logs.push(`✅ SALIDA: ${numBus} desde ${hInfo.origen} | Prog: ${hInfo.hora}, Real: ${mejorMatch.hora_real} (${estado})`);
        }
    }

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            buses_con_plan: busesEnPlan.length,
            buses_con_gps: trazasGPS.length,
            auditorias_generadas: auditados
        },
        logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}