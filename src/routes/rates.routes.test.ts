import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/exchangeRates.js", () => ({
  getExchangeRateHistory: vi.fn(),
}));

import { getExchangeRateHistory } from "../services/exchangeRates.js";
import { ratesRouter } from "./rates.routes.js";

const getExchangeRateHistoryMock = vi.mocked(getExchangeRateHistory);
const app = express();
app.use(ratesRouter);

describe("GET /rates/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns history data and normalizes currency codes", async () => {
    getExchangeRateHistoryMock.mockResolvedValue([{ date: "2026-08-01", rate: 18.4 }]);

    const response = await request(app).get("/rates/history?base=usd&quote=mxn&range=7d");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      base: "USD",
      quote: "MXN",
      range: "7d",
      source: "frankfurter.dev",
      points: [{ date: "2026-08-01", rate: 18.4 }],
    });
    expect(getExchangeRateHistoryMock).toHaveBeenCalledWith(
      "USD",
      "MXN",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("rejects invalid currency codes", async () => {
    const response = await request(app).get("/rates/history?base=US&quote=MXN&range=7d");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("base y quote deben ser códigos ISO de tres letras");
    expect(getExchangeRateHistoryMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported ranges", async () => {
    const response = await request(app).get("/rates/history?base=USD&quote=MXN&range=15d");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("range debe ser 7d, 30d o 90d");
    expect(getExchangeRateHistoryMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the external provider fails", async () => {
    getExchangeRateHistoryMock.mockRejectedValue(new Error("Provider unavailable"));

    const response = await request(app).get("/rates/history?base=USD&quote=MXN&range=30d");

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("No se pudo obtener el histórico de cotizaciones");
  });
});
