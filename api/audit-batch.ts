// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  // 1. SINCRONIZACIÓN DE TIEMPO
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     // Usamos un bus conocido para sincronizar fecha
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     
     if (unitRes.data.item?.lmsg) {
         fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
     }
  } catch (e) {
     console.warn("⚠️ Falló sincro tiempo");
  }

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  // Reducimos ventana a 6 horas para ser más precisos y rápidos
  const inicioTS = finTS - (12 * 3600); 
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. WIALON (Minería de Datos Crudos con Lat/Lon)
    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const logs: string[] = [];
    const errores: string[] = [];

    // 4. MATCHING GEOGRÁFICO REAL
    for (const row of filas) {
        let rawUnit = row.bus_contexto || row.c[0]?.t;
        let hora = row.c[2]?.t;
        // Obtenemos coordenadas crudas del mensaje
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

            // EL JUEZ 2.0: Ahora valida distancia geográfica
            const audit = auditarMovimiento(
                hInfo.destino, 
                hInfo.hora, 
                lat,
                lon,
                hora
            );
            
            if (audit) {
                // SI ENTRA AQUÍ, ES PORQUE EL BUS ESTABA REALMENTE CERCA DE LA TERMINAL
                auditadosCount++;
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                try {
                    await db.collection('auditoria_viajes').doc(docId).set({
                        bus: unitClean,
                        ruta: hInfo.destino,
                        programado: hInfo.hora,
                        gps_llegada: audit.hora_gps,
                        geocerca_detectada: audit.punto,
                        distancia_metros: audit.distancia_punto, // Dato útil para calibrar
                        retraso_minutos: audit.retraso_minutos,
                        estado: audit.estado,
                        fecha: hoyCol,
                        timestamp: new Date(),
                        tipo: "GEO-VALIDADO"
                    }, { merge: true });
                    
                    logs.push(`📍 VALIDADO: Bus ${unitClean} a ${audit.distancia_punto}m de ${audit.punto} | ${audit.estado}`);
                } catch (writeError: any) {
                    errores.push(`Error doc ${docId}: ${writeError.message}`);
                }
                
                break; 
            }
        }
    }

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            puntos_gps_analizados: filas.length,
            validaciones_geograficas_exitosas: auditadosCount
        },
        logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}