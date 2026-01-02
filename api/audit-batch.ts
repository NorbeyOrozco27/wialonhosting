// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  // Rango: Hace 4 horas hasta ahora (Mucho más rápido para Wialon)
  const finTimestamp = Math.floor(ahora.getTime() / 1000);
  const inicioTimestamp = finTimestamp - (4 * 3600); 

  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (dataWialon.error_espera) {
      return res.status(200).json({ success: false, msg: "Wialon está procesando. Reintenta en 5 segundos." });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin buses en las últimas 4 horas." });
    }

    let auditados = 0;
    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // Buscamos turno en Supabase (Solo lectura)
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
          const idCompacto = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idCompacto}`;

          // ESCRIBIR EN FIRESTORE
          await db.collection('auditoria_viajes').doc(docId).set({
            bus: unitClean,
            ruta: turno.ruta,
            programado: turno.hora_turno,
            estado: resultado.estado,
            desviacion: resultado.desviacion_minutos,
            fecha: hoyCol
          }, { merge: true });

          await db.collection('auditoria_viajes').doc(docId).collection('checkpoints').add({
            ...resultado,
            hora_gps: horaGps,
            fecha_audit: new Date()
          });
        }
      }
    }

    return res.status(200).json({ 
      success: true, 
      periodo: "Últimas 4 horas",
      buses_detectados: filas.length, 
      auditados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}