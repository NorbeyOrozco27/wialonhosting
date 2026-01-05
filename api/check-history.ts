// api/check-history.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. OBTENER BUS REFERENCIA (28645824)
    const UNIT_ID = 28645824; 
    const unitRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":${UNIT_ID},"flags":1025}&sid=${sid}`
    );
    
    const item = unitRes.data.item;
    if (!item) return res.json({ error: "Bus no encontrado" });

    const ultimoMensaje = item.lmsg ? item.lmsg.t : 0;
    const horaHumana = new Date(ultimoMensaje * 1000).toLocaleString('es-CO', {timeZone: 'America/Bogota'});

    // 3. PEDIR MENSAJES CRUDOS (Raw Messages)
    // Pedimos las 12 horas ANTERIORES al último mensaje
    const to = ultimoMensaje;
    const from = ultimoMensaje - (12 * 3600);

    const msgParams = {
        itemId: UNIT_ID,
        timeFrom: from,
        timeTo: to,
        flags: 0, // 0 = mensajes de datos GPS
        flagsMask: 0xFF00,
        loadCount: 50 // Traer solo los primeros 50 para verificar
    };

    const msgsRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=messages/load_interval&params=${JSON.stringify(msgParams)}&sid=${sid}`
    );

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const mensajes = msgsRes.data.messages || [];

    res.status(200).json({
      estado_actual: {
        bus_id: UNIT_ID,
        hora_ultimo_mensaje_wialon: horaHumana,
        timestamp_ultimo: ultimoMensaje
      },
      historial_crudo: {
        cantidad_mensajes_encontrados: msgsRes.data.count,
        mensajes_recibidos: mensajes.length,
        ejemplo_mensaje: mensajes[0] || "NINGUNO"
      },
      DIAGNOSTICO_FINAL: mensajes.length > 0 
        ? "✅ EL BUS TIENE HISTORIAL. El problema es la PLANTILLA DEL REPORTE 7." 
        : "❌ EL BUS NO TIENE HISTORIAL. La simulación actualiza la posición pero no guarda la ruta."
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}