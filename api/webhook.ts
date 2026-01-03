// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const hoyCol = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const ahoraTS = Math.floor(Date.now() / 1000);
  const inicioTS = ahoraTS - (3600 * 8); 

  try {
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
      const horaGps = row.c?.[2]?.t || "";
      if (!unitVal || String(unitVal).includes("Total") || !horaGps) continue;

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
          const idComp = hInfo.hora.substring(0,5).replace(':','');
          const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;
          
          batch.set(db.collection('auditoria_viajes').doc(docId), {
            bus: unitClean,
            ruta: hInfo.destino,
            programado: hInfo.hora,
            llegada_real: audit.hora_gps,
            diff_llegada: audit.retraso_minutos,
            estado: audit.estado,
            fecha: hoyCol,
            actualizado_el: new Date()
          }, { merge: true });
          break; 
        }
      }
    }
    if (auditadosCount > 0) await batch.commit();

    return res.status(200).json({ success: true, auditados: auditadosCount, fecha: hoyCol });

  } catch (e: any) {
    return res.status(200).json({ success: false, error: e.message });
  }
}