// lib/wialon.ts
import axios from 'axios';

const WIALON_TOKEN = process.env.WIALON_TOKEN;

/**
 * Función genérica para hablar con Wialon usando el Token
 */
export async function consultarWialon(svc: string, params: any) {
  try {
    // 1. Login por Token para obtener el SID (Session ID)
    const loginUrl = `https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${WIALON_TOKEN}"}`;
    const loginRes = await axios.get(loginUrl);
    const sid = loginRes.data.eid;

    if (!sid) throw new Error("Fallo de autenticación en Wialon");

    // 2. Ejecución del servicio solicitado
    const url = `https://hst-api.wialon.com/wialon/ajax.html?svc=${svc}&params=${JSON.stringify(params)}&sid=${sid}`;
    const response = await axios.get(url);

    // 3. Logout (Cerrar sesión para no saturar el servidor de Wialon)
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    return response.data;
  } catch (error: any) {
    console.error("Error API Wialon:", error.message);
    throw error;
  }
}

/**
 * Obtiene el odómetro (kilometraje) actual de una unidad
 */
export async function obtenerOdometro(unitId: number) {
    const data = await consultarWialon("core/search_item", {
        id: unitId,
        flags: 1 // Flag para datos de sistema y contadores
    });
    return data.item ? data.item.cnm : 0;
}