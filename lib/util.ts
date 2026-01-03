// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta } from './config.js';

export function auditarMovimiento(destino: string, horaTurno: string, geocercaWialon: string, horaGpsStr: string) {
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const config = RUTAS_MAESTRAS[categoria];
  
  // 1. Buscamos si la geocerca es válida (Salida o Llegada)
  const cp = config.checkpoints.find((p: any) => p.nombre === geocercaWialon);
  if (!cp) return null;

  // 2. Parseo de tiempos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProgSalida = hP * 60 + mP;

  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 3. Cálculo de TTI y Diferencia
  const esperadoEnPunto = minProgSalida + cp.tti;
  const diferencia = minGps - esperadoEnPunto;

  // Filtro de coherencia: solo auditamos si está en una ventana de 2 horas
  if (Math.abs(diferencia) > 120) return null;

  return {
    evento: cp.tti === 0 ? "SALIDA" : "LLEGADA", // <-- ESTO ARREGLA EL ROJO DEL WEBHOOK
    punto: cp.nombre,
    retraso_minutos: diferencia,
    hora_gps: parteTiempo,
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO")
  };
}