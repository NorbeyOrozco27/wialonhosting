// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  const hoyCol = "2026-01-02";
  const ahora = Math.floor(Date.now() / 1000);
  const inicioTS = 1767330000; // 00:00 AM Colombia

  try {
    const { data: turnos } = await supabaseA.from('historial_rodamiento_real').select('*').eq('fecha_rodamiento', hoyCol);
    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahora);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || ""; // Unidad (0101)
      const horaEntradaGps = row.c[2]?.t || "";     // Entrada a Rionegro
      const horaSalidaGps = row.c[3]?.t || "";      // Salida de Rionegro

      if (!unitVal || unitVal.includes("Total") || unitVal === "---") continue;
      const unitClean = unitVal.replace(/^0+/, '');

      // Buscamos todos los turnos de este bus hoy
      const turnosBus = turnos?.filter(t => String(t.numero_interno) === unitClean) || [];

      for (const turno of turnosBus) {
        const idViaje = `${unitClean}_20260102_${turno.hora_turno.substring(0,5).replace(':','')}`;
        const docRef = db.collection('auditoria_viajes').doc(idViaje);
        let dataUpdate: any = { bus: unitClean, ruta: turno.ruta, programado: turno.hora_turno, actualizado: new Date() };

        // LÓGICA A: ¿Este turno termina en Rionegro? (Auditamos LLEGADA)
        if (turno.ruta.toUpperCase().includes("RIONEGRO") && horaEntradaGps) {
            dataUpdate.llegada_real = horaEntradaGps;
            dataUpdate.msg_llegada = "Bus llegó a Rionegro";
            auditados++;
        }

        // LÓGICA B: ¿Este turno sale de Rionegro? (Auditamos SALIDA)
        if (turno.ruta.toUpperCase().includes("CEJA") && turno.origen?.toUpperCase().includes("RIONEGRO") && horaSalidaGps) {
            dataUpdate.salida_real = horaSalidaGps;
            dataUpdate.msg_salida = "Bus salió de Rionegro";
            auditados++;
        }

        if (Object.keys(dataUpdate).length > 4) {
            batch.set(docRef, dataUpdate, { merge: true });
        }
      }
    }

    await batch.commit();
    return res.status(200).json({ success: true, buses_procesados: filas.length, auditados_en_firebase: auditados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}