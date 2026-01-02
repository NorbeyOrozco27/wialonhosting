// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No hay SID. Revisa el TOKEN en Vercel.");

  // USAMOS LOS PARÁMETROS EXACTOS DE TU RASTRO DE RED EXITOSO
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158, // El ID del recurso como objeto principal
    reportObjectSecId: "17",  // El ID de la geocerca T. RIONEGRO
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  // 1. Pedimos ejecución
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. Espera corta de 3 segundos (suficiente para un rango de 1 hora)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Pedimos las filas
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 50, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);

  // Cerramos sesión de inmediato
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  if (rowsRes.data.error === 5) return { error_espera: true };
  return rowsRes.data || [];
}