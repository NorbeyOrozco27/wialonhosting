// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  // 1. Login
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // 2. Ejecutar informe (Ajustado según tu rastro de red exacto)
  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", // Importante: como string
    interval: { 
      from: Math.floor(desde), 
      to: Math.floor(hasta), 
      flags: 0 // Usamos 0 para que respete el rango exacto 'from' y 'to'
    },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // Verificamos si Wialon encontró algo
  const rowCount = execRes.data?.reportResult?.rowCount || 0;
  console.log(`Wialon dice que hay ${rowCount} filas listas.`);

  if (rowCount === 0) {
    return []; // No hay datos que procesar
  }

  // 3. Esperar un momento a que el servidor de Wialon libere los datos
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Traer los datos de la tabla
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: rowCount, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  // 5. Logout
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data || []; 
}