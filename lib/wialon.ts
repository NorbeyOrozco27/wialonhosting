// lib/wialon.ts - VERSIÓN CON DIAGNÓSTICO
import axios from 'axios';

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
    throw new Error("❌ FALTA WIALON_TOKEN en variables de entorno");
  }

  console.log(`🔍 WIALON: Consultando desde ${new Date(desde * 1000).toISOString()} hasta ${new Date(hasta * 1000).toISOString()}`);

  try {
    // 1. LOGIN
    const loginRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`
    );
    
    console.log("🔍 WIALON Login respuesta:", JSON.stringify(loginRes.data).substring(0, 200));
    
    const sid = loginRes.data.eid;
    if (!sid) {
      throw new Error(`❌ No hay SID. Respuesta: ${JSON.stringify(loginRes.data)}`);
    }

    // 2. CONFIGURAR REPORTE
    const reportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 18,
      reportObjectId: 28775158,
      reportObjectSecId: "17",
      interval: { 
        from: desde, 
        to: hasta, 
        flags: 0x1 // Agregar flag para incluir objetos ocultos
      },
      remoteExec: 1 // Cambiar a 1 para ejecución remota
    };

    console.log("🔍 WIALON Ejecutando reporte con params:", JSON.stringify(reportParams));

    // 3. EJECUTAR REPORTE
    const execUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`;
    const execRes = await axios.get(execUrl);
    
    console.log("🔍 WIALON Reporte ejecutado:", JSON.stringify(execRes.data).substring(0, 200));

    if (execRes.data.error) {
      throw new Error(`❌ Error ejecutando reporte: ${execRes.data.error}`);
    }

    // 4. ESPERAR PARA PROCESAMIENTO
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 5. INTENTAR DIFERENTES MÉTODOS PARA OBTENER DATOS
    
    // Método A: select_result_rows (el que usabas)
    try {
      const selectParams = {
        tableIndex: 0,
        config: { 
          type: "range", 
          data: { 
            from: 0, 
            to: 100, // Incrementar para ver más datos
            level: 0, 
            unitInfo: 1 
          } 
        }
      };
      
      const selectUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(selectParams)}&sid=${sid}`;
      const rowsRes = await axios.get(selectUrl);
      
      console.log("🔍 WIALON select_result_rows respuesta estructura:", {
        tipo: typeof rowsRes.data,
        esArray: Array.isArray(rowsRes.data),
        longitud: Array.isArray(rowsRes.data) ? rowsRes.data.length : 'N/A',
        primerElemento: rowsRes.data && Array.isArray(rowsRes.data) && rowsRes.data.length > 0 
          ? rowsRes.data[0] 
          : 'Vacío'
      });

      if (rowsRes.data && rowsRes.data.length > 0) {
        // 6. LOGOUT
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        
        return rowsRes.data;
      }
    } catch (selectError: any) {
      console.log("⚠️ select_result_rows falló:", selectError.message);
    }

    // Método B: get_result_rows (alternativo)
    try {
      const getRowsParams = {
        tableIndex: 0,
        indexFrom: 0,
        indexTo: 100
      };
      
      const getRowsUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_result_rows&params=${JSON.stringify(getRowsParams)}&sid=${sid}`;
      const getRowsRes = await axios.get(getRowsUrl);
      
      console.log("🔍 WIALON get_result_rows respuesta:", {
        tipo: typeof getRowsRes.data,
        estructura: getRowsRes.data
      });

      // 6. LOGOUT
      await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
      
      // Wialon puede devolver {rows: [...]}
      if (getRowsRes.data && getRowsRes.data.rows) {
        return getRowsRes.data.rows;
      }
      
      return getRowsRes.data || [];

    } catch (getRowsError: any) {
      console.log("⚠️ get_result_rows también falló:", getRowsError.message);
      throw new Error(`Todos los métodos fallaron: ${getRowsError.message}`);
    }

  } catch (error: any) {
    console.error("🔥 ERROR CRÍTICO en wialon.ts:", error.message);
    throw error;
  }
}