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
  // Argumentos flexibles para soportar Batch (GPS) y Webhook (Geocerca)
  dato1: number | string, // Puede ser Latitud (number) O NombreGeocerca (string)
  dato2: number | string, // Puede ser Longitud (number) O HoraGPS (string)
  dato3?: string          // HoraGPS (solo se usa si estamos en modo GPS)
): ResultadoAuditoria | null {
  
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const config = RUTAS_MAESTRAS[categoria];
  
  // 1. Identificar el punto de control objetivo (Destino)
  const checkpointObjetivo = config.checkpoints[config.checkpoints.length - 1];
  if (!checkpointObjetivo) return null;

  // --- LÓGICA HÍBRIDA ---
  
  // Detectamos si estamos en modo "GPS Batch" (recibimos números) o "Webhook" (recibimos texto)
  const esModoGPS = typeof dato1 === 'number' && typeof dato2 === 'number';
  
  let horaGpsStr = "";
  let distanciaMetros = 0;

  if (esModoGPS) {
      // MODO 1: AUDITORÍA BATCH (Tenemos coordenadas, calculamos distancia)
      const lat = dato1 as number;
      const lon = dato2 as number;
      horaGpsStr = dato3 || "";

      // Si no tenemos la hora, no podemos auditar
      if (!horaGpsStr) return null;

      if (checkpointObjetivo.lat) {
          distanciaMetros = calcularDistancia(lat, lon, checkpointObjetivo.lat, checkpointObjetivo.lon);
          // Si está lejos (> 800m), ignoramos
          if (distanciaMetros > 3000) return null;
      }
  } else {
      // MODO 2: WEBHOOK (Confiamos en el nombre de la geocerca)
      const nombreGeocercaEntrante = String(dato1).trim().toUpperCase();
      horaGpsStr = String(dato2);
      
      // Verificamos si la geocerca del webhook coincide con el destino
      // (Ej: Webhook dice "T. RIONEGRO", Destino espera "T. RIONEGRO")
      if (nombreGeocercaEntrante !== checkpointObjetivo.nombre.toUpperCase()) {
          // Si el webhook reporta una geocerca que no es el destino, no es una llegada válida
          return null;
      }
      distanciaMetros = 0; // En webhook asumimos distancia 0 (llegada perfecta)
  }

  // 2. Parseo de tiempos (Hora Programada)
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  // 3. Parseo de tiempos (Hora GPS)
  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 4. Cálculo de TTI y Diferencia
  const esperadoEnPunto = minProgSalida + checkpointObjetivo.tti;
  const diferencia = minGps - esperadoEnPunto;

  // Filtro de coherencia temporal (± 3 horas)
  if (Math.abs(diferencia) > 180) return null;

  return {
    evento: "LLEGADA",
    punto: checkpointObjetivo.nombre,
    retraso_minutos: diferencia,
    hora_gps: parteTiempo,
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO"),
    distancia_punto: Math.round(distanciaMetros)
  };
}