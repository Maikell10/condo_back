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
    "http://169.197.143.232:10001/", // Tu frontend en producción
];

app.use(
    cors({
        origin: function (origin, callback) {
            // Permitir peticiones sin origen (como Postman o apps móviles)
            if (!origin) return callback(null, true);

            if (allowedOrigins.indexOf(origin) === -1) {
                const msg =
                    "El policy de CORS para este sitio no permite acceso desde el origen especificado.";
                return callback(new Error(msg), false);
            }
            return callback(null, true);
        },
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true, // Vital si usas cookies o sesiones
    }),
);
app.use(express.json()); // Para poder leer JSON en el body de las peticiones
// Manejo manual de preflight para Vercel
app.options("*", cors());

// Usar el enrutador principal y prefijar todas las rutas con /api
app.use("/api", apiRoutes);

// Manejo de rutas no encontradas (404)
app.use((req, res) => {
    res.status(404).json({ message: "Ruta no encontrada" });
});

// Arrancar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
