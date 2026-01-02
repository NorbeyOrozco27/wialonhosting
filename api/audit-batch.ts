// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  // Forzamos la fecha de hoy 02 de enero 2026 según tu reporte
  const hoyCol = "2026-01-02"; 

  // Rango Wialon: Últimas 4 horas
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 4); 

  try {
    // 1. CONSULTA DE SUPABASE (Simplificada para evitar fallos de relación)
    // Traemos la tabla plana y nosotros hacemos el cruce
    const { data: operacion, error: errSup } = await supabaseA
      .from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);

    if (errSup) return res.status(200).json({ error: "Error en Supabase", detalle: errSup.message });

    if (!operacion || operacion.length === 0) {
      return res.status(200).json({ 
        msg: "No se encontraron filas en operacion_diaria.", 
        fecha_buscada: hoyCol,
        nota: "Verifica si los datos del 2 de enero ya están cargados en Supabase." 
      });
    }

    // 2. TRAEMOS LOS BUSES Y HORARIOS PARA HACER EL CRUCE EN MEMORIA
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    // 3. PEDIR DATOS A WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    
    if (dataWialon.error_espera) {
      return res.status(200).json({ success: false, msg: "Wialon está preparando el reporte. Refresca en 5 segundos." });
    }

    const filasWialon = Array.isArray(dataWialon) ? dataWialon : [];
    let auditados = 0;
    const batch = db.batch();

    for (const row of filasWialon) {
      const unitVal = row.c[0]?.t || row.c[0] || "";
      const horaGps = row.c[2]?.t || "";
      const unitClean = String(unitVal).replace(/^0+/, ''); 

      if (!unitVal || unitVal.includes("Total") || unitVal === "---") continue;

      // 4. EL CRUCE MAESTRO (En la memoria de Vercel)
      // Buscamos qué ID de vehículo tiene ese número interno
      const vEncontrado = vehiculos?.find(v => String(v.numero_interno) === unitClean);
      if (!vEncontrado) continue;

      // Buscamos si ese vehiculo_id tiene turno hoy
      const turnoHoy = operacion.find(o => o.vehiculo_id === vEncontrado.id);
      if (!turnoHoy) continue;

      // Traemos la hora y destino del horario
      const hEncontrado = horarios?.find(h => h.id === turnoHoy.horario_id);

      if (hEncontrado) {
        const resultado = auditarEvento(hEncontrado, "T. RIONEGRO", horaGps);
        
        if (resultado) {
          auditados++;
          const idComp = hEncontrado.hora.substring(0,5).replace(':','');
          const docId = `${unitClean}_20260102_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            programado: hEncontrado.hora,
            destino: hEncontrado.destino,
            retraso: resultado.desviacion_minutos,
            estado: resultado.estado,
            fecha: hoyCol,
            fuente: "Auditor Batch V2"
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      programacion_hoy: operacion.length,
      buses_gps: filasWialon.length, 
      auditados_en_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}