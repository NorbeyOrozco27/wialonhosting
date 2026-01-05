// lib/wialon.ts - VERSIÓN REPORTE FANTASMA
import axios from 'axios';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("WIALON_TOKEN no configurado");

  // IDs base
  const RESOURCE_ID = 28775158; 
  // Vamos a ejecutarlo sobre el GRUPO completo para maximizar probabilidad de datos
  const OBJECT_ID   = 28865342; // Grupo TRANSUNIDOS

  let sid = '';
  let tempReportId = 0;
  
  try {
    // 1. LOGIN
    console.log("🔍 WIALON: Login...");
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`, { timeout: 15000 });
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    // 2. CREAR REPORTE TEMPORAL (Esto es la clave)
    // Creamos un reporte "limpio" de Geocercas, sin filtros raros
    console.log("🛠️ WIALON: Creando reporte temporal limpio...");
    
    const createParams = {
        itemId: RESOURCE_ID,
        id: 0,
        callMode: "create",
        n: "API_TEMP_GEO_" + Math.floor(Math.random() * 1000),
        ct: "avl_unit", // Tipo Unidad (para iterar sobre el grupo)
        p: "",
        tbl: [{
            n: "unit_zone_visits", // Tabla de Geocercas
            l: "Geocercas",
            c: "", cl: "", cp: "", p: "", f: 0,
            // Columnas: Unidad, Geocerca, Entrada, Salida
            sl: "[\"asset_name\",\"zone_name\",\"time_in\",\"time_out\"]", 
            s: ""
        }]
    };

    const createRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/update_report&params=${JSON.stringify(createParams)}&sid=${sid}`
    );

    if (createRes.data.error) throw new Error(`Error creando reporte: ${createRes.data.error}`);
    // El ID del reporte nuevo viene en el array de respuesta [ID, {datos...}]
    tempReportId = createRes.data[0]; 
    console.log(`✅ Reporte temporal creado: ID ${tempReportId}`);

    // 3. EJECUTAR EL REPORTE NUEVO
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: tempReportId,
      reportObjectId: OBJECT_ID, // Ejecutamos sobre el GRUPO
      reportObjectSecId: 0,
      interval: { from: desde, to: hasta, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 30000 }
    );
    
    if (execRes.data.error) throw new Error(`Error Exec: ${execRes.data.error}`);

    // 4. ESPERAR (POLLING)
    let status = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
    }

    // 5. APLICAR Y DESCARGAR
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 Filas detectadas con reporte limpio: ${totalRows}`);

    const filasPlanas: any[] = [];

    if (totalRows > 0) {
        const rowsParams = {
          tableIndex: 0,
          config: { type: "range", data: { from: 0, to: totalRows - 1, level: 2, unitInfo: 1 } }
        };

        const rowsRes = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
            { timeout: 60000 }
        );

        // Procesar datos (Normalizar)
        const rawData = rowsRes.data;
        if (Array.isArray(rawData)) {
            const procesarFila = (row: any, contextoPadre: string) => {
                let unidadActual = contextoPadre;
                // Nivel 0: Encabezado de Bus
                if (row.c && row.c[0] && !row.c[1]) {
                    unidadActual = row.c[0].t || row.c[0];
                }
                // Nivel Detalle: Datos (Bus, Geocerca, Hora)
                if (row.c && row.c.length >= 3) {
                   const bus = row.c[0].t || unidadActual; // A veces viene vacio en filas hijas
                   const geo = row.c[1].t;
                   const hora = row.c[2].t;
                   
                   if (bus && geo && hora) {
                       filasPlanas.push({
                           c: [{t: bus}, {t: geo}, {t: hora}],
                           bus_contexto: bus
                       });
                   }
                }
                if (row.r) row.r.forEach((h: any) => procesarFila(h, unidadActual));
            };
            rawData.forEach(r => procesarFila(r, ""));
        }
    }

    // 6. LIMPIEZA Y BORRADO DE REPORTE
    try {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
        
        // Borramos el reporte temporal para no ensuciar tu cuenta
        if (tempReportId > 0) {
            await axios.get(
                `https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`
            );
            console.log("🧹 Reporte temporal eliminado.");
        }
        
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    } catch (e) {}

    console.log(`📦 Filas procesadas finales: ${filasPlanas.length}`);
    return filasPlanas;

  } catch (e: any) {
    // Limpieza de emergencia
    if (sid) {
        if (tempReportId > 0) await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`).catch(()=>{});
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`).catch(()=>{});
    }
    console.error("🔥 Error Wialon:", getErrorMessage(e));
    return [];
  }
}