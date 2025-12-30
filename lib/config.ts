// lib/config.ts
export const RUTAS_MAESTRAS: Record<string, any> = {
  "LA CEJA - MEDELLÍN": {
    puntos: [
      { nombre: "CIT CEJA", tti_esperado: 0 },
      { nombre: "POINT SOMER", tti_esperado: 12 },
      { nombre: "TRAMO PALMAS", tti_esperado: 35 },
      { nombre: "SALIDA T. NORTE", tti_esperado: 65 }
    ]
  },
  "MEDELLÍN - LA CEJA": {
    puntos: [
      { nombre: "SALIDA T. NORTE", tti_esperado: 0 },
      { nombre: "TRAMO PALMAS", tti_esperado: 25 },
      { nombre: "CIT CEJA", tti_esperado: 60 }
    ]
  }
};