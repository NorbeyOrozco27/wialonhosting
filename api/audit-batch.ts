// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. TIMESTAMPS EXACTOS (Bogotá GMT-5)
  // 00:00:00 Bogota = 05:00:00 UTC
  // Para el 02 de Enero de 2026:
  const inicioDiaColombia = 1767330000; 
  const ahoraUTC = Math.floor(Date.now() / 1000);

  const hoyColombia = "2026-01-02"; // Fecha manual para asegurar el match hoy

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDiaColombia, ahoraUTC);
    
    // Verificamos si es iterable
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    if (filas.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "Wialon devolvió 0 filas. Revisa si hay buses en la geocerca en la web.",
        rango_utc: { desde: inicioDiaColombia, hasta: ahoraUTC }
      });
    }

    let auditados = 0;
    for (const row of filas) {
      // En reporte 7.1 de grupo: c[0] es Unidad (0101), c[2] es Hora entrada
      const unitName = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitName || unitName.includes("Total") || unitName === "---") continue;

      const unitClean = unitName.replace(/^0+/, ''); 

      // 2. BUSCAR EN SUPABASE
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyColombia)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        const viajeId = `${unitClean}_20260102_${turno.hora_turno.replace(/:/g,'').substring(0,4)}`;
        
        // 3. GUARDAR EN FIREBASE
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyColombia,
          ultima_actualizacion: new Date()
        }, { merge: true });

        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
          punto: "T. RIONEGRO",
          hora_gps: horaGps,
          creado_el: new Date()
        });
      }
    }

    return res.status(200).json({ 
      success: true, 
      total_buses_wialon: filas.length, 
      auditados_exitosos: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}