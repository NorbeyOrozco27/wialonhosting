// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. LOGIN
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;
  
  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. EJECUTAR REPORTE (Petición liviana de 30 min)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { from: Math.floor(desde), to: Math.floor(hasta), flags: 0 },
    remoteExec: 1
  };

  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 3. ESPERA DE SEGURIDAD (Wialon necesita un respiro)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. DESCARGAR DATOS (Aquí estaba el error de nombre)
  const parametrosSeleccion = { // <--- Lo llamamos así para que sea claro
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 50, level: 0, unitInfo: 1 } }
  };
  
  // Usamos el nombre correcto: parametrosSeleccion
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(parametrosSeleccion)}&sid=${sid}`);
  
  // 5. LOGOUT (Para no dejar la puerta abierta)
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  if (rowsRes.data.error) return { error_wialon: rowsRes.data.error };
  return rowsRes.data || [];
}