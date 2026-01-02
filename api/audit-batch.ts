// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';

export default async function handler(req: any, res: any) {
  // 1. Calcular rango de hoy en Colombia (GMT-5)
  const ahora = new Date();
  const finTimestamp = Math.floor(ahora.getTime() / 1000);
  
  // Inicio de hoy (00:00:00 Colombia)
  const inicioDia = new Date();
  inicioDia.setHours(0,0,0,0);
  // Restamos 5 horas para compensar UTC si el servidor está en otra zona
  const inicioTimestamp = Math.floor(inicioDia.getTime() / 1000);

  const hoyColombia = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    // Si dataWialon viene como un objeto con error o vacío
    const filas = Array.isArray(dataWialon) ? dataWialon : dataWialon.rows || [];

    if (filas.length === 0) {
      return res.status(200).json({ 
        success: true, 
        msg: "No hay movimientos en Wialon para este rango.",
        rango: { desde: inicioTimestamp, hasta: finTimestamp }
      });
    }

    let auditados = 0;

    for (const row of filas) {
      // Mapeo basado en tu reporte 7.1: c[0] es la Agrupación (Móvil)
      const unitName = row.c[0]?.t || row.c[0] || "";
      const geocerca = "T. RIONEGRO"; // El informe es sobre este objeto
      const horaGps = row.c[2]?.t || ""; // Hora de entrada
      
      if (!unitName || String(unitName).includes("Total")) continue;

      const unitClean = String(unitName).replace(/^0+/, ''); 

      // Consulta a Supabase A
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
      filas_encontradas: filas.length, 
      buses_con_turno_hoy: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}