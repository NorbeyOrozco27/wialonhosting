// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Forzar fecha y hora de Colombia
  const ahora = new Date();
  const tiempoCali = new Date(ahora.toLocaleString("en-US", {timeZone: "America/Bogota"}));
  
  // Rango: Desde las 00:00 AM de HOY en Colombia hasta AHORA
  const inicioDia = new Date(tiempoCali);
  inicioDia.setHours(0,0,0,0);

  const inicioTimestamp = Math.floor(inicioDia.getTime() / 1000);
  const finTimestamp = Math.floor(ahora.getTime() / 1000);

  const hoyColombia = tiempoCali.toISOString().split('T')[0];

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "No se encontraron movimientos en este rango.",
        debug: { hoy: hoyColombia, desde: inicioTimestamp, hasta: finTimestamp }
      });
    }

    let auditados = 0;

    for (const row of dataWialon) {
      // En el reporte 7.1 de grupo: c[0] es la Unidad, c[2] es la Entrada
      const unitName = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";
      const geocerca = row.c[1]?.t || "Terminal"; 

      if (!unitName || String(unitName).includes("Total")) continue;

      const unitClean = unitName.replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyColombia)
        .limit(1).single();

      if (turno) {
        auditados++;
        const viajeId = `${unitClean}_${hoyColombia.replace(/-/g,'')}_${turno.hora_turno.replace(/:/g,'').substring(0,4)}`;
        
        await db.collection('auditoria_viajes').doc(viajeId).set({
          bus: unitClean,
          ruta: turno.ruta,
          programado: turno.hora_turno,
          fecha: hoyColombia
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
      filas_encontradas: dataWialon.length, 
      auditados_con_turno: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}