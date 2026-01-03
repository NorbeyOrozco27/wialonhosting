// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. FECHA AUTOMÁTICA SEGURA (YYYY-MM-DD)
  const hoyCol = new Date().toISOString().split('T')[0];

  const ahoraTS = Math.floor(Date.now() / 1000);
  const inicioTS = ahoraTS - (3600 * 8); 

  try {
    // 2. CONSULTA PLANA (Sin Joins complejos que causan error 500)
    const { data: plan, error: errPlan } = await supabaseA
      .from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);

    if (errPlan) throw new Error(`Error Plan: ${errPlan.message}`);

    // Traemos los maestros para cruzar en memoria (más seguro)
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');

    // 3. COSECHAR WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    
    // Verificamos que Wialon haya devuelto una lista
    const filas = Array.isArray(dataWialon) ? dataWialon : (dataWialon?.rows || []);

    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Wialon vacío en este rango." });
    }

    let auditadosCount = 0;
    const batch = db.batch();

    for (const row of filas) {
      // Mapeo: c[0] Unidad, c[2] Hora GPS
      const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
      const horaGps = row.c?.[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || !horaGps) continue;
      const unitClean = String(unitVal).replace(/^0+/, '');

      // 4. CRUCE MANUAL EN MEMORIA
      const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
      if (!vInfo) continue;

      const turnoBus = plan?.find(p => p.vehiculo_id === vInfo.id);
      if (!turnoBus) continue;

      const hInfo = horarios?.find(h => h.id === turnoBus.horario_id);
      if (!hInfo) continue;

      // 5. AUDITORÍA
      const audit = auditarMovimiento(hInfo.origen, hInfo.destino, hInfo.hora, "T. RIONEGRO", horaGps);

      if (audit) {
        auditadosCount++;
        const idViaje = `${unitClean}_${hoyCol.replace(/-/g,'')}_${hInfo.hora.substring(0,5).replace(':','')}`;
        const docRef = db.collection('auditoria_viajes').doc(idViaje);

        batch.set(docRef, {
          bus: unitClean,
          ruta: `${hInfo.origen} -> ${hInfo.destino}`,
          programado: hInfo.hora,
          [audit.evento === "SALIDA" ? "salida_real" : "llegada_real"]: audit.hora_gps,
          [audit.evento === "SALIDA" ? "diff_salida" : "diff_llegada"]: audit.retraso_salida || audit.retraso_llegada,
          fecha: hoyCol,
          updated: new Date()
        }, { merge: true });
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      resumen: {
        buses_gps: filas.length,
        auditados: auditadosCount,
        fecha: hoyCol
      }
    });

  } catch (e: any) {
    // Si falla, devolvemos el error exacto para saber qué pasó
    return res.status(200).json({ success: false, error: e.message });
  }
}

function convertirAMinutos(fStr: string) {
  if (!fStr || !fStr.includes(' ')) return 0;
  const t = fStr.split(' ')[1];
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}