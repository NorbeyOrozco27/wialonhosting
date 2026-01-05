// api/debug-wialon.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
    return res.status(500).json({ 
      success: false, 
      error: "No hay token de Wialon" 
    });
  }

  try {
    // 1. LOGIN
    const loginUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`;
    const loginRes = await axios.get(loginUrl);
    const sid = loginRes.data.eid;

    if (!sid) {
      return res.status(500).json({ 
        success: false, 
        error: "No se pudo obtener SID",
        respuesta_login: loginRes.data 
      });
    }

    // 2. EJECUTAR REPORTE (últimas 4 horas)
    const ahora = Math.floor(Date.now() / 1000);
    const inicio = ahora - (4 * 3600);
    
    const reportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 18,
      reportObjectId: 28775158,
      reportObjectSecId: "17", 
      interval: { from: inicio, to: ahora, flags: 0 },
      remoteExec: 0
    };

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`);
    
    // 3. ESPERAR
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. OBTENER DATOS CON DIFERENTES MÉTODOS
    const resultados: any = {};
    
    // Método 1: select_result_rows (el que estás usando)
    const selectParams1 = {
      tableIndex: 0,
      config: { type: "range", data: { from: 0, to: 10, level: 0, unitInfo: 1 } }
    };
    
    const rowsRes1 = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams1)}&sid=${sid}`);
    resultados.metodo_1_select_result_rows = rowsRes1.data;
    
    // Método 2: get_result_rows (alternativo)
    const selectParams2 = {
      tableIndex: 0,
      indexFrom: 0,
      indexTo: 10
    };
    
    const rowsRes2 = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_result_rows&params=${JSON.stringify(selectParams2)}&sid=${sid}`);
    resultados.metodo_2_get_result_rows = rowsRes2.data;
    
    // Método 3: export_report (formato raw)
    const exportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 18,
      reportObjectId: 28775158,
      reportObjectSecId: "17",
      interval: { from: inicio, to: ahora, flags: 0 },
      type: "xls"
    };
    
    const exportRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/export_report&params=${JSON.stringify(exportParams)}&sid=${sid}`);
    resultados.metodo_3_export_report = exportRes.data;

    // 5. LOGOUT
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 6. ANALIZAR ESTRUCTURA
    const analisis = {
      metodo_1: {
        tipo: typeof resultados.metodo_1_select_result_rows,
        es_array: Array.isArray(resultados.metodo_1_select_result_rows),
        longitud: Array.isArray(resultados.metodo_1_select_result_rows) ? resultados.metodo_1_select_result_rows.length : 'N/A',
        keys: resultados.metodo_1_select_result_rows && typeof resultados.metodo_1_select_result_rows === 'object' 
          ? Object.keys(resultados.metodo_1_select_result_rows) 
          : []
      },
      metodo_2: {
        tipo: typeof resultados.metodo_2_get_result_rows,
        es_array: Array.isArray(resultados.metodo_2_get_result_rows),
        longitud: Array.isArray(resultados.metodo_2_get_result_rows) ? resultados.metodo_2_get_result_rows.length : 'N/A',
        keys: resultados.metodo_2_get_result_rows && typeof resultados.metodo_2_get_result_rows === 'object' 
          ? Object.keys(resultados.metodo_2_get_result_rows) 
          : []
      },
      muestra_primer_elemento: resultados.metodo_1_select_result_rows && 
        Array.isArray(resultados.metodo_1_select_result_rows) && 
        resultados.metodo_1_select_result_rows.length > 0 
        ? resultados.metodo_1_select_result_rows[0] 
        : 'No hay datos'
    };

    return res.status(200).json({
      success: true,
      analisis,
      resultados_completos: resultados // Solo primeros niveles para no saturar
    });

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}