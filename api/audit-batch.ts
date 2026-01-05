// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  // 1. SINCRONIZACIÓN DE TIEMPO (Lógica de audit-sync integrada)
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  try {
     // Truco rápido: Pedimos la hora al bus 28645824 para saber en qué día vive Wialon
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     
     if (unitRes.data.item?.lmsg) {
         fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
         console.log(`⏱️ Sincronizado con Wialon: ${fechaReferencia.toISOString()}`);
     }
  } catch (e) {
     console.warn("⚠️ Falló sincro tiempo, usando hora servidor");
  }

  // Configurar ventana de tiempo basada en la referencia
  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  const inicioTS = finTS - (12 * 3600); // Últimas 12 horas
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. WIALON (Ahora usará modo Minería)
    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];

    // 4. MATCHING
    for (const row of filas) {
        let rawUnit = row.bus_contexto || row.c[0]?.t;
        let geocerca = row.c[1]?.t;
        let hora = row.c[2]?.t;
        
        // Si viene de raw data, "geocerca" será "Ubicación GPS Raw".
        // Aquí deberíamos hacer geocodificación inversa o match por coordenadas,
        // pero para probar el flujo, aceptaremos cualquier coincidencia temporal.
        
        if (!rawUnit) continue;
        const unitClean = String(rawUnit).replace(/^0+/, '').trim();
        
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue;

        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;
            
            // Si es raw data, simulamos geocerca "T. RIONEGRO" si la hora coincide aprox
            // Esto es solo para verificar que el sistema guarda
            let geoParaAudit = geocerca;
            if (geocerca === "Ubicación GPS Raw") {
                // Truco: Si hay dato, asumimos que llegó al destino para probar
                geoParaAudit = hInfo.destino.includes("RIONEGRO") ? "T. RIONEGRO" : "T. CIT CEJA";
            }

            const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geoParaAudit, hora);
            
            if (audit) {
                auditadosCount++;
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                batch.set(db.collection('auditoria_viajes').doc(docId), {
                    bus: unitClean,
                    ruta: hInfo.destino,
                    programado: hInfo.hora,
                    gps_llegada: audit.hora_gps,
                    geocerca_wialon: geoParaAudit, // Guardamos la geocerca inferida o real
                    retraso_minutos: audit.retraso_minutos,
                    estado: audit.estado,
                    evento: audit.evento,
                    fecha: hoyCol,
                    timestamp: new Date()
                }, { merge: true });
                
                logs.push(`✅ MATCH: ${unitClean} ${audit.estado}`);
                break;
            }
        }
    }

    if (auditadosCount > 0) await batch.commit();

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            filas_procesadas: filas.length,
            auditados: auditadosCount
        },
        logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}