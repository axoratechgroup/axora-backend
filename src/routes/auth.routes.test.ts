import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});

const mockSendEmail = vi.fn().mockResolvedValue({ id: "test-email-id" });

vi.mock("../config/database.js", () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: (...args: any[]) => mockConnect(...args),
  },
}));

vi.mock("../services/email.js", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

import { authRouter } from "./auth.routes.js";
import { resetRateLimiterForTesting } from "../middleware/rateLimiter.js";

const app = express();
app.use(express.json());
app.use(authRouter);

describe("Auth Routes", () => {
  const JWT_SECRET = "test-secret-key-123456";

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterForTesting();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe("POST /auth/register", () => {
    it("registra un usuario exitosamente y retorna 201 con token", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          // INSERT INTO users
          rows: [
            {
              id: "user-123",
              first_name: "Camila",
              last_name: "Gómez",
              username: "camilag",
              email: "camila@axora.test",
              role: "user",
              created_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          // INSERT INTO wallets
          rows: [{ id: "wallet-123" }],
        })
        .mockResolvedValueOnce({}) // INSERT INTO balances
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          last_name: "Gómez",
          username: "camilag",
          email: "Camila@Axora.Test",
          password: "Password123!",
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toMatchObject({
        id: "user-123",
        username: "camilag",
        email: "camila@axora.test",
      });
      expect(mockClientRelease).toHaveBeenCalled();
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "camila@axora.test",
          subject: "¡Bienvenido a Axora!",
        })
      );
    });

    it("retorna 400 si faltan campos requeridos", async () => {
      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          email: "camila@axora.test",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Todos los campos son obligatorios");
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it("retorna 400 si el email no tiene formato válido", async () => {
      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          last_name: "Gómez",
          username: "camilag",
          email: "correo-sin-arroba",
          password: "Password123!",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("formato válido");
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it("retorna 400 si la contraseña tiene menos de 8 caracteres", async () => {
      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          last_name: "Gómez",
          username: "camilag",
          email: "camila@axora.test",
          password: "short",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("al menos 8 caracteres");
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it("retorna 400 si la contraseña no contiene mayúsculas o caracteres especiales", async () => {
      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          last_name: "Gómez",
          username: "camilag",
          email: "camila@axora.test",
          password: "password123",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("La contraseña debe contener al menos una letra mayúscula");
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it("retorna 409 si el usuario o email ya existe (código 23505)", async () => {
      const pgError = new Error("duplicate key value violates unique constraint") as any;
      pgError.code = "23505";

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(pgError); // INSERT INTO users fails

      const response = await request(app)
        .post("/auth/register")
        .send({
          first_name: "Camila",
          last_name: "Gómez",
          username: "camilag",
          email: "camila@axora.test",
          password: "Password123!",
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("El usuario o el correo ya están en uso");
      expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  describe("POST /auth/login", () => {
    it("inicia sesión correctamente con credenciales válidas y retorna 200", async () => {
      // bcrypt hash for "password123"
      const passwordHash = "$2b$10$WdZ5P7g2Uo3F.sA8Fj151.7l1qB2gR6q4lHfZzR6x9aW0cZ2aMhQe";
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "user-123",
            first_name: "Camila",
            last_name: "Gómez",
            username: "camilag",
            email: "camila@axora.test",
            role: "user",
            password_hash: passwordHash,
          },
        ],
      });

      // Vi mock for bcrypt compare or let bcrypt compare run
      // Instead of relying on exact hash string, we can test with real bcrypt.hash
      const bcrypt = await import("bcrypt");
      const realHash = await bcrypt.hash("password123", 10);
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "user-123",
            first_name: "Camila",
            last_name: "Gómez",
            username: "camilag",
            email: "camila@axora.test",
            role: "user",
            password_hash: realHash,
          },
        ],
      });

      const response = await request(app)
        .post("/auth/login")
        .send({
          email: "Camila@Axora.Test",
          password: "password123",
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toMatchObject({
        id: "user-123",
        username: "camilag",
        email: "camila@axora.test",
      });
      expect(response.body.user).not.toHaveProperty("password_hash");
    });

    it("retorna 400 si falta el correo o la contraseña", async () => {
      const response = await request(app)
        .post("/auth/login")
        .send({ email: "camila@axora.test" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("El correo y la contraseña son obligatorios");
    });

    it("retorna 401 si el usuario no existe", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post("/auth/login")
        .send({
          email: "inexistente@axora.test",
          password: "password123",
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Credenciales inválidas");
    });

    it("retorna 401 si la contraseña es errónea", async () => {
      const bcrypt = await import("bcrypt");
      const realHash = await bcrypt.hash("password123", 10);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "user-123",
            first_name: "Camila",
            last_name: "Gómez",
            username: "camilag",
            email: "camila@axora.test",
            role: "user",
            password_hash: realHash,
          },
        ],
      });

      const response = await request(app)
        .post("/auth/login")
        .send({
          email: "camila@axora.test",
          password: "wrong-password",
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Credenciales inválidas");
    });

    it("bloquea con 429 tras 5 intentos fallidos consecutivos", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      // Realizar 5 intentos fallidos
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/auth/login")
          .send({
            email: "atacante@axora.test",
            password: "wrong",
          });
        expect(res.status).toBe(401);
      }

      // El 6to intento debe ser rechazado inmediatamente con 429
      const blockedRes = await request(app)
        .post("/auth/login")
        .send({
          email: "atacante@axora.test",
          password: "wrong",
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain("Demasiados intentos fallidos");
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("retorna 400 si falta el email", async () => {
      const response = await request(app)
        .post("/auth/forgot-password")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Falta el email");
    });

    it("retorna 404 si el usuario no existe en el sistema", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "inexistente@axora.test" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe(
        "El correo electrónico no se encuentra registrado en nuestro sistema."
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("crea token de recuperación y envía correo cuando el usuario existe", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: "user-123", first_name: "Camila" }],
        })
        .mockResolvedValueOnce({}); // INSERT INTO password_resets

      const response = await request(app)
        .post("/auth/forgot-password")
        .send({ email: "camila@axora.test" });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain(
        "Se ha enviado un enlace para restablecer tu contraseña"
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "camila@axora.test",
          subject: "Recuperar tu contraseña de Axora",
        })
      );
    });
  });

  describe("POST /auth/check-email", () => {
    it("retorna 400 si falta el email", async () => {
      const response = await request(app)
        .post("/auth/check-email")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Falta el email");
    });

    it("retorna 404 si el email no está en la base de datos", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post("/auth/check-email")
        .send({ email: "desconocido@axora.test" });

      expect(response.status).toBe(404);
      expect(response.body.exists).toBe(false);
      expect(response.body.error).toBe(
        "El correo electrónico no se encuentra registrado en nuestro sistema."
      );
    });

    it("retorna 200 si el email existe en la base de datos", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "user-456", first_name: "Ana" }],
      });

      const response = await request(app)
        .post("/auth/check-email")
        .send({ email: "ana@axora.test" });

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(true);
      expect(response.body.first_name).toBe("Ana");
      expect(response.body.message).toBe("Correo encontrado en el sistema.");
    });
  });

  describe("POST /auth/reset-password", () => {
    it("retorna 400 si falta el token o la nueva contraseña", async () => {
      const res1 = await request(app)
        .post("/auth/reset-password")
        .send({ token: "tok-123" });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain("token y newPassword son requeridos");

      const res2 = await request(app)
        .post("/auth/reset-password")
        .send({ newPassword: "password123" });
      expect(res2.status).toBe(400);
    });

    it("retorna 400 si la nueva contraseña tiene menos de 8 caracteres", async () => {
      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "tok-123", newPassword: "short" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("La contraseña debe tener al menos 8 caracteres");
    });

    it("retorna 400 si el token no existe", async () => {
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "invalid-token", newPassword: "NewSecurePassword123!" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("El enlace de recuperación no es válido");
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it("retorna 400 si el token ya fue utilizado", async () => {
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "pr-1",
            user_id: "user-123",
            expires_at: new Date(Date.now() + 60000),
            used_at: new Date(),
          },
        ],
      });

      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "used-token", newPassword: "NewSecurePassword123!" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Este enlace ya fue utilizado");
    });

    it("retorna 400 si el token ha expirado", async () => {
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "pr-1",
            user_id: "user-123",
            expires_at: new Date(Date.now() - 60000),
            used_at: null,
          },
        ],
      });

      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "expired-token", newPassword: "NewSecurePassword123!" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("El enlace de recuperación ha expirado");
    });

    it("actualiza la contraseña exitosamente con token válido", async () => {
      mockClientQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "pr-1",
              user_id: "user-123",
              expires_at: new Date(Date.now() + 60000),
              used_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // UPDATE users SET password_hash
        .mockResolvedValueOnce({}) // UPDATE password_resets SET used_at
        .mockResolvedValueOnce({}); // COMMIT

      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "valid-token", newPassword: "NewSecurePassword123!" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Contraseña actualizada correctamente");
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });
});
