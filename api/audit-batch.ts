// api/audit-batch.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { obtenerMensajesRaw } from '../lib/wialon.js';
import { RUTAS_MAESTRAS, identificarRuta, calcularDistancia } from '../lib/config.js';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  // 1. DEFINIR FECHA (HOY COLOMBIA)
  // Ajuste manual: Si estás probando datos históricos de Enero 6, usa esa fecha.
  // Para producción automática: new Date()
  const fechaAnalisis = new Date(); 
  // const fechaAnalisis = new Date("2026-01-05T12:00:00-05:00"); // Descomentar para forzar fecha

  const hoyCol = fechaAnalisis.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  
  // Timestamps UNIX para Wialon
  const finTS = Math.floor(fechaAnalisis.getTime() / 1000);
  const inicioTS = finTS - (24 * 3600); // Últimas 24h

  try {
    // 2. OBTENER PLAN SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. OBTENER IDS DE WIALON
    // Necesitamos mapear numero_interno (ej: "143") a ID de Wialon (ej: 28865342)
    // Para no hacer 600 peticiones, descargamos todos los buses del grupo TRANSUNIDOS
    // y hacemos el match en memoria.
    
    const token = process.env.WIALON_TOKEN;
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    
    // Buscar todos los buses del grupo
    const groupRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28865342,"flags":1}&sid=${sid}`);
    const wialonUnitIds = groupRes.data.item?.u || [];
    
    // Obtener nombres de esos buses para saber cuál es cual
    // (Esto es pesado, pero necesario una vez. En producción se cachea).
    // Para hacerlo rápido ahora: Vamos a bajar datos de los buses que están en el PLAN.
    
    // Mapeo manual rápido: Supabase ID -> Wialon ID
    // Como no tenemos el ID de Wialon en Supabase, tenemos que buscarlo.
    // ESTRATEGIA OPTIMIZADA: Buscar en Wialon las unidades que coincidan con los números del plan.
    
    const busesEnPlan = [...new Set(plan.map(p => {
        const v = vehiculos?.find(v => v.id === p.vehiculo_id);
        return v ? v.numero_interno : null;
    }))].filter(x => x);

    // Buscamos los IDs de Wialon para estos números
    const searchSpec = {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*", // Traemos todos y filtramos en JS para asegurar
        sortType: "sys_name"
    };
    const searchRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":${JSON.stringify(searchSpec)},"force":1,"flags":1,"from":0,"to":5000}&sid=${sid}`);
    
    const wialonUnitsMap: Record<string, number> = {}; // "143" -> 234523
    if (searchRes.data.items) {
        searchRes.data.items.forEach((u: any) => {
             // Limpiar nombre: "0143" -> "143"
             const cleanName = u.nm.replace(/^0+/, '').trim();
             wialonUnitsMap[cleanName] = u.id;
        });
    }
    
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 4. DESCARGAR TRAZAS GPS
    const idsParaConsultar = busesEnPlan.map(num => wialonUnitsMap[String(num)]).filter(x => x);
    console.log(`🚌 Consultando GPS para ${idsParaConsultar.length} buses programados hoy.`);

    const trazasGPS = await obtenerMensajesRaw(idsParaConsultar, inicioTS, finTS);

    // 5. EL GRAN CRUCE (AUDITORÍA)
    let auditados = 0;
    const batch = db.batch();
    const logs: string[] = [];

    for (const turno of plan) {
        const vInfo = vehiculos?.find(v => v.id === turno.vehiculo_id);
        const hInfo = horarios?.find(h => h.id === turno.horario_id);
        
        if (!vInfo || !hInfo) continue;
        
        const numBus = String(vInfo.numero_interno);
        const wialonID = wialonUnitsMap[numBus];
        
        if (!wialonID) {
            // logs.push(`⚠️ Bus ${numBus} no encontrado en Wialon`);
            continue;
        }

        const traza = trazasGPS.find(t => t.unitId === wialonID);
        if (!traza || traza.messages.length === 0) continue;

        // DATOS DEL TURNO
        const categoria = identificarRuta(hInfo.destino);
        if (!categoria) continue;

        const config = RUTAS_MAESTRAS[categoria];
        // Auditamos LLEGADA al destino (último checkpoint)
        const cp = config.checkpoints[config.checkpoints.length - 1]; 

        // Convertir hora programada a timestamp para comparar
        const [hP, mP] = hInfo.hora.split(':').map(Number);
        // Asumimos que la fecha es hoyCol
        // Ojo: Ajustar a zona horaria correcta
        const fechaTurno = new Date(fechaAnalisis); // Clona hoy
        // Ajustamos la hora del objeto fechaTurno a la del horario
        // Esto es truco porque 'hora' es string. Mejor comparación simple en minutos.
        const minutosProgramadosDia = hP * 60 + mP;

        // BUSCAR EN LA TRAZA: ¿Pasó cerca del destino a una hora razonable?
        let mejorMatch = null;
        let menorDistancia = 999999;

        for (const msg of traza.messages) {
            if (!msg.pos) continue;
            
            // Hora del mensaje GPS (UTC -> Colombia -5)
            const fechaGPS = new Date(msg.t * 1000);
            const horasGPSCol = fechaGPS.getUTCHours() - 5; 
            const horaFinalGPS = horasGPSCol < 0 ? horasGPSCol + 24 : horasGPSCol;
            const minutosGPSDia = horaFinalGPS * 60 + fechaGPS.getUTCMinutes();

            // Solo miramos puntos dentro de una ventana de tiempo (ej: +/- 2 horas del turno)
            if (Math.abs(minutosGPSDia - minutosProgramadosDia) > 120) continue;

            const dist = calcularDistancia(msg.pos.y, msg.pos.x, cp.lat, cp.lon);
            
            // Si está dentro del radio de la terminal (ej: 800m)
            if (dist < 800) {
                // Nos quedamos con el punto más cercano o el primero que entró
                if (dist < menorDistancia) {
                    menorDistancia = dist;
                    mejorMatch = {
                        hora_real: `${horaFinalGPS.toString().padStart(2,'0')}:${fechaGPS.getUTCMinutes().toString().padStart(2,'0')}`,
                        diferencia: minutosGPSDia - minutosProgramadosDia,
                        distancia: Math.round(dist)
                    };
                }
            }
        }

        if (mejorMatch) {
            auditados++;
            const estado = mejorMatch.diferencia > 10 ? "RETRASADO" : (mejorMatch.diferencia < -10 ? "ADELANTADO" : "A TIEMPO");
            
            const docId = `${numBus}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
            
            // Escritura directa por seguridad
            await db.collection('auditoria_viajes').doc(docId).set({
                bus: numBus,
                ruta: hInfo.destino,
                programado: hInfo.hora,
                gps_llegada: mejorMatch.hora_real,
                geocerca_detectada: cp.nombre,
                distancia_metros: mejorMatch.distancia,
                retraso_minutos: mejorMatch.diferencia,
                estado: estado,
                fecha: hoyCol,
                timestamp: new Date(),
                origen: "RAW_GPS"
            }, { merge: true });

            logs.push(`✅ ${numBus} -> ${cp.nombre}: Prog ${hInfo.hora}, Real ${mejorMatch.hora_real} (${estado})`);
        }
    }

    return res.json({
        success: true,
        fecha: hoyCol,
        buses_con_plan: busesEnPlan.length,
        buses_con_gps: trazasGPS.length,
        auditorias_generadas: auditados,
        logs: logs
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}