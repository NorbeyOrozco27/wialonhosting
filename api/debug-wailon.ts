// api/debug-wialon.ts - CREAR ESTE ARCHIVO INMEDIATAMENTE
import axios from 'axios';

export default async function handler(req: any, res: any) {
  try {
    // 1. VERIFICAR TOKEN
    const token = process.env.WIALON_TOKEN;
    
    if (!token || token === 'undefined' || token === '') {
      return res.status(200).json({
        success: false,
        error: "❌ WIALON_TOKEN no está configurado en Vercel",
        pasos: [
          "1. Ve a Vercel Dashboard",
          "2. Selecciona tu proyecto",
          "3. Ve a 'Settings' → 'Environment Variables'",
          "4. Agrega WIALON_TOKEN con tu token real"
        ]
      });
    }

    console.log("🔍 Token encontrado (primeros 10 chars):", token.substring(0, 10) + "...");

    // 2. HACER LOGIN
    const loginUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`;
    console.log("🔍 URL Login:", loginUrl);
    
    const loginRes = await axios.get(loginUrl);
    console.log("🔍 Respuesta Login:", loginRes.data);
    
    const sid = loginRes.data.eid;
    
    if (!sid) {
      return res.status(200).json({
        success: false,
        error: "❌ Login falló. Token podría ser inválido",
        respuesta_wialon: loginRes.data
      });
    }

    console.log("✅ Login exitoso. SID:", sid);

    // 3. CONFIGURAR RANGO DE TIEMPO
    const ahora = Math.floor(Date.now() / 1000);
    const inicio = ahora - (24 * 3600); // Últimas 24 horas
    
    console.log(`⏰ Rango: ${new Date(inicio * 1000)} a ${new Date(ahora * 1000)}`);

    // 4. EJECUTAR REPORTE
    const reportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 18,
      reportObjectId: 28775158,
      reportObjectSecId: "17",
      interval: { 
        from: inicio, 
        to: ahora, 
        flags: 0x1 
      },
      remoteExec: 1
    };

    console.log("📊 Ejecutando reporte...");
    
    const execUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`;
    const execRes = await axios.get(execUrl);
    
    console.log("📊 Respuesta ejecución:", execRes.data);

    if (execRes.data.error) {
      return res.status(200).json({
        success: false,
        error: "❌ Error ejecutando reporte",
        detalle: execRes.data.error,
        params_usados: reportParams
      });
    }

    // 5. ESPERAR Y OBTENER DATOS
    await new Promise(resolve => setTimeout(resolve, 5000));

    // PROBAR 3 MÉTODOS DIFERENTES
    const resultados: any = {};
    
    // Método A: select_result_rows
    try {
      const paramsA = {
        tableIndex: 0,
        config: { 
          type: "range", 
          data: { from: 0, to: 100, level: 0, unitInfo: 1 } 
        }
      };
      
      const resA = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(paramsA)}&sid=${sid}`);
      resultados.metodo_select_result_rows = resA.data;
      console.log("✅ Método A exitoso");
    } catch (errorA: any) {
      resultados.metodo_select_result_rows_error = errorA.message;
      console.log("❌ Método A falló:", errorA.message);
    }

    // Método B: get_result_rows
    try {
      const paramsB = {
        tableIndex: 0,
        indexFrom: 0,
        indexTo: 100
      };
      
      const resB = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_result_rows&params=${JSON.stringify(paramsB)}&sid=${sid}`);
      resultados.metodo_get_result_rows = resB.data;
      console.log("✅ Método B exitoso");
    } catch (errorB: any) {
      resultados.metodo_get_result_rows_error = errorB.message;
      console.log("❌ Método B falló:", errorB.message);
    }

    // Método C: export_report (CSV)
    try {
      const paramsC = {
        tableIndex: 0,
        headers: 1,
        format: "csv",
        delimiter: ";"
      };
      
      const resC = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/export_result&params=${JSON.stringify(paramsC)}&sid=${sid}`);
      resultados.metodo_export_csv = resC.data;
      console.log("✅ Método C exitoso");
    } catch (errorC: any) {
      resultados.metodo_export_csv_error = errorC.message;
      console.log("❌ Método C falló:", errorC.message);
    }

    // 6. LOGOUT
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    console.log("✅ Logout exitoso");

    // 7. ANALIZAR RESULTADOS
    const analisis = {
      token_existe: !!token,
      token_primeros_10: token.substring(0, 10) + "...",
      sid_obtenido: !!sid,
      metodos_probados: 3,
      estructura_datos: {}
    };

    // Analizar estructura del primer método que funcionó
    if (resultados.metodo_select_result_rows) {
      analisis.estructura_datos = {
        tipo: typeof resultados.metodo_select_result_rows,
        es_array: Array.isArray(resultados.metodo_select_result_rows),
        longitud: Array.isArray(resultados.metodo_select_result_rows) 
          ? resultados.metodo_select_result_rows.length 
          : 'N/A',
        muestra_primer_elemento: resultados.metodo_select_result_rows && 
          Array.isArray(resultados.metodo_select_result_rows) && 
          resultados.metodo_select_result_rows.length > 0 
          ? resultados.metodo_select_result_rows[0] 
          : 'Vacío'
      };
    } else if (resultados.metodo_get_result_rows) {
      analisis.estructura_datos = {
        tipo: typeof resultados.metodo_get_result_rows,
        es_array: Array.isArray(resultados.metodo_get_result_rows),
        longitud: Array.isArray(resultados.metodo_get_result_rows) 
          ? resultados.metodo_get_result_rows.length 
          : 'N/A',
        muestra_primer_elemento: resultados.metodo_get_result_rows && 
          Array.isArray(resultados.metodo_get_result_rows) && 
          resultados.metodo_get_result_rows.length > 0 
          ? resultados.metodo_get_result_rows[0] 
          : 'Vacío'
      };
    }

    return res.status(200).json({
      success: true,
      analisis,
      resultados: {
        metodo_a: resultados.metodo_select_result_rows,
        metodo_b: resultados.metodo_get_result_rows,
        metodo_c: resultados.metodo_export_csv ? 'CSV recibido' : 'Error',
        errores: {
          metodo_a: resultados.metodo_select_result_rows_error,
          metodo_b: resultados.metodo_get_result_rows_error,
          metodo_c: resultados.metodo_export_csv_error
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("🔥 ERROR CRÍTICO:", error);
    return res.status(200).json({
      success: false,
      error: error.message,
      stack: error.stack,
      paso_fallo: "Consulta fallida"
    });
  }
}