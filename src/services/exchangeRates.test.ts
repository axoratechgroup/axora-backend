import { afterEach, describe, expect, it, vi } from "vitest";
import { getExchangeRateHistory } from "./exchangeRates.js";

describe("getExchangeRateHistory", () => {
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
