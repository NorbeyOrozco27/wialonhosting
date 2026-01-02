// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // RANGO: Desde las 00:00 AM de hoy 02-01-2026 hasta ahora (Hora Bogota)
  const inicioTimestamp = 1767330000; 
  const finTimestamp = Math.floor(Date.now() / 1000);
  const hoyStr = "2026-01-02";

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    // Si Wialon devuelve algo que no es un array, es un mensaje de error o aviso
    if (!Array.isArray(dataWialon)) {
      return res.status(200).json({ 
        success: false, 
        msg: "Wialon no devolvió una lista de buses.", 
        respuesta_cruda: dataWialon 
      });
    }

    if (dataWialon.length === 0) {
        return res.status(200).json({ 
          success: true, 
          msg: "Wialon encontró 0 movimientos en el rango de hoy.",
          rango: { desde: "00:00 AM", hasta: "Ahora" }
        });
    }

    // --- EL PROCESO DE CRUCE (Solo si hay datos) ---
    // Traemos turnos de Supabase (1 sola vez para ser rápidos)
    const { data: turnos } = await supabaseA.from('historial_rodamiento_real').select('*').eq('fecha_rodamiento', hoyStr);

    let auditados = 0;
    for (const row of dataWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || unitVal.includes("Total")) continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      const turno = turnos?.find(t => String(t.numero_interno) === unitClean);

      if (turno) {
        const resultado = auditarEvento(turno.ruta, turno.hora_turno, "T. RIONEGRO", horaGps);
        if (resultado) {
          auditados++;
          const viajeId = `${unitClean}_20260102_${turno.hora_turno.substring(0,5).replace(':','')}`;
          await db.collection('auditoria_viajes').doc(viajeId).set({
            bus: unitClean,
            ...resultado,
            programado: turno.hora_turno,
            gps: horaGps
          }, { merge: true });
        }
      }
    }

    return res.status(200).json({ success: true, buses_en_wialon: dataWialon.length, auditados: auditados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}