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
    interval: { from: desde, to: hasta, flags: 0 }, // Flags 0 es más rápido
    remoteExec: 1
  };

  // 1. Iniciar reporte
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. ESPERA CORTA (Solo 3 segundos, para no agotar a Vercel)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Traer solo 50 filas (Suficiente para una ventana de 4 horas)
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 50, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  // Si sigue dando error 5, devolvemos un aviso limpio
  if (rowsRes.data.error === 5) return { error_espera: true };

  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || [];
}