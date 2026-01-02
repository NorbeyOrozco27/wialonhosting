// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarTrayecto } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  // Miramos 6 horas atrás para tener un rango amplio de auditoría
  const inicioTS = finTS - (3600 * 6); 

  // Fecha hoy Colombia YYYY-MM-DD
  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    // 1. CARGAR PROGRAMACIÓN (Mundo A)
    const { data: turnos, error: errSup } = await supabaseA
      .from('historial_rodamiento_real')
      .select('*')
      .eq('fecha_rodamiento', hoyCol);

    if (errSup) throw new Error(`Error Supabase: ${errSup.message}`);

    // 2. COSECHAR WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    // Si Wialon devolvió un objeto de error (ej: el error 5)
    if (dataWialon.error_espera || dataWialon.error_wialon) {
      return res.status(200).json({ 
        success: false, 
        msg: "Wialon está procesando el reporte. Refresca en 5 segundos." 
      });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin actividad en el rango consultado." });
    }

    let totalAuditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      // row.c[0] es la unidad, row.c[1] geocerca, row.c[2] hora gps
      const unitClean = String(row.c[0]?.t || row.c[0]).replace(/^0+/, '');
      const geocerca = row.c[1]?.t || row.c[1];
      const horaGps = row.c[2]?.t || "";

      if (!unitClean || unitClean.includes("Total") || !horaGps) continue;

      // 3. BUSCAR TURNO CERCANO (Máximo 90 min de diferencia)
      const hGpsMin = convertirAMinutos(horaGps);
      
      // Definimos el tipo 'any' para 't' para quitar el error ts(7006)
      const turnoCercano = turnos?.find((t: any) => {
        if (String(t.numero_interno) !== unitClean) return false;
        const [h, m] = t.hora_turno.split(':').map(Number);
        const minutosProg = h * 60 + m;
        // Solo aceptamos turnos en un rango de 90 minutos de cercanía
        return Math.abs(hGpsMin - minutosProg) < 90;
      });

      if (turnoCercano) {
        // 4. JUEZ DE TRAYECTO (Lógica narrativa)
        const auditoria: any = auditarTrayecto(turnoCercano.destino, turnoCercano.hora_turno, geocerca, horaGps);
        
        if (auditoria) {
          totalAuditados++;
          const idViaje = `${unitClean}_${hoyCol.replace(/-/g,'')}_${turnoCercano.hora_turno.substring(0,5).replace(':','')}`;
          const docRef = db.collection('auditoria_viajes').doc(idViaje);

          const dataUpdate: any = {
             bus: unitClean,
             ruta: turnoCercano.ruta,
             prog: turnoCercano.hora_turno,
             actualizado_el: new Date()
          };

          // Si el evento es Salida, llena unos campos, si es Llegada, otros. No borra lo anterior.
          if (auditoria.evento === "SALIDA") {
            dataUpdate.salida_real = auditoria.gps_hora;
            dataUpdate.retraso_salida = auditoria.retraso_salida;
            dataUpdate.estado_salida = auditoria.estado_salida;
          } else {
            dataUpdate.llegada_real = auditoria.gps_hora;
            dataUpdate.retraso_llegada = auditoria.retraso_llegada;
            dataUpdate.estado_llegada = auditoria.estado_llegada;
            dataUpdate.tti_real_minutos = auditoria.duracion_viaje_real;
          }

          batch.set(docRef, dataUpdate, { merge: true });
        }
      }
    }

    // 5. GUARDAR TODO DE UN SOLO GOLPE
    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      msg: "Cosecha y Auditoría completada",
      buses_procesados: filas.length, 
      viajes_auditados: totalAuditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

// Función auxiliar para convertir "02.01.2026 15:30:00" a minutos del día
function convertirAMinutos(fechaStr: string) {
  if (!fechaStr || !fechaStr.includes(' ')) return 0;
  const tiempo = fechaStr.split(' ')[1];
  const [h, m] = tiempo.split(':').map(Number);
  return h * 60 + m;
}