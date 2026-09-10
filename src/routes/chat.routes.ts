import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { askGemini } from "../services/geminiChat.js";

export const chatRouter = Router();

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "ARS", "COP", "MXN", "BRL"]);

const CURRENCY_SYNONYMS: Record<string, string> = {
  dolar: "USD",
  dolares: "USD",
  dollar: "USD",
  dollars: "USD",
  usd: "USD",
  euro: "EUR",
  euros: "EUR",
  eur: "EUR",
  cop: "COP",
  peso_colombiano: "COP",
  pesos_colombianos: "COP",
  ars: "ARS",
  peso_argentino: "ARS",
  pesos_argentinos: "ARS",
  mxn: "MXN",
  peso_mexicano: "MXN",
  pesos_mexicanos: "MXN",
  brl: "BRL",
  real: "BRL",
  reales: "BRL",
  real_brasileno: "BRL",
};

export function normalizeCurrency(raw?: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z_]/g, "");
  if (CURRENCY_SYNONYMS[cleaned]) return CURRENCY_SYNONYMS[cleaned];
  const upper = raw.trim().toUpperCase();
  if (SUPPORTED_CURRENCIES.has(upper)) return upper;
  return null;
}

export function normalizeAmount(raw?: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

export function validateAndNormalizeProposedAction(
  name: string,
  rawArgs: Record<string, unknown> = {}
): {
  isValid: boolean;
  actionType?: "transfer" | "topup" | "exchange";
  params?: Record<string, unknown>;
  reply: string;
} {
  const actionType = name.replace("propose_", "");

  if (actionType === "topup") {
    const amount = normalizeAmount(rawArgs.amount);
    const currency = normalizeCurrency(rawArgs.currency);

    if (!amount || !currency) {
      return {
        isValid: false,
        reply: "Para realizar una carga de saldo, por favor indícame un monto numérico mayor a 0 y una moneda válida (USD, EUR, COP, ARS, MXN o BRL).",
      };
    }

    return {
      isValid: true,
      actionType: "topup",
      params: { amount, currency },
      reply: `¿Confirmas que deseas cargar ${amount} ${currency} a tu cuenta de AXORA?`,
    };
  }

  if (actionType === "transfer") {
    const recipient = typeof rawArgs.recipient_username === "string"
      ? rawArgs.recipient_username.trim().replace(/^@/, "")
      : "";
    const amount = normalizeAmount(rawArgs.amount);
    const currency = normalizeCurrency(rawArgs.currency);

    if (!recipient) {
      return {
        isValid: false,
        reply: "Para realizar una transferencia, por favor indícame el nombre de usuario del destinatario, además del monto y la moneda.",
      };
    }

    if (!amount || !currency) {
      return {
        isValid: false,
        reply: `Para transferir a ${recipient}, por favor especifica un monto mayor a 0 y una moneda válida (USD, EUR, COP, ARS, MXN o BRL).`,
      };
    }

    return {
      isValid: true,
      actionType: "transfer",
      params: { recipient_username: recipient, amount, currency },
      reply: `¿Confirmas que deseas transferir ${amount} ${currency} al usuario ${recipient}?`,
    };
  }

  if (actionType === "exchange") {
    const amount = normalizeAmount(rawArgs.amount);
    const fromCurrency = normalizeCurrency(rawArgs.from_currency);
    const toCurrency = normalizeCurrency(rawArgs.to_currency);

    if (!amount || !fromCurrency || !toCurrency) {
      return {
        isValid: false,
        reply: "Para realizar un cambio de divisas, por favor especifica el monto a convertir, la moneda de origen y la moneda de destino (USD, EUR, COP, ARS, MXN, BRL).",
      };
    }

    if (fromCurrency === toCurrency) {
      return {
        isValid: false,
        reply: "La moneda de origen y la de destino deben ser distintas para realizar una conversión de divisas.",
      };
    }

    return {
      isValid: true,
      actionType: "exchange",
      params: { from_currency: fromCurrency, to_currency: toCurrency, amount },
      reply: `¿Confirmas que deseas convertir ${amount} ${fromCurrency} a ${toCurrency}?`,
    };
  }

  return {
    isValid: false,
    reply: "No comprendí la operación solicitada. Por favor indícame si deseas realizar una carga de saldo, una transferencia o un cambio de divisas.",
  };
}

/**
 * @openapi
 * /chat:
 *   post:
 *     summary: Enviar un mensaje al asistente virtual de Axora (Gemini)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *               history:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant]
 *                     text:
 *                       type: string
 *     responses:
 *       200:
 *         description: Respuesta del asistente, o una acción propuesta pendiente de confirmación
 *       400:
 *         description: Falta el mensaje
 *       401:
 *         description: Token no proporcionado, inválido o expirado
 *       500:
 *         description: Error al contactar al asistente
 */
chatRouter.post("/chat", authenticateToken, async (req, res) => {
  const { message, history } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Falta el mensaje" });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: "El mensaje es demasiado largo (máximo 2000 caracteres)" });
  }

  const safeHistory = Array.isArray(history) ? history.slice(-20) : [];

  try {
    const result = await askGemini(message.trim(), safeHistory);

    if (result.type === "function_call") {
      const validated = validateAndNormalizeProposedAction(result.name, result.args);

      if (validated.isValid && validated.actionType && validated.params) {
        return res.status(200).json({
          reply: validated.reply,
          proposedAction: { type: validated.actionType, params: validated.params },
        });
      }

      return res.status(200).json({
        reply: validated.reply,
      });
    }

    res.status(200).json({ reply: result.reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo obtener respuesta del asistente" });
  }
});

const ACTION_TO_ENDPOINT: Record<string, string> = {
  transfer: "/wallet/transfer",
  topup: "/wallet/topup",
  exchange: "/wallet/exchange",
};

/**
 * @openapi
 * /chat/confirm:
 *   post:
 *     summary: Confirmar y ejecutar una acción propuesta por el asistente
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, params]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [transfer, topup, exchange]
 *               params:
 *                 type: object
 *     responses:
 *       200:
 *         description: Acción ejecutada
 *       400:
 *         description: Acción inválida
 *       401:
 *         description: Token no proporcionado, inválido o expirado
 */
chatRouter.post("/chat/confirm", authenticateToken, async (req, res) => {
  const { type, params } = req.body;

  const endpointPath = ACTION_TO_ENDPOINT[type];
  if (!endpointPath || !params) {
    return res.status(400).json({ error: "Acción inválida" });
  }

  try {
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    const response = await fetch(`${baseUrl}${endpointPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.authorization ?? "",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        reply: `No se pudo completar la operación: ${data.error ?? "error desconocido"}`,
      });
    }

    res.status(200).json({
      reply: "Operación realizada con éxito. La transacción ha sido procesada correctamente.",
      transaction: data.transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo ejecutar la operación" });
  }
});