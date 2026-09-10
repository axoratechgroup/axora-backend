import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { authenticateToken, requireAdmin } from "./auth.js";

describe("Auth Middleware", () => {
  const JWT_SECRET = "test-secret-key-123456";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe("authenticateToken", () => {
    it("retorna 401 si no hay encabezado Authorization", () => {
      const req = { headers: {} } as unknown as Request;
      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Token de acceso no proporcionado" });
      expect(next).not.toHaveBeenCalled();
    });

    it("retorna 401 si el encabezado no inicia con 'Bearer '", () => {
      const req = { headers: { authorization: "Basic 12345" } } as unknown as Request;
      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Token de acceso no proporcionado" });
      expect(next).not.toHaveBeenCalled();
    });

    it("retorna 401 si el token es inválido o expirado", () => {
      const req = { headers: { authorization: "Bearer token-invalido" } } as unknown as Request;
      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Token inválido o expirado" });
      expect(next).not.toHaveBeenCalled();
    });

    it("asigna req.user y llama a next() si el token es válido", () => {
      const payload = { id: "user-uuid-1", email: "test@axora.com", role: "user" };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

      const req = {
        headers: { authorization: `Bearer ${token}` },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      authenticateToken(req, res, next);

      expect(req.user).toMatchObject(payload);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("requireAdmin", () => {
    it("retorna 403 si req.user no es admin", () => {
      const req = {
        user: { id: "user-uuid-2", email: "regular@axora.com", role: "user" },
      } as unknown as Request;
      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Acceso restringido a administradores" });
      expect(next).not.toHaveBeenCalled();
    });

    it("llama a next() si req.user tiene rol admin", () => {
      const req = {
        user: { id: "admin-uuid-1", email: "admin@axora.com", role: "admin" },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
