import { supabaseA } from '../lib/supabase.js';

export default async function handler(req: any, res: any) {
  try {
    // 1. Probamos conexión básica y listado de tablas
    // Queremos ver cómo viene el formato de la columna 'fecha'
    const { data: operacionTest, error: errOp } = await supabaseA
      .from('operacion_diaria')
      .select('*')
      .limit(3);

    const { data: vehiculosTest, error: errVeh } = await supabaseA
      .from('Vehículos')
      .select('*')
      .limit(3);

    const { data: horariosTest, error: errHor } = await supabaseA
      .from('Horarios')
      .select('*')
      .limit(3);

    // 2. Respuesta de Auditoría de Estructura
    return res.status(200).json({
      diagnostico: {
        tablas: {
          operacion_diaria: {
            conectado: !errOp,
            error: errOp || null,
            ejemplo_datos: operacionTest?.[0] || "TABLA VACÍA",
            total_leidas: operacionTest?.length || 0
          },
          vehiculos: {
            conectado: !errVeh,
            error: errVeh || null,
            ejemplo_datos: vehiculosTest?.[0] || "TABLA VACÍA"
          },
          horarios: {
            conectado: !errHor,
            error: errHor || null,
            ejemplo_datos: horariosTest?.[0] || "TABLA VACÍA"
          }
        },
        servidor: {
          hora_servidor: new Date().toISOString(),
          zona_horaria: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      }
    });

  } catch (e: any) {
    return res.status(500).json({ error: "Falla catastrófica", mensaje: e.message });
  }
}