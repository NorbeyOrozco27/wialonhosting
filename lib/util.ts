// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta } from './config.js';

export function auditarEvento(destino: string, horaTurno: string, nombreGeocerca: string, horaGpsStr: string) {
  const categoria = identificarRuta(destino);
  if (!categoria) return null;

  const configRuta = RUTAS_MAESTRAS[categoria];
  const cp = configRuta.checkpoints.find((p: any) => p.nombre === nombreGeocerca);
  if (!cp) return null;

  // Hora programada a minutos
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minutosProg = hP * 60 + mP;

  // Hora GPS a minutos (Toma "05:23:29" de "02.01.2026 05:23:29")
  const parteTiempo = horaGpsStr.split(' ')[1];
  if (!parteTiempo) return null;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minutosGps = hG * 60 + mG;

  const ttiReal = minutosGps - minutosProg;
  const diferencia = ttiReal - cp.tti_esperado;

  return {
    punto: cp.nombre,
    esperado: cp.tti_esperado,
    real_tti: ttiReal,
    retraso_minutos: diferencia,
    estado: diferencia > 10 ? 'RETRASADO' : diferencia < -10 ? 'ADELANTADO' : 'A TIEMPO'
  };
}