// api/audit-batch.ts - VERSIÓN FINAL CORREGIDA
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. CALCULAR FECHA Y TIEMPO REAL COLOMBIA
  const ahora = new Date();
  const hoyCol = ahora.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  
  // Rango Wialon: Últimas 4 horas
  const inicioTS = Math.floor(ahora.getTime() / 1000) - (4 * 3600);
  const finTS = Math.floor(ahora.getTime() / 1000);

  try {
    // 2. DESCARGA MAESTRA DE SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);
    
    const { data: vehiculos } = await supabaseA.from('Vehículos')
      .select('id, numero_interno');
    
    const { data: horarios } = await supabaseA.from('Horarios')
      .select('id, hora, destino');

    if (!plan || plan.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: `No hay turnos en Supabase para ${hoyCol}`
      });
    }

    // 3. COSECHAR WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();
    const geocercasEncontradas = new Set();
    const unidadesProcesadas = new Set();
    const logs = [];

    for (const row of filas) {
      try {
        const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
        const geocercaWialon = row.c?.[1]?.t || row.c?.[1] || "";
        const horaGps = row.c?.[2]?.t || "";
        
        if (!unitVal || String(unitVal).includes("Total") || !horaGps || !geocercaWialon) continue;

        geocercasEncontradas.add(geocercaWialon);
        const unitClean = String(unitVal).replace(/^0+/, '');
        
        // BUSCAR VEHÍCULO
        const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
        
        if (!vInfo) {
          logs.push(`❌ No encontrado en Supabase: ${unitClean}`);
          continue;
        }

        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);
        if (turnosBus.length === 0) {
          logs.push(`⚠️ Bus ${unitClean} no tiene turnos hoy`);
          continue;
        }

        let auditadoEnEsteCiclo = false;
        
        for (const tAsignado of turnosBus) {
          const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
          if (!hInfo) continue;

          const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geocercaWialon, horaGps);
          
          if (audit) {
            auditadosCount++;
            unidadesProcesadas.add(unitClean);
            
            const idComp = hInfo.hora.substring(0,5).replace(/:/g, '');
            const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;
            
            batch.set(db.collection('auditoria_viajes').doc(docId), {
              bus: unitClean,
              ruta: hInfo.destino,
              programado: hInfo.hora,
              gps_llegada: audit.hora_gps,
              geocerca_wialon: geocercaWialon,
              evento: audit.evento,
              retraso_minutos: audit.retraso_minutos,
              estado: audit.estado,
              fecha: hoyCol,
              timestamp: new Date()
            }, { merge: true });
            
            logs.push(`✅ AUDITADO: ${unitClean} - ${hInfo.destino} - ${hInfo.hora} → ${geocercaWialon} (${audit.estado})`);
            auditadoEnEsteCiclo = true;
            break;
          }
        }
        
        if (!auditadoEnEsteCiclo) {
          logs.push(`⏩ No match para ${unitClean} en ${geocercaWialon} a las ${horaGps}`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logs.push(`🔥 Error procesando fila: ${errorMessage}`);
      }
    }

    // EJECUTAR BATCH
    if (auditadosCount > 0) {
      try {
        await batch.commit();
        logs.push(`📦 Batch commit exitoso: ${auditadosCount} registros`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logs.push(`❌ Error en batch commit: ${errorMessage}`);
      }
    }

    return res.status(200).json({ 
      success: true, 
      resumen: {
        fecha: hoyCol,
        en_supabase: plan.length,
        en_wialon: filas.length,
        auditados_final: auditadosCount,
        buses_procesados: Array.from(unidadesProcesadas),
        geocercas_detectadas: Array.from(geocercasEncontradas)
      },
      logs: logs.slice(0, 20)
    });

  } catch (e: any) {
    return res.status(200).json({ 
      success: false, 
      error: e.message
    });
  }
}