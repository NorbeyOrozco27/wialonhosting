// lib/wialon.ts
import axios from 'axios';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// Función auxiliar para esperar
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function ejecutarInformeCosecha(desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("WIALON_TOKEN no configurado");

  const RESOURCE_ID = 28775158; 
  const GROUP_ID    = 28865342; // Grupo TRANSUNIDOS

  let sid = '';
  let tempReportId = 0;
  
  try {
    // 1. LOGIN
    console.log("🔍 WIALON: Login...");
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`, { timeout: 15000 });
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    // 2. OBTENER UNIDADES (Para pasarlas explícitamente)
    console.log(`🔍 WIALON: Obteniendo unidades...`);
    const groupRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${GROUP_ID},"flags":1}&sid=${sid}`
    );
    const unitIds = groupRes.data.item?.u || [];
    if (unitIds.length === 0) throw new Error("Grupo de unidades vacío");

    // 3. CREAR REPORTE DINÁMICO (LA SOLUCIÓN MAESTRA)
    // Creamos un reporte tipo 'avl_unit' con tabla 'unit_zone_visits' (Geocercas)
    console.log("🛠️ WIALON: Creando reporte temporal optimizado...");
    
    const createParams = {
        itemId: RESOURCE_ID,
        id: 0, // 0 = Crear nuevo
        callMode: "create",
        n: "API_TEMP_AUDIT_" + Math.floor(Math.random() * 1000), // Nombre único
        ct: "avl_unit", // Tipo Unidad
        p: "",
        tbl: [{
            n: "unit_zone_visits", // Tabla de Geocercas
            l: "Geocercas Audit",
            c: "", 
            cl: "", 
            cp: "", 
            p: "", 
            f: 0,
            // Columnas: Nombre Unidad, Geocerca, Hora Entrada
            sl: "[\"asset_name\",\"zone_name\",\"time_in\"]", 
            s: ""
        }]
    };

    const createRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/update_report&params=${JSON.stringify(createParams)}&sid=${sid}`
    );

    if (createRes.data.error) throw new Error(`Error creando reporte: ${createRes.data.error}`);
    
    // Guardamos el ID para borrarlo después
    tempReportId = createRes.data[0]; 
    console.log(`✅ Reporte temporal creado con ID: ${tempReportId}`);

    // 4. EJECUTAR EL REPORTE NUEVO
    const reportParams = {
      reportResourceId: RESOURCE_ID,
      reportTemplateId: tempReportId,
      reportObjectId: RESOURCE_ID,
      reportObjectIdList: unitIds,
      interval: { from: desde, to: hasta, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`,
      { timeout: 30000 }
    );

    if (execRes.data.error) throw new Error(`Error Exec: ${execRes.data.error}`);

    // 5. ESPERAR (POLLING)
    let status = 0;
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
    }

    if (status !== 4) throw new Error("Timeout esperando reporte");

    // 6. APLICAR Y DESCARGAR
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 Filas detectadas en reporte dinámico: ${totalRows}`);

    // CORRECCIÓN AQUÍ: Agregamos ': any[]' para que TypeScript no se queje
    const filasPlanas: any[] = [];

    if (totalRows > 0) {
        const rowsParams = {
          tableIndex: 0, // Siempre es 0 porque acabamos de crearlo con 1 sola tabla
          config: { type: "range", data: { from: 0, to: totalRows - 1, level: 2, unitInfo: 1 } }
        };

        const rowsRes = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
            { timeout: 60000 }
        );

        const rawData = rowsRes.data;
        
        // Normalizador
        if (Array.isArray(rawData)) {
            const procesarFila = (row: any, contextoPadre: string) => {
                let unidadActual = contextoPadre;
                // Si es encabezado de bus
                if (row.c && row.c[0] && row.c[0].t && !row.c[1]) {
                    unidadActual = row.c[0].t;
                }
                // Si es fila de datos (tiene geocerca y hora)
                if (row.c && row.c.length >= 3) { // 3 columnas: Bus, Geo, Hora
                    const bus = row.c[0].t || unidadActual;
                    const geo = row.c[1].t;
                    const hora = row.c[2].t;
                    
                    if (bus && geo && hora) {
                        filasPlanas.push({
                            // Estructura normalizada para audit-batch
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

    // 7. LIMPIEZA (BORRAR REPORTE Y SESIÓN)
    // Primero limpiamos el resultado
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
    
    // Luego borramos el reporte temporal para no ensuciar tu cuenta
    if (tempReportId > 0) {
        await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`
        );
        console.log("🧹 Reporte temporal eliminado.");
    }
    
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    console.log(`📦 Filas procesadas finales: ${filasPlanas.length}`);
    return filasPlanas;

  } catch (e: any) {
    // Intento de limpieza de emergencia
    if (sid) {
        if (tempReportId > 0) {
             await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`).catch(()=>{});
        }
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`).catch(()=>{});
    }
    console.error("🔥 Error Wialon:", getErrorMessage(e));
    return [];
  }
}