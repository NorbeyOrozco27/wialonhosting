// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const { unit_name, geofence_name, event_time } = req.body;

  try {
    // 1. LIMPIEZA: Si Wialon manda "0149", convertimos a "149"
    // Esto asegura que coincida con tu columna numero_interno de Supabase
    const unitNameClean = unit_name.replace(/^0+/, '');

    console.log(`Buscando turno para: ${unitNameClean} en geocerca: ${geofence_name}`);

    // 2. CONSULTA MUNDO A: Buscamos el turno más reciente para ese móvil
    const { data: turno, error } = await supabaseA
      .from('historial_rodamiento_real')
      .select('*')
      .eq('numero_interno', unitNameClean)
      .order('fecha_rodamiento', { ascending: false })
      .order('hora_turno', { ascending: false })
      .limit(1)
      .single();

    if (!turno) {
      return res.status(200).json({ msg: `Bus ${unitNameClean} no tiene turnos registrados hoy.` });
    }

    // 3. AUDITORÍA: El Juez compara tiempos
    const resultado = auditarEvento(turno, geofence_name, event_time);
    if (!resultado) {
      return res.status(200).json({ msg: "Punto de paso no configurado para auditoría" });
    }

    // 4. GUARDAR EN MUNDO B (Firebase)
    // ID único: Movil_Fecha_HoraProg (ej: 149_2025-12-30_1500)
    const viajeId = `${unitNameClean}_${turno.fecha_rodamiento}_${turno.hora_turno.replace(/:/g, '')}`;
    
    await db.collection('auditoria_viajes').doc(viajeId).collection('eventos_gps').add({
      ...resultado,
      hora_gps_cruda: event_time,
      fecha_sistema: new Date()
    });

    // Actualizamos la cabecera del viaje para tener el estado general
    await db.collection('auditoria_viajes').doc(viajeId).set({
      móvil: unitNameClean,
      ruta: turno.ruta,
      fecha: turno.fecha_rodamiento,
      ultimo_punto: geofence_name,
      ultima_desviacion: resultado.desviacion_minutos
    }, { merge: true });

    return res.status(200).json({ success: true, viajeId });

  } catch (e: any) {
    console.error("Error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}