-- Perfil opcional en users (cédula, teléfono). Ejecutar una vez en MySQL.
-- No rompe datos existentes: columnas NULL.

ALTER TABLE users
  ADD COLUMN cedula VARCHAR(32) NULL DEFAULT NULL COMMENT 'C.I. propietario u otro contacto' AFTER name,
  ADD COLUMN phone VARCHAR(32) NULL DEFAULT NULL COMMENT 'Teléfono contacto' AFTER email;
