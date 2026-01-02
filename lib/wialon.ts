// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. Ejecutar Informe (IDs exactos de tu rastro de red)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // Importante: como String
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 16777216 
    },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  if (execRes.data.error) {
    throw new Error(`Error Wialon exec_report: ${execRes.data.error}`);
  }

  // 3. Esperar a que el motor de Wialon genere las filas
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. SELECCIONAR FILAS (Cambiamos el servicio aquí)
  // Este es el que nos da el array 'c' con los datos del bus
  const selectParams = {
    tableIndex: 0,
    config: { 
      type: "range", 
      data: { from: 0, to: 100, level: 0 } 
    }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Retornamos las filas directamente
  return rowsRes.data || [];
}