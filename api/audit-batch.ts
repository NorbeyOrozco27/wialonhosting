// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // Rango: Últimas 12 horas desde ahora
  const ahoraSec = Math.floor(Date.now() / 1000);
  const inicioSec = ahoraSec - (12 * 3600); 

  const hoyColombia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioSec, ahoraSec);
    
    // Si lo que regresó es un error de Wialon, lo mostramos
    if (dataWialon.error_wialon) {
      return res.status(200).json({ 
        success: false, 
        msg: "Error en los parámetros de Wialon", 
        detalle: dataWialon.error_wialon 
      });
    }

    // Verificamos que sea una lista antes de iterar
    if (!Array.isArray(dataWialon)) {
       return res.status(200).json({ success: false, msg: "Estructura de datos inesperada", raw: dataWialon });
    }

    let procesados = 0;

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
        .eq('fecha_rodamiento', hoyColombia)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        procesados++;
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

    return res.status(200).json({ 
      success: true, 
      msg: `Auditoría finalizada. Filas Wialon: ${dataWialon.length}, Auditados: ${procesados}` 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}