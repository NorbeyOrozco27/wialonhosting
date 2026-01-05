// lib/wialon.ts
import axios from 'axios';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("WIALON_TOKEN no configurado");

  // ==========================================
  // ⚙️ CONFIGURACIÓN
  // ==========================================
  const RESOURCE_ID = 28775158; 
  const TEMPLATE_ID = 7;        // Reporte "7. Informde de Geocecas"
  const GROUP_ID    = 28865342; // Grupo "TRANSUNIDOS"

  let sid = '';
  
  try {
    // 1. LOGIN
    console.log("🔍 WIALON: Login...");
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`, { timeout: 15000 });
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    // 2. OBTENER LISTA DE UNIDADES DEL GRUPO (EL PASO CLAVE QUE FALTABA)
    console.log(`🔍 WIALON: Obteniendo unidades del grupo ${GROUP_ID}...`);
    const groupRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${GROUP_ID},"flags":1}&sid=${sid}`
    );
    
    // Extraemos los IDs de las unidades (array 'u')
    const unitIds = groupRes.data.item?.u || [];
    console.log(`✅ Grupo encontrado. Contiene ${unitIds.length} unidades.`);

    if (unitIds.length === 0) {
        throw new Error("El grupo TRANSUNIDOS está vacío o no se pudieron leer las unidades.");
    }

    // 3. LIMPIEZA
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);

    // 4. EJECUTAR REPORTE USANDO 'reportObjectIdList'
    // En lugar de pedir el grupo, pedimos explícitamente todas las unidades del grupo
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: TEMPLATE_ID,
      reportObjectId: RESOURCE_ID, // El recurso actúa como contexto
      reportObjectIdList: unitIds, // <--- AQUÍ ESTÁ LA MAGIA
      interval: { from: desde, to: hasta, flags: 0 },
      remoteExec: 1
    };

    console.log("🚀 WIALON: Ejecutando reporte masivo...");
    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 30000 }
    );
    
    if (execRes.data.error) throw new Error(`Error Exec: ${execRes.data.error}`);

    // 5. ESPERAR (POLLING)
    let status = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
      if (status > 4) throw new Error(`Reporte falló status: ${status}`);
    }

    if (status !== 4) throw new Error("Timeout esperando reporte");

    // 6. APLICAR RESULTADOS
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    // BUSCAR LA TABLA CORRECTA
    const tables = applyRes.data.tables;
    if (!tables || tables.length === 0) {
        console.log("⚠️ Reporte vacío (sin tablas).");
        await limpiar(sid);
        return [];
    }

    // Buscamos la tabla con más filas
    let targetTableIndex = -1;
    let maxRows = 0;

    tables.forEach((t: any, idx: number) => {
        console.log(`📊 Tabla ${idx} [${t.label}]: ${t.rows} filas`);
        if (t.rows > maxRows) {
            maxRows = t.rows;
            targetTableIndex = idx;
        }
    });

    if (targetTableIndex === -1 || maxRows === 0) {
        console.log("⚠️ Reporte generado pero sin datos (0 filas en todas las tablas).");
        await limpiar(sid);
        return [];
    }

    // 7. DESCARGAR FILAS
    console.log(`📥 Descargando ${maxRows} filas de la tabla ${targetTableIndex}...`);
    const rowsParams = {
      tableIndex: targetTableIndex,
      config: {
        type: "range",
        data: { from: 0, to: maxRows - 1, level: 2, unitInfo: 1 }
      }
    };

    const rowsRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
        { timeout: 60000 } // Más tiempo para descarga grande
    );

    await limpiar(sid);

    // 8. NORMALIZAR DATOS
    const rawData = rowsRes.data;
    if (!Array.isArray(rawData)) return [];

    const filasPlanas: any[] = [];
    
    // Función recursiva para aplanar la estructura jerárquica
    const procesarFila = (row: any, unidadPadre: string) => {
        let unidadActual = unidadPadre;
        
        // Intentar capturar el nombre del bus de la fila agrupada
        if (row.c && row.c[0]) {
            const val = row.c[0].t || row.c[0];
            if (val && typeof val === 'string' && !val.includes("Total")) {
                unidadActual = val;
            }
        }

        // Si es una fila de detalle (tiene geocerca y hora)
        // Normalmente Col 1 es Geocerca, Col 2 es Hora Entrada, Col 3 Hora Salida (depende de tu reporte)
        // Asumimos que si tiene datos en c[1], es un evento
        if (row.c && row.c.length >= 2) {
            // Verificamos que no sea una fila de agrupación (que suele tener c[1] vacío)
            const dato1 = row.c[1]?.t || row.c[1];
            
            if (dato1) {
                const filaLimpia = { ...row };
                // Inyectamos el nombre de la unidad explícitamente para audit-batch
                filaLimpia.bus_contexto = unidadActual;
                filasPlanas.push(filaLimpia);
            }
        }

        // Procesar hijos (r)
        if (row.r && Array.isArray(row.r)) {
            row.r.forEach((hijo: any) => procesarFila(hijo, unidadActual));
        }
    };

    rawData.forEach((row: any) => procesarFila(row, ""));

    console.log(`📦 Filas procesadas listas: ${filasPlanas.length}`);
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