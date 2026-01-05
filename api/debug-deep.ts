// api/debug-deep.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. CONFIGURACIÓN DE PRUEBA (UNITARIA)
    const RESOURCE_ID = 28775158;
    const TEMPLATE_ID = 7; 
    
    // CAMBIO CLAVE: Usamos el ID de UN SOLO BUS (sacado de tu captura anterior)
    // Bus 28645824
    const OBJECT_ID = 28645824; 

    const now = Math.floor(Date.now() / 1000);
    const from = now - (48 * 3600); // Últimas 48 horas

    // 3. EJECUTAR REPORTE
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: OBJECT_ID, // <-- AHORA ES UNA UNIDAD
      reportObjectSecId: 0,
      interval: { from: from, to: now, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`
    );

    // 4. ESPERAR
    let status = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
    }

    // 5. OBTENER RESULTADO
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    // Si hay tablas, intentamos leer la primera fila para ver qué trae
    let muestraFilas = [];
    if (applyRes.data && applyRes.data.tables && applyRes.data.tables.length > 0) {
        // Buscamos la tabla con más filas
        const tablaIndex = applyRes.data.tables.findIndex((t: any) => t.rows > 0);
        
        if (tablaIndex >= 0) {
            const rowsRes = await axios.get(
                `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params={"tableIndex":${tablaIndex},"config":{"type":"range","data":{"from":0,"to":5,"level":0,"unitInfo":1}}}&sid=${sid}`
            );
            muestraFilas = rowsRes.data;
        }
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 6. RESPUESTA
    res.status(200).json({
      prueba_unidad: {
        id_bus: OBJECT_ID,
        mensaje: "Probando reporte sobre un solo bus para verificar datos"
      },
      tablas: applyRes.data.tables ? applyRes.data.tables.map((t: any, idx: number) => ({
        INDICE: idx,
        NOMBRE: t.label,
        FILAS: t.rows
      })) : [],
      muestra_datos: muestraFilas
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}