import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Obtener SID
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  // 2. Ejecutar el informe 18 (7.1 Informe de Geocercas)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: 17,
    interval: { from: desde, to: hasta, flags: 16777216 },
    remoteExec: 1
  };

  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 3. Traer los datos de la tabla (las primeras 100 filas)
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: 100, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 4. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data; 
}