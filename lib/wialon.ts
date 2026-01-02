// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No hay SID");

  // USAMOS LOS PARÁMETROS QUE VIMOS EN TU F12
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // ID del objeto como string
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 16777216 // Flag de intervalo manual/remoto
    },
    remoteExec: 1
  };

  // 1. Ejecutar informe
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // LOG PARA DEPURAR: Queremos ver cuántas filas dice Wialon que hay
  console.log("Respuesta Exec:", JSON.stringify(execRes.data.reportResult?.tables[0]));

  // 2. Espera de 4 segundos para que el servidor de Wialon "llene" la tabla
  await new Promise(resolve => setTimeout(resolve, 4000));

  // 3. Traer los datos (select_result_rows es el más confiable)
  const selectParams = {
    tableIndex: 0,
    config: { 
      type: "range", 
      data: { from: 0, to: 50, level: 0, unitInfo: 1 } 
    }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`);
  
  // Cerrar sesión
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data; 
}