// api/diagnostico.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.json({ error: "Falta token" });

  try {
    // 1. Hora del Servidor
    const serverTime = new Date();
    const serverTimeTS = Math.floor(serverTime.getTime() / 1000);

    // 2. Login Wialon
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = loginRes.data.eid;

    // 3. Buscar Unidades y su "Último Mensaje"
    // Flags: 1 (Base) + 1024 (Last Message) = 1025
    const searchParams = {
      spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
      force: 1,
      flags: 1025,
      from: 0,
      to: 5 // Solo las primeras 5 para ver
    };

    const unitsRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params=${JSON.stringify(searchParams)}&sid=${sid}`);
    
    const unidades = unitsRes.data.items || [];
    const muestraUnidades = unidades.map((u: any) => ({
      nombre: u.nm,
      ultimo_mensaje_ts: u.lmsg ? u.lmsg.t : "Sin datos",
      ultimo_mensaje_human: u.lmsg ? new Date(u.lmsg.t * 1000).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : "N/A"
    }));

    // 4. Analizar Reporte 18 (Si existe)
    const templatesRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_resource","propName":"reporttemplates","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":8192,"from":0,"to":0}&sid=${sid}`);
    
    // Buscar plantilla ID 18
    let reporteInfo = "No encontrado en la búsqueda general";
    if (templatesRes.data && templatesRes.data.items) {
       // A veces las plantillas están dentro del recurso
       const resource = templatesRes.data.items.find((r: any) => r.rep && r.rep[18]);
       if (resource) {
         reporteInfo = `Encontrado en recurso ${resource.nm} (ID: ${resource.id})`;
       }
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    res.status(200).json({
      servidor: {
        hora_actual_sistema: serverTime.toString(),
        timestamp: serverTimeTS,
        zona_horaria: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      wialon_datos_reales: {
        cantidad_unidades_leidas: unidades.length,
        muestra_ultima_actividad: muestraUnidades
      },
      conclusion: {
        desfase_segundos: unidades[0]?.lmsg ? (serverTimeTS - unidades[0].lmsg.t) : "N/A",
        mensaje: unidades[0]?.lmsg && (Math.abs(serverTimeTS - unidades[0].lmsg.t) > 86400) 
          ? "⚠️ ALERTA CRÍTICA: Hay un desfase masivo de fechas. El servidor usa 2026 y Wialon 2025." 
          : "✅ Fechas sincronizadas."
      }
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}