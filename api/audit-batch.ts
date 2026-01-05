// api/audit-batch.ts
// ... (imports igual que antes)
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { ejecutarInformeCosecha } from '../lib/wialon.js';
import { auditarMovimiento, ResultadoAuditoria } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  // ... (Configuración de fechas igual que antes) ...
  const ahora = new Date();
  const finTS = Math.floor(ahora.getTime() / 1000);
  const inicioTS = finTS - (48 * 3600); // 48 HORAS ATRÁS para asegurar datos
  const hoyCol = new Date(finTS * 1000).toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // ... (Carga de Supabase igual que antes) ...
    // ... (Copiar bloque de Supabase del código anterior) ...
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: "Sin plan hoy" });

    // COSECHA WIALON
    const filas = await ejecutarInformeCosecha(inicioTS, finTS);

    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];

    for (const row of filas) {
        // EXTRACCIÓN INTELIGENTE DE DATOS
        // Intentamos leer el bus del contexto inyectado o de la primera columna
        let rawUnit = row.bus_contexto || (row.c[0]?.t || row.c[0]);
        
        // Asumimos que la geocerca está en col 1 y la hora en col 2 (estándar)
        // SI FALLA: Probamos combinaciones.
        let geocerca = row.c[1]?.t || row.c[1] || "";
        let hora = row.c[2]?.t || row.c[2] || "";

        // A veces la columna 0 es numeración y la 1 es geocerca.
        // Si 'rawUnit' viene del contexto, confiamos en él.
        
        if (!rawUnit || !geocerca || !hora) continue;

        // Limpieza de bus ("0149" -> "149")
        const unitClean = String(rawUnit).replace(/^0+/, '').trim();
        
        // Buscar vehículo en Supabase
        const vInfo = vehiculos?.find(v => String(v.numero_interno).trim() === unitClean);
        if (!vInfo) continue; 

        // Buscar turnos
        const turnosBus = plan.filter(p => p.vehiculo_id === vInfo.id);

        for (const tAsignado of turnosBus) {
            const hInfo = horarios?.find(h => h.id === tAsignado.horario_id);
            if (!hInfo) continue;

            const audit = auditarMovimiento(hInfo.destino, hInfo.hora, geocerca, hora);
            
            if (audit) {
                auditadosCount++;
                // ID Único: BUS_FECHA_HORAPROG
                const docId = `${unitClean}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
                
                batch.set(db.collection('auditoria_viajes').doc(docId), {
                    bus: unitClean,
                    ruta: hInfo.destino,
                    programado: hInfo.hora,
                    gps_llegada: audit.hora_gps,
                    geocerca_wialon: geocerca,
                    retraso_minutos: audit.retraso_minutos,
                    estado: audit.estado,
                    evento: audit.evento,
                    fecha: hoyCol,
                    timestamp: new Date()
                }, { merge: true });
                
                logs.push(`✅ MATCH: ${unitClean} | Prog: ${hInfo.hora} | Real: ${audit.hora_gps} | ${audit.estado}`);
                break;
            }
        }
    }

    if (auditadosCount > 0) await batch.commit();

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            filas_wialon: filas.length,
            auditados: auditadosCount
        },
        logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.json({ error: e.message });
  }
}