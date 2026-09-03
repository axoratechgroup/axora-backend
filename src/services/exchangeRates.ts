import { pool } from "../config/database.js";

const CACHE_TTL_MINUTES = 60;

/**
 * Devuelve cuántas unidades de `toCurrency` equivalen a 1 unidad de
 * `fromCurrency`. Primero busca una cotización en caché (tabla
 * exchange_rates) que no haya vencido; si no encuentra, la pide a una API
 * externa gratuita y la guarda para no golpearla en cada request.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const cached = await pool.query(
    `SELECT rate FROM exchange_rates
     WHERE from_currency = $1 AND to_currency = $2 AND expires_at > NOW()`,
    [fromCurrency, toCurrency],
  );

  if (cached.rows.length > 0) {
    return Number(cached.rows[0].rate);
  }

  const response = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`);
  if (!response.ok) {
    throw new Error("No se pudo obtener la cotización externa");
  }

  const data = (await response.json()) as {
    result: string;
    rates?: Record<string, number>;
  };

  if (data.result !== "success" || !data.rates || !data.rates[toCurrency]) {
    throw new Error(`No se encontró cotización de ${fromCurrency} a ${toCurrency}`);
  }

  const rate = data.rates[toCurrency];

  await pool.query(
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source, expires_at)
     VALUES ($1, $2, $3, 'open.er-api.com', NOW() + INTERVAL '60 minutes')
     ON CONFLICT (from_currency, to_currency)
     DO UPDATE SET rate = EXCLUDED.rate,
                   source = EXCLUDED.source,
                   fetched_at = NOW(),
                   expires_at = EXCLUDED.expires_at`,
    [fromCurrency, toCurrency, rate],
  );

  return rate;
}