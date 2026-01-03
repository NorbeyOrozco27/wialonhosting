// lib/config.ts - VERSIÓN CORREGIDA
export const RUTAS_MAESTRAS: Record<string, any> = {
  "NORTE": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0 },     // CAMBIADO de "CIT CEJA"
      { nombre: "T. NORTE", tti: 110 }       // CAMBIADO de "T. NORTE" (está bien)
    ] 
  },
  "SUR": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0 },     // CAMBIADO de "CIT CEJA"
      { nombre: "T. SUR", tti: 110 }         // CAMBIADO de "T. SUR" (está bien)
    ] 
  },
  "RIONEGRO": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0 },     // CAMBIADO de "CIT CEJA"
      { nombre: "T. RIONEGRO", tti: 50 }     // CAMBIADO de "T. RIONEGRO" (está bien)
    ] 
  },
  "UNION": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0 },     // CAMBIADO de "CIT CEJA"
      { nombre: "T. LA UNION 2", tti: 40 }   // CAMBIADO de "T. LA UNION 2" (está bien)
    ] 
  }
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