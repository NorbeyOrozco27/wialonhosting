// lib/util.ts
import { RUTAS_MAESTRAS, identificarRuta } from './config.js';

export function auditarEvento(turno: any, nombreGeocerca: string, horaEvento: string) {
  // 1. Usamos el destino de la base de datos para saber qué tiempos aplicar
  const categoria = identificarRuta(turno.destino);
  if (!categoria) return null;

  const configRuta = RUTAS_MAESTRAS[categoria];
  
  // 2. Buscamos si la geocerca de Wialon es uno de nuestros puntos válidos
  const cp = configRuta.checkpoints.find((p: any) => p.nombre === nombreGeocerca);
  if (!cp) return null;

  // 3. Parseo de Hora Programada (Supabase: "16:20:00")
  const [hP, mP] = turno.hora_turno.split(':').map(Number);
  const minutosProg = hP * 60 + mP;

  // 4. Parseo de Hora GPS (Wialon: "02.01.2026 16:25:00")
  const parteTiempo = horaEvento.split(' ')[1];
  if (!parteTiempo) return null;
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minutosGps = hG * 60 + mG;

  // 5. Cálculo de Desviación
  const ttiReal = minutosGps - minutosProg;
  const diferencia = ttiReal - cp.tti_esperado;

  return {
    punto_nombre: cp.nombre,
    tti_esperado: cp.tti_esperado,
    tti_real: ttiReal,
    desviacion_minutos: diferencia,
    estado: diferencia > 10 ? 'RETRASADO' : diferencia < -10 ? 'ADELANTADO' : 'A TIEMPO'
  };
}