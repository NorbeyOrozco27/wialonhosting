// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
// IMPORTANTE: Aquí importamos lo que acabamos de exportar en util.ts
import { auditarMovimiento } from '../lib/util.js';
import { calcularDistancia, RUTAS_MAESTRAS, identificarRuta } from '../lib/config.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  // ... (Aquí va el código del Modo Rastreador que te pasé en la respuesta anterior)
  // Te lo resumo para que compile, pero usa la lógica completa del "Modo Rastreador"
  
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     if (unitRes.data.item?.lmsg) fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
  } catch (e) {}

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  const inicioTS = finTS - (12 * 3600); 
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];
    const rastreo: string[] = [];

    for (const row of filas) {
        let rawUnit = row.bus_contexto || row.c[0]?.t;
        let hora = row.c[2]?.t;
        let lat = row.lat; 
        let lon = row.lon;
        
        if (!rawUnit || !lat || !lon) continue;

        const unitClean = String(rawUnit).replace(/^0+/, '').trim();
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue;

        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;

            // RASTREO PARA DEBUG
            const categoria = identificarRuta(hInfo.destino);
            if (categoria) {
                const config = RUTAS_MAESTRAS[categoria];
                const cp = config.checkpoints[config.checkpoints.length - 1];
                const dist = calcularDistancia(lat, lon, cp.lat, cp.lon);
                
                if (dist < 10000 && rastreo.length < 50) { // Loguear si está a menos de 10km
                     rastreo.push(`Bus ${unitClean} a ${Math.round(dist)}m de ${cp.nombre} (Destino: ${hInfo.destino})`);
                }
            }

            // AUDITORÍA
            const audit = auditarMovimiento(hInfo.destino, hInfo.hora, lat, lon, hora);
            
            if (audit) {
                auditadosCount++;
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                batch.set(db.collection('auditoria_viajes').doc(docId), {
                    bus: unitClean,
                    ruta: hInfo.destino,
                    programado: hInfo.hora,
                    gps_llegada: audit.hora_gps,
                    geocerca_detectada: audit.punto,
                    distancia_metros: audit.distancia_punto,
                    retraso_minutos: audit.retraso_minutos,
                    estado: audit.estado,
                    evento: audit.evento,
                    fecha: hoyCol,
                    timestamp: new Date()
                }, { merge: true });
                
                logs.push(`✅ MATCH: ${unitClean} | ${audit.estado}`);
                break; 
            }
        }
    }

    if (auditadosCount > 0) await batch.commit();

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            filas: filas.length,
            auditados: auditadosCount
        },
        RASTREO_GPS: rastreo,
        logs: logs
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}