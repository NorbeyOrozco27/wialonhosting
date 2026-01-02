// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Obtener Sesión (SID)
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo iniciar sesión en Wialon. Revisa el TOKEN.");

  // 2. Parámetros del informe (IDs como NÚMEROS, sin comillas)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: 17, // Número, no texto
    interval: { 
        from: Math.floor(desde), 
        to: Math.floor(hasta), 
        flags: 16777216 
    },
    remoteExec: 1
  };

  // 3. Ejecutar informe
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  if (execRes.data.error) {
      throw new Error(`Error en exec_report: ${JSON.stringify(execRes.data)}`);
  }

  // 4. Esperar a que Wialon procese
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 5. Traer filas de la tabla
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 6. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data.rows || rowsRes.data || []; 
}