// api/audit-sync.ts
import axios from 'axios';
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarMovimiento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. OBTENER UN BUS REFERENCIA PARA SABER "QUÉ DÍA ES HOY" EN WIALON
    // Usamos el ID del bus que sabemos que existe: 28645824
    const unitRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`
    );
    
    const bus = unitRes.data.item;
    if (!bus || !bus.lmsg) {
        return res.json({ error: "El bus de referencia no tiene datos recientes. Wialon parece vacío." });
    }

    // ESTE ES EL SECRETO: Usamos la hora del último mensaje del bus, no la del servidor
    const ultimoMensajeTS = bus.lmsg.t; 
    const fechaRealWialon = new Date(ultimoMensajeTS * 1000);
    
    console.log(`⏱️ Tiempo Servidor: ${new Date().toISOString()}`);
    console.log(`⏱️ Tiempo Real Wialon: ${fechaRealWialon.toISOString()}`);

    // Definimos el rango: Las 24 horas previas al último mensaje del bus
    const finTS = ultimoMensajeTS;
    const inicioTS = finTS - (24 * 3600);
    
    const hoyCol = fechaRealWialon.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});

    // 3. OBTENER UNIDADES DEL GRUPO TRANSUNIDOS
    const GROUP_ID = 28865342;
    const groupRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${GROUP_ID},"flags":1}&sid=${sid}`
    );
    const unitIds = groupRes.data.item?.u || [];

    // 4. EJECUTAR REPORTE SINCRONIZADO
    const RESOURCE_ID = 28775158;
    const TEMPLATE_ID = 7; 

    // Limpieza previa
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);

    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: RESOURCE_ID,
      reportObjectIdList: unitIds, // Lista completa de buses
      interval: { from: inicioTS, to: finTS, flags: 0 }, // RANGO CORREGIDO
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`
    );

    // Esperar reporte
    let status = 0;
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
        status = parseInt(sRes.data.status);
        if (status === 4) break;
    }

    // Aplicar resultados
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    // Buscar la tabla correcta (la que tenga filas)
    const tables = applyRes.data.tables || [];
    let targetIdx = -1;
    let maxRows = 0;
    tables.forEach((t: any, idx: number) => {
        if (t.rows > maxRows) { maxRows = t.rows; targetIdx = idx; }
    });

    let filasWialon = [];
    if (targetIdx >= 0 && maxRows > 0) {
        const rowsRes = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params={"tableIndex":${targetIdx},"config":{"type":"range","data":{"from":0,"to":${maxRows-1},"level":2,"unitInfo":1}}}&sid=${sid}`
        );
        filasWialon = rowsRes.data;
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // ==========================================
    // AHORA CRUZAMOS CON SUPABASE USANDO LA FECHA CORRECTA
    // ==========================================
    
    const { data: plan } = await supabaseA.from('operacion_diaria')
      .select('vehiculo_id, horario_id')
      .eq('fecha', hoyCol); // Usamos la fecha que Wialon nos dijo
    
    const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
    const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, destino');

    if (!plan || plan.length === 0) {
        return res.json({ 
            success: true, 
            mensaje: `Wialon trajo ${filasWialon.length} filas del día ${hoyCol}, pero NO hay plan en Supabase para esa fecha.`,
            wialon_fecha_detectada: hoyCol
        });
    }

    // Procesar Auditoría
    let auditadosCount = 0;
    const batch = db.batch();
    const logs: string[] = [];

    // Normalizar y Procesar filas
    const filasPlanas: any[] = [];
    // (Lógica de aplanado simplificada)
    filasWialon.forEach((row: any) => {
        if (row.c && row.c.length >= 2) filasPlanas.push(row);
        if (row.r) row.r.forEach((h: any) => { if(h.c) filasPlanas.push(h); });
    });

    for (const row of filasPlanas) {
        // Intentar sacar datos de las columnas 0, 1, 2
        // Nota: Depende de tu reporte, a veces geocerca es col 0 o 1
        const valA = row.c[0]?.t || "";
        const valB = row.c[1]?.t || "";
        const valC = row.c[2]?.t || "";

        // Heurística básica: Buscar cuál parece una hora y cuál una geocerca
        const hora = [valA, valB, valC].find(v => String(v).includes(":"));
        const geocerca = [valA, valB, valC].find(v => v !== hora && !String(v).match(/^\d+$/)); // Que no sea solo números (bus)
        
        // El bus suele venir en el contexto 'unitInfo' si usamos level 2, o en la fila padre
        // Por simplicidad, asumimos que 'unitInfo' funcionó o que está en una columna
        // Para este fix rápido, iteramos todos los vehículos si no encontramos el bus en la fila
        
        // ... (Aquí iría la lógica completa de matching, pero primero veamos si trae datos)
        if (hora && geocerca) auditadosCount++; // Simulación de conteo
    }

    res.status(200).json({
        success: true,
        sincronizacion: {
            tiempo_servidor: new Date().toISOString(),
            tiempo_wialon: fechaRealWialon.toISOString(),
            fecha_usada: hoyCol
        },
        resultados: {
            filas_wialon_encontradas: filasWialon.length,
            filas_procesables: filasPlanas.length,
            plan_supabase_encontrado: plan.length,
            coincidencias_potenciales: auditadosCount
        },
        ejemplo_fila: filasPlanas.length > 0 ? filasPlanas[0] : "Nada"
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}