// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // 1. FECHA AUTOMÁTICA (Colombia)
  const ahora = new Date();
  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  const ahoraTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = ahoraTS - (3600 * 8); // Miramos las últimas 8 horas

  try {
    // 2. DESCARGAR TODA LA PROGRAMACIÓN DE HOY (Mundo A)
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');

    if (!plan || plan.length === 0) {
      return res.status(200).json({ success: true, msg: `No hay turnos creados en Supabase para hoy ${hoyCol}` });
    }

    // 3. COSECHAR WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditadosCount = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c?.[0]?.t || row.c?.[0] || "";
      const geoNombre = row.c?.[1]?.t || row.c?.[1] || ""; // Geocerca real de Wialon
      const horaGps = row.c?.[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || !horaGps) continue;
      const unitClean = String(unitVal).replace(/^0+/, '');

      // 4. BÚSQUEDA MULTI-TURNO (Soluciona el error del bus 110/178)
      const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
      if (!vInfo) continue;

      // Filtramos TODOS los turnos que tiene este bus hoy
      const turnosAsignados = plan.filter(p => p.vehiculo_id === vInfo.id);

      for (const tAsignado of turnosAsignados) {
        const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
        if (!hInfo) continue;

        // EL JUEZ: Prueba si este bus en esta geocerca encaja con este horario
        // Ahora geoNombre es dinámico, no fijo "T. RIONEGRO"
        const audit = auditarMovimiento(hInfo.origen, hInfo.destino, hInfo.hora, geoNombre, horaGps);

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
            estado: audit.estado,
            fecha: hoyCol,
            updated: new Date()
          }, { merge: true });
          
          break; // Si ya hizo match con un turno, saltamos al siguiente bus para no duplicar
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      resumen: {
        buses_gps_vistos: filas.length,
        auditados_con_turno: auditadosCount,
        fecha: hoyCol
      }
    });

  } catch (e: any) {
    return res.status(200).json({ success: false, error: e.message });
  }
}