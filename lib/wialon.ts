// lib/wialon.ts
import axios from 'axios';

// Helper para manejar errores de tipado en catch
const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  console.log(`🔍 WIALON: Ejecutando informe desde ${new Date(desde * 1000)} hasta ${new Date(hasta * 1000)}`);
  
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
    throw new Error("WIALON_TOKEN no configurado");
  }

  let sid = '';
  
  try {
    // 1. LOGIN
    console.log("🔍 WIALON: Haciendo login...");
    const loginRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`,
      { timeout: 15000 } // Aumentado a 15s
    );
    
    sid = loginRes.data.eid;
    if (!sid) {
      throw new Error(`Login falló: ${JSON.stringify(loginRes.data)}`);
    }
    
    console.log("✅ WIALON: Login exitoso, SID:", sid);

    // 2. CONFIGURAR ZONA HORARIA (Opcional pero recomendado para consistencia)
    try {
      await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=render/set_locale&params={"tzOffset":-18000,"language":"en","formatDate":"%Y-%m-%d %H:%M:%S"}&sid=${sid}`,
        { timeout: 5000 }
      );
    } catch (e) {
      console.warn("⚠️ Warning setting locale:", getErrorMessage(e));
    }

    // 3. EJECUTAR REPORTE (Asegúrate que el ID 18 corresponda a Geocercas/Unidades)
    const reportParams = {
      reportResourceId: 28775158, 
      reportTemplateId: 18, 
      reportObjectId: 28775158, // Recurso o Grupo de Unidades
      reportObjectSecId: 0,
      interval: { 
        from: desde, 
        to: hasta, 
        flags: 0 
      },
      remoteExec: 1 // Ejecución asíncrona
    };

    console.log("🔍 WIALON: Iniciando ejecución remota...");
    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 20000 }
    );
    
    if (execRes.data.error) {
      throw new Error(`Error Wialon Exec: ${execRes.data.error}`);
    }

    // 4. POLLING DE ESTADO (Esperar que termine)
    let status = 0;
    let intentos = 0;
    // Aumentamos intentos a 60 (1 minuto máx) para reportes grandes
    while (status !== 4 && intentos < 60) {
      await new Promise(r => setTimeout(r, 1000));
      intentos++;
      
      try {
        const statusRes = await axios.get(
          `https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`
        );
        status = parseInt(statusRes.data.status);
        // console.log(`⏳ Estado reporte: ${status} (Intento ${intentos})`);
      } catch (err: unknown) {
        console.warn("⚠️ Error polling status:", getErrorMessage(err));
      }
    }

    if (status !== 4) throw new Error("Timeout esperando reporte de Wialon");

    // 5. APLICAR RESULTADOS (Traer tablas al contexto actual)
    const applyRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`
    );

    // Revisar cuántas filas generó el reporte realmente
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 WIALON: Reporte listo. Filas totales detectadas: ${totalRows}`);

    if (totalRows === 0) {
      // Limpieza rápida y retorno vacío
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      return [];
    }

    // 6. DESCARGAR FILAS
    // Pedimos todas las filas disponibles (o un límite seguro, ej. 5000)
    const rowsParams = {
      tableIndex: 0,
      indexFrom: 0,
      indexTo: totalRows // Pedir exactamente las que hay
    };

    const rowsRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
      { timeout: 30000 } // Timeout generoso para descarga
    );

    // 7. LIMPIEZA Y LOGOUT
    try {
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    } catch (e) { /* ignorar error en limpieza */ }

    // Procesar respuesta
    let filas = [];
    if (Array.isArray(rowsRes.data)) {
      filas = rowsRes.data;
    } else if (rowsRes.data && Array.isArray(rowsRes.data.rows)) {
      filas = rowsRes.data.rows; // Algunas versiones devuelven objeto con propiedad rows
    } else {
      console.error("❌ Estructura desconocida de filas:", JSON.stringify(rowsRes.data).substring(0, 200));
    }

    // Filtrado básico para quitar filas vacías o de agrupación
    return filas.filter((r: any) => r.c && r.c.length > 0);

  } catch (error: any) {
    // Manejo robusto de errores y limpieza de sesión si existe
    if (sid) {
      try {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      } catch (e) {}
    }

    // Si es timeout de Axios
    if (error.code === 'ECONNABORTED') {
      console.error("🔥 WIALON TIMEOUT: La petición tardó demasiado.");
      return []; // Retornar vacío para no romper el flujo batch
    }

    console.error("🔥 ERROR WIALON LIB:", error.message);
    // En producción, tal vez quieras lanzar el error, pero para batch es mejor loguear y seguir
    return []; 
  }
}