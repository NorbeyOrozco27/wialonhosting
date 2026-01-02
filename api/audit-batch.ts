// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 2); // Últimas 2 horas

  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    // 1. OBTENER TODOS LOS TURNOS DE HOY DE SUPABASE (1 Sola llamada)
    const { data: todosLosTurnos, error: errSup } = await supabaseA
      .from('historial_rodamiento_real')
      .select('*')
      .eq('fecha_rodamiento', hoyCol);

    if (errSup || !todosLosTurnos) throw new Error("Error leyendo Supabase");

    // 2. PEDIR DATOS A WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (dataWialon.error_espera) {
      return res.status(200).json({ success: false, msg: "Wialon procesando. Refresca en 5 segundos." });
    }

    const filas = Array.isArray(dataWialon) ? dataWialon : [];
    if (filas.length === 0) {
      return res.status(200).json({ success: true, msg: "Sin actividad en la última hora." });
    }

    let auditados = 0;
    const batch = db.batch(); // Usamos batch de Firebase para más velocidad

    for (const row of filas) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";

      if (!unitVal || String(unitVal).includes("Total") || unitVal === "---") continue;
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      // 3. BUSCAR EN MEMORIA (Instantáneo)
      const turno = todosLosTurnos.find(t => t.numero_interno === unitClean);

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
            fecha: hoyCol
          }, { merge: true });
        }
      }
    }

    await batch.commit(); // Guardamos todo en Firebase de un solo golpe

    return res.status(200).json({ 
      success: true, 
      msg: "Auditoría relámpago completada",
      buses_detectados: filas.length, 
      guardados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}