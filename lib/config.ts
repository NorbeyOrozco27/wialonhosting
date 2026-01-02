// lib/config.ts

export const RUTAS_MAESTRAS: Record<string, any> = {
  "NORTE": {
    checkpoints: [
      { nombre: "CIT CEJA", tti_esperado: 0 },
      { nombre: "T. NORTE", tti_esperado: 110 } // 1h 50m
    ]
  },
  "SUR": {
    checkpoints: [
      { nombre: "CIT CEJA", tti_esperado: 0 },
      { nombre: "T. SUR", tti_esperado: 110 } // 1h 50m
    ]
  },
  "RIONEGRO": {
    checkpoints: [
      { nombre: "CIT CEJA", tti_esperado: 0 },
      { nombre: "T. RIONEGRO", tti_esperado: 50 }
    ]
  },
  "UNION": {
    checkpoints: [
      { nombre: "CIT CEJA", tti_esperado: 0 },
      { nombre: "T. LA UNION 2", tti_esperado: 40 }
    ]
  }
};

/**
 * Esta función es el puente: mira el destino de Supabase 
 * y nos dice qué configuración de tiempo usar.
 */
export function identificarRuta(destinoDB: string) {
  if (!destinoDB) return null;
  const d = destinoDB.toUpperCase();
  // Buscamos palabras clave sin importar qué más diga el texto
  if (d.includes("NORTE")) return "NORTE";
  if (d.includes("SUR"))   return "SUR";
  if (d.includes("UNION")) return "UNION";
  if (d.includes("RIONEGRO")) return "RIONEGRO";
  return null;
}