// lib/util.ts
import { GEOCERCAS_ROLES, TTI_ESTANDAR } from './config.js';

export function auditarMovimiento(origenDB: string, destinoDB: string, horaTurno: string, geocercaWialon: string, horaGpsStr: string) {
  // 1. Normalizar nombres
  const origen = origenDB.toUpperCase();
  const destino = destinoDB.toUpperCase();
  
  // 2. Parsear horas a minutos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  const parteTiempo = horaGpsStr.split(' ')[1];
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 3. IDENTIFICAR SI ES SALIDA O LLEGADA
  // Si la geocerca de Wialon coincide con el ORIGEN de la DB -> Es una SALIDA
  if (origen.includes("CEJA") && geocercaWialon.includes("CIT CEJA")) {
    const diff = minGps - minProgSalida;
    return {
      evento: "SALIDA",
      retraso_salida: diff,
      hora_gps: parteTiempo,
      estado: Math.abs(diff) <= 10 ? "A TIEMPO" : (diff > 10 ? "TARDE" : "ADELANTADO")
    };
  }

  // Si la geocerca de Wialon coincide con el DESTINO de la DB -> Es una LLEGADA
  if (destino.includes("RIONEGRO") && geocercaWialon.includes("RIONEGRO")) {
    const esperadoLlegada = minProgSalida + 50; // TTI Rionegro
    const diff = minGps - esperadoLlegada;
    return {
      evento: "LLEGADA",
      retraso_llegada: diff,
      hora_gps: parteTiempo,
      estado: Math.abs(diff) <= 10 ? "A TIEMPO" : "RETRASADO"
    };
  }

  return null;
}