// api/webhook.ts - CORREGIDO (Argumentos Completos)
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento, ResultadoAuditoria } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Only POST');

  const { unitId, geofenceName, eventTime } = req.body;
  
  // Soporte para query params (pruebas en navegador) o body (webhook real)
  const unitVal = unitId || req.query.unit;
  const geocercaWialon = geofenceName || req.query.geofence;
  const horaGps = eventTime || req.query.time;

  if (!unitVal || !geocercaWialon || !horaGps) {
    return res.status(400).json({ error: 'Faltan datos (unitId, geofenceName, eventTime)' });
  }

  const hoyCol = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const unitClean = String(unitVal).replace(/^0+/, '');

  try {
    // 1. Buscar vehículo
    const { data: vehiculos } = await supabaseA.from('Vehículos')
      .select('id')
      .eq('numero_interno', unitClean)
      .single();

    if (!vehiculos) return res.json({ msg: "Bus no encontrado en BD" });

    // 2. Buscar turnos de hoy
    const { data: turnos } = await supabaseA.from('operacion_diaria')
      .select('horario_id')
      .eq('fecha', hoyCol)
      .eq('vehiculo_id', vehiculos.id);

    if (!turnos || turnos.length === 0) return res.json({ msg: "Sin turnos hoy" });

    // 3. Buscar detalles de horarios
    const idsHorarios = turnos.map(t => t.horario_id);
    const { data: infoHorarios } = await supabaseA.from('Horarios')
      .select('id, hora, destino, origen') // Aseguramos traer origen
      .in('id', idsHorarios);

    let resultado: ResultadoAuditoria | null = null;
    let horarioMatch: any = null;

    if (infoHorarios) {
        for (const h of infoHorarios) {
            // CORRECCIÓN AQUÍ: Pasamos 5 argumentos.
            // 1. Origen/Destino
            // 2. Hora Programada
            // 3. Geocerca (dato1 - string)
            // 4. Hora GPS (dato2 - string)
            // 5. "" (dato3 - string vacío, no se usa en modo webhook)
            
            // Intentamos auditar como LLEGADA (usando destino)
            let audit = auditarMovimiento(h.destino, h.hora, geocercaWialon, horaGps, "");
            
            // Si no cuadra, intentamos como SALIDA (usando origen)
            if (!audit && h.origen) {
                audit = auditarMovimiento(h.origen, h.hora, geocercaWialon, horaGps, "");
            }

            if (audit) {
                resultado = audit;
                horarioMatch = h;
                break;
            }
        }
    }

    if (resultado && horarioMatch) {
        // ID Único
        const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${horarioMatch.hora.replace(/:/g, '')}`;
        
        await db.collection('auditoria_viajes').doc(docId).set({
            bus: unitClean,
            ruta: horarioMatch.destino,
            origen_programado: horarioMatch.origen,
            programado: horarioMatch.hora,
            gps_llegada: resultado.hora_gps,
            geocerca_wialon: geocercaWialon,
            retraso_minutos: resultado.retraso_minutos,
            estado: resultado.estado,
            evento: resultado.evento, // SALIDA o LLEGADA
            fecha: hoyCol,
            timestamp: new Date(),
            origen_datos: "WEBHOOK"
        }, { merge: true });

        return res.json({ success: true, audit: resultado });
    }

    return res.json({ success: false, msg: "No coincide con ningún turno" });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}