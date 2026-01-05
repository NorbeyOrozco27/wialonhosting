// lib/wialon.ts
import axios from 'axios';

// Helper para manejar errores de tipado en bloques catch
const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  console.log(`🔍 WIALON: Ejecutando informe desde ${new Date(desde * 1000)} hasta ${new Date(hasta * 1000)}`);
  
  const token = process.env.WIALON_TOKEN;
  
  if (!token) {
    throw new Error("WIALON_TOKEN no configurado en variables de entorno");
  }

  let sid = '';
  
  try {
    // 1. LOGIN
    console.log("🔍 WIALON: Iniciando sesión...");
    const loginRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`,
      { timeout: 15000 }
    );
    
    sid = loginRes.data.eid;
    if (!sid) {
      throw new Error(`Login falló: ${JSON.stringify(loginRes.data)}`);
    }
    
    console.log("✅ WIALON: Login exitoso. SID obtenido.");

    // 2. CONFIGURAR ZONA HORARIA (Colombia GMT-5 = -18000 segundos)
    try {
      await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=render/set_locale&params={"tzOffset":-18000,"language":"en","formatDate":"%Y-%m-%d %H:%M:%S"}&sid=${sid}`,
        { timeout: 5000 }
      );
    } catch (e) {
      console.warn("⚠️ Advertencia: No se pudo configurar la zona horaria, usando la del servidor Wialon.");
    }

    // 3. EJECUTAR REPORTE (ID 18)
    // Nota: remoteExec: 1 es crucial para reportes grandes
    const reportParams = {
      reportResourceId: 28775158, 
      reportTemplateId: 18, 
      reportObjectId: 28775158, 
      reportObjectSecId: 0,
      interval: { 
        from: desde, 
        to: hasta, 
        flags: 0 
      },
      remoteExec: 1 
    };

    console.log("🔍 WIALON: Enviando orden de ejecución de reporte...");
    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 20000 }
    );
    
    if (execRes.data.error) {
      throw new Error(`Error al ejecutar reporte: Código ${execRes.data.error}`);
    }

    // 4. POLLING (ESPERAR RESULTADOS)
    let status = 0;
    let intentos = 0;
    const maxIntentos = 60; // Esperar hasta 60 segundos

    while (status !== 4 && intentos < maxIntentos) {
      await new Promise(r => setTimeout(r, 1000));
      intentos++;
      
      try {
        const statusRes = await axios.get(
          `https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`
        );
        status = parseInt(statusRes.data.status);
      } catch (err) {
        console.warn("⚠️ Error verificando estado, reintentando...");
      }
    }

    if (status !== 4) throw new Error("Timeout: El reporte de Wialon tardó demasiado en generarse.");

    // 5. APLICAR RESULTADOS
    const applyRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`
    );

    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 WIALON: Reporte listo. Filas detectadas en el servidor: ${totalRows}`);

    if (totalRows === 0) {
      await limpiarSesion(sid);
      return [];
    }

    // 6. DESCARGAR FILAS
    const rowsParams = {
      tableIndex: 0,
      indexFrom: 0,
      indexTo: totalRows 
    };

    const rowsRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
      { timeout: 30000 }
    );

    // 7. LIMPIEZA
    await limpiarSesion(sid);

    // 8. PROCESAMIENTO Y NORMALIZACIÓN DE DATOS
    let filasRaw = [];
    if (Array.isArray(rowsRes.data)) {
      filasRaw = rowsRes.data;
    } else if (rowsRes.data && Array.isArray(rowsRes.data.rows)) {
      filasRaw = rowsRes.data.rows;
    }

    console.log(`✅ WIALON: Filas crudas descargadas: ${filasRaw.length}`);

    // NORMALIZADOR: Convierte todo a una estructura estándar { c: [{t:val}, {t:val}...] }
    // Esto arregla el problema de "en_wialon: 0" por formato incorrecto
    const filasNormalizadas = filasRaw
      .filter((row: any) => {
        // Filtrar filas vacías o de agrupación que no tengan datos útiles
        if (row.c && Array.isArray(row.c)) return row.c.length >= 3;
        if (Array.isArray(row)) return row.length >= 3;
        return false;
      })
      .map((row: any) => {
        // Si ya tiene la estructura 'c', la dejamos pasar
        if (row.c && Array.isArray(row.c)) return row;
        
        // Si es un array plano, lo envolvemos para que parezca la estructura estándar
        if (Array.isArray(row)) {
          return { c: row.map((val: any) => ({ t: val })) };
        }
        return null;
      })
      .filter((row: any) => row !== null);

    console.log(`✅ WIALON: Filas normalizadas y listas para auditoría: ${filasNormalizadas.length}`);
    return filasNormalizadas;

  } catch (error: any) {
    if (sid) await limpiarSesion(sid).catch(() => {});

    if (error.code === 'ECONNABORTED') {
      console.error("🔥 WIALON TIMEOUT: La petición tardó demasiado.");
      return []; 
    }

    console.error("🔥 ERROR WIALON LIB:", getErrorMessage(error));
    return []; 
  }
}

// Función auxiliar para cerrar sesión y limpiar
async function limpiarSesion(sid: string) {
  try {
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
  } catch (e) {
    // Silencio
  }
}