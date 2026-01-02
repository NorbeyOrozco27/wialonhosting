// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarTrayecto } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const hoyCol = "2026-01-02";
  const ahoraTS = Math.floor(Date.now() / 1000);
  const inicioTS = 1767330000; // 00:00 AM

  try {
    const { data: turnos } = await supabaseA.from('historial_rodamiento_real').select('*').eq('fecha_rodamiento', hoyCol);
    const dataWialon = await ejecutarInformeCosecha(inicioTS, ahoraTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    let procesados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitClean = String(row.c[0]?.t || row.c[0]).replace(/^0+/, '');
      const geocerca = row.c[1]?.t || row.c[1];
      const horaGps = row.c[2]?.t || "";
      if (unitClean.includes("Total") || !horaGps) continue;

      // 1. BUSCAR EL TURNO COHERENTE (El más cercano al evento GPS)
      const horaGpsMinutos = convertirAMinutos(horaGps);
      const turnosBus = turnos?.filter(t => String(t.numero_interno) === unitClean) || [];
      
      let mejorTurno = null;
      let diferenciaMinima = 120; // Solo turnos en un rango de 2 horas

      for (const t of turnosBus) {
        const [h, m] = t.hora_turno.split(':').map(Number);
        const diff = Math.abs(horaGpsMinutos - (h * 60 + m));
        if (diff < diferenciaMinima) {
          diferenciaMinima = diff;
          mejorTurno = t;
        }
      }

      if (mejorTurno) {
        const auditoria = auditarTrayecto(mejorTurno.destino, mejorTurno.hora_turno, geocerca, horaGps);
        
        if (auditoria) {
          procesados++;
          const idViaje = `${unitClean}_20260102_${mejorTurno.hora_turno.substring(0,5).replace(':','')}`;
          const docRef = db.collection('auditoria_viajes').doc(idViaje);

          // Unimos los datos: si es salida la anota, si es llegada la anota en el mismo documento
          batch.set(docRef, {
            ...auditoria,
            bus: unitClean,
            ruta: mejorTurno.ruta,
            hora_programada: mejorTurno.hora_turno,
            actualizado: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();
    return res.status(200).json({ success: true, auditados: procesados });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

function convertirAMinutos(fechaStr: string) {
  const tiempo = fechaStr.split(' ')[1];
  const [h, m] = tiempo.split(':').map(Number);
  return h * 60 + m;
}