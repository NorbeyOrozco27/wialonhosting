export const RUTAS_MAESTRAS: Record<string, any> = {
  // BASE DE DATOS DE COORDENADAS EXACTAS (AJUSTADAS A BAHÍAS DE PARQUEO)
  "MAPEO_LUGARES": {
    // ----------------------------------------------------
    // ZONA ORIENTE
    // ----------------------------------------------------
    
    // LA CEJA (Punto promedio de las bahías)
    "LA CEJA":          { nombre: "T. CIT CEJA", lat: 6.031289, lon: -75.428031 }, 

    // RIONEGRO (Bahía 1)
    "RIONEGRO":         { nombre: "T. RIONEGRO", lat: 6.151600, lon: -75.372930 },

    // LA UNIÓN (Bahía 1)
    "LA UNION":         { nombre: "T. LA UNION 2", lat: 5.972390, lon: -75.359134 },
    "LA UNIÓN":         { nombre: "T. LA UNION 2", lat: 5.972390, lon: -75.359134 },

    // ABEJORRAL (Parque Principal - Punto de cuadre)
    "ABEJORRAL":        { nombre: "T. ABEJORRAL", lat: 5.791610, lon: -75.427175 },

    // ----------------------------------------------------
    // ZONA MEDELLÍN
    // ----------------------------------------------------

    // TERMINAL NORTE (Bahía del bus)
    "TERM. NORTE":      { nombre: "T. NORTE", lat: 6.278391, lon: -75.570846 },
    "MEDELLIN TERM. NORTE": { nombre: "T. NORTE", lat: 6.278391, lon: -75.570846 },

    // TERMINAL SUR (Bahía del bus)
    "TERM. SUR":        { nombre: "T. SUR", lat: 6.216481, lon: -75.588084 },
    "MEDELLIN TERM. SUR": { nombre: "T. SUR", lat: 6.216481, lon: -75.588084 },

    // EXPOSICIONES (Mantenemos la anterior)
    "EXPOSICIONES":     { nombre: "T. EXPO", lat: 6.237823, lon: -75.573333 },
  }
};

// Fórmula Haversine (Matemática de Distancia)
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

// Buscador Inteligente
export function obtenerCoordenadas(lugarSupabase: string) {
  if (!lugarSupabase) return null;
  const dbName = lugarSupabase.toUpperCase().trim();
  const mapa = RUTAS_MAESTRAS["MAPEO_LUGARES"];
  
  // 1. Búsqueda Exacta
  if (mapa[dbName]) return mapa[dbName];
  
  // 2. Búsqueda por Palabras Clave
  if (dbName.includes("NORTE")) return mapa["TERM. NORTE"];
  if (dbName.includes("SUR"))   return mapa["TERM. SUR"];
  if (dbName.includes("RIO") || dbName.includes("RIONEGRO")) return mapa["RIONEGRO"];
  if (dbName.includes("UNION") || dbName.includes("UNIÓN")) return mapa["LA UNION"];
  if (dbName.includes("CEJA")) return mapa["LA CEJA"];
  
  // Abejorral
  if (dbName.includes("ABEJ")) return mapa["ABEJORRAL"];

  // Exposiciones
  if (dbName.includes("EXPO") || dbName.includes("EXPOSICIONES")) return mapa["EXPOSICIONES"];

  return null;
}