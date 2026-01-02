// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Desde hoy a las 00:00:00 Bogota (1767330000) hasta ahora
  const inicioTimestamp = 1767330000;
  const finTimestamp = Math.floor(Date.now() / 1000);
  const hoyStr = "2026-01-02";

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (!dataWialon || dataWialon.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "Wialon devolvió una tabla vacía. Revisa si hay buses en la web.",
        rango: { desde: inicioTimestamp, hasta: finTimestamp }
      });
    }

    let auditados = 0;
    for (const row of dataWialon) {
      // Mapeo según tu tabla: c[0] es la Unidad (Móvil)
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaEntradaGps = row.c[2]?.t || row.c[2] || ""; // "02.01.2026 05:23:29"

      // Limpieza: ignorar filas de "Total" o vacías
      if (!unitVal || String(unitVal).includes("Total") || String(unitVal) === "---") continue;

      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // 1. Buscamos el turno en Supabase
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
        
        // 2. Guardamos en Firebase (Auditamos el bus)
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyStr,
          ultima_actualizacion: new Date()
        }, { merge: true });

        await db.collection('auditoria_viajes').doc(viajeId).collection('eventos').add({
          punto: "T. RIONEGRO",
          hora_gps: horaEntradaGps,
          hora_programada: turno.hora_turno,
          servidor_fecha: new Date()
        });
      }
    }

    return res.status(200).json({ 
      success: true, 
      buses_leidos_wialon: dataWialon.length, 
      auditados_con_exito: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}