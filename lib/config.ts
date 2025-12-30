// lib/config.ts

// Mapeamos los nombres de Wialon a tipos de puntos
export const PUNTOS_CONTROL: Record<string, string> = {
    "SALIDA T. NORTE": "INICIO",
    "TRAMO PALMAS": "CONTROL",
    "POINT SOMER": "CONTROL",
    "T. RIONEGRO": "FIN",
    "T. CIT CEJA": "FIN",
    "T. ABEJORRAL": "FIN"
};

// Definimos las rutas y sus tiempos ideales (TTI) en minutos desde la salida
export const RUTAS_MAESTRAS: Record<string, any> = {
    "MEDELLÍN - LA CEJA": {
        checkpoints: [
            { nombre: "SALIDA T. NORTE", tti_esperado: 0 },
            { nombre: "TRAMO PALMAS", tti_esperado: 35 },
            { nombre: "T. CIT CEJA", tti_esperado: 65 }
        ]
    },
    "LA CEJA - RIONEGRO": {
        checkpoints: [
            { nombre: "T. CIT CEJA", tti_esperado: 0 },
            { nombre: "POINT SOMER", tti_esperado: 25 },
            { nombre: "T. RIONEGRO", tti_esperado: 45 }
        ]
    }
};