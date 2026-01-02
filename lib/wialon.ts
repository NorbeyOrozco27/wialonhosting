// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. Ejecutar informe 18 sobre el Grupo de Buses 28843634
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28843634, // ID del Grupo [BUSES AFILIADO]
    reportObjectSecId: 0,
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 0 
    },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // Verificamos cuántas filas dice Wialon que generó
  const rowCount = execRes.data?.reportResult?.tables[0]?.rows || 0;
  console.log(`Wialon reportó ${rowCount} movimientos encontrados.`);

  if (rowCount === 0) return [];

  // 3. Esperar a que el motor de Wialon termine de escribir la tabla
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Traer los datos reales
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: rowCount, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || []; 
}