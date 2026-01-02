// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("Error de SID: Revisa el Token en Vercel.");

  // Parámetros basados en tu captura exitosa del F12
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  // 1. ORDENAR ejecución del informe
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  if (execRes.data.error) throw new Error(`Error en exec_report: ${execRes.data.error}`);

  // 2. PRIMERA ESPERA: Damos 3 segundos para que Wialon procese en sus servidores
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. SELECCIONAR FILAS (Paso clave para evitar Error 5)
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  // Reintento interno si sale error 5
  let rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);

  if (rowsRes.data.error === 5) {
      console.log("Wialon pidió más tiempo (Error 5). Esperando 3s más...");
      await new Promise(resolve => setTimeout(resolve, 3000));
      rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  }

  // 4. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || [];
}