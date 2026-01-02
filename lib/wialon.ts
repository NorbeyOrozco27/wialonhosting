// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. Ejecutar informe
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17",
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // Si Wialon devuelve error en la ejecución, lo capturamos aquí
  if (execRes.data.error) {
    return { error_wialon: execRes.data };
  }

  // 3. Esperar proceso
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Pedir los datos de la tabla
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // IMPORTANTE: Retornamos las filas si existen, si no un array vacío
  return rowsRes.data.rows || (Array.isArray(rowsRes.data) ? rowsRes.data : []); 
}