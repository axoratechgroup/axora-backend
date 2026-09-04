import { Router } from "express";
import { getExchangeRateHistory } from "../services/exchangeRates.js";

export const ratesRouter = Router();

const RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

type HistoryRange = keyof typeof RANGE_DAYS;

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * @openapi
 * /rates/history:
 *   get:
 *     summary: Devuelve el histórico informativo de una tasa de cambio
 *     tags: [Rates]
 *     parameters:
 *       - in: query
 *         name: base
 *         required: true
 *         schema:
 *           type: string
 *           example: USD
 *       - in: query
 *         name: quote
 *         required: true
 *         schema:
 *           type: string
 *           example: MXN
 *       - in: query
 *         name: range
 *         required: true
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d]
 *     responses:
 *       200:
 *         description: Serie de tasas por fecha
 *       400:
 *         description: Parámetros inválidos
 *       502:
 *         description: No fue posible consultar el proveedor externo
 */
ratesRouter.get("/rates/history", async (req, res) => {
  const base = typeof req.query.base === "string" ? req.query.base.toUpperCase() : "";
  const quote = typeof req.query.quote === "string" ? req.query.quote.toUpperCase() : "";
  const range = typeof req.query.range === "string" ? req.query.range : "";

  if (!isCurrencyCode(base) || !isCurrencyCode(quote)) {
    return res.status(400).json({ error: "base y quote deben ser códigos ISO de tres letras" });
  }

  if (!(range in RANGE_DAYS)) {
    return res.status(400).json({ error: "range debe ser 7d, 30d o 90d" });
  }

  const typedRange = range as HistoryRange;
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - RANGE_DAYS[typedRange]);

  try {
    const points = await getExchangeRateHistory(base, quote, toIsoDate(from), toIsoDate(to));

    res.json({
      base,
      quote,
      range: typedRange,
      points,
      source: "frankfurter.dev",
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "No se pudo obtener el histórico de cotizaciones" });
  }
});
