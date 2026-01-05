// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento, ResultadoAuditoria } from '../lib/util.js'; // Importar interfaz

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Only POST');

  const { unitId, geofenceName, eventTime } = req.body;
  
  if (!unitId || !geofenceName || !eventTime) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const hoyCol = "2026-01-05"; // Fecha fija para tu prueba
  const unitClean = String(unitId).replace(/^0+/, '');

  try {
    const { data: vehiculos } = await supabaseA.from('Vehículos')
      .select('id')
      .eq('numero_interno', unitClean)
      .single();

    if (!vehiculos) return res.json({ msg: "Bus no encontrado" });

    const { data: turnos } = await supabaseA.from('operacion_diaria')
      .select('horario_id')
      .eq('fecha', hoyCol)
      .eq('vehiculo_id', vehiculos.id);

    if (!turnos || turnos.length === 0) return res.json({ msg: "Sin turnos hoy" });

    // Buscar el horario en Supabase para obtener destino y hora
    const idsHorarios = turnos.map(t => t.horario_id);
    const { data: infoHorarios } = await supabaseA.from('Horarios')
      .select('id, hora, destino')
      .in('id', idsHorarios);

    let resultado: ResultadoAuditoria | null = null;
    let horarioMatch = null;

    if (infoHorarios) {
        for (const h of infoHorarios) {
            const audit = auditarMovimiento(h.destino, h.hora, geofenceName, eventTime);
            if (audit) {
                resultado = audit;
                horarioMatch = h;
                break;
            }
        }
    }

    if (resultado && horarioMatch) {
        const docId = `${unitClean}_${hoyCol}_${horarioMatch.hora.replace(':','')}`;
        
        await db.collection('auditoria_viajes').doc(docId).set({
            bus: unitClean,
            estado: resultado.estado, // TypeScript ahora feliz
            retraso: resultado.retraso_minutos,
            geocerca: geofenceName,
            hora_gps: resultado.hora_gps,
            timestamp: new Date()
        }, { merge: true });

        return res.json({ success: true, audit: resultado });
    }

    return res.json({ success: false, msg: "No coincide con ningún turno" });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}