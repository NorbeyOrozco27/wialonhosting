// lib/config.ts
export const RUTAS_MAESTRAS: Record<string, any> = {
  "NORTE": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.0336, lon: -75.4328 }, // Coordenadas aprox La Ceja
      { nombre: "T. NORTE", tti: 110, lat: 6.2758, lon: -75.5705 }   // Terminal Norte Medellín
    ] 
  },
  "SUR": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.0336, lon: -75.4328 },
      { nombre: "T. SUR", tti: 110, lat: 6.2185, lon: -75.5838 }     // Terminal Sur Medellín
    ] 
  },
  "RIONEGRO": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.0336, lon: -75.4328 },
      { nombre: "T. RIONEGRO", tti: 50, lat: 6.1517, lon: -75.3789 } // Terminal Rionegro (Aprox)
    ] 
  },
  "UNION": { 
    checkpoints: [
      { nombre: "T. CIT CEJA", tti: 0, lat: 6.0336, lon: -75.4328 },
      { nombre: "T. LA UNION 2", tti: 40, lat: 5.9744, lon: -75.3622 } // La Unión
    ] 
  }
};

// Función matemática para calcular distancia entre dos puntos (Fórmula Haversine)
export function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Radio de la tierra en metros
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distancia en metros
}

export function identificarRuta(destinoDB: string) {
  if (!destinoDB) return null;
  const d = destinoDB.toUpperCase();
  if (d.includes("NORTE")) return "NORTE";
  if (d.includes("SUR"))   return "SUR";
  if (d.includes("UNION")) return "UNION";
  if (d.includes("RIONEGRO")) return "RIONEGRO";
  return null;
}