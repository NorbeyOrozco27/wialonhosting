// lib/config.ts
export const RUTAS_MAESTRAS: Record<string, any> = {
  // Mapeamos los nombres de Supabase a tus Geocercas de Wialon
  "MAPEO_LUGARES": {
    "LA CEJA": { nombre: "T. CIT CEJA", lat: 6.031375, lon: -75.428140 },
    "MEDELLIN TERM. NORTE": { nombre: "T. NORTE", lat: 6.278344, lon: -75.570674 },
    "MEDELLIN TERM. SUR": { nombre: "T. SUR", lat: 6.216175, lon: -75.587963 },
    "RIONEGRO": { nombre: "T. RIONEGRO", lat: 6.151535, lon: -75.373023 },
    "LA UNIÓN": { nombre: "T. LA UNION 2", lat: 5.972245, lon: -75.358896 },
    "LA UNION": { nombre: "T. LA UNION 2", lat: 5.972245, lon: -75.358896 },
    "EXPO": { nombre: "T. EXPO", lat: 6.237823, lon: -75.573333 }
  }
};

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

export function obtenerCoordenadas(lugarSupabase: string) {
  if (!lugarSupabase) return null;
  const dbName = lugarSupabase.toUpperCase().trim();
  const mapa = RUTAS_MAESTRAS["MAPEO_LUGARES"];
  
  // Búsqueda exacta
  if (mapa[dbName]) return mapa[dbName];
  
  // Búsqueda aproximada
  if (dbName.includes("NORTE")) return mapa["MEDELLIN TERM. NORTE"];
  if (dbName.includes("SUR")) return mapa["MEDELLIN TERM. SUR"];
  if (dbName.includes("RIO")) return mapa["RIONEGRO"];
  if (dbName.includes("UNION") || dbName.includes("UNIÓN")) return mapa["LA UNION"];
  if (dbName.includes("CEJA")) return mapa["LA CEJA"];
  if (dbName.includes("EXPO")) return mapa["EXPO"];

  return null;
}