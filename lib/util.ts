// lib/util.ts
import { RUTAS_MAESTRAS } from './config.js';

export function auditarEvento(turno: any, nombreGeocerca: string, horaEvento: string) {
  const configRuta = RUTAS_MAESTRAS[turno.ruta];
  if (!configRuta) return null;

  const cp = configRuta.puntos.find((p: any) => p.nombre === nombreGeocerca);
  if (!cp) return null;

  // 1. Hora programada a minutos
  const [hP, mP] = turno.hora_turno.split(':').map(Number);
  const minutosProg = hP * 60 + mP;

  // 2. Hora GPS a minutos (Ajuste -5 horas para Colombia)
  const fechaGps = new Date(horaEvento);
  const minutosGps = (fechaGps.getUTCHours() - 5) * 60 + fechaGps.getUTCMinutes();

  // 3. TTI Real y Desviación
  const ttiReal = minutosGps - minutosProg;
  const diferencia = ttiReal - cp.tti_esperado;

  return {
    punto_nombre: cp.nombre,
    tti_esperado: cp.tti_esperado,
    tti_real: ttiReal,
    desviacion_minutos: diferencia, // <--- NOMBRE CORREGIDO AQUÍ
    estado: diferencia > 8 ? 'RETRASADO' : diferencia < -8 ? 'ADELANTADO' : 'A TIEMPO'
  };
}