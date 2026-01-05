// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento, ResultadoAuditoria } from '../lib/util.js'; // Importamos la interfaz

export default async function handler(req: any, res: any) {
  const ahora = new Date();
  // Forzamos fecha 2026-01-05 ya que es tu fecha de simulación/actual
  const hoyCol = "2026-01-05"; 
  
  // Timestamp para Wialon (Últimas 24 horas basado en la fecha actual real del sistema)
  const finTS = Math.floor(Date.now() / 1000);
  const inicioTS = finTS - (24 * 3600);

  try {
    // 1. SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);
    
    const { data: vehiculos } = await supabaseA.from('Vehículos')
      .select('id, numero_interno');
    
    const { data: horarios } = await supabaseA.from('Horarios')
      .select('id, hora, destino');

    if (!plan || plan.length === 0) {
      return res.json({ success: true, msg: `Sin turnos para ${hoyCol}` });
    }

    // 2. WIALON
    const dataWialon = await ejecutarInformeCosecha(inicioTS, finTS);
    const filas = Array.isArray(dataWialon) ? dataWialon : [];

    // 3. MATCHING
    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];

    for (const row of filas) {
        // Extracción segura de datos Wialon
        let unitVal = "", geocercaWialon = "", horaGps = "";
        
        if (row.c && Array.isArray(row.c)) {
            unitVal = row.c[0]?.t || row.c[0] || "";
            geocercaWialon = row.c[1]?.t || row.c[1] || "";
            horaGps = row.c[2]?.t || row.c[2] || "";
        } else if (Array.isArray(row)) {
            unitVal = row[0]; geocercaWialon = row[1]; horaGps = row[2];
        }

        if (!unitVal || !geocercaWialon || !horaGps) continue;

        const unitClean = String(unitVal).replace(/^0+/, '');
        
        // Buscar vehículo
        const vInfo = vehiculos?.find(v => String(v.numero_interno) === unitClean);
        if (!vInfo) continue;

        // Buscar turnos
        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;

            // AQUÍ LA CORRECCIÓN CLAVE: TypeScript ahora sabe qué devuelve esto
            const audit: ResultadoAuditoria | null = auditarMovimiento(hInfo.destino, hInfo.hora, geocercaWialon, horaGps);
            
            if (audit) {
                auditadosCount++;
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                batch.set(db.collection('auditoria_viajes').doc(docId), {
                    bus: unitClean,
                    ruta: hInfo.destino,
                    programado: hInfo.hora,
                    gps_llegada: audit.hora_gps, // Ya no dará error
                    geocerca: geocercaWialon,
                    retraso: audit.retraso_minutos, // Ya no dará error
                    estado: audit.estado, // Ya no dará error
                    fecha: hoyCol,
                    timestamp: new Date()
                }, { merge: true });
                
                logs.push(`✅ ${unitClean}: ${audit.estado} (${audit.retraso_minutos}min) en ${geocercaWialon}`);
                break; 
            }
        }
    }

    if (auditadosCount > 0) await batch.commit();

    return res.json({
      success: true,
      resumen: {
        fecha: hoyCol,
        procesados: filas.length,
        auditados: auditadosCount
      },
      logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.json({ success: false, error: e.message });
  }
}