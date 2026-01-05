// api/test-wialon.ts - CREA ESTE ARCHIVO INMEDIATAMENTE
import axios from 'axios';

export default async function handler(req: any, res: any) {
  console.log("🔍 TEST-WIALON: Iniciando diagnóstico...");
  
  const response = {
    success: false,
    steps: [] as string[],
    data: {} as any,
    errors: [] as string[]
  };

  try {
    // 1. VERIFICAR TOKEN
    response.steps.push("1. Verificando token...");
    const token = process.env.WIALON_TOKEN;
    
    if (!token) {
      response.errors.push("❌ WIALON_TOKEN no está configurado en Vercel");
      response.data.token = "NO_CONFIGURADO";
      return res.status(200).json(response);
    }
    
    response.data.token = {
      exists: true,
      length: token.length,
      first10: token.substring(0, 10) + "...",
      last10: "..." + token.substring(token.length - 10)
    };
    response.steps.push("✅ Token encontrado");

    // 2. HACER LOGIN
    response.steps.push("2. Intentando login...");
    const loginUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`;
    
    let loginRes;
    try {
      loginRes = await axios.get(loginUrl, { timeout: 10000 });
      response.data.login_response = loginRes.data;
      
      if (!loginRes.data.eid) {
        response.errors.push("❌ Login falló. Token inválido o expirado");
        response.data.login_error = loginRes.data;
        return res.status(200).json(response);
      }
      
      const sid = loginRes.data.eid;
      response.data.sid = sid;
      response.steps.push("✅ Login exitoso. SID obtenido");
      
      // 3. PROBAR REPORTE SIMPLE
      response.steps.push("3. Probando reporte básico...");
      
      // Primero, obtener recursos disponibles
      const resourcesParams = {
        spec: [{
          type: "type",
          data: "report",
          flags: 1,
          mode: 0
        }]
      };
      
      const resourcesUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params=${JSON.stringify(resourcesParams)}&sid=${sid}`;
      const resourcesRes = await axios.get(resourcesUrl);
      response.data.resources = resourcesRes.data;
      
      // 4. PROBAR EJECUCIÓN DE REPORTE
      response.steps.push("4. Probando ejecución de reporte 18...");
      
      const ahora = Math.floor(Date.now() / 1000);
      const inicio = ahora - (24 * 3600);
      
      const reportParams = {
        reportResourceId: 28775158,
        reportTemplateId: 18,
        reportObjectId: 28775158,
        reportObjectSecId: "17",
        interval: { from: inicio, to: ahora, flags: 0x1 },
        remoteExec: 1
      };
      
      const execUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`;
      const execRes = await axios.get(execUrl);
      response.data.exec_report = execRes.data;
      
      // 5. OBTENER DATOS
      response.steps.push("5. Intentando obtener datos...");
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Método 1: select_result_rows
      const selectParams = {
        tableIndex: 0,
        config: { 
          type: "range", 
          data: { from: 0, to: 100, level: 0, unitInfo: 1 } 
        }
      };
      
      const selectUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`;
      const selectRes = await axios.get(selectUrl);
      response.data.select_result = selectRes.data;
      
      // 6. LOGOUT
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      response.steps.push("✅ Logout exitoso");
      
      // 7. ANALIZAR RESULTADOS
      response.success = true;
      response.steps.push("✅ Diagnóstico completado");
      
      // Análisis de datos
      if (selectRes.data && Array.isArray(selectRes.data) && selectRes.data.length > 0) {
        response.data.analysis = {
          rows_received: selectRes.data.length,
          first_row_structure: selectRes.data[0],
          first_row_keys: Object.keys(selectRes.data[0]),
          sample_data: {
            unit: selectRes.data[0]?.c?.[0]?.t || selectRes.data[0]?.c?.[0],
            geofence: selectRes.data[0]?.c?.[1]?.t || selectRes.data[0]?.c?.[1],
            time: selectRes.data[0]?.c?.[2]?.t || selectRes.data[0]?.c?.[2]
          }
        };
      } else {
        response.data.analysis = {
          rows_received: 0,
          message: "No se recibieron datos. Posibles causas:",
          causes: [
            "No hay eventos de geocerca en el rango de tiempo",
            "El reporte 18 no está configurado correctamente",
            "El ID del recurso (28775158) es incorrecto"
          ]
        };
      }
      
    } catch (wialonError: any) {
      response.errors.push(`❌ Error en conexión Wialon: ${wialonError.message}`);
      response.data.wialon_error = {
        message: wialonError.message,
        url: wialonError.config?.url,
        status: wialonError.response?.status,
        data: wialonError.response?.data
      };
    }
    
  } catch (error: any) {
    response.errors.push(`❌ Error general: ${error.message}`);
    response.data.general_error = error.message;
  }
  
  return res.status(200).json(response);
}