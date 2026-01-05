// lib/wialon.ts - VERSIÓN VIAJES (MÁS ROBUSTA)
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

  // IDs que ya confirmamos que existen
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

    // 2. OBTENER UNIDADES
    const groupRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${GROUP_ID},"flags":1}&sid=${sid}`
    );
    const unitIds = groupRes.data.item?.u || [];
    if (unitIds.length === 0) throw new Error("Grupo de unidades vacío");

    // 3. CREAR REPORTE DINÁMICO DE VIAJES (CAMBIO CLAVE)
    // Cambiamos 'unit_zone_visits' por 'unit_trips' que es más seguro
    console.log("🛠️ WIALON: Creando reporte de VIAJES...");
    
    const createParams = {
        itemId: RESOURCE_ID,
        id: 0,
        callMode: "create",
        n: "API_TRIPS_AUDIT_" + Math.floor(Math.random() * 1000),
        ct: "avl_unit",
        p: JSON.stringify({
            "geozones_ex": "1" // Importante: Intenta usar geocercas como direcciones
        }),
        tbl: [{
            n: "unit_trips", // TABLA DE VIAJES
            l: "Viajes",
            c: "", cl: "", cp: "", p: "", f: 0,
            // Columnas: Comienzo, Posición Inicial, Posición Final, Duración
            sl: "[\"time_begin\", \"address_begin\", \"address_end\", \"duration\"]", 
            s: ""
        }]
    };

    const createRes = await axios.get(
        `https://hst-api.wialon.com/wialon/ajax.html?svc=report/update_report&params=${JSON.stringify(createParams)}&sid=${sid}`
    );

    if (createRes.data.error) throw new Error(`Error creando reporte: ${createRes.data.error}`);
    tempReportId = createRes.data[0]; 

    // 4. EJECUTAR EL REPORTE
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

    // 6. APLICAR Y DESCARGAR
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    const totalRows = applyRes.data.rows || 0;
    console.log(`📊 Filas de viajes detectadas: ${totalRows}`);

    const filasPlanas: any[] = []; // Tipado explícito

    if (totalRows > 0) {
        const rowsParams = {
          tableIndex: 0,
          config: { type: "range", data: { from: 0, to: totalRows - 1, level: 2, unitInfo: 1 } }
        };

        const rowsRes = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=report/select_result_rows&params=${JSON.stringify(rowsParams)}&sid=${sid}`,
            { timeout: 60000 }
        );

        const rawData = rowsRes.data;
        
        // Normalizador para Viajes
        if (Array.isArray(rawData)) {
            const procesarFila = (row: any, contextoPadre: string) => {
                let unidadActual = contextoPadre;
                
                // Nivel 0: Encabezado del bus
                if (row.c && row.c[0] && !row.c[1]) {
                    unidadActual = row.c[0].t || row.c[0];
                }

                // Nivel Detalle: Datos del viaje
                // Col 0: Hora Inicio, Col 1: Dir Inicio, Col 2: Dir Fin
                if (row.c && row.c.length >= 3) {
                    const horaInicio = row.c[0].t;
                    const dirInicio = row.c[1].t; // Aquí Wialon pone la geocerca si coincide
                    const dirFin = row.c[2].t;
                    
                    // Solo guardamos si parece un dato válido
                    if (horaInicio && dirInicio && unidadActual) {
                        filasPlanas.push({
                            // Adaptamos al formato que espera audit-batch:
                            // c[0]: Unidad, c[1]: Geocerca, c[2]: Hora
                            c: [
                                { t: unidadActual }, // Unidad
                                { t: dirInicio },    // Geocerca (o dirección)
                                { t: horaInicio }    // Hora
                            ],
                            bus_contexto: unidadActual
                        });
                    }
                }
                
                if (row.r) row.r.forEach((h: any) => procesarFila(h, unidadActual));
            };
            rawData.forEach(r => procesarFila(r, ""));
        }
    }

    // 7. LIMPIEZA
    try {
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/cleanup_result&params={}&sid=${sid}`);
        if (tempReportId > 0) {
            await axios.get(
                `https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`
            );
        }
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    } catch (e) {}

    console.log(`📦 Viajes procesados finales: ${filasPlanas.length}`);
    return filasPlanas;

  } catch (e: any) {
    if (sid) {
        // Limpieza de emergencia
        try {
             if (tempReportId > 0) await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=item/delete_item&params={"itemId":${RESOURCE_ID},"id":${tempReportId},"callMode":"delete"}&sid=${sid}`);
             await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        } catch (err) {}
    }
    console.error("🔥 Error Wialon:", getErrorMessage(e));
    return [];
  }
}