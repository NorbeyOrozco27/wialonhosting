// lib/config.ts - CONFIGURACIÓN CALIBRADA (GURTAM MAPS)
export const RUTAS_MAESTRAS: Record<string, any> = {
  "NORTE": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.031375, lon: -75.428140 },
      { nombre: "T. NORTE", tti: 110, lat: 6.278344, lon: -75.570674 }
    ] 
  },
  "SUR": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.031375, lon: -75.428140 },
      { nombre: "T. SUR", tti: 110, lat: 6.216175, lon: -75.587963 }
    ] 
  },
  "RIONEGRO": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.031375, lon: -75.428140 },
      { nombre: "T. RIONEGRO", tti: 50, lat: 6.151535, lon: -75.373023 }
    ] 
  },
  "UNION": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.031375, lon: -75.428140 },
      { nombre: "T. LA UNION 2", tti: 40, lat: 5.972245, lon: -75.358896 }
    ] 
  },
  "EXPO": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.031375, lon: -75.428140 },
      { nombre: "T. EXPO", tti: 90, lat: 6.237823, lon: -75.573333 }
    ]
  }
};

// Función matemática de distancia (Haversine)
export function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Radio tierra (metros)
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; 
}

export function identificarRuta(destinoDB: string) {
  if (!destinoDB) return null;
  const d = destinoDB.toUpperCase();
  
  // Lógica mejorada para detectar rutas
  if (d.includes("NORTE")) return "NORTE";
  if (d.includes("SUR"))   return "SUR";
  if (d.includes("UNION") || d.includes("UNIÓN")) return "UNION";
  if (d.includes("RIONEGRO") || d.includes("RIO")) return "RIONEGRO";
  if (d.includes("EXPO")) return "EXPO";
  
  return null;
}