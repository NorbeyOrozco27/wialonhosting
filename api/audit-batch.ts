// api/audit-batch.ts - VERSIÓN CORREGIDA Y COMPLETA
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';
import { calcularDistancia, RUTAS_MAESTRAS, identificarRuta } from '../lib/config.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  // 1. SINCRONIZACIÓN DE TIEMPO AUTOMÁTICA
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
  const inicioTS = finTS - (12 * 3600); // 12 horas atrás
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. OBTENER DATOS DE SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. OBTENER DATOS DE WIALON (MINERÍA)
    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const logs: string[] = [];
    const errores: string[] = [];

    // 4. PROCESAMIENTO
    for (const row of filas) {
        let rawUnit = row.bus_contexto || row.c[0]?.t;
        let hora = row.c[2]?.t;
        let lat = row.lat; 
        let lon = row.lon;
        
        if (!rawUnit || !lat || !lon) continue;

        const unitClean = String(rawUnit).replace(/^0+/, '').trim();
        
        // Buscar vehículo
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue;

        // Buscar turnos
        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;

            const categoria = identificarRuta(hInfo.destino);
            if (categoria) {
                const config = RUTAS_MAESTRAS[categoria];
                const cp = config.checkpoints[config.checkpoints.length - 1]; // Destino final
                
                // Calcular distancia real
                const dist = calcularDistancia(lat, lon, cp.lat, cp.lon);
                
                // 5. VERIFICACIÓN CON RAYOS X (Logs detallados)
                if (dist < 5000) { // Si está a menos de 5km
                    
                    // LOG IMPORTANTE: El bus está cerca
                    logs.push(`🔍 CERCA: Bus ${unitClean} a ${Math.round(dist)}m de ${cp.nombre}. Plan: ${hInfo.hora} | GPS: ${hora}`);

                    // Intentar auditar (verificar tiempos)
                    const audit = auditarMovimiento(hInfo.destino, hInfo.hora, lat, lon, hora);
                    
                    if (!audit) {
                        // LOG IMPORTANTE: Por qué falló el tiempo
                        logs.push(`⚠️ DESCARTADO: ${unitClean} (Cerca) - Diferencia de hora muy grande.`);
                    } else {
                        // ÉXITO
                        auditadosCount++;
                        const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                        
                        try {
                            await db.collection('auditoria_viajes').doc(docId).set({
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
                                timestamp: new Date(),
                                origen_datos: "API Vercel"
                            }, { merge: true });
                            
                            logs.push(`✅ GUARDADO: ${unitClean} | ${audit.estado} | ${audit.retraso_minutos}min`);
                        } catch (writeError: any) {
                            errores.push(`Error Firebase: ${writeError.message}`);
                        }
                        
                        break; // Ya encontramos el match para este punto GPS
                    }
                }
            }
        }
    }

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            filas_procesadas: filas.length,
            auditados: auditadosCount
        },
        logs: logs.slice(0, 100), // Mostramos hasta 100 logs para ver bien
        errores: errores
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}