import "dotenv/config";
import type { CorsOptions } from "cors";

// Orígenes configurados explícitamente en variables de entorno (separados por coma)
const configuredOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:5174,https://axora-frontend.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Patrones permitidos: cualquier localhost/127.0.0.1 con cualquier puerto, o subdominios de Vercel de AXORA
const LOCALHOST_REGEX = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/;
const VERCEL_REGEX = /^https:\/\/([a-zA-Z0-9_-]+\.)*vercel\.app$/;

export function isOriginAllowed(origin?: string): boolean {
  // Permitir solicitudes sin encabezado Origin (curl, mobile apps, scripts de servidor a servidor)
  if (!origin) return true;

  // 1. Orígenes configurados explícitamente
  if (configuredOrigins.includes(origin)) return true;

  // 2. Cualquier puerto local en desarrollo
  if (LOCALHOST_REGEX.test(origin)) return true;

  // 3. Cualquier despliegue de Vercel (producción o ramas preview)
  if (VERCEL_REGEX.test(origin)) return true;

  return false;
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  credentials: true,
  optionsSuccessStatus: 204,
};
