// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID");

  const reportParams = {
    reportResourceId: 28775158,
    reportTemplateId: 18,
    reportObjectId: 28775158,
    reportObjectSecId: "17", 
    interval: { 
      from: desde, 
      to: hasta, 
      flags: 16777216 // Flag de intervalo manual
    },
    remoteExec: 1
  };

  // 1. Ejecutar el informe
  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  // 2. Extraer el número de filas de forma segura
  // Wialon a veces lo pone en reportResult.tables[0].rows o en rowCount
  const tables = execRes.data?.reportResult?.tables || [];
  const rowCount = tables.length > 0 ? tables[0].rows : 0;
  
  console.log(`Wialon detectó ${rowCount} filas en la tabla.`);

  // 3. Si no hay filas, intentamos pedir al menos las primeras 50 por si el conteo falló
  const filasAPedir = rowCount > 0 ? rowCount : 50;

  // 4. Pequeña espera para que Wialon procese
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 5. Traer los datos
  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: filasAPedir, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  // Retornamos las filas reales o el objeto completo para diagnosticar
  return rowsRes.data.rows || rowsRes.data || [];
}