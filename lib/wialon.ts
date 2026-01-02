// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. Parámetros EXACTOS de tu rastro de red (F12)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // ID del objeto geocerca como string
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 16777216 // Flag de reporte ejecutado remotamente
    },
    remoteExec: 1
  };

  // Ejecutamos el reporte
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  if (execRes.data.error) {
    throw new Error(`Wialon Error ${execRes.data.error} en exec_report`);
  }

  // 3. ESPERA CRÍTICA: Damos tiempo a que Wialon guarde el resultado en la sesión
  await new Promise(resolve => setTimeout(resolve, 4000));

  // 4. Seleccionar filas (Usamos la configuración idéntica a tu rastro de red)
  const selectParams = {
    tableIndex: 0,
    config: { 
      type: "range", 
      data: { 
        from: 0, 
        to: 99, 
        level: 0,
        unitInfo: 1 // Este parámetro es el que nos faltaba
      } 
    }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  if (rowsRes.data.error) {
    // Si da error 5, retornamos el error para verlo en el navegador
    return { error_wialon: rowsRes.data.error, raw: rowsRes.data };
  }

  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || [];
}