import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../config/database.js", () => ({
  pool: { query: queryMock },
}));

import {
  getExchangeRate,
  getExchangeRateHistory,
  getStaticFallbackRate,
} from "./exchangeRates.js";

describe("getStaticFallbackRate", () => {
  it("returns 1 for identical currencies", () => {
    expect(getStaticFallbackRate("USD", "USD")).toBe(1);
    expect(getStaticFallbackRate("eur", "EUR")).toBe(1);
  });

  it("calculates cross-rates accurately from base USD rates", () => {
    // USD to EUR: 1 / 1.08
    expect(getStaticFallbackRate("USD", "EUR")).toBeCloseTo(1 / 1.08, 4);
    // EUR to USD: 1.08 / 1
    expect(getStaticFallbackRate("EUR", "USD")).toBe(1.08);
    // ARS to USD: 0.00075 / 1
    expect(getStaticFallbackRate("ARS", "USD")).toBe(0.00075);
    // USD to ARS: 1 / 0.00075
    expect(getStaticFallbackRate("USD", "ARS")).toBeCloseTo(1 / 0.00075, 2);
  });

  it("returns null for unsupported currencies", () => {
    expect(getStaticFallbackRate("XYZ", "USD")).toBeNull();
    expect(getStaticFallbackRate("USD", "ABC")).toBeNull();
  });
});

describe("getExchangeRate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 1 without DB or external API request for identical currencies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const rate = await getExchangeRate("USD", "USD");

    expect(rate).toBe(1);
    expect(queryMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns cached rate when non-expired rate exists in PostgreSQL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    queryMock.mockResolvedValueOnce({ rows: [{ rate: "0.92000000" }] });

    const rate = await getExchangeRate("USD", "EUR");

    expect(rate).toBe(0.92);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > NOW()"),
      ["USD", "EUR"],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from external API and caches when cache is empty", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no valid cache
      .mockResolvedValueOnce({ rows: [] }); // insert into exchange_rates

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: "success",
        rates: { EUR: 0.915 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const rate = await getExchangeRate("USD", "EUR");

    expect(rate).toBe(0.915);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.er-api.com/v6/latest/USD",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO exchange_rates"),
      ["USD", "EUR", 0.915, 60],
    );
  });

  it("falls back to last known rate in DB (stale cache) when external API fails", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no valid (unexpired) cache
      .mockResolvedValueOnce({ rows: [{ rate: "0.90500000" }] }); // last known rate in DB

    // external API fails (503 Service Unavailable)
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const rate = await getExchangeRate("USD", "EUR");

    expect(rate).toBe(0.905);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY fetched_at DESC LIMIT 1"),
      ["USD", "EUR"],
    );
  });

  it("falls back to static contingency matrix when external API fails and no DB cache exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no valid cache
      .mockResolvedValueOnce({ rows: [] }); // no stale cache in DB either

    // external API network timeout/failure
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network timeout"));
    vi.stubGlobal("fetch", fetchMock);

    const rate = await getExchangeRate("USD", "COP");

    // FALLBACK_RATES_TO_USD: USD=1, COP=0.00025 -> USD to COP = 1 / 0.00025 = 4000
    expect(rate).toBeCloseTo(4000, 2);
  });

  it("throws an error if external API fails, DB is empty, and currency is unsupported", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getExchangeRate("UNKNOWN", "OTHER")).rejects.toThrow(
      "No fue posible obtener cotización",
    );
  });
});

describe("getExchangeRateHistory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a fixed rate without requesting an external provider for identical currencies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const points = await getExchangeRateHistory("USD", "USD", "2026-08-01", "2026-08-31");

    expect(points).toEqual([{ date: "2026-08-31", rate: 1 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps and sorts valid provider points by date", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        { date: "2026-08-03", base: "USD", quote: "MXN", rate: 18.6 },
        { date: "2026-08-01", base: "USD", quote: "MXN", rate: 18.4 },
        { date: "2026-08-02", base: "USD", quote: "EUR", rate: 0.85 },
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const points = await getExchangeRateHistory("USD", "MXN", "2026-08-01", "2026-08-03");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v2/rates?base=USD&quotes=MXN&from=2026-08-01&to=2026-08-03",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(points).toEqual([
      { date: "2026-08-01", rate: 18.4 },
      { date: "2026-08-03", rate: 18.6 },
    ]);
  });

  it("throws when the external provider responds with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(getExchangeRateHistory("USD", "MXN", "2026-08-01", "2026-08-03")).rejects.toThrow(
      "No se pudo obtener el histórico de cotizaciones",
    );
  });
});
