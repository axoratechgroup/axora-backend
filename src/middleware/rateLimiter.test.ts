import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  loginRateLimiter,
  recordFailedLogin,
  clearLoginAttempts,
  resetRateLimiterForTesting,
} from "./rateLimiter.js";

describe("loginRateLimiter middleware", () => {
  beforeEach(() => {
    resetRateLimiterForTesting();
  });

  const mockReq = (ip = "192.168.1.100") =>
    ({
      headers: {},
      ip,
      socket: { remoteAddress: ip },
    } as unknown as Request);

  const mockRes = () => {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    res.setHeader = vi.fn().mockReturnValue(res);
    return res as Response;
  };

  const mockNext = vi.fn() as NextFunction;

  it("permite el acceso si no hay intentos fallidos previos", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    loginRateLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("permite hasta 4 intentos fallidos previos", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    for (let i = 0; i < 4; i++) {
      recordFailedLogin(req);
    }

    loginRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("bloquea con código 429 al alcanzar el 5to intento fallido consecutivo", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    for (let i = 0; i < 5; i++) {
      recordFailedLogin(req);
    }

    loginRateLimiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("Demasiados intentos fallidos"),
      }),
    );
  });

  it("limpia el bloqueo tras un login exitoso", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    for (let i = 0; i < 5; i++) {
      recordFailedLogin(req);
    }

    clearLoginAttempts(req);

    loginRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
