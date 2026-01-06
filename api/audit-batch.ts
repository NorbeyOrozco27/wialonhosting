// api/audit-batch.ts - VERSIÓN BLINDADA PARA COMPILAR (CON ESPÍA)
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { obtenerMensajesRaw } from '../lib/wialon.js';
import { auditarMovimiento } from '../lib/util.js';
import { calcularDistancia, obtenerCoordenadas } from '../lib/config.js';
import axios from 'axios';

// Definimos interfaces básicas para calmar a TypeScript
interface Turno {
    vehiculo_id: number;
    horario_id: number;
}
interface Horario {
    id: number;
    hora: string;
    origen: string;
    destino: string;
}

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  let fechaReferencia = new Date();
  
  // 1. Sincronización
  try {
     const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
     const sid = login.data.eid;
     const unitRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`);
     await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
     if (unitRes.data.item?.lmsg) fechaReferencia = new Date(unitRes.data.item.lmsg.t * 1000);
  } catch (e) {}

  const finTS = Math.floor(fechaReferencia.getTime() / 1000);
  const inicioTS = finTS - (24 * 3600); 
  const hoyCol = fechaReferencia.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

  try {
    // 2. SUPABASE
    const { data: plan } = await supabaseA.from('operacion_diaria').select('vehiculo_id, horario_id').eq('fecha', hoyCol);
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino');

    if (!plan || plan.length === 0) return res.json({ msg: `Sin plan para ${hoyCol}` });

    // 3. WIALON
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    
    // Traer todos los buses
    const searchRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1,"from":0,"to":5000}&sid=${sid}`);
    
    const wialonUnitsMap: Record<string, number> = {};
    if (searchRes.data.items) {
        searchRes.data.items.forEach((u: any) => {
             const cleanName = u.nm.replace(/^0+/, '').trim();
             wialonUnitsMap[cleanName] = u.id;
        });
    }
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const busesEnPlan = [...new Set(plan.map((p: any) => {
        const v = vehiculos?.find((v: any) => v.id === p.vehiculo_id);
        return v ? String(v.numero_interno) : null;
    }))].filter(x => x);

    const idsParaConsultar = busesEnPlan.map(num => wialonUnitsMap[num as string]).filter(x => x);
    const trazasGPS = await obtenerMensajesRaw(idsParaConsultar, inicioTS, finTS);

    // 5. AUDITORÍA
    let auditados = 0;
    const logs: string[] = [];
    const espia_rionegro: string[] = [];

    // Cast explícito para evitar error de tipo
    const planTipado = plan as Turno[];

    for (const turno of planTipado) {
        const vInfo = vehiculos?.find((v: any) => v.id === turno.vehiculo_id);
        const hInfo = horarios?.find((h: any) => h.id === turno.horario_id) as Horario;
        
        if (!vInfo || !hInfo) continue;
        
        const numBus = String(vInfo.numero_interno);
        const wialonID = wialonUnitsMap[numBus];
        
        // --- ZONA ESPÍA RIONEGRO ---
        const origenStr = hInfo.origen || "";
        const esRionegro = origenStr.toUpperCase().includes("RIO") || origenStr.toUpperCase().includes("NEGRO");
        
        if (esRionegro && !wialonID) {
            espia_rionegro.push(`❌ Bus ${numBus} (Rionegro) NO ENCONTRADO en Wialon.`);
            continue;
        }

        if (!wialonID) continue;

        const traza = trazasGPS.find((t: any) => t.unitId === wialonID);
        if (!traza || !traza.messages || traza.messages.length === 0) {
            if (esRionegro) espia_rionegro.push(`⚠️ Bus ${numBus} tiene ID pero SIN DATOS GPS.`);
            continue;
        }

        const coordsOrigen = obtenerCoordenadas(origenStr);
        if (!coordsOrigen) {
            if (esRionegro) espia_rionegro.push(`❓ No tengo coordenadas para: "${origenStr}"`);
            continue;
        }

        // Filtro de tiempo (No auditar futuro)
        const [hP, mP] = hInfo.hora.split(':').map(Number);
        const minutosProg = hP * 60 + mP;
        const ahoraCol = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
        const minutosAhora = ahoraCol.getHours() * 60 + ahoraCol.getMinutes();
        if (minutosProg > (minutosAhora + 30)) continue;

        let mejorMatch = null;
        let menorDiferenciaTiempo = 999999;
        let distanciaMinimaDetectada = 999999;

        for (const msg of traza.messages) {
            if (!msg.pos) continue;

            const dist = calcularDistancia(msg.pos.y, msg.pos.x, coordsOrigen.lat, coordsOrigen.lon);
            if (dist < distanciaMinimaDetectada) distanciaMinimaDetectada = dist;

            const fechaGPS = new Date(msg.t * 1000);
            let horasGPS = fechaGPS.getUTCHours() - 5;
            if (horasGPS < 0) horasGPS += 24;
            const minutosGPS = horasGPS * 60 + fechaGPS.getUTCMinutes();

            if (Math.abs(minutosGPS - minutosProg) > 120) continue;

            if (dist < 1500) {
                const diferenciaTiempo = Math.abs(minutosGPS - minutosProg);
                if (diferenciaTiempo < menorDiferenciaTiempo) {
                    menorDiferenciaTiempo = diferenciaTiempo;
                    const diffReal = minutosGPS - minutosProg;
                    
                    let estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO" = "A TIEMPO";
                    if (diffReal > 5) estado = "RETRASADO";
                    if (diffReal < -5) estado = "ADELANTADO";

                    mejorMatch = {
                        hora_real: `${horasGPS.toString().padStart(2,'0')}:${fechaGPS.getUTCMinutes().toString().padStart(2,'0')}:00`,
                        diferencia: diffReal,
                        distancia: Math.round(dist),
                        estado: estado
                    };
                }
            }
        }

        // REPORTE ESPÍA
        if (esRionegro && !mejorMatch) {
            espia_rionegro.push(`📍 Bus ${numBus} en ${origenStr}: Pasó a ${Math.round(distanciaMinimaDetectada)}m (Límite 1500m).`);
        }

        if (mejorMatch) {
            auditados++;
            const docId = `${numBus}_${hoyCol.replace(/-/g, '')}_${hInfo.hora.replace(/:/g, '')}`;
            
            await db.collection('auditoria_viajes').doc(docId).set({
                bus: numBus,
                origen_programado: hInfo.origen,
                destino_programado: hInfo.destino,
                programado: hInfo.hora,
                gps_salida_detectada: mejorMatch.hora_real,
                geocerca_origen: coordsOrigen.nombre,
                distancia_metros: mejorMatch.distancia,
                retraso_minutos: mejorMatch.diferencia,
                estado: mejorMatch.estado,
                evento: "SALIDA",
                fecha: hoyCol,
                timestamp: new Date(),
                origen_datos: "RAW_GPS"
            }, { merge: true });

            logs.push(`✅ SALIDA: ${numBus} desde ${hInfo.origen} | ${mejorMatch.estado}`);
        }
    }

    return res.json({
        success: true,
        resumen: {
            fecha: hoyCol,
            auditorias_generadas: auditados
        },
        ESPIA_RIONEGRO: espia_rionegro,
        logs: logs.slice(0, 50)
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}