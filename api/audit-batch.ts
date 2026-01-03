import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // Fecha hoy Colombia YYYY-MM-DD
  const hoyCol = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const ahoraTS = Math.floor(Date.now() / 1000);
  const inicioTS = ahoraTS - (3600 * 8); 

  try {
    // 1. DESCARGA DE DATOS (CORREGIDO: Incluimos horario_id)
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();

    if (plan && plan.length > 0 && filas.length > 0) {
      for (const row of filas) {
        const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
        const horaGps = row.c?.[2]?.t || "";
        if (!unitVal || String(unitVal).includes("Total") || !horaGps) continue;

        const unitClean = String(unitVal).replace(/^0+/, '');
        const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
        
        if (vInfo) {
          const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);
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
                gps_llegada: audit.hora_gps,
                retraso: audit.retraso_minutos,
                estado: audit.estado,
                fecha: hoyCol,
                actualizado: new Date()
              }, { merge: true });
              break;
            }
          }
        }
      }
      await batch.commit();
    }

    return res.status(200).json({ 
      success: true, 
      resumen: {
        fecha: hoyCol,
        en_supabase: plan?.length || 0,
        en_wialon: filas.length,
        auditados_final: auditadosCount
      }
    });

  } catch (e: any) {
    return res.status(200).json({ success: false, error: e.message });
  }
}