// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID");

  // IDs exactos de tu rastro de red exitoso
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18, // Informe 7.1
    reportObjectId: 28775158,
    reportObjectSecId: "17", // Geocerca T. RIONEGRO
    interval: { 
      from: desde, 
      to: hasta, 
      flags: 16777216 // Flag de intervalo completo
    },
    remoteExec: 1
  };

  // 1. Ejecutar el informe
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. Esperar un poco a que Wialon procese los datos
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 3. Traer los datos (Probamos con tableIndex 0 que es el principal)
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Retornamos las filas
  return rowsRes.data || []; 
}