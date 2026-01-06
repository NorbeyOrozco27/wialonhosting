// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta, calcularDistancia } from './config.js';

export interface ResultadoAuditoria {
  evento: string;
  punto: string;
  retraso_minutos: number;
  hora_gps: string;
  estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO";
  distancia_punto: number;
}

export function auditarMovimiento(
  destino: string, 
  horaTurno: string, 
  dato1: number | string, 
  dato2: number | string, 
  dato3?: string
): ResultadoAuditoria | null {
  
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const config = RUTAS_MAESTRAS[categoria];
  
  // 1. Identificar el punto de control (Destino)
  const checkpointObjetivo = config.checkpoints[config.checkpoints.length - 1];
  if (!checkpointObjetivo) return null;

  const esModoGPS = typeof dato1 === 'number' && typeof dato2 === 'number';
  
  let horaGpsStr = "";
  let distanciaMetros = 0;

  if (esModoGPS) {
      const lat = dato1 as number;
      const lon = dato2 as number;
      horaGpsStr = dato3 || "";

      if (!horaGpsStr) return null;

      if (checkpointObjetivo.lat) {
          distanciaMetros = calcularDistancia(lat, lon, checkpointObjetivo.lat, checkpointObjetivo.lon);
          // Tolerancia de 3km para asegurar detección
          if (distanciaMetros > 3000) return null;
      }
  } else {
      // Modo Webhook
      const nombreGeocercaEntrante = String(dato1).trim().toUpperCase();
      horaGpsStr = String(dato2);
      if (nombreGeocercaEntrante !== checkpointObjetivo.nombre.toUpperCase()) return null;
      distanciaMetros = 0; 
  }

  // 2. Parseo de tiempos (Hora Programada Colombia)
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  // 3. Parseo de tiempos (Hora GPS - Wialon viene en UTC)
  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  let [hG, mG] = parteTiempo.split(':').map(Number);
  
  // --- CORRECCIÓN DE ZONA HORARIA (LA SOLUCIÓN MÁGICA) ---
  // Wialon envía UTC. Colombia es UTC-5.
  // Restamos 5 horas a la hora del GPS.
  hG = hG - 5;
  if (hG < 0) hG += 24; // Ajuste si la resta pasa al día anterior (ej: 02:00 - 5 = 21:00)

  const minGps = hG * 60 + mG;

  // 4. Cálculo de Diferencia
  const esperadoEnPunto = minProgSalida + checkpointObjetivo.tti;
  const diferencia = minGps - esperadoEnPunto;

  // Filtro de coherencia: Ahora que las horas están corregidas,
  // podemos bajar la tolerancia a algo realista (ej: 90 minutos)
  if (Math.abs(diferencia) > 90) return null;

  return {
    evento: "LLEGADA",
    punto: checkpointObjetivo.nombre,
    retraso_minutos: diferencia,
    hora_gps: `${hG.toString().padStart(2, '0')}:${mG.toString().padStart(2, '0')}:00`, // Guardamos la hora corregida a Colombia
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO"),
    distancia_punto: Math.round(distanciaMetros)
  };
}