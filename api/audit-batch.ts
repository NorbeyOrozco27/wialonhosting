// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (3600 * 4); // Últimas 4 horas

  // Fecha hoy Bogota
  const hoyCol = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  try {
    // 1. CONSULTA PRO: Unimos operacion_diaria con Horarios y Vehículos
    const { data: planDelDia, error: errSup } = await supabaseA
      .from('operacion_diaria')
      .select(`
        id,
        fecha,
        Vehículos ( numero_interno ),
        Horarios ( hora, destino, origen )
      `)
      .eq('fecha', hoyCol);

    if (errSup) {
      return res.status(200).json({ error: "Error en Supabase", detalle: errSup.message });
    }

    if (!planDelDia || planDelDia.length === 0) {
      return res.status(200).json({ msg: "No hay programacion en operacion_diaria para hoy.", fecha: hoyCol });
    }

    // 2. PEDIR DATOS A WIALON
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

      // 3. MATCH EN MEMORIA: Buscamos en el plan del día
      // Buscamos el bus y que el destino coincida con lo que el Juez espera
      const turno = planDelDia.find(p => String((p.Vehículos as any)?.numero_interno) === unitClean);

      if (turno && (turno.Horarios as any)) {
        // Preparamos el objeto para el Juez (lib/util.ts)
        const infoParaJuez = {
            destino: (turno.Horarios as any).destino,
            hora_turno: (turno.Horarios as any).hora
        };

        const resultado = auditarEvento(infoParaJuez, "T. RIONEGRO", horaGps);
        
        if (resultado) {
          auditados++;
          const idComp = infoParaJuez.hora_turno.substring(0,5).replace(':','');
          const docId = `${unitClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;

          const docRef = db.collection('auditoria_viajes').doc(docId);
          batch.set(docRef, {
            bus: unitClean,
            ruta: `${(turno.Horarios as any).origen} -> ${(turno.Horarios as any).destino}`,
            programado: infoParaJuez.hora_turno,
            desviacion: resultado.desviacion_minutos,
            estado: resultado.estado,
            fecha: hoyCol,
            actualizado: new Date()
          }, { merge: true });
        }
      }
    }

    await batch.commit();

    return res.status(200).json({ 
      success: true, 
      plan_vuelos_hoy: planDelDia.length,
      buses_vistos_gps: filasWialon.length, 
      auditados_firebase: auditados 
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}