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

vi.mock("../config/database.js", () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: (...args: any[]) => mockConnect(...args),
  },
}));

import { authRouter } from "./auth.routes.js";

const app = express();
app.use(express.json());
app.use(authRouter);

describe("Auth Routes", () => {
  const JWT_SECRET = "test-secret-key-123456";

  beforeEach(() => {
    vi.clearAllMocks();
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
          password: "password123",
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toMatchObject({
        id: "user-123",
        username: "camilag",
        email: "camila@axora.test",
      });
      expect(mockClientRelease).toHaveBeenCalled();
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
          password: "password123",
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
  });
});
