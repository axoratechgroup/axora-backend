import { Router } from "express";
import { pool } from "../config/database.js";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";

export const adminRouter = Router();

/**
 * @openapi
 * /admin/users:
 *   get:
 *     summary: Lista todos los usuarios (panel de admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios
 *       401:
 *         description: Token de acceso no proporcionado
 *       403:
 *         description: Token inválido o expirado
 *       500:
 *         description: Error del servidor
 */
adminRouter.get("/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, created_at
       FROM users
       ORDER BY created_at DESC`,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener los usuarios" });
  }
});

/**
 * @openapi
 * /admin/transactions:
 *   get:
 *     summary: Lista todas las transacciones con su usuario dueño (panel de admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de transacciones
 *       401:
 *         description: Token de acceso no proporcionado
 *       403:
 *         description: Token inválido o expirado
 *       500:
 *         description: Error del servidor
 */
adminRouter.get(
  "/admin/transactions",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
         t.id,
         t.type,
         t.status,
         u.username,
         u.email,
         t.from_currency,
         t.from_amount,
         t.to_currency,
         t.to_amount,
         t.applied_exchange_rate,
         t.description,
         t.created_at
       FROM transactions t
       JOIN wallets w ON w.id = t.wallet_id
       JOIN users u ON u.id = w.user_id
       ORDER BY t.created_at DESC`,
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Error al obtener las transacciones" });
    }
  },
);