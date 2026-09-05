import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();

vi.mock("../config/database.js", () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
  },
}));

import { adminRouter } from "./admin.routes.js";

const app = express();
app.use(express.json());
app.use(adminRouter);

describe("Admin Routes", () => {
  const JWT_SECRET = "test-secret-key-123456";
  const adminToken = jwt.sign(
    { id: "admin-1", email: "admin@axora.test", role: "admin" },
    JWT_SECRET,
  );
  const userToken = jwt.sign(
    { id: "user-1", email: "user@axora.test", role: "user" },
    JWT_SECRET,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe("GET /admin/users", () => {
    it("retorna 401 si no hay token", async () => {
      const response = await request(app).get("/admin/users");
      expect(response.status).toBe(401);
    });

    it("retorna 403 si el usuario no tiene rol admin", async () => {
      const response = await request(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${userToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Acceso restringido a administradores");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("retorna 200 y la lista de usuarios si es admin", async () => {
      const usersList = [
        {
          id: "u-1",
          first_name: "Juan",
          last_name: "Pérez",
          username: "juanp",
          email: "juan@axora.test",
          created_at: new Date().toISOString(),
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: usersList });

      const response = await request(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(usersList);
    });
  });

  describe("GET /admin/transactions", () => {
    it("retorna 403 si no es admin", async () => {
      const response = await request(app)
        .get("/admin/transactions")
        .set("Authorization", `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it("retorna 200 y el historial de transacciones global para admin", async () => {
      const transactions = [
        {
          id: "tx-1",
          type: "TRANSFER",
          status: "COMPLETED",
          username: "juanp",
          email: "juan@axora.test",
          from_currency: "USD",
          from_amount: "50",
          to_currency: "USD",
          to_amount: "50",
          created_at: new Date().toISOString(),
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: transactions });

      const response = await request(app)
        .get("/admin/transactions")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(transactions);
    });
  });
});
