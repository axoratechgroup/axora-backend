import { pool } from "../config/database.js";

const CACHE_TTL_MINUTES = 60;
const EXTERNAL_FETCH_TIMEOUT_MS = 5000;

export interface ExchangeRateHistoryPoint {
  date: string;
  rate: number;
}

interface FrankfurterRateRow {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

export const FALLBACK_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  ARS: 0.00075,
  COP: 0.00025,
  MXN: 0.051,
  BRL: 0.17,
};

export function getStaticFallbackRate(fromCurrency: string, toCurrency: string): number | null {
  const from = fromCurrency?.trim().toUpperCase();
  const to = toCurrency?.trim().toUpperCase();
  if (from === to) return 1;
  const fromToUsd = FALLBACK_RATES_TO_USD[from];
  const toToUsd = FALLBACK_RATES_TO_USD[to];
  if (!fromToUsd || !toToUsd) return null;
  return fromToUsd / toToUsd;
}

/**
 * Devuelve cuántas unidades de `toCurrency` equivalen a 1 unidad de
 * `fromCurrency`. Primero busca una cotización en caché (tabla
 * exchange_rates) que no haya vencido; si no encuentra, la pide a una API
 * externa gratuita y la guarda. Si la API externa no está disponible,
 * aplica una estrategia de fallback resiliente: primero la última tasa histórica
 * registrada en PostgreSQL y, como último recurso, la matriz estática de contingencia.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  // 1. Buscar en caché válida (TTL no expirado)
  const cached = await pool.query(
    `SELECT rate FROM exchange_rates
     WHERE from_currency = $1 AND to_currency = $2 AND expires_at > NOW()`,
    [fromCurrency, toCurrency],
  );

  if (cached.rows.length > 0) {
    return Number(cached.rows[0].rate);
  }

  // 2. Intentar consultar API externa
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`API externa respondió con status ${response.status}`);
    }

    const data = (await response.json()) as {
      result: string;
      rates?: Record<string, number>;
    };

    if (data.result !== "success" || !data.rates || !data.rates[toCurrency]) {
      throw new Error(`No se encontró cotización de ${fromCurrency} a ${toCurrency} en la API externa`);
    }

    const rate = data.rates[toCurrency];

    await pool.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, source, expires_at)
       VALUES ($1, $2, $3, 'open.er-api.com', NOW() + ($4 || ' minutes')::interval)
       ON CONFLICT (from_currency, to_currency)
       DO UPDATE SET rate = EXCLUDED.rate,
                     source = EXCLUDED.source,
                     fetched_at = NOW(),
                     expires_at = EXCLUDED.expires_at`,
      [fromCurrency, toCurrency, rate, CACHE_TTL_MINUTES],
    );

    return rate;
  } catch (externalError) {
    console.warn(
      `[exchangeRates] Falla al consultar API externa para ${fromCurrency}->${toCurrency}:`,
      externalError,
    );

    // 3. Fallback Nivel 1: Última tasa conocida registrada en la base de datos (incluso si expiró)
    try {
      const lastKnown = await pool.query(
        `SELECT rate FROM exchange_rates
         WHERE from_currency = $1 AND to_currency = $2
         ORDER BY fetched_at DESC LIMIT 1`,
        [fromCurrency, toCurrency],
      );

      if (lastKnown.rows.length > 0) {
        console.warn(
          `[exchangeRates] Usando última cotización histórica en BD para ${fromCurrency}->${toCurrency}: ${lastKnown.rows[0].rate}`,
        );
        return Number(lastKnown.rows[0].rate);
      }
    } catch (dbError) {
      console.error(`[exchangeRates] Error al consultar última cotización en BD:`, dbError);
    }

    // 4. Fallback Nivel 2: Tasa de contingencia calculada con matriz estática
    const staticRate = getStaticFallbackRate(fromCurrency, toCurrency);
    if (staticRate !== null && staticRate > 0) {
      console.warn(
        `[exchangeRates] Usando tasa estática de contingencia para ${fromCurrency}->${toCurrency}: ${staticRate}`,
      );
      return staticRate;
    }

    throw new Error(
      `No fue posible obtener cotización para ${fromCurrency} a ${toCurrency} ni aplicar tasa de contingencia`,
    );
  }
}

/**
 * Obtiene una serie histórica informativa para un par de monedas. A diferencia
 * de getExchangeRate, esta función no interviene en el cálculo de una operación
 * financiera: el gráfico muestra tasas de referencia por fecha.
 */
export async function getExchangeRateHistory(
  fromCurrency: string,
  toCurrency: string,
  fromDate: string,
  toDate: string,
): Promise<ExchangeRateHistoryPoint[]> {
  if (fromCurrency === toCurrency) {
    return [{ date: toDate, rate: 1 }];
  }

  const query = new URLSearchParams({
    base: fromCurrency,
    quotes: toCurrency,
    from: fromDate,
    to: toDate,
  });

  const response = await fetch(`https://api.frankfurter.dev/v2/rates?${query}`, {
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("No se pudo obtener el histórico de cotizaciones");
  }

  const data = (await response.json()) as FrankfurterRateRow[];

  return data
    .filter(
      (row) =>
        row.base === fromCurrency &&
        row.quote === toCurrency &&
        typeof row.date === "string" &&
        Number.isFinite(row.rate),
    )
    .map((row) => ({ date: row.date, rate: row.rate }))
    .sort((first, second) => first.date.localeCompare(second.date));
}
