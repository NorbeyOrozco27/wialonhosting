// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. CALCULAR FECHA Y TIEMPO REAL COLOMBIA
  const ahora = new Date();
  const hoyCol = ahora.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  
  // Rango Wialon: Desde las 00:00:00 de HOY en Colombia hasta ahora
  const inicioDiaCol = new Date(new Date(ahora.toLocaleString("en-US", {timeZone: "America/Bogota"})).setHours(0,0,0,0));
  const inicioTS = Math.floor(inicioDiaCol.getTime() / 1000);
  const finTS = Math.floor(ahora.getTime() / 1000);

  try {
    // 2. DESCARGA MAESTRA DE SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) {
      return res.status(200).json({ success: true, msg: `No hay turnos en Supabase para ${hoyCol}` });
    }

    // 3. COSECHAR WIALON (Con el tiempo dinámico de hoy)
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();

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

          // El Juez ahora decide basándose en el destino y hora de Supabase
          const audit = auditarMovimiento(hInfo.destino, hInfo.hora, "T. RIONEGRO", horaGps);
          
          if (audit) {
            auditadosCount++;
            const idComp = hInfo.hora.substring(0,5).replace(':','');
            const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;
            
            batch.set(db.collection('auditoria_viajes').doc(docId), {
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

    if (auditadosCount > 0) await batch.commit();

    return res.status(200).json({ 
      success: true, 
      resumen: {
        fecha: hoyCol,
        en_supabase: plan.length,
        en_wialon: filas.length,
        auditados_final: auditadosCount
      }
    });

  } catch (e: any) {
    return res.status(200).json({ success: false, error: e.message });
  }
}