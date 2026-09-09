import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { sendEmail } from "./email.js";
import { buildTransactionEmail, type RecipientRole, type TransactionEmailData } from "./transactionEmail.js";

// Se ejecuta con el MISMO cliente y antes del COMMIT del movimiento.
export async function enqueueTransactionNotifications(client: PoolClient, transactionId: string): Promise<void> {
  await client.query(
    `INSERT INTO notification_outbox (transaction_id, recipient_email, recipient_role)
     SELECT t.id, u.email, CASE WHEN t.type = 'TRANSFER' THEN 'sender' ELSE 'owner' END
     FROM transactions t JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id
     WHERE t.id = $1 AND t.status = 'COMPLETED'
     UNION ALL
     SELECT t.id, u.email, 'recipient'
     FROM transactions t JOIN wallets w ON w.id = t.destination_wallet_id JOIN users u ON u.id = w.user_id
     WHERE t.id = $1 AND t.type = 'TRANSFER' AND t.status = 'COMPLETED'
     ON CONFLICT (transaction_id, type, recipient_role) DO NOTHING`,
    [transactionId],
  );
}

// Llamar solo después de COMMIT. También permite reintentar FAILED explícitamente.
// No propaga errores al endpoint de movimiento: un fallo de correo no invalida el saldo.
export async function dispatchTransactionNotifications(transactionId: string): Promise<void> {
  try {
    const candidates = await pool.query<{ id: string }>(
      `SELECT id FROM notification_outbox WHERE transaction_id = $1
       AND status IN ('PENDING', 'FAILED') AND attempts < 3 ORDER BY created_at, id`, [transactionId],
    );
    for (const candidate of candidates.rows) {
      // UPDATE condicional: dos invocaciones simultáneas no pueden enviar la misma fila.
      const claim = await pool.query<{ recipient_email: string; recipient_role: RecipientRole }>(
        `UPDATE notification_outbox SET status = 'PROCESSING', attempts = attempts + 1, last_error = NULL
         WHERE id = $1 AND status IN ('PENDING', 'FAILED') AND attempts < 3
         RETURNING recipient_email, recipient_role`, [candidate.id],
      );
      const notification = claim.rows[0];
      if (!notification) continue;
      try {
        const result = await pool.query<TransactionEmailData>(
          `SELECT t.*, sender.username AS sender_username, recipient.username AS recipient_username
           FROM transactions t JOIN wallets sw ON sw.id = t.wallet_id JOIN users sender ON sender.id = sw.user_id
           LEFT JOIN wallets rw ON rw.id = t.destination_wallet_id
           LEFT JOIN users recipient ON recipient.id = rw.user_id WHERE t.id = $1`, [transactionId],
        );
        if (!result.rows[0]) throw new Error("Transacción no encontrada");
        const content = buildTransactionEmail(result.rows[0], notification.recipient_role, process.env.FRONTEND_URL || "http://localhost:5173");
        await sendEmail({ to: notification.recipient_email, ...content });
      } catch {
        await pool.query(
          `UPDATE notification_outbox SET status = 'FAILED', last_error = $2 WHERE id = $1`,
          [candidate.id, "No se pudo preparar o enviar el correo. Revisar configuración y proveedor antes de reintentar."],
        );
        continue;
      }
      // Fuera del catch de envío: si falla esta escritura tras aceptar SES el email,
      // se conserva PROCESSING para no provocar un reenvío automático duplicado.
      await pool.query(
        `UPDATE notification_outbox SET status = 'SENT', sent_at = NOW(), last_error = NULL WHERE id = $1`,
        [candidate.id],
      );
    }
  } catch {
    console.error("No se pudo procesar el outbox de la transacción", transactionId);
  }
}
