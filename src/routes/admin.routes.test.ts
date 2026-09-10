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

    it("retorna 200 y la lista de usuarios (con rol) si es admin", async () => {
      const usersList = [
        {
          id: "u-1",
          first_name: "Juan",
          last_name: "Pérez",
          username: "juanp",
          email: "juan@axora.test",
          role: "user",
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

  describe("PATCH /admin/users/:id/role", () => {
    it("retorna 401 si no hay token", async () => {
      const response = await request(app)
        .patch("/admin/users/u-1/role")
        .send({ role: "admin" });

      expect(response.status).toBe(401);
    });

    it("retorna 403 si el usuario no tiene rol admin", async () => {
      const response = await request(app)
        .patch("/admin/users/u-1/role")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ role: "admin" });

      expect(response.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("retorna 400 si el rol no es 'user' ni 'admin'", async () => {
      const response = await request(app)
        .patch("/admin/users/u-1/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "superadmin" });

      expect(response.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("retorna 400 si el admin intenta quitarse su propio rol", async () => {
      const response = await request(app)
        .patch("/admin/users/admin-1/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "user" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "No puedes quitarte tu propio rol de administrador.",
      );
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("retorna 400 si degradar a este usuario dejaría el sistema sin administradores", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const response = await request(app)
        .patch("/admin/users/u-2/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "user" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Debe existir al menos un administrador en el sistema.",
      );
    });

    it("retorna 404 si el usuario no existe", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch("/admin/users/no-existe/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "user" });

      expect(response.status).toBe(404);
    });

    it("retorna 200 y el usuario actualizado al promover a admin", async () => {
      const updatedUser = {
        id: "u-1",
        first_name: "Juan",
        last_name: "Pérez",
        username: "juanp",
        email: "juan@axora.test",
        role: "admin",
      };
      mockQuery.mockResolvedValueOnce({ rows: [updatedUser] });

      const response = await request(app)
        .patch("/admin/users/u-1/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "admin" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedUser);
      // Promover a admin no requiere el chequeo de "último admin"
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("retorna 200 y degrada a un usuario cuando hay otros admins", async () => {
      const updatedUser = {
        id: "u-2",
        first_name: "Ana",
        last_name: "Gómez",
        username: "anag",
        email: "ana@axora.test",
        role: "user",
      };
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [updatedUser] });

      const response = await request(app)
        .patch("/admin/users/u-2/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: "user" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedUser);
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
          recipient_username: "camilop",
          description: "Cena del viaje",
          created_at: new Date().toISOString(),
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: transactions });

      const response = await request(app)
        .get("/admin/transactions")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(transactions);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("recipient.username AS recipient_username"),
      );
    });
  });
});
