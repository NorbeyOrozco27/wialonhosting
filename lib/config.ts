export const RUTAS_MAESTRAS: Record<string, any> = {
  "NORTE": { checkpoints: [{ nombre: "CIT CEJA", tti: 0 }, { nombre: "T. NORTE", tti: 110 }] },
  "SUR":   { checkpoints: [{ nombre: "CIT CEJA", tti: 0 }, { nombre: "T. SUR", tti: 110 }] },
  "RIONEGRO": { checkpoints: [{ nombre: "CIT CEJA", tti: 0 }, { nombre: "T. RIONEGRO", tti: 50 }] },
  "UNION": { checkpoints: [{ nombre: "CIT CEJA", tti: 0 }, { nombre: "T. LA UNION 2", tti: 40 }] }
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