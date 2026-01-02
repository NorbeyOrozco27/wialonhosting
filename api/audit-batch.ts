// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Desde las 00:00 AM de hoy 02-01-2026 hasta ahora (Hora Bogota)
  const inicioTimestamp = 1767330000; 
  const finTimestamp = Math.floor(Date.now() / 1000);
  const hoyStr = "2026-01-02";

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (!Array.isArray(dataWialon)) {
      return res.status(200).json({ success: false, msg: "Wialon aún no tiene listo el reporte. Refresca en 10 segundos.", error_code: dataWialon });
    }

    let auditados = 0;
    for (const row of dataWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaEntradaGps = row.c[2]?.t || "";

      if (!unitVal || unitVal.includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        // ID: bus_fecha_hora (ej: 101_20260102_0521)
        const idCompacto = turno.hora_turno.substring(0,5).replace(':','');
        const docId = `${unitClean}_20260102_${idCompacto}`;

        // GUARDADO REAL EN FIRESTORE (Aquí es donde aparecerán los datos en tu captura)
        await db.collection('auditoria_viajes').doc(docId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          ultima_captura_gps: horaEntradaGps,
          servidor_auditado: new Date()
        }, { merge: true });

        // Guardamos el detalle del punto
        await db.collection('auditoria_viajes').doc(docId).collection('checkpoints').add({
          punto: "T. RIONEGRO",
          hora_gps: horaEntradaGps,
          hora_prog: turno.hora_turno,
          fecha_proceso: new Date()
        });
      }
    }

    return res.status(200).json({ 
        success: true, 
        registros_procesados: dataWialon.length, 
        auditados_guardados: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}