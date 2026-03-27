const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Importa el archivo index.js de la carpeta routes (Node lo detecta automáticamente)
const apiRoutes = require("./routes");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json()); // Para poder leer JSON en el body de las peticiones

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
