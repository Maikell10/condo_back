-- Propietarios sin correo: email NULL (sin placeholders @condominio.local).
-- En MySQL, varias filas pueden tener email NULL con índice UNIQUE en email.

ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL;
