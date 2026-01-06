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
  origen: string, // <--- AHORA IMPORTA EL ORIGEN
  horaTurno: string, 
  latBus: number, 
  lonBus: number,
  horaGpsStr: string
): ResultadoAuditoria | null {
  
  // 1. Obtenemos las coordenadas del ORIGEN (Donde debe estar el bus para salir)
  const puntoControl = obtenerCoordenadas(origen);
  
  if (!puntoControl) return null; // No sabemos dónde es ese origen

  // 2. Calcular Distancia al ORIGEN
  const distanciaMetros = calcularDistancia(latBus, lonBus, puntoControl.lat, puntoControl.lon);

  // Tolerancia: 2km alrededor de la terminal/parqueadero de salida
  if (distanciaMetros > 2000) return null;

  // 3. Parseo de tiempos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProg = hP * 60 + mP;

  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  let [hG, mG] = parteTiempo.split(':').map(Number);
  
  // Corrección Zona Horaria (-5)
  hG = hG - 5;
  if (hG < 0) hG += 24;

  const minGps = hG * 60 + mG;

  // 4. Cálculo de Diferencia (Hora Real Salida - Hora Programada Salida)
  const diferencia = minGps - minProg;

  // Ventana de tiempo: Buscamos salidas entre 1 hora antes y 2 horas después
  if (diferencia < -60 || diferencia > 120) return null;

  return {
    evento: "SALIDA", // Estamos auditando la salida
    punto: puntoControl.nombre,
    retraso_minutos: diferencia,
    hora_gps: `${hG.toString().padStart(2, '0')}:${mG.toString().padStart(2, '0')}:00`,
    estado: diferencia > 5 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO"),
    distancia_punto: Math.round(distanciaMetros)
  };
}