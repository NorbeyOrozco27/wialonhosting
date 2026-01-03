// api/webhook.ts - VERSIÓN CORREGIDA Y TYPESCRIPT-SAFE
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. VERIFICAR MÉTODO (webhook POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    // 2. OBTENER DATOS DEL WEBHOOK
    const { unitId, geofenceName, eventTime } = req.body;
    
    // Si no viene en body, intentar query params (para pruebas)
    const unitVal = unitId || req.query.unit;
    const geocercaWialon = geofenceName || req.query.geofence;
    const horaGps = eventTime || req.query.time;

    if (!unitVal || !geocercaWialon || !horaGps) {
      return res.status(400).json({ 
        success: false, 
        error: 'Faltan parámetros',
        recibido: req.body
      });
    }

    // 3. FECHA ACTUAL COLOMBIA
    const ahora = new Date();
    const hoyCol = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    // 4. BUSCAR EN SUPABASE
    const { data: vehiculos } = await supabaseA.from('Vehículos')
      .select('id, numero_interno');
    
    const { data: plan } = await supabaseA.from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);
    
    const { data: horarios } = await supabaseA.from('Horarios')
      .select('id, hora, destino');

    // 5. LIMPIAR ID DEL BUS
    const unitClean = String(unitVal).replace(/^0+/, '');
    
    // 6. BUSCAR VEHÍCULO
    const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
    
    if (!vInfo) {
      return res.status(200).json({ 
        success: true, 
        mensaje: `Bus ${unitClean} no encontrado en Supabase`,
        unit_clean: unitClean,
        unit_original: unitVal
      });
    }

    // 7. OBTENER TURNOS DEL BUS
    const turnosBus = plan?.filter(p => p.vehiculo_id === vInfo.id) || [];
    
    if (turnosBus.length === 0) {
      return res.status(200).json({ 
        success: true, 
        mensaje: `Bus ${unitClean} no tiene turnos programados hoy`,
        fecha: hoyCol
      });
    }

    let auditado = false;
    let resultadoAuditoria: any = null; // EXPLICITA: puede ser null
    let docId: string | null = null;

    // 8. AUDITAR CADA TURNO
    for (const tAsignado of turnosBus) {
      const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
      if (!hInfo) continue;

      const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geocercaWialon, horaGps);
      
      if (audit) {
        auditado = true;
        resultadoAuditoria = audit;
        
        // 9. CREAR ID ÚNICO
        const idComp = hInfo.hora.substring(0, 5).replace(':', '');
        docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${idComp}`;
        
        // 10. GUARDAR EN FIREBASE
        await db.collection('auditoria_viajes').doc(docId).set({
          bus: unitClean,
          bus_wialon: unitVal,
          ruta: hInfo.destino,
          programado: hInfo.hora,
          gps_llegada: audit.hora_gps,
          geocerca_wialon: geocercaWialon,
          evento: audit.evento,
          retraso_minutos: audit.retraso_minutos,
          estado: audit.estado,
          fecha: hoyCol,
          timestamp: new Date(),
          fuente: 'webhook',
          webhook_recibido: {
            unitId: unitVal,
            geofenceName: geocercaWialon,
            eventTime: horaGps,
            receivedAt: ahora.toISOString()
          }
        }, { merge: true });
        
        break;
      }
    }

    // 11. RESPUESTA - ¡CORREGIDO!
    if (auditado && resultadoAuditoria) { // ← VALIDACIÓN AÑADIDA
      return res.status(200).json({
        success: true,
        mensaje: 'Auditoría registrada exitosamente',
        auditoria: {
          bus: unitClean,
          geocerca: geocercaWialon,
          hora_gps: resultadoAuditoria.hora_gps, // ← AHORA SEGURO
          estado: resultadoAuditoria.estado,     // ← AHORA SEGURO
          retraso: resultadoAuditoria.retraso_minutos, // ← AHORA SEGURO
          documento_id: docId
        },
        procesado_en: ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' })
      });
    } else {
      return res.status(200).json({
        success: true,
        mensaje: 'Evento recibido pero no coincide con ningún turno',
        datos_recibidos: {
          bus: unitVal,
          bus_clean: unitClean,
          geocerca: geocercaWialon,
          hora: horaGps // ← CORREGIDO: era "hora6ps"
        },
        turnos_del_bus: turnosBus.length
      });
    }

  } catch (error: any) {
    console.error('Error en webhook:', error);
    return res.status(200).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}