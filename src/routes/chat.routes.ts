import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { askGemini } from "../services/geminiChat.js";

export const chatRouter = Router();

const ACTION_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  propose_transfer: (a) => `transferir ${a.amount} ${a.currency} a ${a.recipient_username}`,
  propose_topup: (a) => `cargar ${a.amount} ${a.currency} a tu cuenta`,
  propose_exchange: (a) => `cambiar ${a.amount} ${a.from_currency} a ${a.to_currency}`,
};

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

  try {
    const result = await askGemini(message.trim(), Array.isArray(history) ? history : []);

    if (result.type === "function_call") {
      const actionType = result.name.replace("propose_", "");
      const describeAction = ACTION_LABELS[result.name];
      const description = describeAction ? describeAction(result.args) : "esa operación";

      return res.status(200).json({
        reply: `¿Confirmás ${description}?`,
        proposedAction: { type: actionType, params: result.args },
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
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const response = await fetch(`${baseUrl}${endpointPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.authorization ?? "",
      },
      body: JSON.stringify(params),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        reply: `No se pudo completar la operación: ${data.error ?? "error desconocido"}`,
      });
    }

    res.status(200).json({
      reply: "Listo, lo hice. ✅",
      transaction: data.transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo ejecutar la operación" });
  }
});