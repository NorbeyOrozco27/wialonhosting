// lib/config.ts
export const RUTAS_MAESTRAS: Record<string, any> = {
  // BASE DE DATOS DE COORDENADAS EXACTAS (GURTAM MAPS)
  "MAPEO_LUGARES": {
    // LA CEJA
    "LA CEJA":          { nombre: "T. CIT CEJA", lat: 6.031375, lon: -75.428140 },
    
    // MEDELLÍN
    "TERM. NORTE":      { nombre: "T. NORTE", lat: 6.278344, lon: -75.570674 },
    "MEDELLIN TERM. NORTE": { nombre: "T. NORTE", lat: 6.278344, lon: -75.570674 },
    
    "TERM. SUR":        { nombre: "T. SUR", lat: 6.216175, lon: -75.587963 },
    "MEDELLIN TERM. SUR": { nombre: "T. SUR", lat: 6.216175, lon: -75.587963 },
    
    "EXPOSICIONES":     { nombre: "T. EXPO", lat: 6.237823, lon: -75.573333 },
    
    // ORIENTE
    "RIONEGRO":         { nombre: "T. RIONEGRO", lat: 6.151535, lon: -75.373023 },
    
    "LA UNION":         { nombre: "T. LA UNION 2", lat: 5.972245, lon: -75.358896 },
    "LA UNIÓN":         { nombre: "T. LA UNION 2", lat: 5.972245, lon: -75.358896 },
    
    // ⚠️ FALTA ABEJORRAL (Vi este destino en tus logs, pero no tengo coordenadas)
    // Agrega la línea de abajo cuando tengas la coordenada:
    // "ABEJORRAL":     { nombre: "T. ABEJORRAL", lat: 0.0000, lon: 0.0000 },
  }
};

// Fórmula matemática de distancia (Haversine)
export function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
  const R = 6371e3; 
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

// Función inteligente para encontrar coordenadas buscando palabras clave
export function obtenerCoordenadas(lugarSupabase: string) {
  if (!lugarSupabase) return null;
  
  const dbName = lugarSupabase.toUpperCase().trim();
  const mapa = RUTAS_MAESTRAS["MAPEO_LUGARES"];
  
  // 1. Búsqueda Exacta
  if (mapa[dbName]) return mapa[dbName];
  
  // 2. Búsqueda por Palabras Clave (Para atrapar variaciones)
  if (dbName.includes("NORTE")) return mapa["TERM. NORTE"];
  if (dbName.includes("SUR"))   return mapa["TERM. SUR"];
  
  // Rionegro
  if (dbName.includes("RIO") || dbName.includes("RIONEGRO")) return mapa["RIONEGRO"];
  
  // La Unión (con o sin tilde)
  if (dbName.includes("UNION") || dbName.includes("UNIÓN")) return mapa["LA UNION"];
  
  // La Ceja
  if (dbName.includes("CEJA")) return mapa["LA CEJA"];
  
  // Exposiciones
  if (dbName.includes("EXPO") || dbName.includes("EXPOSICIONES")) return mapa["EXPOSICIONES"];

  return null;
}