# AXORA Backend

API backend de AXORA, billetera digital multi-moneda. Express + TypeScript, autenticación con JWT, Postgres como base de datos.

## Requisitos

- Node.js 20 o superior (probado con Node 22)
- npm
- PostgreSQL 14 o superior, con la extensión `pgcrypto` disponible (el schema la habilita solo)

## Instalación

```bash
git clone https://github.com/axoratechgroup/axora-backend.git
cd axora-backend
npm install
```

## Variables de entorno

Copiar el archivo de ejemplo y completarlo:

```bash
cp .env.example .env
```

| Variable       | Obligatoria | Descripción                                                                                  |
| -------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Sí          | Connection string de Postgres (`postgres://usuario:password@host:puerto/db`)                 |
| `JWT_SECRET`   | Sí          | Secreto para firmar y verificar los JWT. Usa un valor propio, no lo compartas entre entornos |
| `CORS_ORIGIN`  | No          | Orígenes permitidos por CORS, separados por coma. Default: `http://localhost:5173`           |
| `PORT`         | No          | Puerto donde escucha el server. Default: `3000` (en Railway lo inyecta la plataforma)        |

`.env` está en `.gitignore` — nunca se commitea.

## Base de datos

Con la base ya creada en Postgres (local o en un contenedor) y `DATABASE_URL` apuntando a ella:

```bash
# Crea las tablas (users, wallets, balances, currencies, etc.)
psql "$DATABASE_URL" -f schema.sql

# Carga las monedas soportadas (USD, ARS, MXN, COP, BRL, EUR)
psql "$DATABASE_URL" -f seeds/currencies.sql
```

Si no tenés Postgres instalado localmente, una alternativa rápida es levantarlo con Docker:

```bash
docker run --name axora-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=axora -p 5432:5432 -d postgres:16
```

## Levantar el servidor

```bash
npm run dev
```

Corre con `tsx watch` (recarga automática) en `http://localhost:3000` (o el puerto de la variable `PORT`, si está definida).

Para un build de producción:

```bash
npm run build
npm start
```

## Documentación de la API (Swagger / OpenAPI)

La API está documentada con OpenAPI 3.0, generado automáticamente desde comentarios JSDoc en `src/index.ts` (ver `src/config/swagger.ts`).

- UI interactiva (Swagger UI): `/docs` — ej. `http://localhost:3000/docs` en local, o `https://axora-backend-production-4e8d.up.railway.app/docs` en producción.
- Spec crudo en JSON: `/docs.json` — útil para importar en Postman/Insomnia o generar clientes.

Para agregar o modificar un endpoint, actualizar el bloque `@openapi` que está justo encima de la ruta en `src/index.ts`; no hace falta tocar `swagger.ts` salvo que se agregue un schema nuevo reutilizable.

## Endpoints disponibles

### `POST /auth/register`

Crea el usuario y su wallet en la misma transacción.

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Juan",
    "last_name": "Camilo",
    "username": "juanc",
    "email": "juanc@example.com",
    "password": "contraseña123"
  }'
```

Devuelve `201` con el usuario creado y un `token` JWT (expira en 2h). La contraseña debe tener mínimo 8 caracteres.

### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "juanc@example.com", "password": "contraseña123"}'
```

Devuelve `200` con el usuario (sin `password_hash`) y un `token` JWT.

### `GET /users`

Requiere token válido en el header `Authorization`.

```bash
curl http://localhost:3000/users \
  -H "Authorization: Bearer <token>"
```

Sin token o con uno inválido/expirado devuelve `401` o `403`.

Ver `/docs` para el detalle completo de cada endpoint (schemas de request/response, códigos de error).

## Notas

- CORS solo deja pasar el/los origen(es) definidos en `CORS_ORIGIN` (por defecto, el front local en `5173`).
- Los commits y el `push` los hace cada dev desde su propia terminal.
