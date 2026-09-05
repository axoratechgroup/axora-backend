import { Router } from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";
import type { Pool, PoolClient } from "pg";
import { getExchangeRate } from "../services/exchangeRates.js";

export const walletRouter = Router();



async function getWalletByUserId(userId: string, executor: Pool | PoolClient = pool) {
  const result = await executor.query(
    "SELECT id, created_at FROM wallets WHERE user_id = $1",
    [userId],
  );
  return result.rows[0];
}


const MAX_WALLET_TOTAL_USD = 10000;
const MAX_TRANSFER_USD = 2000;
const SWAP_FEE_PERCENTAGE = 0.003; // 0.3% de comisión en cada cambio de moneda
/**
 * Suma el valor de todos los balances de una wallet, convertidos a USD con
 * la cotización actual. Se usa para no dejar que la carga de saldo empuje
 * el total de la cuenta por encima del límite permitido.
 */
async function getWalletTotalInUsd(
  walletId: string,
  executor: Pool | PoolClient = pool,
): Promise<number> {
  const result = await executor.query(
    "SELECT currency, amount FROM balances WHERE wallet_id = $1",
    [walletId],
  );

  let totalUsd = 0;
  for (const row of result.rows) {
    const amount = Number(row.amount);
    if (amount === 0) continue;
    const rate = row.currency === "USD" ? 1 : await getExchangeRate(row.currency, "USD");
    totalUsd += amount * rate;
  }

  return totalUsd;
}


/**
 * @openapi
 * /wallet:
 *   get:
 *     summary: Devuelve la wallet y los balances del usuario autenticado
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet con sus balances por moneda
 *       401:
 *         description: Token no proporcionado, inválido o expirado
 *       404:
 *         description: El usuario no tiene wallet
 *       500:
 *         description: Error del servidor
 */
walletRouter.get("/wallet", authenticateToken, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user!.id);

    if (!wallet) {
      return res.status(404).json({ error: "El usuario no tiene wallet" });
    }

    const balancesResult = await pool.query(
      `SELECT b.currency, c.name AS currency_name, c.symbol, b.amount, b.updated_at
       FROM balances b
       JOIN currencies c ON c.code = b.currency
       WHERE b.wallet_id = $1
       ORDER BY b.currency`,
      [wallet.id],
    );

    res.json({
      wallet_id: wallet.id,
      created_at: wallet.created_at,
      balances: balancesResult.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener la wallet" });
  }
});

/**
 * @openapi
 * /wallet/transactions:
 *   get:
 *     summary: Devuelve las transacciones del usuario autenticado
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de transacciones del usuario
 *       401:
 *         description: Token de acceso no proporcionado
 *       404:
 *         description: El usuario no tiene wallet
 *       500:
 *         description: Error del servidor
 */
walletRouter.get("/wallet/transactions", authenticateToken, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user!.id);

    if (!wallet) {
      return res.status(404).json({ error: "El usuario no tiene wallet" });
    }

    const transactionsResult = await pool.query(
      `SELECT t.id, t.type, t.status, t.wallet_id, t.destination_wallet_id,
              t.from_currency, t.from_amount, t.to_currency, t.to_amount,
              t.applied_exchange_rate, t.description, t.created_at,
              sender.username AS sender_username,
              recipient.username AS recipient_username
       FROM transactions t
       LEFT JOIN wallets sender_wallet ON sender_wallet.id = t.wallet_id
       LEFT JOIN users sender ON sender.id = sender_wallet.user_id
       LEFT JOIN wallets recipient_wallet ON recipient_wallet.id = t.destination_wallet_id
       LEFT JOIN users recipient ON recipient.id = recipient_wallet.user_id
       WHERE t.wallet_id = $1 OR t.destination_wallet_id = $1
       ORDER BY t.created_at DESC`,
      [wallet.id],
    );

    const transactions = transactionsResult.rows.map((tx) => {
      const direction = tx.wallet_id === wallet.id ? "sent" : "received";
      const { sender_username, recipient_username, ...rest } = tx;

      return {
        ...rest,
        direction,
        counterparty_username:
          tx.type === "TRANSFER"
            ? direction === "sent"
              ? recipient_username
              : sender_username
            : null,
      };
    });

    res.json({ transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las transacciones" });
  }
});

/**
 * @openapi
 * /wallet/topup:
 *   post:
 *     summary: Cargar saldo a tu propia wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currency, amount]
 *             properties:
 *               currency:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Carga realizada
 *       400:
 *         description: Datos inválidos o moneda no soportada
 */
walletRouter.post("/wallet/topup", authenticateToken, async (req, res) => {
  const { currency } = req.body;
  const amount = Number(req.body.amount);

  if (!currency || !req.body.amount) {
    return res.status(400).json({ error: "Faltan datos: currency y amount son requeridos" });
  }

  if (!(amount > 0)) {
    return res.status(400).json({ error: "El monto debe ser mayor a 0" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wallet = await getWalletByUserId(req.user!.id, client);
    const walletId = wallet!.id;

    const balanceResult = await client.query(
      "SELECT amount FROM balances WHERE wallet_id = $1 AND currency = $2 FOR UPDATE",
      [walletId, currency]
    );

    if (balanceResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Moneda no soportada: ${currency}` });
    }

    const amountInUsd = currency === "USD" ? amount : amount * (await getExchangeRate(currency, "USD"));
    const currentTotalUsd = await getWalletTotalInUsd(walletId, client);

    if (currentTotalUsd + amountInUsd > MAX_WALLET_TOTAL_USD) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `No puedes cargar ese monto: superarías el límite de USD ${MAX_WALLET_TOTAL_USD} en tu cuenta (actualmente tienes el equivalente a USD ${currentTotalUsd.toFixed(2)})`,
      });
    }

    const balanceBefore = Number(balanceResult.rows[0].amount);
    const balanceAfter = balanceBefore + amount;

    await client.query(
      "UPDATE balances SET amount = $1 WHERE wallet_id = $2 AND currency = $3",
      [balanceAfter, walletId, currency]
    );

    const transactionResult = await client.query(
      `INSERT INTO transactions (
         wallet_id, type,
         to_currency, to_amount, to_balance_before, to_balance_after,
         status, description
       ) VALUES ($1, 'TOP_UP', $2, $3, $4, $5, 'COMPLETED', $6)
       RETURNING *`,
      [walletId, currency, amount, balanceBefore, balanceAfter, "Carga de saldo"]
    );

    await client.query("COMMIT");

    res.status(200).json({ transaction: transactionResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al procesar la carga" });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /wallet/transfer:
 *   post:
 *     summary: Transferir dinero a otro usuario
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipient_username, currency, amount]
 *             properties:
 *               recipient_username:
 *                 type: string
 *               currency:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transferencia realizada
 *       400:
 *         description: Datos inválidos, fondos insuficientes, o auto-transferencia
 *       404:
 *         description: Destinatario no encontrado
 */
walletRouter.post("/wallet/transfer", authenticateToken, async (req, res) => {
  const { recipient_username, currency } = req.body;
  const amount = Number(req.body.amount);

  if (!recipient_username || !currency || !req.body.amount) {
    return res.status(400).json({ error: "Faltan datos: recipient_username, currency y amount son requeridos" });
  }

  if (!(amount > 0)) {
    return res.status(400).json({ error: "El monto debe ser mayor a 0" });
  }

  const amountInUsd = currency === "USD" ? amount : amount * (await getExchangeRate(currency, "USD"));
  if (amountInUsd > MAX_TRANSFER_USD) {
    return res.status(400).json({
      error: `No puedes transferir más de USD ${MAX_TRANSFER_USD} por operación (esto equivale a USD ${amountInUsd.toFixed(2)})`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const senderWallet = await getWalletByUserId(req.user!.id, client);
    const senderWalletId = senderWallet!.id;

    const recipientResult = await client.query(
      `SELECT u.id AS user_id, w.id AS wallet_id
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.username = $1`,
      [recipient_username]
    );

    if (recipientResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No existe un usuario con ese nombre de usuario" });
    }

    const recipientWalletId = recipientResult.rows[0].wallet_id;

    if (recipientWalletId === senderWalletId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No puedes transferirte dinero a ti mismo" });
    }

    // Bloqueamos las dos filas de balance EN UNA SOLA CONSULTA, ordenadas por
    // wallet_id (no por quién envía o recibe). Esto evita un deadlock: si dos
    // transferencias en direcciones opuestas (A→B y B→A) llegan al mismo tiempo,
    // ambas piden los bloqueos en el mismo orden, así que una simplemente espera
    // a la otra en vez de bloquearse mutuamente en un círculo.
    const balancesResult = await client.query(
      `SELECT wallet_id, amount FROM balances
       WHERE wallet_id IN ($1, $2) AND currency = $3
       ORDER BY wallet_id
       FOR UPDATE`,
      [senderWalletId, recipientWalletId, currency]
    );

    const senderBalanceRow = balancesResult.rows.find((r) => r.wallet_id === senderWalletId);
    const recipientBalanceRow = balancesResult.rows.find((r) => r.wallet_id === recipientWalletId);

    if (!senderBalanceRow) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `No tienes balance en ${currency}` });
    }

    if (!recipientBalanceRow) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `El destinatario no tiene balance en ${currency}` });
    }

    const senderBalanceBefore = Number(senderBalanceRow.amount);

    if (senderBalanceBefore < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const senderBalanceAfter = senderBalanceBefore - amount;

    const recipientBalanceBefore = Number(recipientBalanceRow.amount);
    const recipientBalanceAfter = recipientBalanceBefore + amount;

    await client.query(
      "UPDATE balances SET amount = $1 WHERE wallet_id = $2 AND currency = $3",
      [senderBalanceAfter, senderWalletId, currency]
    );

    await client.query(
      "UPDATE balances SET amount = $1 WHERE wallet_id = $2 AND currency = $3",
      [recipientBalanceAfter, recipientWalletId, currency]
    );

    const transactionResult = await client.query(
      `INSERT INTO transactions (
         wallet_id, type,
         from_currency, from_amount, from_balance_before, from_balance_after,
         to_currency, to_amount, to_balance_before, to_balance_after,
         destination_wallet_id, status, description
       ) VALUES ($1, 'TRANSFER', $2, $3, $4, $5, $2, $3, $6, $7, $8, 'COMPLETED', $9)
       RETURNING *`,
      [
        senderWalletId,
        currency,
        amount,
        senderBalanceBefore,
        senderBalanceAfter,
        recipientBalanceBefore,
        recipientBalanceAfter,
        recipientWalletId,
        `Transferencia a ${recipient_username}`,
      ]
    );

    await client.query("COMMIT");

    res.status(200).json({ transaction: transactionResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al procesar la transferencia" });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /wallet/exchange:
 *   post:
 *     summary: Compra/vende (cambia) saldo entre dos monedas de tu propia wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from_currency, to_currency, amount]
 *             properties:
 *               from_currency:
 *                 type: string
 *               to_currency:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Cambio realizado
 *       400:
 *         description: Datos inválidos, monedas iguales, o fondos insuficientes
 *       401:
 *         description: Token no proporcionado, inválido o expirado
 *       500:
 *         description: Error del servidor
 */
walletRouter.post("/wallet/exchange", authenticateToken, async (req, res) => {
  const { from_currency, to_currency } = req.body;
  const amount = Number(req.body.amount);

  if (!from_currency || !to_currency || !req.body.amount) {
    return res.status(400).json({ error: "Faltan datos: from_currency, to_currency y amount son requeridos" });
  }

  if (from_currency === to_currency) {
    return res.status(400).json({ error: "Elige dos monedas distintas para cambiar" });
  }

  if (!(amount > 0)) {
    return res.status(400).json({ error: "El monto debe ser mayor a 0" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wallet = await getWalletByUserId(req.user!.id, client);
    const walletId = wallet!.id;

    // Bloqueamos las dos filas de balance (origen y destino) en una sola
    // consulta, ordenadas por moneda, para evitar problemas si el mismo
    // usuario dispara dos cambios al mismo tiempo.
    const balancesResult = await client.query(
      `SELECT currency, amount FROM balances
       WHERE wallet_id = $1 AND currency IN ($2, $3)
       ORDER BY currency
       FOR UPDATE`,
      [walletId, from_currency, to_currency]
    );

    const fromBalanceRow = balancesResult.rows.find((r) => r.currency === from_currency);
    const toBalanceRow = balancesResult.rows.find((r) => r.currency === to_currency);

    if (!fromBalanceRow || !toBalanceRow) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Moneda no soportada" });
    }

    const fromBalanceBefore = Number(fromBalanceRow.amount);

    if (fromBalanceBefore < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const rate = await getExchangeRate(from_currency, to_currency);
    const grossToAmount = amount * rate;
    const feeAmount = grossToAmount * SWAP_FEE_PERCENTAGE;
    const toAmount = grossToAmount - feeAmount;

    const fromBalanceAfter = fromBalanceBefore - amount;
    const toBalanceBefore = Number(toBalanceRow.amount);
    const toBalanceAfter = toBalanceBefore + toAmount;

    await client.query(
      "UPDATE balances SET amount = $1 WHERE wallet_id = $2 AND currency = $3",
      [fromBalanceAfter, walletId, from_currency]
    );
    await client.query(
      "UPDATE balances SET amount = $1 WHERE wallet_id = $2 AND currency = $3",
      [toBalanceAfter, walletId, to_currency]
    );

    const transactionResult = await client.query(
      `INSERT INTO transactions (
         wallet_id, type,
         from_currency, from_amount, from_balance_before, from_balance_after,
         to_currency, to_amount, to_balance_before, to_balance_after,
         applied_exchange_rate, status, description, metadata
       ) VALUES ($1, 'SWAP', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'COMPLETED', $11, $12)
       RETURNING *`,
      [
        walletId,
        from_currency,
        amount,
        fromBalanceBefore,
        fromBalanceAfter,
        to_currency,
        toAmount,
        toBalanceBefore,
        toBalanceAfter,
        rate,
        `Cambio de ${from_currency} a ${to_currency} (incluye comisión del ${(SWAP_FEE_PERCENTAGE * 100).toFixed(1)}%)`,
        JSON.stringify({
          fee_percentage: SWAP_FEE_PERCENTAGE,
          fee_amount: feeAmount,
          fee_currency: to_currency,
          gross_to_amount: grossToAmount,
        }),
      ]
    );

    await client.query("COMMIT");

    res.status(200).json({ transaction: transactionResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Error al procesar el cambio de moneda" });
  } finally {
    client.release();
  }
});