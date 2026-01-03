// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta } from './config.js';

export function auditarMovimiento(destino: string, horaTurno: string, geocercaWialon: string, horaGpsStr: string) {
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const config = RUTAS_MAESTRAS[categoria];
  const cp = config.checkpoints.find((p: any) => p.nombre === geocercaWialon);
  if (!cp) return null;

  // 1. Hora programada a minutos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minProg = hP * 60 + mP;

  // 2. Hora GPS a minutos (extrae "15:30" de "02.01.2026 15:30:00")
  const parteTiempo = horaGpsStr.includes(' ') ? horaGpsStr.split(' ')[1] : horaGpsStr;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minGps = hG * 60 + mG;

  // 3. Cálculo de TTI y diferencia
  const ttiReal = minGps - minProg;
  const diferencia = ttiReal - cp.tti;

  return {
    evento: cp.tti === 0 ? "SALIDA" : "LLEGADA",
    retraso_minutos: diferencia,
    hora_gps: parteTiempo,
    estado: diferencia > 10 ? "RETRASADO" : (diferencia < -10 ? "ADELANTADO" : "A TIEMPO")
  };
}