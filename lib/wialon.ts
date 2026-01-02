// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No hay SID");

  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: desde, to: hasta, flags: 0 },
    remoteExec: 0 // Usamos 0 como en tu prueba exitosa
  };

  // 1. Ejecutar
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. ESPERA DE SEGURIDAD (5 segundos para asegurar que el buffer esté lleno)
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 3. Traer datos (select_result_rows)
  const selectParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 64, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // En tu captura, los datos vienen directamente en rowsRes.data
  return rowsRes.data || [];
}