// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No hay SID.");

  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  // 1. Ejecutar el reporte
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);

  // 2. POLLING (Preguntar si ya está listo)
  // Haremos hasta 3 intentos de espera de 1.5 segundos para no agotar a Vercel
  let listo = false;
  let intentos = 0;
  let rowCount = 0;

  while (!listo && intentos < 3) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const statusRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
    
    // Si el status devuelve algo en 'tables', es que ya terminó de calcular
    if (statusRes.data && statusRes.data.tables) {
      rowCount = statusRes.data.tables[0]?.rows || 0;
      listo = true;
    }
    intentos++;
  }

  if (!listo) {
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      return { error_wialon: 5, msg: "Wialon tardó demasiado. Reintenta." };
  }

  // 3. Seleccionar las filas (Solo si rowCount > 0)
  if (rowCount === 0) {
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      return [];
  }

  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: rowCount, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);

  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || [];
}