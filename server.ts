import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';

// Importamos los manejadores (handlers)
const liveRadarModule = require('./api/live-radar');
const liveRadarHandler = liveRadarModule.default || liveRadarModule;

const tableroModule = require('./api/tablero');
const tableroHandler = tableroModule.default || tableroModule;

config();
const app = express();
const PORT = 3000;

app.use(cors());

// --- RUTA 1: RADAR (Mapa en vivo) ---
app.get('/api/live-radar', async (req, res) => {
    try {
        console.log(`📡 Radar solicitado: ${new Date().toLocaleTimeString()}`);
        await liveRadarHandler(req, res);
    } catch (error) {
        console.error("Error en radar:", error);
        res.status(500).json({ error: "Error interno del radar" });
    }
});

// --- RUTA 2: TABLERO (Tabla de turnos) ---
app.get('/api/tablero', async (req, res) => {
    try {
        console.log(`✈️ Tablero solicitado: ${new Date().toLocaleTimeString()}`);
        await tableroHandler(req, res);
    } catch (error) {
        console.error("Error en tablero:", error);
        res.status(500).json({ error: "Error interno del tablero" });
    }
});

// --- RUTAS DE ARCHIVOS HTML (Frontend) ---
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'live-map.html'));
});

app.get('/tablero', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dashboard.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
    🚀 Servidor TransUnidos ACTIVO
    -----------------------------------
    🗺️  Mapa en Vivo:    http://localhost:${PORT}
    ✈️  Tablero Turnos:  http://localhost:${PORT}/tablero
    -----------------------------------
    `);
});