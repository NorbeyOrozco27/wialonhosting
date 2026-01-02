// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Obtener fecha actual en formato Colombia
  const now = new Date();
  const colombiaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);

  // 2. Calcular medianoche de hoy en Colombia (GMT-5)
  // El timestamp 1767330000 es Jan 2 2026 00:00 Bogota
  const inicioDiaColombia = Math.floor(new Date(`${colombiaDate}T05:00:00Z`).getTime() / 1000);
  const finAhora = Math.floor(Date.now() / 1000);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioDiaColombia, finAhora);
    
    // Verificamos si dataWialon tiene filas (Wialon las manda a veces en .rows)
    const filas = Array.isArray(dataWialon) ? dataWialon : (dataWialon.rows || []);

    if (filas.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "Wialon no encontró buses en Rionegro todavía.",
        rango_consultado: {
            desde_colombia: new Date(inicioDiaColombia * 1000).toLocaleString("es-CO"),
            hasta_ahora: new Date(finAhora * 1000).toLocaleString("es-CO")
        }
      });
    }

    let auditados = 0;
    for (const row of filas) {
      // En reporte 7.1: c[0] es Unidad, c[2] es Entrada
      const unitName = row.c[0]?.t || row.c[0] || "";
      const horaEntradaGps = row.c[2]?.t || ""; // "02.01.2026 06:17:10"
      
      if (!unitName || String(unitName).includes("Total") || String(unitName).includes("---")) continue;

      const unitClean = unitName.replace(/^0+/, ''); 

      // 3. Cruce con Supabase
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
      buses_en_rionegro: filas.length, 
      auditados_con_turno: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}