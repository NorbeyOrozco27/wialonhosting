// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) {
    throw new Error(`Error de autenticación Wialon: ${JSON.stringify(loginRes.data)}`);
  }

  // 2. Ejecutar el informe 18 (Exactamente como en tu rastro de red)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // <--- DEBE SER STRING como en el rastro
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 16777216 
    },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  if (execRes.data.error) {
    throw new Error(`Error en exec_report: ${execRes.data.error} - ${JSON.stringify(execRes.data)}`);
  }

  // 3. Esperar a que Wialon termine de calcular
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 4. Traer los datos de la tabla
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Devolvemos las filas reales
  return rowsRes.data.rows || rowsRes.data || []; 
}