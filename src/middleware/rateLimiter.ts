import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ATTEMPTS = 5; // Máximo 5 intentos fallidos consecutivos

const loginAttempts = new Map<string, RateLimitRecord>();

function getClientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown-ip";
}

/**
 * Middleware para limitar intentos fallidos de inicio de sesión.
 * Si la IP supera MAX_ATTEMPTS en WINDOW_MS, se bloquea por el tiempo restante.
 */
export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = getClientKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    // Si ya expiró la ventana, resetear
    if (now - record.firstAttemptAt > WINDOW_MS) {
      loginAttempts.delete(key);
    } else if (record.attempts >= MAX_ATTEMPTS) {
      const remainingMs = record.firstAttemptAt + WINDOW_MS - now;
      const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
      res.setHeader("Retry-After", Math.ceil(remainingMs / 1000));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Por favor, intente nuevamente en ${remainingMinutes} minuto(s).`,
      });
    }
  }

  next();
}

/**
 * Registra un intento fallido de login.
 */
export function recordFailedLogin(req: Request): void {
  const key = getClientKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    loginAttempts.set(key, { attempts: 1, firstAttemptAt: now });
  } else {
    record.attempts += 1;
  }
}

/**
 * Limpia los intentos registrados para la IP tras un login exitoso.
 */
export function clearLoginAttempts(req: Request): void {
  const key = getClientKey(req);
  loginAttempts.delete(key);
}

/**
 * Utilidad exclusiva para tests: reiniciar estado del rate limiter.
 */
export function resetRateLimiterForTesting(): void {
  loginAttempts.clear();
}
