// lib/wialon.ts
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
  const sid = loginRes.data.eid;

  if (!sid) throw new Error("No se pudo obtener SID de Wialon");

  // IDs EXTRAÍDOS DE TU RASTRO DE RED (Network Tab)
  const reportParams = {
    reportResourceId: 28775158, // ID de la cuenta maestra
    reportTemplateId: 18,       // ID del informe 7.1
    reportObjectId: 28843634,   // <--- ID DEL GRUPO [BUSES AFILIADO] (Corregido)
    reportObjectSecId: 0,       // Para grupos se usa 0 si el ObjectId es el grupo
    interval: { 
      from: desde, 
      to: hasta, 
      flags: 0 
    },
    remoteExec: 1
  };

  const execRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
  
  const rowCount = execRes.data?.reportResult?.rowCount || 0;
  console.log(`Wialon encontró ${rowCount} filas en el grupo.`);

  if (rowCount === 0) return [];

  await new Promise(resolve => setTimeout(resolve, 3000));

  const tableParams = {
    tableIndex: 0,
    config: { type: "range", data: { from: 0, to: rowCount, level: 0, unitInfo: 1 } }
  };
  
  const rowsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_data&params=${JSON.stringify(tableParams)}&sid=${sid}`);
  
  await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

  return rowsRes.data.rows || rowsRes.data || []; 
}