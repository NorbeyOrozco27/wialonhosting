// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // REQUISITO 1: FECHA AUTOMÁTICA (Colombia)
  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const finTS = Math.floor(Date.now() / 1000);
  const inicioTS = finTS - (3600 * 8); // Miramos las últimas 8 horas

  try {
    // REQUISITO 2: CONSULTA A operacion_diaria (Transactional)
    const { data: plan, error } = await supabaseA
      .from('operacion_diaria')
      .select(`
        vehiculo_id,
        Vehículos ( numero_interno ),
        Horarios ( hora, origen, destino )
      `)
      .eq('fecha', hoyCol);

    if (error) throw error;

    // 3. COSECHAR WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const geoVal = row.c[1]?.t || "T. RIONEGRO"; // Asumimos Rionegro por el reporte
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || unitVal.includes("Total") || !horaGps) continue;
      const unitClean = unitVal.replace(/^0+/, '');

      // REQUISITO 3: COMPARAR SOLO REGISTROS CERCANOS (Matching Inteligente)
      const hGpsMin = convertirAMinutos(horaGps);
      
      // Buscamos en el plan de hoy el bus y el turno que esté a menos de 90 min
      const turnoMatch: any = plan?.find((p: any) => {
        if (String(p.Vehículos?.numero_interno) !== unitClean) return false;
        const [h, m] = p.Horarios.hora.split(':').map(Number);
        return Math.abs(hGpsMin - (h * 60 + m)) < 90; // Ventana de coherencia
      });

      if (turnoMatch) {
        const audit = auditarMovimiento(
          turnoMatch.Horarios.origen,
          turnoMatch.Horarios.destino,
          turnoMatch.Horarios.hora,
          geoVal,
          horaGps
        );

        if (audit) {
          auditados++;
          const idViaje = `${unitClean}_${hoyCol.replace(/-/g,'')}_${turnoMatch.Horarios.hora.substring(0,5).replace(':','')}`;
          const docRef = db.collection('auditoria_viajes').doc(idViaje);

          batch.set(docRef, {
            bus: unitClean,
            ruta: `${turnoMatch.Horarios.origen} -> ${turnoMatch.Horarios.destino}`,
            programado: turnoMatch.Horarios.hora,
            [audit.evento === "SALIDA" ? "salida_real" : "llegada_real"]: audit.hora_gps,
            [audit.evento === "SALIDA" ? "retraso_salida" : "retraso_llegada"]: audit.retraso_salida || audit.retraso_llegada,
            fecha: hoyCol,
            actualizado: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();
    return res.status(200).json({ 
        success: true, 
        fecha: hoyCol,
        buses_wialon: filas.length, 
        auditados: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

function convertirAMinutos(fStr: string) {
  const t = fStr.split(' ')[1];
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}