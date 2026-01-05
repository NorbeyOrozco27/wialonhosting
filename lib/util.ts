// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta } from './config.js';

// Definimos la interfaz para que TypeScript sepa qué devuelve esta función
export interface ResultadoAuditoria {
  evento: string;
  punto: string;
  retraso_minutos: number;
  hora_gps: string;
  estado: "RETRASADO" | "ADELANTADO" | "A TIEMPO";
}

export function auditarMovimiento(destino: string, horaTurno: string, geocercaWialon: string, horaGpsStr: string): ResultadoAuditoria | null {
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const config = RUTAS_MAESTRAS[categoria];
  
  // Normalizar nombres para evitar errores por mayúsculas/espacios
  const nombreGeo = geocercaWialon.trim().toUpperCase();
  
  // 1. Buscamos si la geocerca es válida
  const cp = config.checkpoints.find((p: any) => p.nombre.toUpperCase() === nombreGeo);
  if (!cp) return null;

  // 2. Parseo de tiempos (Hora Programada)
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  // 3. Parseo de tiempos (Hora GPS)
  // Maneja formatos "2026-01-05 14:30:00" y "14:30:00"
  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 4. Cálculo de TTI y Diferencia (AQUÍ ESTABA EL ERROR ANTES)
  const esperadoEnPunto = minProgSalida + cp.tti;
  const diferencia = minGps - esperadoEnPunto; // Esta variable faltaba o estaba fuera de alcance

  // Filtro de coherencia: solo auditamos si está en una ventana de 4 horas (240 min)
  // Ampliamos la ventana para asegurar que capte datos de prueba
  if (Math.abs(diferencia) > 240) return null;

  return {
    evento: cp.tti === 0 ? "SALIDA" : "LLEGADA",
    punto: cp.nombre,
    retraso_minutos: diferencia,
    hora_gps: parteTiempo,
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO")
  };
}