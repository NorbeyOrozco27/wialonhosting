// api/debug-rayosx.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. OBTENER INFORMACIÓN DE LA UNIDAD (Para ver si está viva)
    // Usamos el ID del bus que encontramos antes: 28645824
    const unitRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28645824,"flags":1025}&sid=${sid}`
    );
    const item = unitRes.data.item;
    const lastMsgTime = item && item.lmsg ? new Date(item.lmsg.t * 1000).toLocaleString('es-CO', {timeZone: 'America/Bogota'}) : "NUNCA";

    // 3. DESCARGAR DEFINICIÓN DE TODOS LOS REPORTES DEL RECURSO 28775158
    // Usamos get_report_data para ver las tablas internas de cada plantilla
    const resourceId = 28775158;
    
    // Primero listamos los reportes disponibles en ese recurso
    const resourceRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${resourceId},"flags":8192}&sid=${sid}`
    );

    const reportesEncontrados = [];
    const reportesUtiles = [];

    if (resourceRes.data.item && resourceRes.data.item.rep) {
        const templates = resourceRes.data.item.rep;
        
        // Iteramos sobre cada plantilla de reporte
        for (const [id, tpl] of Object.entries(templates)) {
            const template = tpl as any;
            
            // Inspeccionamos las tablas de esta plantilla
            const tablasInfo = [];
            let tieneGeocercas = false;

            if (template.tbl) {
                for (const tabla of template.tbl) {
                    tablasInfo.push({
                        nombre: tabla.n, // Nombre interno (ej: unit_zone_visits)
                        etiqueta: tabla.l // Nombre visible (ej: Geocercas)
                    });

                    // BUSCAMOS LA TABLA DE ORO: 'unit_zone_visits'
                    if (tabla.n === 'unit_zone_visits') {
                        tieneGeocercas = true;
                    }
                }
            }

            const infoReporte = {
                ID_REPORTE: template.id,
                NOMBRE: template.n,
                TIPO_OBJETO: template.ct, // avl_unit, avl_unit_group, etc.
                TIENE_TABLA_GEOCERCAS: tieneGeocercas,
                TABLAS_INTERNAS: tablasInfo
            };

            reportesEncontrados.push(infoReporte);

            if (tieneGeocercas) {
                reportesUtiles.push(infoReporte);
            }
        }
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    res.status(200).json({
      estado_unidad_28645824: {
        existe: !!item,
        ultimo_mensaje: lastMsgTime
      },
      ANALISIS: {
        mensaje: reportesUtiles.length > 0 
            ? "¡ÉXITO! Usa uno de los reportes en 'REPORTES_QUE_SIRVEN' en tu archivo wialon.ts" 
            : "ERROR CRÍTICO: Ningún reporte tiene tabla de geocercas configurada.",
        REPORTES_QUE_SIRVEN: reportesUtiles
      },
      todos_los_reportes: reportesEncontrados
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}