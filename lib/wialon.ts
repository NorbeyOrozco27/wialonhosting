// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No hay SID. Revisa el TOKEN en Vercel.");

  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  // 1. Pedimos a Wialon que empiece el reporte
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. ESPERA CALCULADA: Wialon necesita tiempo para "dibujar" la tabla en su memoria
  await new Promise(resolve => setTimeout(resolve, 6000)); // Aumentamos a 6 segundos

  // 3. Intentamos traer los datos
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  let rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);

  // Si sale error 5 (no listo), intentamos una última vez antes de rendirnos
  if (rowsRes.data.error === 5) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  }

  // 4. Logout (Muy importante para no bloquear la cuenta)
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Devolvemos las filas o el error para diagnóstico
  return rowsRes.data.error ? { error_wialon: rowsRes.data.error } : (rowsRes.data || []);
}