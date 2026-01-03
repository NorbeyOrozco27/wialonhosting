// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const { unit_name, geofence_name, event_time } = req.body;

  try {
    const unitNameClean = unit_name.replace(/^0+/, '');
    const hoyCol = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

    // 1. Consulta Segura a Supabase (Tablas separadas para evitar Error 500)
    const { data: plan } = await supabaseA.from('operacion_diaria').select('*').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('*');

    const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitNameClean);
    if (!vInfo) return res.status(200).json({ msg: "Bus no reconocido" });

    // 2. Match por proximidad temporal (Ventana de 2 horas)
    const tiempoGpsRaw = event_time.includes(' ') ? event_time.split(' ')[1] : event_time;
    const [hG, mG] = tiempoGpsRaw.split(':').map(Number);
    const minGps = hG * 60 + mG;

    const turnosBus = plan?.filter(p => p.vehiculo_id === vInfo.id) || [];
    let mejorTurno: any = null;
    let difMinima = 120;

    for (const p of turnosBus) {
      const hInfo = horarios?.find(h => h.id === p.horario_id);
      if (hInfo) {
        const [hP, mP] = hInfo.hora.split(':').map(Number);
        const diff = Math.abs(minGps - (hP * 60 + mP));
        if (diff < difMinima) {
          difMinima = diff;
          mejorTurno = hInfo;
        }
      }
    }

    if (!mejorTurno) return res.status(200).json({ msg: "Sin turno cercano" });

    // 3. Auditoría y Guardado
    const audit = auditarMovimiento(mejorTurno.destino, mejorTurno.hora, geofence_name, event_time);
    if (!audit) return res.status(200).json({ msg: "Geocerca no auditable" });

    const viajeId = `${unitNameClean}_${hoyCol.replace(/-/g,'')}_${mejorTurno.hora.substring(0,5).replace(':','')}`;
    await db.collection('auditoria_viajes').doc(viajeId).set({
      bus: unitNameClean,
      ruta: mejorTurno.destino,
      programado: mejorTurno.hora,
      [audit.evento === "SALIDA" ? "salida_real" : "llegada_real"]: audit.hora_gps,
      [audit.evento === "SALIDA" ? "diff_salida" : "diff_llegada"]: audit.retraso_minutos,
      estado: audit.estado,
      fecha: hoyCol
    }, { merge: true });

    return res.status(200).json({ success: true, bus: unitNameClean, estado: audit.estado });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}