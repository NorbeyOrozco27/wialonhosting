// api/debug-tables.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. CONFIGURACIÓN (Tus IDs confirmados)
    const RESOURCE_ID = 28775158;
    const TEMPLATE_ID = 7; 
    const OBJECT_ID = 28865342; // Grupo Transunidos

    // Rango: Últimas 48 horas para asegurar que haya algo
    const now = Math.floor(Date.now() / 1000);
    const from = now - (48 * 3600);

    // 3. EJECUTAR REPORTE
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: OBJECT_ID,
      reportObjectSecId: 0,
      interval: { from: from, to: now, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`
    );

    // 4. ESPERAR RESULTADO
    let status = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
    }

    // 5. OBTENER METADATA DE TABLAS (ESTA ES LA CLAVE)
    // Esto nos dirá qué tablas se generaron y cuántas filas tienen
    const tablesRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_tables&params={}&sid=${sid}`);
    
    // Obtener filas de la primera tabla que tenga datos
    let muestraDatos = null;
    const tablas = tablesRes.data;
    
    // Buscamos una tabla que tenga filas ('rows' > 0)
    for (let i = 0; i < tablas.length; i++) {
        if (tablas[i].rows > 0) {
            // Pedimos 3 filas de muestra
            const rowsRes = await axios.get(
                `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params={"tableIndex":${i},"config":{"type":"range","data":{"from":0,"to":2,"level":0,"unitInfo":1}}}&sid=${sid}`
            );
            muestraDatos = {
                tabla_usada: i,
                nombre_tabla: tablas[i].label,
                filas_crudas: rowsRes.data
            };
            break; // Solo necesitamos una muestra
        }
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    res.status(200).json({
      success: true,
      mensaje: "Analiza la lista 'tablas_encontradas' para ver cuál tiene datos (rows > 0)",
      tablas_encontradas: tablesRes.data.map((t: any, index: number) => ({
        INDICE: index, // <--- ESTE ES EL NÚMERO QUE NECESITAMOS
        NOMBRE: t.label,
        TIPO: t.name,
        FILAS: t.rows,
        COLUMNAS: t.header
      })),
      muestra_datos: muestraDatos
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}