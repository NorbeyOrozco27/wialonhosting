// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST');

  const { unit_name, geofence_name, event_time } = req.body;

  try {
    // 1. LIMPIEZA Y FECHA AUTOMÁTICA (Colombia)
    const unitNameClean = unit_name.replace(/^0+/, '');
    const hoyCol = new Date().toLocaleString("en-CA", {timeZone: "America/Bogota"}).split(',')[0];

    // 2. CONSULTA SEGURA (Mundo A): Traemos las 3 piezas por separado para evitar el Error 500
    const { data: plan } = await supabaseA
      .from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol);

    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');

    if (!plan || !vehiculos || !horarios) {
        return res.status(200).json({ msg: "Error al cargar maestros de Supabase" });
    }

    // 3. MATCH INTELIGENTE: Buscamos el bus y el turno más cercano a la hora del GPS
    const vInfo = vehiculos.find(v => String(v.numero_interno) === unitNameClean);
    if (!vInfo) return res.status(200).json({ msg: `Bus ${unitNameClean} no existe en la base de datos.` });

    // Filtramos los turnos de este bus para hoy
    const turnosHoy = plan.filter(p => p.vehiculo_id === vInfo.id);
    
    // Parseamos la hora actual del GPS para buscar proximidad
    const tiempoGpsRaw = event_time.includes(' ') ? event_time.split(' ')[1] : event_time;
    const [hG, mG] = tiempoGpsRaw.split(':').map(Number);
    const minutosGps = hG * 60 + mG;

    let mejorTurno: any = null;
    let difMinima = 120; // Ventana de 2 horas para asociar el evento

    for (const p of turnosHoy) {
        const hInfo = horarios.find(h => h.id === p.horario_id);
        if (hInfo) {
            const [hP, mP] = hInfo.hora.split(':').map(Number);
            const diff = Math.abs(minutosGps - (hP * 60 + mP));
            if (diff < difMinima) {
                difMinima = diff;
                mejorTurno = { ...p, ...hInfo };
            }
        }
    }

    if (!mejorTurno) {
      return res.status(200).json({ msg: "El evento GPS no coincide con ningún turno programado para hoy." });
    }

    // 4. AUDITORÍA NARRATIVA (Usa auditarMovimiento de util.ts)
    const audit = auditarMovimiento(
        mejorTurno.origen, 
        mejorTurno.destino, 
        mejorTurno.hora, 
        geofence_name, 
        event_time
    );

    if (!audit) {
      return res.status(200).json({ msg: "Punto de paso no auditable (Taller u otro)." });
    }

    // 5. GUARDAR EN MUNDO B (Firebase)
    const idComp = mejorTurno.hora.substring(0,5).replace(':','');
    const viajeId = `${unitNameClean}_${hoyCol.replace(/-/g,'')}_${idComp}`;
    
    const docRef = db.collection('auditoria_viajes').doc(viajeId);

    // Guardamos con MERGE para tener Salida y Llegada en el mismo ticket
    await docRef.set({
      bus: unitNameClean,
      ruta: `${mejorTurno.origen} -> ${mejorTurno.destino}`,
      programado: mejorTurno.hora,
      [audit.evento === "SALIDA" ? "salida_real" : "llegada_real"]: audit.hora_gps,
      [audit.evento === "SALIDA" ? "diff_salida" : "diff_llegada"]: audit.retraso_salida || audit.retraso_llegada,
      estado_actual: audit.estado,
      fecha: hoyCol,
      ultima_actualizacion: new Date()
    }, { merge: true });

    return res.status(200).json({ 
        success: true, 
        evento: audit.evento, 
        bus: unitNameClean,
        retraso: audit.retraso_salida || audit.retraso_llegada 
    });

  } catch (e: any) {
    console.error("Error en Webhook:", e.message);
    return res.status(500).json({ error: e.message });
  }
}