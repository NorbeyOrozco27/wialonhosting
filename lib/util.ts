// lib/util.ts
import { obtenerCoordenadas, calcularDistancia } from './config.js';

export interface ResultadoAuditoria {
  evento: string;
  punto: string;
  retraso_minutos: number;
  hora_gps: string;
  estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO";
  distancia_punto: number;
}

export function auditarMovimiento(
  origen: string, 
  horaTurno: string, 
  latBus: number, 
  lonBus: number,
  horaGpsStr: string
): ResultadoAuditoria | null {
  
  const puntoControl = obtenerCoordenadas(origen);
  if (!puntoControl) return null;

  // 1. Validar Ubicación
  const distanciaMetros = calcularDistancia(latBus, lonBus, puntoControl.lat, puntoControl.lon);
  if (distanciaMetros > 1500) return null; // Tolerancia 1.5km

  // 2. Parseo de tiempos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProg = hP * 60 + mP;

  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  let [hG, mG] = parteTiempo.split(':').map(Number);
  
  // Corrección Zona Horaria (-5)
  hG = hG - 5;
  if (hG < 0) hG += 24;

  const minGps = hG * 60 + mG;
  const diferencia = minGps - minProg;

  // 3. LÓGICA DE NEGOCIO MEJORADA
  // Si es origen, buscamos coincidencia cercana a la hora de salida.
  // Ventana: Desde 2 horas antes hasta 30 min después
  if (diferencia < -120 || diferencia > 30) return null;

  // ESTADOS (Reglas de Negocio)
  // - Si sale antes de tiempo (ej: -5 min): ADELANTADO
  // - Si sale después (ej: +5 min): RETRASADO
  // - Entre -5 y +5: A TIEMPO
  
  let estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO" = "A TIEMPO";
  if (diferencia > 5) estado = "RETRASADO";
  if (diferencia < -5) estado = "ADELANTADO";

  return {
    evento: "EN_TERMINAL", // Indica que el bus está en posición de salida
    punto: puntoControl.nombre,
    retraso_minutos: diferencia,
    hora_gps: `${hG.toString().padStart(2, '0')}:${mG.toString().padStart(2, '0')}:00`,
    estado: estado,
    distancia_punto: Math.round(distanciaMetros)
  };
}