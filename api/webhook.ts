// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const { unit_name, geofence_name, event_time } = req.body;

  try {
    // 1. LIMPIEZA: "0149" -> "149"
    const unitNameClean = unit_name.replace(/^0+/, '');
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

    // 2. CONSULTA MUNDO A: Usamos historial porque ya tiene los datos planos (ruta y hora)
    const { data: turno } = await supabaseA
      .from('historial_rodamiento_real')
      .select('ruta, hora_turno, fecha_rodamiento')
      .eq('numero_interno', unitNameClean)
      .eq('fecha_rodamiento', hoy)
      .order('hora_turno', { ascending: false })
      .limit(1)
      .single();

    if (!turno) {
      return res.status(200).json({ msg: `Bus ${unitNameClean} sin turno activo para hoy.` });
    }

    // 3. AUDITORÍA: El Juez ahora pide (destino, horaTurno, geocerca, horaGps)
    // Pasamos 'turno.ruta' como destino porque el Juez la filtrará en config.ts
    const resultado: any = auditarEvento(turno.ruta, turno.hora_turno, geofence_name, event_time);

    if (!resultado) {
      return res.status(200).json({ msg: "Punto de paso o ruta no configurados para auditoría." });
    }

    // 4. GUARDAR EN MUNDO B (Firebase)
    const idComp = turno.hora_turno.substring(0,5).replace(':','');
    const viajeId = `${unitNameClean}_${hoy.replace(/-/g,'')}_${idComp}`;
    
    // Guardar el evento en la sub-colección
    await db.collection('auditoria_viajes').doc(viajeId).collection('eventos_gps').add({
      ...resultado,
      hora_gps_cruda: event_time,
      fecha_proceso: new Date()
    });

    // Actualizar el resumen del viaje
    await db.collection('auditoria_viajes').doc(viajeId).set({
      bus: unitNameClean,
      ruta: turno.ruta,
      fecha: turno.fecha_rodamiento,
      ultimo_punto: geofence_name,
      estado_actual: resultado.estado,
      minutos_retraso: resultado.retraso_minutos // Sincronizado con util.ts
    }, { merge: true });

    return res.status(200).json({ success: true, viajeId, estado: resultado.estado });

  } catch (e: any) {
    console.error("Error en Webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }
}