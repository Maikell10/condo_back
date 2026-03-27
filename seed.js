const db = require("./src/db");
const bcrypt = require("bcryptjs");

async function runSeed() {
    try {
        console.log("⏳ Creando datos de prueba...");

        // 1. Encriptar la contraseña genérica "123456"
        const passwordHash = await bcrypt.hash("123456", 10);

        // 2. Insertar Usuarios
        // El id 1 será Super Admin, el id 2 será Building Admin, el id 3 será Owner
        await db.query(
            `
            INSERT INTO users (name, email, password, role) VALUES 
            ('Super Administrador', 'admin@condomanager.com', ?, 'SUPER_ADMIN'),
            ('Gustavo Ramirez', 'edificio1@condomanager.com', ?, 'BUILDING_ADMIN'),
            ('Propietario PH', 'maikell.ods10@gmail.com', ?, 'OWNER')
        `,
            [passwordHash, passwordHash, passwordHash],
        );
        console.log("✅ Usuarios creados.");

        // 3. Insertar Edificio y asignarle el Admin (id: 2)
        await db.query(`
            INSERT INTO buildings (name, admin_id, address) VALUES 
            ('Residencias Indiana', 2, 'Caracas, Distrito Capital')
        `);
        console.log("✅ Edificio creado.");

        // 4. Insertar Apartamento y asignarlo al Edificio (id: 1) y al Propietario (id: 3)
        await db.query(`
            INSERT INTO apartments (building_id, owner_id, number) VALUES 
            (1, 3, 'PH')
        `);
        console.log("✅ Apartamento creado.");

        console.log("🎉 ¡Base de datos poblada con éxito!");
        process.exit();
    } catch (error) {
        console.error("❌ Error llenando la base de datos:", error);
        process.exit(1);
    }
}

runSeed();
