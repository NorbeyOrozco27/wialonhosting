// lib/wialon.ts - VERSIÓN CON MÁS LOGS
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  console.log(`🔍 WIALON ejecutarInformeCosecha: ${desde} a ${hasta}`);
  
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
    console.error("❌ ERROR: WIALON_TOKEN no definido");
    throw new Error("WIALON_TOKEN no configurado");
  }
  
  console.log("✅ Token encontrado, longitud:", token.length);

  try {
    // 1. LOGIN
    console.log("🔍 Intentando login...");
    const loginRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`,
      { timeout: 15000 }
    );
    
    console.log("🔍 Login respuesta:", JSON.stringify(loginRes.data).substring(0, 200));
    
    const sid = loginRes.data.eid;
    if (!sid) {
      console.error("❌ Login falló. Respuesta completa:", loginRes.data);
      throw new Error(`Login falló: ${JSON.stringify(loginRes.data)}`);
    }
    
    console.log("✅ Login exitoso. SID:", sid);

    // 2. EJECUTAR REPORTE CON MÁS PARÁMETROS
    const reportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 18,
      reportObjectId: 28775158,
      reportObjectSecId: "17",
      interval: { 
        from: desde, 
        to: hasta, 
        flags: 0x1 // Incluir objetos ocultos
      },
      remoteExec: 1, // Ejecución remota
      reportTemplate: null
    };

    console.log("🔍 Ejecutando reporte con params:", JSON.stringify(reportParams));
    
    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 20000 }
    );
    
    console.log("🔍 Reporte ejecutado:", JSON.stringify(execRes.data).substring(0, 300));
    
    if (execRes.data.error) {
      console.error("❌ Error en ejecución de reporte:", execRes.data.error);
      throw new Error(`Error reporte: ${execRes.data.error}`);
    }

    // 3. ESPERAR Y OBTENER DATOS
    console.log("⏳ Esperando procesamiento del reporte...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Intentar con límite mayor
    const selectParams = {
      tableIndex: 0,
      config: { 
        type: "range", 
        data: { 
          from: 0, 
          to: 500, // Aumentar límite
          level: 0, 
          unitInfo: 1 
        } 
      }
    };
    
    console.log("🔍 Solicitando datos con select_result_rows...");
    const rowsRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`,
      { timeout: 15000 }
    );
    
    console.log("🔍 Datos recibidos. Tipo:", typeof rowsRes.data);
    console.log("🔍 Es array?:", Array.isArray(rowsRes.data));
    console.log("🔍 Longitud:", Array.isArray(rowsRes.data) ? rowsRes.data.length : "N/A");
    
    if (Array.isArray(rowsRes.data) && rowsRes.data.length > 0) {
      console.log("🔍 Primer elemento:", JSON.stringify(rowsRes.data[0]).substring(0, 300));
    }

    // 4. LOGOUT
    await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`,
      { timeout: 5000 }
    );
    
    console.log("✅ Logout exitoso");

    // Devolver datos o array vacío
    return Array.isArray(rowsRes.data) ? rowsRes.data : [];

  } catch (error: any) {
    console.error("🔥 ERROR CRÍTICO en wialon.ts:", {
      message: error.message,
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data
    });
    
    // Si hay timeout, devolver array vacío para no bloquear el proceso
    if (error.code === 'ECONNABORTED') {
      console.warn("⚠️ Timeout en Wialon, devolviendo array vacío");
      return [];
    }
    
    throw error;
  }
}