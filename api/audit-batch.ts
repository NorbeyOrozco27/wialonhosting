// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Hoy 02 de enero 2026 completo (Basado en tus fotos)
  const inicioTimestamp = 1767330000; // 00:00:00 Bogota
  const finTimestamp = Math.floor(Date.now() / 1000);
  const hoyStr = "2026-01-02";

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    // Si Wialon nos devolvió un error (como el error 5)
    if (dataWialon.error_wialon) {
        return res.status(200).json({ 
            success: false, 
            msg: `Wialon reportó error ${dataWialon.error_wialon}. Reintenta en 5 segundos.`,
            raw: dataWialon.raw 
        });
    }

    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
        return res.status(200).json({ success: true, msg: "No se encontraron filas con buses.", data: dataWialon });
    }

    let auditados = 0;
    for (const row of dataWialon) {
      // Mapeo: c[0] Unidad (0101), c[2] Entrada
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaEntradaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;

      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // Buscamos turno en Supabase
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        const viajeId = `${unitClean}_20260102_${turno.hora_turno.replace(/:/g,'').substring(0,4)}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyStr,
          ultima_actualizacion: new Date()
        }, { merge: true });

        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
          punto: "T. RIONEGRO",
          hora_gps: horaEntradaGps,
          hora_programada: turno.hora_turno,
          servidor_registro: new Date()
        });
      }
    }

    return res.status(200).json({ 
        success: true, 
        buses_rionegro_wialon: dataWialon.length, 
        auditados_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}