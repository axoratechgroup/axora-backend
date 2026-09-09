import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
}

function getClientKey(req: Request): string {
  // Usamos req.ip (no el header crudo) porque Express, con "trust proxy"
  // configurado, ya valida cuántos saltos de proxy confiar. Leer
  // x-forwarded-for directamente permite que cualquier cliente lo
  // falsifique y reciba un balde de intentos nuevo en cada request,
  // anulando el rate limit.
  return req.ip || req.socket.remoteAddress || "unknown-ip";
}

interface RateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  message: (remainingMinutes: number) => string;
}

interface RateLimiterInstance {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  recordFailure: (req: Request) => void;
  clear: (req: Request) => void;
  resetForTesting: () => void;
}

/**
 * Crea un limitador de intentos independiente (con su propio almacenamiento
 * en memoria). Cada instancia lleva su propio conteo por IP, así un intento
 * fallido de login no consume el cupo de, por ejemplo, forgot-password.
 *
 * Nota: el almacenamiento es un Map en memoria del proceso. Si el backend
 * llega a correr en más de una instancia (cluster/horizontal scaling), cada
 * proceso tendría su propio conteo y el límite efectivo se multiplicaría.
 * Para ese escenario conviene migrar a un store compartido (Redis).
 */
function createRateLimiter({ windowMs, maxAttempts, message }: RateLimiterOptions): RateLimiterInstance {
  const attempts = new Map<string, RateLimitRecord>();

  function middleware(req: Request, res: Response, next: NextFunction) {
    const key = getClientKey(req);
    const now = Date.now();
    const record = attempts.get(key);

    if (record) {
      if (now - record.firstAttemptAt > windowMs) {
        attempts.delete(key);
      } else if (record.attempts >= maxAttempts) {
        const remainingMs = record.firstAttemptAt + windowMs - now;
        const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
        res.setHeader("Retry-After", Math.ceil(remainingMs / 1000));
        return res.status(429).json({ error: message(remainingMinutes) });
      }
    }

    next();
  }

  function recordFailure(req: Request): void {
    const key = getClientKey(req);
    const now = Date.now();
    const record = attempts.get(key);

    if (!record || now - record.firstAttemptAt > windowMs) {
      attempts.set(key, { attempts: 1, firstAttemptAt: now });
    } else {
      record.attempts += 1;
    }
  }

  function clear(req: Request): void {
    attempts.delete(getClientKey(req));
  }

  function resetForTesting(): void {
    attempts.clear();
  }

  return { middleware, recordFailure, clear, resetForTesting };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  maxAttempts: 5,
  message: (min) => `Demasiados intentos fallidos. Por favor, intente nuevamente en ${min} minuto(s).`,
});

/**
 * Middleware para limitar intentos fallidos de inicio de sesión.
 * Si la IP supera 5 intentos en 15 minutos, se bloquea por el tiempo restante.
 */
export const loginRateLimiter = loginLimiter.middleware;

/** Registra un intento fallido de login. */
export const recordFailedLogin = loginLimiter.recordFailure;

/** Limpia los intentos registrados para la IP tras un login exitoso. */
export const clearLoginAttempts = loginLimiter.clear;

/** Utilidad exclusiva para tests: reiniciar estado del rate limiter de login. */
export const resetRateLimiterForTesting = loginLimiter.resetForTesting;

// Registro de cuentas: más laxo que login (no son "intentos fallidos" sino
// intentos de registro), pero limita creación masiva de cuentas desde una
// misma IP.
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hora
  maxAttempts: 10,
  message: (min) => `Demasiadas cuentas creadas desde esta conexión. Intente nuevamente en ${min} minuto(s).`,
});
export const registerRateLimiter = registerLimiter.middleware;

// Recuperación de contraseña: evita que se pueda bombardear el correo de
// cualquier usuario pidiendo links de reseteo sin límite.
const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  maxAttempts: 5,
  message: (min) => `Demasiadas solicitudes de recuperación. Intente nuevamente en ${min} minuto(s).`,
});
export const forgotPasswordRateLimiter = forgotPasswordLimiter.middleware;
