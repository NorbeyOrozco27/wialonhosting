// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarTrayecto } from '../lib/util.js'; // <--- ESTA ERA LA LÍNEA QUE FALTABA

export default async function handler(req: any, res: any) {
  const hoyCol = "2026-01-02";
  const ahoraTS = Math.floor(Date.now() / 1000);
  const inicioTS = 1767330000; // 00:00 AM Colombia del 2 de enero

  try {
    // 1. Traer programación de Supabase (Mundo A)
    const { data: turnos, error: errSup } = await supabaseA
        .from('historial_rodamiento_real')
        .select('*')
        .eq('fecha_rodamiento', hoyCol);

    if (errSup) throw new Error(errSup.message);

    // 2. Traer buses de Wialon (Cosecha Batch)
    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    if (filas.length === 0) {
        return res.status(200).json({ success: true, msg: "Sin actividad en Wialon aún." });
    }

    let totalAuditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      // row.c[0] es la unidad (ej: "0110"), row.c[2].t es la hora (ej: "11:17:10")
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || ""; 

      if (!unitVal || unitVal.includes("Total") || unitVal === "---" || !horaGps) continue;

      const unitClean = String(unitVal).replace(/^0+/, '');
      
      // Filtramos todos los turnos que tiene este bus asignados hoy
      const turnosDelBus = turnos?.filter((t: any) => String(t.numero_interno) === unitClean) || [];

      let mejorAuditoria = null;
      let mejorTurnoId = "";
      let menorDiferenciaAbsoluta = 999;

      // PROCESO DE MATCHING: Buscamos el turno que mejor encaje con la hora del GPS
      for (const turno of turnosDelBus) {
        // Llamamos al Juez (ahora sí está importado)
        const auditoria: any = auditarTrayecto(turno.ruta, turno.hora_turno, "T. RIONEGRO", horaGps);
        
        // Si el Juez dice que este turno es coherente (< 60 min de diferencia)
        if (auditoria && Math.abs(auditoria.retraso_llegada) < menorDiferenciaAbsoluta) {
          menorDiferenciaAbsoluta = Math.abs(auditoria.retraso_llegada);
          mejorAuditoria = auditoria;
          mejorTurnoId = `${unitClean}_20260102_${turno.hora_turno.substring(0,5).replace(':','')}`;
        }
      }

      // Si encontramos un turno que encaja, lo preparamos para Firebase
      if (mejorAuditoria) {
        totalAuditados++;
        const docRef = db.collection('auditoria_viajes').doc(mejorTurnoId);
        batch.set(docRef, {
          bus: unitClean,
          ...mejorAuditoria,
          actualizado: new Date()
        }, { merge: true });
      }
    }

    // 3. GUARDAR EN FIREBASE (Mundo B)
    await batch.commit();

    return res.status(200).json({ 
        success: true, 
        msg: "Auditoría de proximidad completada",
        buses_wialon: filas.length,
        auditados: totalAuditados 
    });

  } catch (e: any) {
    console.error("Error fatal:", e.message);
    return res.status(500).json({ error: e.message });
  }
}