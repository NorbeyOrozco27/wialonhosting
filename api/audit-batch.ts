// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const hoyCol = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const finTS = Math.floor(Date.now() / 1000);
  const inicioTS = finTS - (3600 * 8); // Últimas 8 horas

  try {
    const { data: plan } = await supabaseA.from('operacion_diaria').select('*').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('*');

    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
      const horaGps = row.c?.[2]?.t || "";
      if (!unitVal || unitVal.includes("Total") || !horaGps) continue;

      const unitClean = String(unitVal).replace(/^0+/, '');
      const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
      if (!vInfo) continue;

      const turnosBus = plan?.filter(p => p.vehiculo_id === vInfo.id) || [];

      for (const tAsignado of turnosBus) {
        const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
        if (!hInfo) continue;

        const audit = auditarMovimiento(hInfo.destino, hInfo.hora, "T. RIONEGRO", horaGps);
        if (audit) {
          auditadosCount++;
          const idViaje = `${unitClean}_${hoyCol.replace(/-/g,'')}_${hInfo.hora.substring(0,5).replace(':','')}`;
          batch.set(db.collection('auditoria_viajes').doc(idViaje), {
            bus: unitClean,
            ruta: hInfo.destino,
            programado: hInfo.hora,
            [audit.evento === "SALIDA" ? "salida_real" : "llegada_real"]: audit.hora_gps,
            [audit.evento === "SALIDA" ? "diff_salida" : "diff_llegada"]: audit.retraso_minutos,
            estado: audit.estado,
            fecha: hoyCol
          }, { merge: true });
          break; 
        }
      }
    }
    await batch.commit();
    return res.status(200).json({ success: true, procesados: auditadosCount, fecha: hoyCol });
  } catch (e: any) {
    return res.status(200).json({ success: false, error: e.message });
  }
}