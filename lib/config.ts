// lib/config.ts

export const GEOCERCAS_ROLES: Record<string, any> = {
  "LA CEJA": "CIT CEJA",
  "RIONEGRO": "T. RIONEGRO",
  "MEDELLIN": "T. NORTE", // O T. SUR según corresponda
  "UNION": "T. LA UNION 2"
};

// Tiempos estimados de viaje (TTI)
export const TTI_ESTANDAR: Record<string, number> = {
  "RIONEGRO": 50,
  "UNION": 40,
  "MEDELLIN": 110
};