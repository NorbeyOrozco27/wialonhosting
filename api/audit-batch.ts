import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Hoy 02-01-2026 desde las 00:00 hasta ahora
  const ahora = Math.floor(Date.now() / 1000);
  const inicioDia = 1767330000; // Unix Timestamp del 02-01-2026 00:00:00

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDia, ahora);
    
    // Si no hay datos en la tabla
    if (!dataWialon || !dataWialon.length) {
        return res.status(200).json({ msg: "No se encontraron movimientos en este rango." });
    }

    let procesados = 0;

    for (const row of dataWialon) {
      // row.c[0].t es la Unidad, row.c[1].t es la Geocerca, row.c[2].t es la Entrada
      const unitName = row.c[0]?.t || "";
      const geocerca = row.c[1]?.t || "";
      const horaGps = row.c[2]?.t || "";
      
      if (!unitName) continue;

      const unitClean = unitName.replace(/^0+/, ''); // "0101" -> "101"

      // 1. Buscamos el turno en Supabase A (Mundo A)
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', '2026-01-02')
        .limit(1).single();

      if (turno) {
        procesados++;
        // 2. Guardamos en Firebase (Mundo B - Auditoría)
        const viajeId = `${unitClean}_20260102_${turno.hora_turno.replace(/:/g,'')}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: '2026-01-02'
        }, { merge: true });

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
        msg: `Auditoría completada. Se procesaron ${procesados} registros de buses.` 
    });

  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}