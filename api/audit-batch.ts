// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Fecha de hoy en formato Colombia
  const hoyStr = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'}); // YYYY-MM-DD
  
  // Rango: Hoy desde las 00:00 hasta ahora (en segundos Unix)
  const ahora = Math.floor(Date.now() / 1000);
  const inicioDia = Math.floor(new Date().setHours(0,0,0,0) / 1000);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDia, ahora);
    
    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
        return res.status(200).json({ msg: "No hubo movimientos de buses en lo que va del día.", raw: dataWialon });
    }

    let procesados = 0;

    for (const row of dataWialon) {
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = row.c[1]?.t || row.c[1] || "";
      const horaGps = row.c[2]?.t || row.c[2] || "";
      
      if (!unitName || String(unitName).includes("Agrupación")) continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      // Consulta a Supabase A (Mundo A)
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        procesados++;
        const idCompacto = turno.hora_turno.replace(/:/g,'').substring(0,4);
        const viajeId = `${unitClean}_${hoyStr.replace(/-/g,'')}_${idCompacto}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyStr,
          ultima_geocerca: geocerca,
          ultima_actualizacion: new Date()
        }, { merge: true });

        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
          punto: geocerca,
          hora_gps: horaGps,
          creado_el: new Date()
        });
      }
    }

    return res.status(200).json({ success: true, buses_auditados: procesados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message, detalle: "Error en el proceso de auditoría" });
  }
}