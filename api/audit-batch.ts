// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  const ahora = Math.floor(Date.now() / 1000);
  const inicioDia = 1767330000; // 02-01-2026 00:00:00

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDia, ahora);
    
    console.log("Filas recibidas de Wialon:", dataWialon.length);

    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
        return res.status(200).json({ 
          msg: "Wialon devolvió 0 filas. Revisa el rango de tiempo o los IDs.",
          raw: dataWialon 
        });
    }

    let procesados = 0;

    for (const row of dataWialon) {
      // Wialon a veces manda los datos en row.c[0] o row.c[0].t
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = row.c[1]?.t || row.c[1] || "";
      const horaGps = row.c[2]?.t || row.c[2] || "";
      
      if (!unitName || unitName === "Agrupación") continue; // Saltar encabezados

      const unitClean = String(unitName).replace(/^0+/, ''); 

      // 1. Consultar turno en Supabase
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', '2026-01-02')
        .limit(1).single();

      if (turno) {
        procesados++;
        const viajeId = `${unitClean}_20260102_${turno.hora_turno.replace(/:/g,'')}`;
        
        // Guardar/Actualizar viaje
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: '2026-01-02',
          ultima_actualizacion: new Date()
        }, { merge: true });

        // Guardar el evento específico
        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
          punto: geocerca,
          hora_gps: horaGps,
          hora_programada: turno.hora_turno,
          creado_el: new Date()
        });
      }
    }

    return res.status(200).json({ 
        success: true, 
        msg: `Auditoría completada. Se procesaron ${procesados} buses con turnos activos.` 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}