// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Obtener fecha de hoy en Colombia (YYYY-MM-DD)
  const hoyColombia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  // 2. Rango de tiempo para el reporte (Desde las 00:00 de hoy hasta ahora)
  const ahoraSec = Math.floor(Date.now() / 1000);
  const inicioDiaSec = Math.floor(new Date().setHours(0,0,0,0) / 1000);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDiaSec, ahoraSec);
    
    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
      return res.status(200).json({ success: true, msg: "No hay movimientos registrados hoy aún." });
    }

    let auditados = 0;

    for (const row of dataWialon) {
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = row.c[1]?.t || row.c[1] || "";
      const horaGps = row.c[2]?.t || row.c[2] || "";
      
      if (!unitName || String(unitName).includes("Agrupación")) continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      // Consulta a Supabase A (Mundo A) con la fecha de Colombia
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyColombia)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        const idCompacto = turno.hora_turno.replace(/:/g,'').substring(0,4);
        const viajeId = `${unitClean}_${hoyColombia.replace(/-/g,'')}_${idCompacto}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyColombia,
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

    return res.status(200).json({ success: true, buses_encontrados: dataWialon.length, auditados_con_turno: auditados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}