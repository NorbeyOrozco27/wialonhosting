// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("SID no obtenido");

  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: desde, to: hasta, flags: 0 },
    remoteExec: 1
  };

  // 1. Ejecutar
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. Espera reducida a 2.5 segundos (suficiente para rangos cortos)
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 3. Traer datos
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 50, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data.error === 5 ? { error_espera: true } : (rowsRes.data || []);
}