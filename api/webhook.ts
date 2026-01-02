// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarTrayecto } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const { unit_name, geofence_name, event_time } = req.body;

  try {
    // 1. LIMPIEZA Y FECHA
    const unitNameClean = unit_name.replace(/^0+/, '');
    const hoyCol = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

    // 2. CONSULTA MUNDO A: Buscamos todos los turnos de este bus para hoy
    const { data: turnosBus } = await supabaseA
      .from('historial_rodamiento_real')
      .select('ruta, hora_turno, destino')
      .eq('numero_interno', unitNameClean)
      .eq('fecha_rodamiento', hoyCol);

    if (!turnosBus || turnosBus.length === 0) {
      return res.status(200).json({ msg: `Bus ${unitNameClean} sin programación.` });
    }

    // 3. MATCH INTELIGENTE (Proximidad Temporal)
    // El bus puede estar marcando salida o llegada, buscamos el turno más cercano a la hora del GPS
    const fechaGps = new Date(event_time);
    const minutosGps = (fechaGps.getUTCHours() - 5) * 60 + fechaGps.getUTCMinutes();
    
    let mejorTurno = null;
    let difMinima = 90; // Margen de 1.5 horas para asociar un evento a un turno

    for (const t of turnosBus) {
        const [h, m] = t.hora_turno.split(':').map(Number);
        const diff = Math.abs(minutosGps - (h * 60 + m));
        if (diff < difMinima) {
            difMinima = diff;
            mejorTurno = t;
        }
    }

    if (!mejorTurno) {
        return res.status(200).json({ msg: "Evento GPS demasiado alejado de cualquier turno programado." });
    }

    // 4. AUDITORÍA DE TRAYECTO (La nueva lógica narrativa)
    const resultado: any = auditarTrayecto(mejorTurno.destino, mejorTurno.hora_turno, geofence_name, event_time);

    if (!resultado) {
      return res.status(200).json({ msg: "Punto de paso no auditable para este trayecto." });
    }

    // 5. GUARDAR EN MUNDO B (Firebase)
    // Usamos el ID compacto para que Salida y Llegada caigan en el mismo ticket
    const idComp = mejorTurno.hora_turno.substring(0,5).replace(':','');
    const viajeId = `${unitNameClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;
    
    const docRef = db.collection('auditoria_viajes').doc(viajeId);

    // Guardamos con MERGE:TRUE para no borrar lo que ya estaba (ej: si ya se marcó la salida)
    await docRef.set({
      bus: unitNameClean,
      ruta: mejorTurno.ruta,
      programado_salida: mejorTurno.hora_turno,
      ...resultado, // Esto inyectará hora_salida_gps O hora_llegada_gps según el punto
      actualizado_en_vivo: new Date()
    }, { merge: true });

    return res.status(200).json({ 
        success: true, 
        evento: resultado.tipo_evento, 
        viaje: mejorTurno.ruta 
    });

  } catch (e: any) {
    console.error("Error Webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }
}