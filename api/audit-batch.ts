// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  // Rango: Últimas 3 horas (Mucho más rápido)
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 3); 

  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    // Manejo de Error 5 o Tiempo de espera
    if (dataWialon.error_wialon) {
      return res.status(200).json({ 
        success: false, 
        msg: "El servidor de Wialon está saturado. Refresca la página en 5 segundos.",
        rango: "Últimas 3 horas"
      });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin buses detectados en las últimas 3 horas." });
    }

    // Traemos la programación de Supabase (Mundo A)
    const { data: turnos } = await supabaseA.from('historial_rodamiento_real').select('*').eq('fecha_rodamiento', hoyCol);

    let auditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      const turno = turnos?.find(t => String(t.numero_interno) === unitClean);

      if (turno) {
        const resultado = auditarEvento(turno.ruta, turno.hora_turno, "T. RIONEGRO", horaGps);
        if (resultado) {
          auditados++;
          const idComp = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            ruta: turno.ruta,
            programado: turno.hora_turno,
            ...resultado,
            fecha: hoyCol,
            actualizado: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      msg: "Auditoría completada exitosamente.",
      buses_wialon: filas.length, 
      auditados_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}