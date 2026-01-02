// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Obtener Sesión (SID)
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID. Revisa el WIALON_TOKEN en Vercel.");

  // 2. Ejecutar Informe 18 (Copia fiel de tu rastro de red)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // El ID de T. RIONEGRO según tu rastro
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

  // 3. Pequeña espera para que el motor de Wialon "dibuje" la tabla
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Pedir los datos de la tabla (Index 0 es la tabla de geocercas)
  const tableParams = {
    tableIndex: 0,
    config: { 
        type: "range", 
        data: { from: 0, to: 100, level: 0, unitInfo: 1 } 
    }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 5. Logout para no dejar sesiones abiertas
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Retornamos los datos crudos (si vienen en .rows o directos)
  return Array.isArray(rowsRes.data) ? rowsRes.data : (rowsRes.data.rows || []);
}