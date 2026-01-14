import axios from 'axios';

// Función para obtener mensajes crudos de una lista de unidades
export async function obtenerMensajesRaw(unitIds: number[], desde: number, hasta: number) {
  const token = process.env.WIALON_TOKEN;
  if (!token) throw new Error("Token faltante");

  let sid = '';
  try {
    // 1. Login
    const loginRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    sid = loginRes.data.eid;
    if (!sid) throw new Error("Login falló");

    console.log(`📡 WIALON: Descargando trazas GPS para ${unitIds.length} vehículos...`);

    const resultados: any[] = [];

    // Procesamos de a 5 buses a la vez
    const chunk = 5;
    for (let i = 0; i < unitIds.length; i += chunk) {
        const lote = unitIds.slice(i, i + chunk);
        
        const promesas = lote.map(async (unitId) => {
            try {
                // 🔥 loadCount: 50000 (Vital para tener el día completo)
                const url = `https://hst-api.wialon.com/wialon/ajax.html?svc=messages/load_interval&params={"itemId":${unitId},"timeFrom":${desde},"timeTo":${hasta},"flags":1,"flagsMask":1,"loadCount":50000}&sid=${sid}`;
                
                const res = await axios.get(url);
                const msgs = res.data.messages || [];
                
                if (msgs.length >= 49900) {
                    console.warn(`⚠️ ALERTA: Bus ${unitId} saturó el límite de 50k mensajes.`);
                }
                
                return { unitId, messages: msgs };
            } catch (e) {
                console.error(`Error bus ${unitId}`, e);
                return { unitId, messages: [] };
            }
        });

        const loteResultados = await Promise.all(promesas);
        resultados.push(...loteResultados);
    }

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
    
    return resultados;

  } catch (e: any) {
    if (sid) axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`).catch(()=>{});
    throw e;
  }
}

export async function buscarIdVehiculo(nombre: string, sid: string): Promise<number | null> {
    return null;
}