// lib/config.ts
export const CONFIG_VIAJES: Record<string, { tti: number, salida: string, llegada: string }> = {
  "NORTE": { tti: 110, salida: "CIT CEJA", llegada: "SALIDA T. NORTE" },
  "SUR":   { tti: 110, salida: "CIT CEJA", llegada: "T. SUR" },
  "RIONEGRO": { tti: 50,  salida: "CIT CEJA", llegada: "T. RIONEGRO" },
  "UNION": { tti: 40,  salida: "CIT CEJA", llegada: "T. LA UNION 2" }
};

export function identificarRuta(destinoDB: string) {
  if (!destinoDB) return null;
  const d = destinoDB.toUpperCase();
  if (d.includes("NORTE")) return "NORTE";
  if (d.includes("SUR"))   return "SUR";
  if (d.includes("UNION")) return "UNION";
  if (d.includes("RIONEGRO")) return "RIONEGRO";
  return null;
}