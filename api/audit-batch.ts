// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Calculamos el inicio del día en Colombia (GMT-5)
  // Independiente de dónde esté el servidor de Vercel
  const fechaHoy = new Date();
  const offsetColombia = 5 * 60 * 60 * 1000; // 5 horas en milisegundos
  
  // Inicio del día (00:00:00 de hoy en Colombia)
  const inicioDiaCol = new Date(fechaHoy.setHours(0,0,0,0) - (fechaHoy.getTimezoneOffset() * 60000));
  const inicioTimestamp = Math.floor(inicioDiaCol.getTime() / 1000) - (5 * 3600); 
  
  // Hasta ahora mismo
  const finTimestamp = Math.floor(Date.now() / 1000);

  const hoyStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    // DEBUG: Si Wialon devuelve algo que no es una lista, queremos saberlo
    if (!dataWialon || dataWialon.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "Wialon no reportó movimientos entre las 00:00 y ahora.",
        rango_consultado: { 
            desde: new Date(inicioTimestamp * 1000).toLocaleString("es-CO"),
            hasta: new Date(finTimestamp * 1000).toLocaleString("es-CO")
        }
      });
    }

    let auditados = 0;

    for (const row of dataWialon) {
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = row.c[1]?.t || row.c[1] || "";
      const horaGps = row.c[2]?.t || row.c[2] || "";
      
      if (!unitName || String(unitName).includes("Agrupación")) continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        auditados++;
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

    return res.status(200).json({ 
      success: true, 
      buses_en_reporte: dataWialon.length, 
      auditados_con_turno: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}