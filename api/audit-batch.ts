// api/audit-batch.ts - VERSIÓN ESCRITURA DIRECTA (SEGURA)
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  // 1. SINCRONIZACIÓN DE TIEMPO
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     
     if (unitRes.data.item?.lmsg) {
         fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
     }
  } catch (e) {
     console.warn("⚠️ Falló sincro tiempo, usando hora servidor");
  }

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  const inicioTS = finTS - (12 * 3600); 
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. WIALON
    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const logs: string[] = [];
    const errores: string[] = [];

    // 4. MATCHING Y GUARDADO DIRECTO
    for (const row of filas) {
        let rawUnit = row.bus_contexto || row.c[0]?.t;
        let geocerca = row.c[1]?.t;
        let hora = row.c[2]?.t;
        
        if (!rawUnit) continue;
        const unitClean = String(rawUnit).replace(/^0+/, '').trim();
        
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue;

        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;
            
            // Simulación de geocerca para Raw Data si es necesario
            let geoParaAudit = geocerca;
            if (geocerca === "Ubicación GPS Raw") {
                geoParaAudit = hInfo.destino.includes("RIONEGRO") ? "T. RIONEGRO" : "T. CIT CEJA";
            }

            const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geoParaAudit, hora);
            
            if (audit) {
                auditadosCount++;
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                try {
                    // --- CAMBIO IMPORTANTE: ESCRITURA DIRECTA AWAIT ---
                    await db.collection('auditoria_viajes').doc(docId).set({
                        bus: unitClean,
                        ruta: hInfo.destino,
                        programado: hInfo.hora,
                        gps_llegada: audit.hora_gps,
                        geocerca_wialon: geoParaAudit,
                        retraso_minutos: audit.retraso_minutos,
                        estado: audit.estado,
                        evento: audit.evento,
                        fecha: hoyCol,
                        timestamp: new Date(),
                        origen_datos: "API Vercel"
                    }, { merge: true });
                    
                    logs.push(`✅ GUARDADO: Bus ${unitClean} | ${audit.estado}`);
                } catch (writeError: any) {
                    console.error(`❌ Error guardando ${docId}:`, writeError);
                    errores.push(`Error doc ${docId}: ${writeError.message}`);
                }
                
                break; // Pasamos al siguiente mensaje de Wialon
            }
        }
    }

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            filas_procesadas: filas.length,
            intentos_guardado: auditadosCount,
            errores_guardado: errores.length
        },
        logs: logs.slice(0, 50),
        errores: errores
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}