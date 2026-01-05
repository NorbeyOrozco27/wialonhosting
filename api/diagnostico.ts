// api/diagnostico.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta WIALON_TOKEN" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;
    if (!sid) return res.json({ error: "Login falló", data: login.data });

    // 2. ESCANEAR RECURSOS Y REPORTES
    // Buscamos todos los recursos y pedimos sus plantillas de reportes (flags: 8192)
    const searchRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_resource","propName":"reporttemplates","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":8192,"from":0,"to":0}&sid=${sid}`
    );

    const recursosEncontrados = [];
    let reportesCandidatos = [];

    if (searchRes.data && searchRes.data.items) {
      for (const item of searchRes.data.items) {
        const reportes = [];
        if (item.rep) {
          for (const [id, data] of Object.entries(item.rep)) {
            const rData = data as any;
            reportes.push({ id: rData.id, nombre: rData.n, tipo: rData.ct });
            
            // Buscamos reportes que parezcan de geocercas o unidades
            reportesCandidatos.push({
              resource_id: item.id,
              resource_name: item.nm,
              report_id: rData.id,
              report_name: rData.n,
              report_type: rData.ct // "avl_unit_group" o "avl_unit" son los ideales
            });
          }
        }
        recursosEncontrados.push({
          id: item.id,
          nombre: item.nm,
          total_reportes: reportes.length,
          reportes_muestra: reportes.slice(0, 5)
        });
      }
    }

    // 3. ESCANEAR UNA UNIDAD PARA VER SU ÚLTIMA HORA REAL
    // Flags 1025 = Base + Último Mensaje
    const unitRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1025,"from":0,"to":1}&sid=${sid}`
    );

    const unidadMuestra = unitRes.data.items && unitRes.data.items.length > 0 ? unitRes.data.items[0] : null;
    const ultimoMensaje = unidadMuestra && unidadMuestra.lmsg ? new Date(unidadMuestra.lmsg.t * 1000).toLocaleString('es-CO', {timeZone: 'America/Bogota'}) : "Sin datos";

    // 4. LOGOUT
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 5. RESPUESTA
    res.status(200).json({
      success: true,
      servidor_tiempo: new Date().toLocaleString('es-CO', {timeZone: 'America/Bogota'}),
      wialon_tiempo_unidad: ultimoMensaje,
      analisis: {
        mensaje: "Usa estos IDs en tu archivo lib/wialon.ts",
        candidatos_reportes: reportesCandidatos
      },
      recursos_brudos: recursosEncontrados
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}