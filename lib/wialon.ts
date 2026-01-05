// lib/wialon.ts
import axios from 'axios';

// Helper para errores
const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("WIALON_TOKEN no configurado");

  // ==========================================
  // 🎯 CONFIGURACIÓN FIJA (IDs DEL DIAGNÓSTICO)
  // ==========================================
  const RESOURCE_ID = 28775158; 
  // Usamos el reporte 7 ("7. Informde de Geocecas") que es tipo 'avl_unit'
  const TEMPLATE_ID = 7; 
  // Usamos el grupo "TRANSUNIDOS"
  const OBJECT_ID   = 28865342; 

  console.log(`🚀 WIALON: Forzando ejecución Reporte ${TEMPLATE_ID} sobre Grupo ${OBJECT_ID}`);

  let sid = '';
  
  try {
    // 1. LOGIN
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`, { timeout: 15000 });
    sid = loginRes.data.eid;
    if (!sid) throw new Error(`Login falló: ${JSON.stringify(loginRes.data)}`);

    // 2. LIMPIEZA DE SESIÓN
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);

    // 3. EJECUTAR REPORTE (Remote Exec)
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: OBJECT_ID, 
      reportObjectSecId: 0,
      interval: { from: desde, to: hasta, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 30000 }
    );
    
    if (execRes.data.error) throw new Error(`Error Exec: ${execRes.data.error}`);

    // 4. ESPERAR (POLLING) - Esperamos hasta que termine
    let status = 0;
    for (let i = 0; i < 60; i++) { // 60 segundos máx
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(statusRes.data.status);
      if (status === 4) break;
    }

    if (status !== 4) throw new Error("Timeout esperando Wialon");

    // 5. APLICAR RESULTADOS
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    // Verificamos si hay tablas generadas
    const tablas = applyRes.data.tables;
    if (!tablas || tablas.length === 0) {
      console.log("⚠️ El reporte se ejecutó pero no generó tablas.");
      await limpiar(sid);
      return [];
    }

    // Buscamos la tabla que tenga más filas
    let indiceTablaMejor = 0;
    let maxFilas = 0;
    
    tablas.forEach((t: any, idx: number) => {
        console.log(`📊 Tabla ${idx} (${t.label}): ${t.rows} filas`);
        if (t.rows > maxFilas) {
            maxFilas = t.rows;
            indiceTablaMejor = idx;
        }
    });

    if (maxFilas === 0) {
        console.log("⚠️ Todas las tablas están vacías (0 filas).");
        await limpiar(sid);
        return [];
    }

    console.log(`✅ Usando Tabla ${indiceTablaMejor} con ${maxFilas} filas.`);

    // 6. DESCARGAR FILAS
    const rowsParams = {
      tableIndex: indiceTablaMejor,
      config: {
        type: "range",
        data: { from: 0, to: maxFilas - 1, level: 2, unitInfo: 1 }
      }
    };

    const rowsRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
        { timeout: 30000 }
    );

    await limpiar(sid);

    // 7. NORMALIZAR DATOS PARA AUDIT-BATCH
    const rawData = rowsRes.data;
    if (!Array.isArray(rawData)) return [];

    // Aplanamos: Si es un reporte agrupado, queremos las filas hijas que tienen los eventos
    const filasPlanas: any[] = [];
    
    const procesarFila = (row: any, contextoPadre: string) => {
        // Intentamos detectar el nombre del bus en la fila agrupada
        let busActual = contextoPadre;
        
        // Si la fila tiene el nombre del bus (común en nivel 0 de agrupación)
        if (row.c && row.c[0]) {
            const val = row.c[0].t || row.c[0];
            // Si parece un bus (no una fecha ni un total), lo guardamos como contexto
            if (val && !val.includes("Total") && !val.includes(":")) {
                busActual = val;
            }
        }

        // Si la fila parece un evento de geocerca (tiene hora y geocerca)
        // Estructura típica: [Bus/Vacio, Geocerca, HoraEntrada, HoraSalida...]
        // Depende mucho de la configuración de columnas de tu reporte 7.
        // Asumiremos que cualquier fila con más de 2 columnas de datos es útil.
        if (row.c && row.c.length >= 2) {
            // Inyectamos el nombre del bus si falta en la fila hija
            const filaCopia = { ...row };
            if (busActual) {
                 // Truco: Ponemos el bus en una propiedad especial para que audit-batch lo encuentre
                 filaCopia.bus_contexto = busActual; 
            }
            filasPlanas.push(filaCopia);
        }

        // Recursividad para hijos
        if (row.r && Array.isArray(row.r)) {
            row.r.forEach((hijo: any) => procesarFila(hijo, busActual));
        }
    };

    rawData.forEach((row: any) => procesarFila(row, ""));

    console.log(`📦 Filas extraídas para auditar: ${filasPlanas.length}`);
    return filasPlanas;

  } catch (e: any) {
    if (sid) await limpiar(sid).catch(()=>{});
    console.error("🔥 Error Wialon:", getErrorMessage(e));
    return [];
  }
}

async function limpiar(sid: string) {
    try {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    } catch (e) {}
}