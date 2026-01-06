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

// Esta función debe tener la palabra 'export' al inicio
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
  
  // 1. Identificar el punto de control objetivo (Destino)
  const checkpointObjetivo = config.checkpoints[config.checkpoints.length - 1];
  if (!checkpointObjetivo) return null;

  // --- LÓGICA HÍBRIDA (Batch vs Webhook) ---
  const esModoGPS = typeof dato1 === 'number' && typeof dato2 === 'number';
  
  let horaGpsStr = "";
  let distanciaMetros = 0;

  if (esModoGPS) {
      // MODO 1: AUDITORÍA BATCH (Tenemos coordenadas)
      const lat = dato1 as number;
      const lon = dato2 as number;
      horaGpsStr = dato3 || "";

      if (!horaGpsStr) return null;

      if (checkpointObjetivo.lat) {
          distanciaMetros = calcularDistancia(lat, lon, checkpointObjetivo.lat, checkpointObjetivo.lon);
          // Tolerancia amplia para pruebas: 5km (5000 metros)
          if (distanciaMetros > 1000) return null;
      }
  } else {
      // MODO 2: WEBHOOK (Tenemos nombre de geocerca)
      const nombreGeocercaEntrante = String(dato1).trim().toUpperCase();
      horaGpsStr = String(dato2);
      
      if (nombreGeocercaEntrante !== checkpointObjetivo.nombre.toUpperCase()) {
          return null;
      }
      distanciaMetros = 0; 
  }

  // 2. Parseo de tiempos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 3. Cálculo de Estado
  const esperadoEnPunto = minProgSalida + checkpointObjetivo.tti;
  const diferencia = minGps - esperadoEnPunto;

  if (Math.abs(diferencia) > 720) return null;

  return {
    evento: "LLEGADA",
    punto: checkpointObjetivo.nombre,
    retraso_minutos: diferencia,
    hora_gps: parteTiempo,
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO"),
    distancia_punto: Math.round(distanciaMetros)
  };
}