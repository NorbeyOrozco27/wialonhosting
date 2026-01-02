// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 2); // Pedimos las últimas 2 horas para seguridad

  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (dataWialon.error_espera) {
      return res.status(200).json({ success: false, msg: "Wialon sigue procesando. Intenta de nuevo." });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin actividad en Rionegro en la última hora." });
    }

    let auditados = 0;
    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyCol)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        const resultado = auditarEvento(turno, "T. RIONEGRO", horaGps);
        if (resultado) {
          auditados++;
          const idComp = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idComp}`;

          await db.collection('auditoria_viajes').doc(docId).set({
            bus: unitClean,
            ruta: turno.ruta,
            programado: turno.hora_turno,
            desviacion: resultado.desviacion_minutos,
            estado: resultado.estado,
            ultima_geocerca: "T. RIONEGRO"
          }, { merge: true });

          await db.collection('auditoria_viajes').doc(docId).collection('checkpoints').add({
            ...resultado,
            hora_gps: horaGps,
            auditado_el: new Date()
          });
        }
      }
    }

    return res.status(200).json({ 
      success: true, 
      rango: "Última hora",
      buses_detectados: filas.length, 
      guardados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}