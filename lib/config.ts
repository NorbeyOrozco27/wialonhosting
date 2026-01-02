// lib/config.ts

export const MAPA_TTI = {
  // MEDELLÍN NORTE (1h 50min = 110 min)
  "NORTE": {
    tiempo_total: 110,
    geocercas: ["T.CIT CEJA", "T. NORTE"]
  },
  // MEDELLÍN SUR (1h 50min = 110 min)
  "SUR": {
    tiempo_total: 110,
    geocercas: ["T.CIT CEJA", "T.SUR"]
  },
  // RIONEGRO (50 min)
  "RIONEGRO": {
    tiempo_total: 50,
    geocercas: ["T.CIT CEJA", "T. RIONEGRO"]
  },
  // LA UNIÓN (40 min)
  "UNION": {
    tiempo_total: 40,
    geocercas: ["T.CIT CEJA", "T. LA UNION 2"]
  }
};

/**
 * Esta función identificará qué tipo de ruta es según el destino de la DB
 */
export function identificarRuta(destinoDB: string) {
  const d = destinoDB.toUpperCase();
  if (d.includes("NORTE")) return "NORTE";
  if (d.includes("SUR"))   return "SUR";
  if (d.includes("UNION")) return "UNION";
  if (d.includes("RIONEGRO")) return "RIONEGRO";
  return null;
}