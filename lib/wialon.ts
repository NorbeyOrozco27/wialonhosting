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
  // ⚙️ CONFIGURACIÓN FINAL (IDs REALES)
  // ==========================================
  const RESOURCE_ID = 28775158; // El recurso donde están las plantillas
  const TEMPLATE_ID = 7;        // "7. Informde de Geocecas" (Tipo avl_unit)
  const OBJECT_ID   = 28865342; // Grupo "TRANSUNIDOS" (Sacado de tu diagnóstico)

  console.log(`🔍 WIALON: Ejecutando Reporte ID ${TEMPLATE_ID} sobre Grupo ${OBJECT_ID} ("TRANSUNIDOS")`);

  let sid = '';
  
  try {
    // 1. LOGIN
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`, { timeout: 15000 });
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    // 2. LIMPIEZA PREVENTIVA
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);

    // 3. EJECUTAR REPORTE
    // Usamos el ID del grupo (28865342). Al ser un reporte tipo "avl_unit", 
    // Wialon iterará sobre cada unidad dentro de este grupo.
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
      { timeout: 20000 }
    );
    
    if (execRes.data.error) throw new Error(`Error Exec Reporte: ${execRes.data.error}`);

    // 4. POLLING (ESPERAR)
    let status = 0;
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(statusRes.data.status);
      if (status === 4) break;
      if (status > 4) throw new Error(`Reporte falló status: ${status}`);
    }

    if (status !== 4) throw new Error("Timeout esperando reporte");

    // 5. APLICAR RESULTADOS
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 Filas detectadas en Wialon: ${totalRows}`);

    if (totalRows === 0) {
      await limpiar(sid);
      return [];
    }

    // 6. OBTENER FILAS (MODO EXPANDIDO)
    // Usamos level: 2 para asegurarnos de bajar al detalle si el reporte agrupa por unidad
    const rowsParams = {
      tableIndex: 0,
      config: {
        type: "range",
        data: { from: 0, to: totalRows - 1, level: 2, unitInfo: 1 }
      }
    };

    const rowsRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`
    );

    // 7. LIMPIEZA FINAL
    await limpiar(sid);

    // 8. NORMALIZAR RESPUESTA
    const rawData = rowsRes.data;
    if (!Array.isArray(rawData)) return [];

    console.log(`✅ Filas crudas descargadas: ${rawData.length}`);

    // Aplanamos la estructura por si Wialon devuelve agrupación (Unidad -> Geocercas)
    // Buscamos cualquier fila que tenga celdas con datos 'c'
    const filasPlanos: any[] = [];

    const procesarFila = (row: any, unidadPadre?: string) => {
        // Intentar detectar nombre de unidad en la fila actual si es un encabezado
        let unidadActual = unidadPadre;
        if (row.c && row.c[0] && !row.c[1]) { 
             // Si la primera columna tiene datos y la segunda no, es probable que sea el encabezado de la unidad
             unidadActual = row.c[0].t || row.c[0];
        }

        // Si la fila tiene al menos 2 columnas de datos (Unidad/Geocerca/Tiempo), la guardamos
        // A veces la columna de unidad viene vacía en las filas hijo, así que le inyectamos el nombre del padre
        if (row.c && row.c.length >= 2) {
            // Clonamos para no mutar
            const nuevaFila = { ...row };
            
            // Si la celda de unidad (c[0]) está vacía o es un número secuencial, ponemos el nombre de la unidad padre
            if ((!nuevaFila.c[0] || !nuevaFila.c[0].t) && unidadActual) {
                nuevaFila.c[0] = { t: unidadActual };
            }
            
            filasPlanos.push(nuevaFila);
        }

        // Si tiene hijos (r), procesarlos recursivamente
        if (row.r && Array.isArray(row.r)) {
            row.r.forEach((subRow: any) => procesarFila(subRow, unidadActual));
        }
    };

    rawData.forEach(row => procesarFila(row));

    console.log(`✅ Filas procesadas listas para auditar: ${filasPlanos.length}`);
    return filasPlanos;

  } catch (e: any) {
    if (sid) await limpiar(sid).catch(()=>{});
    console.error("Wialon Error:", getErrorMessage(e));
    return [];
  }
}

async function limpiar(sid: string) {
    try {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    } catch (e) {}
}