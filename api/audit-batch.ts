// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Desde las 00:00 AM de hoy en Colombia
  const now = new Date();
  const colombiaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);

  const inicioTimestamp = Math.floor(new Date(`${colombiaDate}T05:00:00Z`).getTime() / 1000);
  const finTimestamp = Math.floor(now.getTime() / 1000);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    // Si no es un array, mostramos qué es para diagnosticar
    if (!Array.isArray(dataWialon)) {
        return res.status(200).json({ 
            success: false, 
            msg: "Estructura de datos desconocida", 
            raw: dataWialon 
        });
    }

    if (dataWialon.length === 0) {
        return res.status(200).json({ 
            success: true, 
            msg: "Wialon no encontró buses aún.", 
            rango: { desde: inicioTimestamp, hasta: finTimestamp } 
        });
    }

    let auditados = 0;
    for (const row of dataWialon) {
      const unitName = row.c[0]?.t || row.c[0] || "";
      const horaEntradaGps = row.c[2]?.t || "";

      if (!unitName || String(unitName).includes("Total") || unitName === "---") continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', colombiaDate)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        const viajeId = `${unitClean}_${colombiaDate.replace(/-/g,'')}_${turno.hora_turno.replace(/:/g,'').substring(0,4)}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: colombiaDate
        }, { merge: true });

        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
          punto: "T. RIONEGRO",
          hora_gps: horaEntradaGps,
          hora_programada: turno.hora_turno,
          creado_el: new Date()
        });
      }
    }

    return res.status(200).json({ 
        success: true, 
        buses_wialon: dataWialon.length, 
        auditados_con_exito: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}