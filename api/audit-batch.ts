// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 3); // Últimas 3 horas

  // Fecha hoy en formato Colombia (YYYY-MM-DD)
  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    // 1. INTENTO DE LECTURA CON DIAGNÓSTICO
    const { data: todosLosTurnos, error: errSup } = await supabaseA
      .from('historial_rodamiento_real')
      .select('*')
      .eq('fecha_rodamiento', hoyCol);

    // SI HAY ERROR, LO MOSTRAMOS EN PANTALLA
    if (errSup) {
      return res.status(200).json({ 
        error: "Error técnico de Supabase", 
        mensaje: errSup.message,
        codigo: errSup.code,
        detalles: errSup.details,
        fecha_intentada: hoyCol
      });
    }

    if (!todosLosTurnos || todosLosTurnos.length === 0) {
      return res.status(200).json({ 
        msg: "No se encontraron turnos en Supabase para la fecha de hoy.",
        fecha_consultada: hoyCol
      });
    }

    // 2. PEDIR DATOS A WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (dataWialon.error_espera) {
      return res.status(200).json({ success: false, msg: "Wialon procesando. Refresca en 5 segundos." });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin actividad en Rionegro en el rango consultado." });
    }

    let auditados = 0;
    const batch = db.batch();

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // 3. BUSQUEDA EN MEMORIA
      const turno = todosLosTurnos.find(t => String(t.numero_interno) === unitClean);

      if (turno) {
        const resultado = auditarEvento(turno, "T. RIONEGRO", horaGps);
        if (resultado) {
          auditados++;
          const idComp = turno.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            ruta: turno.ruta,
            programado: turno.hora_turno,
            desviacion: resultado.desviacion_minutos,
            estado: resultado.estado,
            fecha: hoyCol,
            actualizado_el: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      msg: "Auditoría completada",
      turnos_en_base_datos: todosLosTurnos.length,
      buses_detectados_gps: filas.length, 
      auditados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: "Error fatal en el servidor", mensaje: e.message });
  }
}