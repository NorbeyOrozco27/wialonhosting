// lib/util.ts
import { RUTAS_MAESTRAS } from './config.js';

export function auditarEvento(turno: any, nombreGeocerca: string, horaEvento: string) {
  // 1. Buscamos la configuración de la ruta que viene de Supabase A
  const configRuta = RUTAS_MAESTRAS[turno.ruta];
  if (!configRuta) return { error: "Ruta no configurada en Mundo B" };

  // 2. Buscamos el punto de control por su nombre exacto
  const cp = configRuta.checkpoints.find((p: any) => p.nombre === nombreGeocerca);
  if (!cp) return null; // Es una geocerca que no auditamos (ej: un taller)

  // 3. Calculamos tiempos
  const [hP, mP] = turno.hora_turno.split(':').map(Number);
  const minutosProg = hP * 60 + mP;

  const fechaGps = new Date(horaEvento);
  // Wialon suele enviar UTC, ajustamos a hora Colombia (-5) si es necesario
  const minutosGps = (fechaGps.getUTCHours() - 5) * 60 + fechaGps.getUTCMinutes();

  const ttiReal = minutosGps - minutosProg;
  const desviacion = ttiReal - cp.tti_esperado;

  return {
    punto: cp.nombre,
    tti_esperado: cp.tti_esperado,
    tti_real: ttiReal,
    desviacion: desviacion,
    estado: desviacion > 8 ? 'RETRASADO' : desviacion < -8 ? 'ADELANTADO' : 'A TIEMPO'
  };
}