// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento, ResultadoAuditoria } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. CONFIGURACIÓN DE FECHAS
  // IMPORTANTE: Dado que el prompt indica que es 2026, usamos Date.now()
  // Si en realidad estás probando con datos históricos de 2025, descomenta la línea de 'timestampFijo'
  
  const ahora = new Date();
  
  // Opción Producción (Tiempo real):
  const finTS = Math.floor(ahora.getTime() / 1000);
  
  // Opción Debug (Si necesitas forzar a una fecha donde sabes que hubo datos):
  // const timestampFijo = 1736073600; // Enero 5, 2025 (ejemplo)
  // const finTS = timestampFijo;

  const inicioTS = finTS - (24 * 3600); // Ventana de 24 horas hacia atrás
  
  // Formatear fecha para consulta en Supabase (YYYY-MM-DD) en zona horaria Colombia
  const hoyCol = new Date(finTS * 1000).toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  console.log(`📊 AUDITORÍA BATCH: Iniciando para fecha ${hoyCol}`);
  console.log(`⏰ Ventana de tiempo (Unix): ${inicioTS} a ${finTS}`);

  try {
    // 2. OBTENER PLANIFICACIÓN (MUNDO A - SUPABASE)
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
        msg: `No se encontraron turnos programados en Supabase para ${hoyCol}`,
        debug_date: hoyCol
      });
    }

    // 3. OBTENER REALIDAD (MUNDO B - WIALON)
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    // 4. MOTOR DE MATCHING
    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];
    const geocercasDetectadas = new Set();

    // Recorrer cada fila del reporte de Wialon
    for (const row of filas) {
        // Extracción segura gracias a la normalización en wialon.ts
        // Se asume el orden del reporte: Col 0: Unidad, Col 1: Geocerca, Col 2: Hora
        const unitVal = row.c[0]?.t || "";
        const geocercaWialon = row.c[1]?.t || "";
        const horaGps = row.c[2]?.t || "";

        // Validaciones básicas
        if (!unitVal || !geocercaWialon || !horaGps) continue;
        if (String(unitVal).includes("Total")) continue;

        geocercasDetectadas.add(geocercaWialon);

        // Limpieza de ID del bus (quitar ceros a la izquierda, ej: "0149" -> "149")
        const unitClean = String(unitVal).replace(/^0+/, '').trim();
        
        // Buscar vehículo en Supabase
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue; // Si el bus de Wialon no está en nuestra BD, lo ignoramos

        // Buscar turnos asignados a este vehículo hoy
        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);
        if (turnosBus.length === 0) continue;

        // Intentar hacer match con algún turno programado
        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;

            // EL JUEZ: Comparar Plan vs Realidad
            const audit: ResultadoAuditoria | null = auditarMovimiento(
                hInfo.destino, 
                hInfo.hora, 
                geocercaWialon, 
                horaGps
            );
            
            if (audit) {
                auditadosCount++;
                
                // Crear ID único para idempotencia (evitar duplicados)
                // Formato: BUS_FECHA_HORAPROGRAMADA (ej: 149_20260105_0430)
                const horaLimpia = hInfo.hora.replace(/:/g, '').substring(0, 4);
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${horaLimpia}`;
                
                const docRef = db.collection('auditoria_viajes').doc(docId);
                
                batch.set(docRef, {
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
                    last_update: new Date().toISOString()
                }, { merge: true });
                
                logs.push(`✅ MATCH: Bus ${unitClean} en ${geocercaWialon} (${audit.retraso_minutos} min)`);
                break; // Ya encontramos el match para este evento, pasamos a la siguiente fila
            }
        }
    }

    // 5. GUARDAR RESULTADOS
    if (auditadosCount > 0) {
        await batch.commit();
        console.log(`💾 Base de datos actualizada con ${auditadosCount} auditorías.`);
    }

    return res.status(200).json({
      success: true,
      resumen: {
        fecha: hoyCol,
        en_supabase: plan.length,
        en_wialon: filas.length,
        auditados_final: auditadosCount,
        geocercas_encontradas: Array.from(geocercasDetectadas).slice(0, 10) // Muestra las primeras 10 para debug
      },
      logs: logs.slice(0, 20) // Muestra los primeros 20 logs
    });

  } catch (e: any) {
    console.error("🔥 Error fatal en audit-batch:", e);
    return res.status(500).json({ 
      success: false, 
      error: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined 
    });
  }
}