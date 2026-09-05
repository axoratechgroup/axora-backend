# AXORA Backend

API REST y motor transaccional de **AXORA**, billetera digital multi-moneda diseñada para viajeros y nómadas digitales. Desarrollada con **Express 5**, **TypeScript**, autenticación **JWT**, **PostgreSQL** y motor de inteligencia artificial con **Google Gemini**.

---

## 📋 Tabla de Contenidos

1. [Características](#-características)
2. [Requisitos Previos](#-requisitos-previos)
3. [Instalación y Configuración](#-instalación-y-configuración)
4. [Variables de Entorno](#-variables-de-entorno)
5. [Base de Datos y Migraciones](#-base-de-datos-y-migraciones)
6. [Scripts de Ejecución](#-scripts-de-ejecución)
7. [Arquitectura del Proyecto](#-arquitectura-del-proyecto)
8. [Documentación de la API (Swagger / OpenAPI)](#-documentación-de-la-api-swagger--openapi)
9. [Catálogo de Endpoints](#-catálogo-de-endpoints)
   - [Salud y Raíz](#salud-y-raíz)
   - [Autenticación](#autenticación)
   - [Billetera (Wallet)](#billetera-wallet)
   - [Cotizaciones y Divisas](#cotizaciones-y-divisas)
   - [Asistente Virtual con IA (Chat)](#asistente-virtual-con-ia-chat)
   - [Administración](#administración)
10. [Reglas de Negocio y Seguridad](#-reglas-de-negocio-y-seguridad)
11. [Pruebas Automatizadas](#-pruebas-automatizadas)

---

## 🚀 Características

- **Multi-moneda nativa**: Soporte para USD, EUR, ARS, COP, MXN y BRL con balances segregados e independientes por billetera.
- **Operaciones atómicas y consistentes (ACID)**: Transacciones con bloqueo a nivel de fila (`FOR UPDATE`) para evitar condiciones de carrera (*race conditions*) y deadlocks.
- **Límites de seguridad**:
  - Patrimonio máximo por usuario: equivalente a **USD 10.000**.
  - Límite por transferencia individual: equivalente a **USD 2.000**.
  - Comisión por intercambio de divisas (*swap*): **0.3%** configurable.
- **Cotizaciones en tiempo real con caché**:
  - Consulta a proveedores externos (`open.er-api.com`).
  - Caché de tipos de cambio en Postgres con TTL de 60 minutos y tasas de respaldo (*fallbacks*) en caso de indisponibilidad.
  - Histórico de cotizaciones vía `api.frankfurter.dev` (7, 30 y 90 días).
- **Asistente de IA integrado (Google Gemini 3.5 Flash Lite)**:
  - Chat conversacional con soporte de historial.
  - *Function calling* / herramientas para proponer transferencias, cargas de saldo e intercambios.
  - Confirmación explícita de operaciones en 2 pasos (`/chat/confirm`).
- **Autenticación y Autorización**:
  - Tokens JWT con expiración de 2 horas.
  - Encriptación de contraseñas con bcrypt (costo 10).
  - Mitigación de *timing attacks* en el login mediante hash constante de prueba.
  - Control de acceso basado en roles (`user` y `admin`).
- **OpenAPI 3.0 & Swagger UI**: Especificación viva autogenerada desde comentarios JSDoc.

---

## 💻 Requisitos Previos

- **Node.js**: v20.0.0 o superior (recomendado v22.x LTS).
- **npm**: v10.x o superior.
- **PostgreSQL**: v14 o superior, con la extensión `pgcrypto` disponible (el script `schema.sql` la activa automáticamente).
- **Docker** *(opcional)*: para levantar una instancia local de PostgreSQL rápidamente.

---

## ⚙️ Instalación y Configuración

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/axoratechgroup/axora-backend.git
   cd axora-backend
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar las variables de entorno:**
   ```bash
   cp .env.example .env
   ```
   Edita `.env` con tus parámetros de base de datos, secreto JWT y clave de API de Gemini.

---

## 🔑 Variables de Entorno

El archivo `.env` está excluido del control de versiones (`.gitignore`). Configura los siguientes valores:

| Variable | Obligatoria | Valor por defecto | Descripción |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Sí** | — | Cadena de conexión a PostgreSQL (`postgres://usuario:password@host:puerto/database`). |
| `JWT_SECRET` | **Sí** | — | Clave secreta para firmar y validar tokens JWT. Debe ser un valor seguro y único por entorno. |
| `GEMINI_API_KEY` | **Sí** | — | API Key de Google Gemini para el asistente virtual (`gemini-3.5-flash-lite`). |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Orígenes HTTP permitidos, separados por comas. |
| `PORT` | No | `3000` | Puerto en el que se ejecuta el servidor HTTP Express. |

---

## 🗄️ Base de Datos y Migraciones

### Opción A: Levantar PostgreSQL con Docker

```bash
docker run --name axora-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=axora \
  -p 5432:5432 -d postgres:16
```

### Opción B: Inicializar tablas y datos semilla

Con `DATABASE_URL` apuntando a la base de datos de destino:

```bash
# 1. Crear extensión pgcrypto, tablas, índices, restricciones y triggers
psql "$DATABASE_URL" -f schema.sql

# 2. Cargar catálogo de monedas soportadas (USD, ARS, MXN, COP, BRL, EUR)
psql "$DATABASE_URL" -f seeds/currencies.sql

# 3. (Opcional) Backfill de billeteras y balances para usuarios preexistentes
psql "$DATABASE_URL" -f seeds/backfill_wallets_and_balances.sql
```

### Esquema de Tablas

- `currencies`: Catálogo de divisas (`code`, `name`, `symbol`).
- `users`: Cuentas de usuario (`id`, `first_name`, `last_name`, `username`, `email`, `password_hash`, `role`).
- `wallets`: Billetera 1-a-1 asociada a cada usuario (`id`, `user_id`).
- `balances`: Saldos por divisa asociados a una billetera (`wallet_id`, `currency`, `amount`).
- `transactions`: Registro inmutable de transacciones (`TOP_UP`, `TRANSFER`, `SWAP`) con balances anteriores y posteriores.
- `exchange_rates`: Caché local de tasas de cambio con tiempo de expiración (`expires_at`).
- `notification_outbox`: Bandeja de salida para notificaciones y auditoría asíncrona.

---

## 🚀 Scripts de Ejecución

| Comando | Descripción |
| :--- | :--- |
| `npm run dev` | Inicia el servidor de desarrollo con recarga en caliente usando `tsx watch`. |
| `npm run build` | Compila el código TypeScript a JavaScript en el directorio `dist/`. |
| `npm start` | Ejecuta el build compilado en producción (`node dist/index.js`). |
| `npm test` | Ejecuta la suite de pruebas en modo interactivo/vigilancia con **Vitest**. |
| `npm run test:run` | Ejecuta la suite completa de pruebas una sola vez y finaliza. |

---

## 🏛️ Arquitectura del Proyecto

El backend implementa una arquitectura modular desacoplada con separación de configuración, middlewares, servicios de dominio y controladores de rutas:

```
axora-backend/
├── schema.sql                     # DDL completo de PostgreSQL (tablas, constraints, triggers)
├── seeds/
│   ├── currencies.sql             # Monedas base iniciales
│   └── backfill_wallets_and_balances.sql # Script de consistencia de wallets y balances
├── src/
│   ├── index.ts                   # Punto de entrada de la aplicación Express y registro de routers
│   ├── config/
│   │   ├── database.ts            # Pool de conexiones a PostgreSQL con pg.Pool
│   │   ├── cors.ts                # Configuración dinámica de políticas CORS
│   │   └── swagger.ts             # Definición de especificación OpenAPI 3.0 JSDoc
│   ├── middleware/
│   │   ├── auth.ts                # Middlewares: authenticateToken y requireAdmin
│   │   └── auth.middleware.test.ts # Tests unitarios de autenticación y autorización
│   ├── routes/
│   │   ├── auth.routes.ts         # Registro y login de usuarios
│   │   ├── auth.routes.test.ts    # Tests de registro, hashing y login
│   │   ├── wallet.routes.ts       # Balances, transacciones, topup, transferencias y swaps
│   │   ├── wallet.routes.test.ts  # Tests de transacciones atómicas y límites
│   │   ├── rates.routes.ts        # Histórico de tasas de cambio
│   │   ├── rates.routes.test.ts   # Tests de validación y proxy de cotizaciones
│   │   ├── chat.routes.ts         # Endpoints del asistente conversacional y confirmación
│   │   ├── admin.routes.ts        # Endpoints protegidos para administradores
│   │   └── admin.routes.test.ts   # Tests de control de acceso a reportes admin
│   ├── services/
│   │   ├── exchangeRates.ts       # Integración con APIs de tasas y caché en BD
│   │   ├── exchangeRates.test.ts  # Tests de cálculo y caché de divisas
│   │   └── geminiChat.ts          # Integración con Google Gemini y Function Calling
│   └── types/
│       └── express.d.ts           # Extensiones de tipos globales de Express (req.user)
├── tsconfig.json                  # Configuración del compilador TypeScript
└── vitest.config.ts               # Configuración del test runner Vitest
```

---

## 📖 Documentación de la API (Swagger / OpenAPI)

La API cuenta con documentación viva generada mediante **OpenAPI 3.0**:

- **Swagger UI interactivo**: [`http://localhost:3000/docs`](http://localhost:3000/docs) (o `/docs` en el host de producción).
- **Especificación JSON cruda**: [`http://localhost:3000/docs.json`](http://localhost:3000/docs.json) (ideal para importar en Postman o Insomnia).

---

## 📡 Catálogo de Endpoints

### Salud y Raíz

#### `GET /`
Verifica el estado del servidor.
- **Acceso**: Público.
- **Respuesta `200 OK`**:
  ```json
  {
    "name": "AXORA API",
    "status": "healthy",
    "version": "1.0.0",
    "docs": "/docs"
  }
  ```

---

### Autenticación

#### `POST /auth/register`
Registra un nuevo usuario y crea atómicamente su billetera y balances iniciales en cero para todas las monedas activas.
- **Acceso**: Público.
- **Body**:
  ```json
  {
    "first_name": "Juan",
    "last_name": "Camilo",
    "username": "juanc",
    "email": "juanc@example.com",
    "password": "miPasswordSeguro123"
  }
  ```
- **Validaciones**: Contraseña mínima de 8 caracteres, formato de correo válido, unicidad de usuario y correo (insensible a mayúsculas/minúsculas).
- **Respuesta `201 Created`**:
  ```json
  {
    "user": {
      "id": "c1f7b8c2-3e2a-4c8d-bf8d-9b1e5a2c3d4e",
      "first_name": "Juan",
      "last_name": "Camilo",
      "username": "juanc",
      "email": "juanc@example.com",
      "role": "user",
      "created_at": "2026-09-05T06:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

#### `POST /auth/login`
Inicia sesión validando credenciales contra el hash bcrypt. Emplea un hash dummy para mitigar ataques de temporización si el usuario no existe.
- **Acceso**: Público.
- **Body**:
  ```json
  {
    "email": "juanc@example.com",
    "password": "miPasswordSeguro123"
  }
  ```
- **Respuesta `200 OK`**: Retorna el objeto `user` (sin `password_hash`) y el `token` JWT con vigencia de 2 horas.

---

### Billetera (Wallet)

*Todos los endpoints de billetera requieren el encabezado `Authorization: Bearer <token>`.*

#### `GET /wallet`
Obtiene los saldos de cada moneda y calcula el valor patrimonial total consolidado en USD.
- **Respuesta `200 OK`**:
  ```json
  {
    "wallet_id": "9b1e5a2c-3e2a-4c8d-bf8d-c1f7b8c2d4e5",
    "created_at": "2026-09-05T06:00:00.000Z",
    "total_in_usd": 1250.75,
    "balances": [
      {
        "currency": "USD",
        "currency_name": "Dólar estadounidense",
        "symbol": "$",
        "amount": "1000.00000000",
        "updated_at": "2026-09-05T06:30:00.000Z"
      },
      {
        "currency": "EUR",
        "currency_name": "Euro",
        "symbol": "€",
        "amount": "230.00000000",
        "updated_at": "2026-09-05T06:30:00.000Z"
      }
    ]
  }
  ```

#### `GET /wallet/transactions`
Lista el historial de movimientos de la billetera (recientes primero). Añade los campos computados `direction` (`sent` | `received`) y `counterparty_username`.
- **Respuesta `200 OK`**:
  ```json
  {
    "transactions": [
      {
        "id": "e4e76a6f-713f-479a-b69b-c30bbb417bf5",
        "type": "TRANSFER",
        "status": "COMPLETED",
        "wallet_id": "9b1e5a2c-...",
        "destination_wallet_id": "a3b2c1d0-...",
        "from_currency": "USD",
        "from_amount": "50.00000000",
        "to_currency": "USD",
        "to_amount": "50.00000000",
        "applied_exchange_rate": null,
        "description": "Transferencia a andres_dev",
        "created_at": "2026-09-05T06:45:00.000Z",
        "direction": "sent",
        "counterparty_username": "andres_dev"
      }
    ]
  }
  ```

#### `POST /wallet/topup`
Carga saldo directamente a la billetera en la moneda seleccionada.
- **Body**:
  ```json
  {
    "currency": "USD",
    "amount": 200
  }
  ```
- **Validaciones**: `amount > 0`. Verifica que el balance consolidado en USD tras la recarga no exceda el límite de USD 10.000.
- **Respuesta `200 OK`**: Objeto de la transacción creada con estado `COMPLETED`.

#### `POST /wallet/transfer`
Transfiere fondos de una moneda específica hacia otro usuario registrado mediante su `recipient_username`.
- **Body**:
  ```json
  {
    "recipient_username": "andres_dev",
    "currency": "USD",
    "amount": 100
  }
  ```
- **Validaciones**:
  - No permite auto-transferencias.
  - El destinatario debe existir y tener billetera activa.
  - Saldo suficiente en la moneda indicada.
  - Límite máximo por transferencia: equivalente a **USD 2.000**.
  - Bloqueo determinista de filas en base de datos ordenado por `wallet_id` para garantizar atomicidad y evitar deadlocks.
- **Respuesta `200 OK`**: Detalle de la transacción emitida.

#### `POST /wallet/exchange`
Convierte saldo entre dos monedas distintas pertenecientes a la misma billetera (*swap* interno).
- **Body**:
  ```json
  {
    "from_currency": "USD",
    "to_currency": "EUR",
    "amount": 100
  }
  ```
- **Lógica de conversión**:
  - Consulta la cotización en tiempo real vía `exchangeRates.ts` (con fallback y caché en BD).
  - Deduce automáticamente la comisión de swap (**0.3%**).
  - Almacena el desglose de tarifas y el importe bruto en el campo `metadata` (JSONB) de la transacción.
- **Respuesta `200 OK`**: Transacción con tipo `SWAP`, tasa aplicada y balances antes/después.

---

### Cotizaciones y Divisas

#### `GET /rates/history`
Obtiene la serie temporal de cotizaciones históricas para graficar tendencias. No requiere autenticación.
- **Query Params**:
  - `base`: Moneda base en formato ISO 3 letras (ej. `USD`).
  - `quote`: Moneda de cotización en formato ISO 3 letras (ej. `MXN`).
  - `range`: Rango de tiempo (`7d`, `30d` o `90d`).
- **Ejemplo**: `GET /rates/history?base=USD&quote=MXN&range=30d`
- **Respuesta `200 OK`**:
  ```json
  {
    "base": "USD",
    "quote": "MXN",
    "range": "30d",
    "source": "frankfurter.dev",
    "points": [
      { "date": "2026-08-06", "rate": 19.42 },
      { "date": "2026-08-07", "rate": 19.51 }
    ]
  }
  ```

---

### Asistente Virtual con IA (Chat)

*Requiere token de autenticación y variable `GEMINI_API_KEY` configurada.*

#### `POST /chat`
Envía un mensaje al modelo **Google Gemini 3.5 Flash Lite**. Si el usuario solicita una acción (transferir, recargar o cambiar dinero), el asistente responde mediante *Function Calling* estructurado proponiendo la operación para confirmación del usuario.
- **Body**:
  ```json
  {
    "message": "Quiero transferir 50 USD a andres_dev",
    "history": [
      { "role": "user", "text": "Hola" },
      { "role": "assistant", "text": "¡Hola! ¿En qué puedo ayudarte?" }
    ]
  }
  ```
- **Respuesta `200 OK` (Operación propuesta)**:
  ```json
  {
    "reply": "¿Confirmas transferir 50 USD a andres_dev?",
    "proposedAction": {
      "type": "transfer",
      "params": {
        "recipient_username": "andres_dev",
        "currency": "USD",
        "amount": 50
      }
    }
  }
  ```

#### `POST /chat/confirm`
Ejecuta la operación financiera previamente propuesta por el asistente una vez que el usuario la aprueba en la interfaz.
- **Body**:
  ```json
  {
    "type": "transfer",
    "params": {
      "recipient_username": "andres_dev",
      "currency": "USD",
      "amount": 50
    }
  }
  ```
- **Respuesta `200 OK`**:
  ```json
  {
    "reply": "Listo, lo hice. ✅",
    "transaction": { ... }
  }
  ```

---

### Administración

*Requiere token de autenticación y rol de usuario `admin` en la base de datos.*

#### `GET /admin/users`
Lista todos los usuarios registrados en la plataforma.
- **Respuesta `200 OK`**: Array de objetos de usuario con `id`, `first_name`, `last_name`, `username`, `email` y `created_at`.
- **Errores**: `401 Unauthorized` (sin token) o `403 Forbidden` (si el usuario no tiene rol admin).

#### `GET /admin/transactions`
Lista global de todas las transacciones realizadas en el sistema con los datos del usuario emisor (`username`, `email`).
- **Respuesta `200 OK`**: Array cronológico de transacciones.

---

## 🛡️ Reglas de Negocio y Seguridad

1. **Prevención de Deadlocks**: Al realizar transferencias o swaps donde intervienen múltiples registros en `balances`, el backend siempre ejecuta la consulta con `FOR UPDATE` ordenando explícitamente las claves (`ORDER BY wallet_id` o `ORDER BY currency`).
2. **Protección contra Timing Attacks**: Durante el login, si el usuario consultado no existe, se ejecuta un hash de comparación dummy para asegurar que el tiempo de respuesta sea indistinguible del caso de contraseña incorrecta.
3. **Normalización de Datos**: Correos electrónicos y nombres de usuario son procesados con `.trim().toLowerCase()` para evitar duplicados accidentales o vulnerabilidades por variaciones de mayúsculas.
4. **Resiliencia de Cotizaciones**: Si el servicio externo de tipos de cambio experimenta latencia o caída, el sistema recurre a la tabla de caché interna con TTL de 60 minutos o a las tasas de contingencia predefinidas.
5. **Políticas CORS Estrictas**: Solo los orígenes autorizados en la variable `CORS_ORIGIN` pueden interactuar con la API en navegadores.

---

## 🧪 Pruebas Automatizadas

El proyecto utiliza **Vitest** y **Supertest** para pruebas unitarias y de integración de rutas, middlewares y servicios externos simulados:

```bash
# Ejecutar todas las pruebas una sola vez
npm run test:run

# Modo interactivo (watch)
npm test
```

### Cobertura de Pruebas

- **`auth.middleware.test.ts`**: Validación de presencia, firma y expiración de tokens JWT; control de acceso basado en roles (`requireAdmin`).
- **`auth.routes.test.ts`**: Registro con validaciones de contraseña, emails inválidos, duplicados y flujo completo de login.
- **`wallet.routes.test.ts`**: Consulta de saldos, cargas con control de tope ($10.000 USD), transferencias con límite ($2.000 USD), autosuficiencia de balance, intercambios con comisión del 0.3% y mitigación de deadlocks.
- **`rates.routes.test.ts`**: Validación de parámetros ISO, rangos temporales admitidos y tratamiento de fallas del proveedor (502).
- **`exchangeRates.test.ts`**: Consulta a APIs remotas, cacheo en base de datos y tasas fallback.
- **`admin.routes.test.ts`**: Acceso denegado a usuarios regulares y consulta exitosa para administradores.
