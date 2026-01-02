// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Calcular el "Hoy" exacto en Colombia
  const ahora = new Date();
  const hoyColStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  // 2. Calcular Timestamps para Wialon (UTC) que representen el día de Colombia
  // 00:00:00 Bogota = 05:00:00 UTC
  const inicioDiaCol = new Date(`${hoyColStr}T05:00:00Z`);
  const inicioTimestamp = Math.floor(inicioDiaCol.getTime() / 1000);
  const finTimestamp = Math.floor(ahora.getTime() / 1000);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (!dataWialon || dataWialon.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "No hay movimientos registrados hoy en Wialon aún.",
        rango: { 
            desde: new Date(inicioTimestamp * 1000).toISOString(), 
            hasta: new Date(finTimestamp * 1000).toISOString() 
        }
      });
    }

    let auditados = 0;

    for (const row of dataWialon) {
      // Mapeo: c[0] Unidad, c[1] Geocerca, c[2] Entrada
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = row.c[1]?.t || row.c[1] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitName || String(unitName).includes("Total")) continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyColStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
        const idCompacto = turno.hora_turno.replace(/:/g,'').substring(0,4);
        const viajeId = `${unitClean}_${hoyColStr.replace(/-/g,'')}_${idCompacto}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyColStr,
          ultima_actualizacion: new Date()
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
        registros_wialon: dataWialon.length, 
        auditados_con_turno: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}