// api/audit-batch.ts - VERSIÓN CON DIAGNÓSTICO MEJORADO
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. CALCULAR FECHA Y TIEMPO REAL COLOMBIA
  const ahora = new Date();
  const hoyCol = ahora.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  
  // Rango Wialon: Últimas 24 horas para asegurar datos
  const inicioTS = Math.floor(ahora.getTime() / 1000) - (24 * 3600);
  const finTS = Math.floor(ahora.getTime() / 1000);

  console.log(`📊 AUDIT-BATCH: Iniciando para fecha ${hoyCol}, rango ${inicioTS} a ${finTS}`);

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
        msg: `No hay turnos en Supabase para ${hoyCol}`,
        diagnostico: { hora_actual: ahora.toISOString() }
      });
    }

    console.log(`📊 SUPABASE: ${plan.length} turnos, ${vehiculos?.length || 0} vehículos, ${horarios?.length || 0} horarios`);

    // 3. COSECHAR WIALON
    console.log("📊 WIALON: Solicitando datos...");
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    console.log("📊 WIALON: Datos recibidos, tipo:", typeof dataWialon);
    console.log("📊 WIALON: Es array?:", Array.isArray(dataWialon));
    
    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    console.log(`📊 WIALON: ${filas.length} filas recibidas`);

    // 4. DIAGNÓSTICO DETALLADO DE ESTRUCTURA
    const diagnostico = [];
    if (filas.length > 0) {
      for (let i = 0; i < Math.min(filas.length, 5); i++) {
        const row = filas[i];
        diagnostico.push({
          indice: i,
          tipo: typeof row,
          es_array: Array.isArray(row),
          keys: row && typeof row === 'object' ? Object.keys(row) : [],
          valor_completo: JSON.stringify(row, null, 2).substring(0, 500)
        });
        
        // Intentar extraer datos para ver estructura
        if (row && row.c && Array.isArray(row.c)) {
          console.log(`📊 Fila ${i} tiene propiedad 'c' con ${row.c.length} elementos`);
          row.c.forEach((celda: any, idx: number) => {
            console.log(`   Celda ${idx}:`, JSON.stringify(celda));
          });
        } else if (Array.isArray(row)) {
          console.log(`📊 Fila ${i} es array directo:`, row);
        }
      }
    }

    // 5. PROCESAR FILAS CON MÚLTIPLES ESTRUCTURAS POSIBLES
    let auditadosCount = 0;
    const batch = db.batch();
    const geocercasEncontradas = new Set();
    const unidadesProcesadas = new Set();
    const logs = [];

    for (let i = 0; i < filas.length; i++) {
      const row = filas[i];
      
      try {
        // DIFERENTES ESTRUCTURAS POSIBLES DE WIALON
        
        // Estructura 1: { c: [{t: "valor"}, {t: "valor"}] } - MÁS COMÚN
        let unitVal = "";
        let geocercaWialon = "";
        let horaGps = "";
        
        if (row && row.c && Array.isArray(row.c)) {
          // Wialon usa objetos con propiedad 't' para texto
          unitVal = row.c[0]?.t || row.c[0] || "";
          geocercaWialon = row.c[1]?.t || row.c[1] || "";
          horaGps = row.c[2]?.t || row.c[2] || "";
        }
        // Estructura 2: Array directo ["valor1", "valor2", "valor3"]
        else if (Array.isArray(row)) {
          unitVal = row[0] || "";
          geocercaWialon = row[1] || "";
          horaGps = row[2] || "";
        }
        // Estructura 3: Objeto con propiedades específicas
        else if (row && typeof row === 'object') {
          unitVal = row.unidad || row.unit || row.vehicle || "";
          geocercaWialon = row.geocerca || row.geofence || row.zona || "";
          horaGps = row.hora || row.time || row.timestamp || "";
        }
        
        // VALIDAR DATOS EXTRAÍDOS
        if (!unitVal || !geocercaWialon || !horaGps) {
          logs.push(`⚠️ Fila ${i}: Datos incompletos - Unit: "${unitVal}", Geo: "${geocercaWialon}", Hora: "${horaGps}"`);
          continue;
        }
        
        // Saltar filas de totales
        if (String(unitVal).includes("Total") || String(unitVal).includes("TOTAL")) {
          continue;
        }
        
        // LIMPIAR ID DEL BUS
        const unitClean = String(unitVal).replace(/^0+/, '');
        geocercasEncontradas.add(geocercaWialon);
        
        // BUSCAR EN SUPABASE
        const vInfo = vehiculos?.find(v => {
          const numInt = String(v.numero_interno).trim();
          return numInt === unitClean;
        });
        
        if (!vInfo) {
          logs.push(`❌ Bus ${unitClean} (original: ${unitVal}) no encontrado en Supabase`);
          continue;
        }
        
        // OBTENER TURNOS DEL BUS
        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);
        
        if (turnosBus.length === 0) {
          logs.push(`⚠️ Bus ${unitClean} no tiene turnos programados hoy`);
          continue;
        }
        
        // PROCESAR CADA TURNO
        let auditado = false;
        
        for (const tAsignado of turnosBus) {
          const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
          if (!hInfo) continue;
          
          const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geocercaWialon, horaGps);
          
          if (audit) {
            auditadosCount++;
            unidadesProcesadas.add(unitClean);
            
            const idComp = hInfo.hora.substring(0, 5).replace(/:/g, '');
            const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${idComp}`;
            
            batch.set(db.collection('auditoria_viajes').doc(docId), {
              bus: unitClean,
              ruta: hInfo.destino,
              programado: hInfo.hora,
              gps_llegada: audit.hora_gps,
              geocerca_wialon: geocercaWialon,
              retraso_minutos: audit.retraso_minutos,
              estado: audit.estado,
              evento: audit.evento,
              fecha: hoyCol,
              timestamp: new Date(),
              procesado_en: ahora.toISOString()
            }, { merge: true });
            
            logs.push(`✅ ${unitClean}: ${hInfo.destino} ${hInfo.hora} → ${geocercaWialon} (${audit.estado}, ${audit.retraso_minutos} min)`);
            auditado = true;
            break;
          }
        }
        
        if (!auditado) {
          logs.push(`⏩ ${unitClean}: ${geocercaWialon} a las ${horaGps} no coincide con turnos`);
        }
        
      } catch (error: any) {
        logs.push(`🔥 Error en fila ${i}: ${error.message}`);
      }
    }
    
    // 6. EJECUTAR BATCH
    if (auditadosCount > 0) {
      try {
        await batch.commit();
        logs.push(`📦 Guardados ${auditadosCount} registros en Firebase`);
      } catch (error: any) {
        logs.push(`❌ Error guardando batch: ${error.message}`);
      }
    }

    // 7. RESPUESTA CON DIAGNÓSTICO COMPLETO
    const respuesta = {
      success: true,
      resumen: {
        fecha: hoyCol,
        en_supabase: plan.length,
        en_wialon: filas.length,
        auditados_final: auditadosCount,
        buses_procesados: Array.from(unidadesProcesadas),
        geocercas_detectadas: Array.from(geocercasEncontradas)
      },
      diagnostico: {
        estructura_datos: diagnostico,
        hora_inicio_ts: inicioTS,
        hora_fin_ts: finTS,
        hora_inicio_human: new Date(inicioTS * 1000).toISOString(),
        hora_fin_human: new Date(finTS * 1000).toISOString()
      },
      logs: logs.slice(0, 100) // Más logs para diagnóstico
    };

    console.log("📊 AUDIT-BATCH: Proceso completado", JSON.stringify(respuesta.resumen));
    
    return res.status(200).json(respuesta);

  } catch (e: any) {
    console.error("🔥 ERROR en audit-batch:", e);
    return res.status(200).json({ 
      success: false, 
      error: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
}