// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const hoyStr = "2026-01-02"; // Fecha fija para hoy
  
  // RANGO: Últimos 60 minutos
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - 3600; 

  try {
    // 1. Traer programación de Supabase (Mundo A)
    const { data: operacion } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyStr);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    // 2. Traer buses de Wialon (Solo última hora)
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (dataWialon.error_wialon) {
      return res.status(200).json({ success: false, msg: "Wialon está ocupado. Refresca en 5 segundos." });
    }

    let auditados = 0;
    const batch = db.batch();

    for (const row of dataWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || unitVal.includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // CRUCE DE DATOS
      const v = vehiculos?.find(veh => String(veh.numero_interno) === unitClean);
      const op = operacion?.find(o => o.vehiculo_id === v?.id);
      const h = horarios?.find(hor => hor.id === op?.horario_id);

      if (h) {
        const resultado = auditarEvento(h.destino, h.hora, "T. RIONEGRO", horaGps);
        if (resultado) {
          auditados++;
          const idComp = h.hora.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            ruta_destino: h.destino,
            programado_llegada: resultado.llegada_esperada,
            gps_llegada: horaGps,
            retraso: resultado.retraso_minutos,
            estado: resultado.estado,
            actualizado: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      msg: `Auditoría completada.`,
      buses_ultima_hora: dataWialon.length, 
      auditados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}