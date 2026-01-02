// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // RANGO: Jan 02 2026 completo (00:00 a 23:59)
  const inicioTS = 1767330000; 
  const finTS = 1767416399; 
  const hoyCol = "2026-01-02";

  try {
    // 1. Traer programación de Supabase (Mundo A)
    const { data: turnos } = await supabaseA.from('historial_rodamiento_real').select('*').eq('fecha_rodamiento', hoyCol);

    // 2. Traer buses de Wialon
    const filasWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (!Array.isArray(filasWialon) || filasWialon.length === 0) {
      return res.status(200).json({ success: true, msg: "Wialon devolvió 0 filas. Revisa el SID.", raw: filasWialon });
    }

    let auditados = 0;
    const batch = db.batch();

    for (const row of filasWialon) {
      // MAPEADO DE TU IMAGEN: c[0] es nombre bus, c[2].t es hora entrada
      const unitVal = row.c[0]; // Ej: "0110"
      const horaGps = row.c[2]?.t || ""; // Ej: "02.01.2026 11:17:10"

      if (!unitVal || String(unitVal).includes("Total")) continue;
      
      const unitClean = String(unitVal).replace(/^0+/, ''); 
      const turno = turnos?.find(t => String(t.numero_interno) === unitClean);

      if (turno) {
        // Auditar usando destino y hora_turno de Supabase
        const resultado = auditarEvento(turno.ruta, turno.hora_turno, "T. RIONEGRO", horaGps);
        
        if (resultado) {
          auditados++;
          const idComp = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            ruta_despacho: turno.ruta,
            prog: turno.hora_turno,
            gps: horaGps,
            retraso: resultado.retraso_minutos,
            estado: resultado.estado,
            fecha: hoyCol
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      msg: "Auditoría completada satisfactoriamente.",
      buses_leidos: filasWialon.length, 
      auditados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}