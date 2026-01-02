// lib/util.ts
import { CONFIG_VIAJES, identificarRuta } from './config.js';

export function auditarTrayecto(destino: string, horaTurno: string, geocercaWialon: string, horaGpsStr: string) {
  const cat = identificarRuta(destino);
  if (!cat) return null;

  const config = CONFIG_VIAJES[cat];
  const [hP, mP] = horaTurno.split(':').map(Number);
  const minutosProgSalida = hP * 60 + mP;

  const parteTiempo = horaGpsStr.split(' ')[1];
  const [hG, mG] = parteTiempo.split(':').map(Number);
  const minutosGps = hG * 60 + mG;

  // ¿Es un evento de SALIDA o de LLEGADA?
  const esSalida = geocercaWialon === config.salida;
  const esLlegada = geocercaWialon === config.llegada;

  if (esSalida) {
    const retrasoSalida = minutosGps - minutosProgSalida;
    return {
      tipo_evento: "SALIDA",
      minutos_retraso_salida: retrasoSalida,
      hora_salida_gps: parteTiempo,
      estado_salida: retrasoSalida > 5 ? "TARDE" : "A TIEMPO"
    };
  }

  if (esLlegada) {
    const minutosEsperadosLlegada = minutosProgSalida + config.tti;
    const retrasoLlegada = minutosGps - minutosEsperadosLlegada;
    return {
      tipo_evento: "LLEGADA",
      hora_llegada_gps: parteTiempo,
      tti_esperado: config.tti,
      retraso_llegada_final: retrasoLlegada,
      estado_llegada: retrasoLlegada > 5 ? "TARDE" : "A TIEMPO"
    };
  }

  return null;
}