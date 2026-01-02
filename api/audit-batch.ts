// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // Rango: Hoy 02-01-2026 desde las 00:00 (Timestamp 1767330000)
  const inicioTimestamp = 1767330000;
  const finTimestamp = Math.floor(Date.now() / 1000);
  const hoyStr = "2026-01-02";

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTimestamp, finTimestamp);
    
    if (dataWialon.error_wialon) {
      return res.status(200).json({ 
        success: false, 
        msg: `Wialon (Error ${dataWialon.error_wialon}): El reporte es muy grande o no está listo. Refresca en 10 segundos.` 
      });
    }

    if (!Array.isArray(dataWialon) || dataWialon.length === 0) {
      return res.status(200).json({ success: true, msg: "Wialon respondió pero la tabla está vacía.", data: dataWialon });
    }

    let auditados = 0;
    for (const row of dataWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // 1. Buscar en Supabase A
      const { data: turno } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('numero_interno', unitClean)
        .eq('fecha_rodamiento', hoyStr)
        .order('hora_turno', { ascending: false })
        .limit(1).single();

      if (turno) {
        // 2. AUDITAR usando tu lib/util.ts
        const resultado = auditarEvento(turno, "T. RIONEGRO", horaGps);
        
        if (resultado) {
          auditados++;
          const idCompacto = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idCompacto}`;

          // 3. GUARDAR EN FIRESTORE (Aquí aparecerán los datos en tu consola)
          await db.collection('auditoria_viajes').doc(docId).set({
            bus: unitClean,
            ruta: turno.ruta,
            programado: turno.hora_turno,
            fecha: hoyStr,
            estado_gps: resultado.estado,
            desviacion: resultado.desviacion_minutos
          }, { merge: true });

          await db.collection('auditoria_viajes').doc(docId).collection('checkpoints').add({
            ...resultado,
            hora_gps_original: horaGps,
            auditado_el: new Date()
          });
        }
      }
    }

    return res.status(200).json({ 
      success: true, 
      buses_en_rionegro: dataWialon.length, 
      auditados_exitosamente: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}