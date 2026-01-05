// lib/wialon.ts - VERSIÓN FINAL CORREGIDA
import axios from 'axios';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("WIALON_TOKEN faltante");

  let sid = '';
  
  try {
    // 1. LOGIN
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    // 2. LIMPIEZA PREVENTIVA (Evita error 5 por sesión sucia)
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);

    // 3. EJECUTAR REPORTE
    // IMPORTANTE: Reemplaza estos IDs con los que te dé api/diagnostico
    const RESOURCE_ID = 28775158; 
    const TEMPLATE_ID = 18; 
    
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: RESOURCE_ID, // Usualmente se ejecuta sobre el mismo recurso (grupo)
      reportObjectSecId: 0,
      interval: { from: desde, to: hasta, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`
    );
    
    if (execRes.data.error) throw new Error(`Error Exec: ${execRes.data.error}`);

    // 4. ESPERAR (POLLING)
    let status = 0;
    for (let i = 0; i < 30; i++) { // 30 segundos máx
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(statusRes.data.status);
      if (status === 4) break;
      if (status > 4) throw new Error(`Reporte falló estado: ${status}`);
    }

    if (status !== 4) throw new Error("Timeout esperando reporte");

    // 5. APLICAR RESULTADOS
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    // 6. OBTENER FILAS
    // Primero intentamos select_result_rows que es más estable para paginación
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 Filas detectadas: ${totalRows}`);
    
    if (totalRows === 0) {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        return [];
    }

    const rowsParams = {
      tableIndex: 0,
      config: {
        type: "range",
        data: { from: 0, to: totalRows - 1, level: 0, unitInfo: 1 }
      }
    };

    const rowsRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`
    );

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 7. NORMALIZAR
    const rawData = rowsRes.data;
    if (!Array.isArray(rawData)) return [];

    // Convertir al formato estándar { c: [{t:val}, {t:val}] }
    return rawData.map((row: any) => {
        if (row.c) return row;
        // Si viene plano, lo envolvemos
        if (Array.isArray(row)) return { c: row.map((val: any) => ({ t: val })) };
        return { c: [] };
    });

  } catch (e: any) {
    if (sid) await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`).catch(()=>{});
    console.error("Wialon Error:", getErrorMessage(e));
    return [];
  }
}