const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Importa el archivo index.js de la carpeta routes (Node lo detecta automáticamente)
const apiRoutes = require("./routes");

const app = express();

// Middlewares
// Lista blanca de dominios permitidos
const allowedOrigins = [
    "http://localhost:4200", // Tu Angular local
    "http://169.197.143.232:10001", // Tu frontend en producción
];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("No permitido por CORS"));
            }
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    }),
);

app.use(express.json()); // Para poder leer JSON en el body de las peticiones

// Prueba de vida para Vercel
app.get("/", (req, res) => {
    res.send("API de Condominios: El servidor está vivo y funcionando 🚀");
});

// Usar el enrutador principal y prefijar todas las rutas con /api
app.use("/api", apiRoutes);

// Manejo de rutas no encontradas (404)
app.use((req, res) => {
    res.status(404).json({ message: "Ruta no encontrada" });
});

// Arrancar el servidor para desarrollo local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

// EXPORTACIÓN OBLIGATORIA PARA VERCEL
module.exports = app;
