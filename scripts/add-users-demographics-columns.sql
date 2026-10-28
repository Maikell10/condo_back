-- Sexo y fecha de nacimiento (opcionales). Ejecutar una vez en MySQL.

ALTER TABLE users
  ADD COLUMN sex ENUM('M', 'F') NULL DEFAULT NULL COMMENT 'Sexo M/F' AFTER phone,
  ADD COLUMN birth_date DATE NULL DEFAULT NULL COMMENT 'Fecha de nacimiento' AFTER sex;
