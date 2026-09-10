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
 *         description: Token no proporcionado, inválido o expirado
 *       403:
 *         description: Acceso restringido a administradores
 *       500:
 *         description: Error del servidor
 */
adminRouter.get("/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, role, created_at
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
 * /admin/users/{id}/role:
 *   patch:
 *     summary: Cambia el rol de un usuario (panel de admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario a modificar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       400:
 *         description: Rol inválido, o la operación dejaría al sistema sin administradores
 *       401:
 *         description: Token no proporcionado, inválido o expirado
 *       403:
 *         description: Acceso restringido a administradores
 *       404:
 *         description: Usuario no encontrado
 *       500:
 *         description: Error del servidor
 */
adminRouter.patch(
  "/admin/users/:id/role",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { role } = req.body ?? {};

    if (role !== "user" && role !== "admin") {
      return res
        .status(400)
        .json({ error: "Rol inválido. Debe ser 'user' o 'admin'." });
    }

    if (id === req.user?.id && role !== "admin") {
      return res
        .status(400)
        .json({ error: "No puedes quitarte tu propio rol de administrador." });
    }

    try {
      if (role === "user") {
        const adminCount = await pool.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND id != $1`,
          [id],
        );
        if (adminCount.rows[0].count === 0) {
          return res.status(400).json({
            error: "Debe existir al menos un administrador en el sistema.",
          });
        }
      }

      const result = await pool.query(
        `UPDATE users
         SET role = $1
         WHERE id = $2
         RETURNING id, first_name, last_name, username, email, role`,
        [role, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al actualizar el rol del usuario" });
    }
  },
);

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
 *         description: Token no proporcionado, inválido o expirado
 *       403:
 *         description: Acceso restringido a administradores
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
         recipient.username AS recipient_username,
         t.created_at
       FROM transactions t
       JOIN wallets w ON w.id = t.wallet_id
       JOIN users u ON u.id = w.user_id
       LEFT JOIN wallets recipient_wallet ON recipient_wallet.id = t.destination_wallet_id
       LEFT JOIN users recipient ON recipient.id = recipient_wallet.user_id
       ORDER BY t.created_at DESC`,
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener las transacciones" });
    }
  },
);
