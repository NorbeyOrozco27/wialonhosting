// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const hoyStr = "2026-01-02"; // Fecha de tu operación actual
  const ahora = Math.floor(Date.now() / 1000);
  const inicioTimestamp = 1767330000; // 00:00:00 Colombia

  try {
    // 1. Descargar piezas de Supabase (Mundo A)
    const { data: operacion } = await supabaseA.from('operacion_diaria').select('*').eq('fecha', hoyStr);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    // 2. Descargar reporte de Wialon
    const filasWialon = await ejecutarInformeCosecha(inicioTimestamp, ahora);
    
    if (!Array.isArray(filasWialon) || filasWialon.length === 0) {
      return res.status(200).json({ success: true, msg: "No hay buses moviéndose en Wialon aún." });
    }

    let auditados = 0;
    const batch = db.batch();

    for (const row of filasWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || ""; // Unidad
      const geoVal = row.c[1]?.t || row.c[1] || "";  // Geocerca
      const horaGps = row.c[2]?.t || "";             // Hora Entrada

      if (!unitVal || unitVal.includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // 3. Cruce de datos en memoria
      const v = vehiculos?.find(v => String(v.numero_interno) === unitClean);
      if (!v) continue;

      const op = operacion?.find(o => o.vehiculo_id === v.id);
      if (!op) continue;

      const h = horarios?.find(h => h.id === op.horario_id);
      if (!h) continue;

      // 4. Auditoría
      const resultado = auditarEvento(h.destino, h.hora, geoVal, horaGps);
      
      if (resultado) {
        auditados++;
        const docId = `${unitClean}_20260102_${h.hora.substring(0,5).replace(':','')}`;
        const docRef = db.collection('auditoria_viajes').doc(docId);
        
        batch.set(docRef, {
          bus: unitClean,
          programado: h.hora,
          destino: h.destino,
          ...resultado,
          fecha: hoyStr,
          actualizado: new Date()
        }, { merge: true });
      }
    }

    await batch.commit(); // Guardar todo en Firebase de un golpe

    return res.status(200).json({ 
      success: true, 
      msg: `Auditoría Exitosa. Se procesaron ${auditados} turnos.`,
      detalles: { wialon_filas: filasWialon.length, firebase_guardados: auditados }
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}