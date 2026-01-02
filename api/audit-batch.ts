// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const hoyCol = "2026-01-02";
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 6); // Ampliamos a 6 horas para capturar viajes largos

  try {
    // 1. Descargar TODO el plan del día
    const { data: todosLosTurnos } = await supabaseA
      .from('historial_rodamiento_real')
      .select('*')
      .eq('fecha_rodamiento', hoyCol);

    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let auditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGpsStr = row.c[2]?.t || ""; // Ej: "02.01.2026 10:50:35"
      if (!unitVal || unitVal.includes("Total")) continue;

      const unitClean = String(unitVal).replace(/^0+/, '');
      const horaGpsMinutos = convertirAHoraMinutos(horaGpsStr);

      // 2. FILTRO INTELIGENTE: Buscamos todos los turnos de este bus
      const turnosDelBus = todosLosTurnos?.filter(t => String(t.numero_interno) === unitClean) || [];

      // 3. ENCONTRAR EL TURNO CORRECTO:
      // Buscamos el turno cuya hora programada sea la más cercana PERO ANTERIOR a la hora del GPS
      let mejorTurno = null;
      let menorDiferencia = Infinity;

      for (const t of turnosDelBus) {
        const [h, m] = t.hora_turno.split(':').map(Number);
        const minutosProg = h * 60 + m;
        const diff = horaGpsMinutos - minutosProg;

        // Un viaje no debería durar más de 300 min (5 horas) de retraso para ser del mismo turno
        if (diff >= 0 && diff < 300 && diff < menorDiferencia) {
          menorDiferencia = diff;
          mejorTurno = t;
        }
      }

      if (mejorTurno) {
        const resultado = auditarEvento(mejorTurno.ruta, mejorTurno.hora_turno, "T. RIONEGRO", horaGpsStr);
        if (resultado) {
          auditados++;
          // El ID ahora incluye la hora del turno para que no se sobreescriban los viajes del mismo día
          const idViaje = `${unitClean}_20260102_${mejorTurno.hora_turno.substring(0,5).replace(':','')}`;
          
          const docRef = db.collection('auditoria_viajes').doc(idViaje);
          batch.set(docRef, {
            bus: unitClean,
            ruta: mejorTurno.ruta,
            prog: mejorTurno.hora_turno,
            gps: horaGpsStr,
            retraso: resultado.retraso_minutos,
            estado: resultado.estado,
            fecha: hoyCol
          }, { merge: true });
        }
      }
    }

    await batch.commit();
    return res.status(200).json({ success: true, auditados: auditados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

// Función auxiliar para el match
function convertirAHoraMinutos(fechaStr: string) {
    const tiempo = fechaStr.split(' ')[1];
    const [h, m] = tiempo.split(':').map(Number);
    return h * 60 + m;
}