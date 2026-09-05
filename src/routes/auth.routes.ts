import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";

export const authRouter = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Crea un usuario y su wallet en la misma transacción
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterInput'
 *     responses:
 *       201:
 *         description: Usuario creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Campos faltantes o contraseña con menos de 8 caracteres
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: El usuario o el correo ya están en uso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post("/auth/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const first_name = req.body.first_name?.trim();
    const last_name = req.body.last_name?.trim();
    const username = req.body.username?.trim().toLowerCase();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!first_name || !last_name || !username || !email || !password) {
      return res.status(400).json({
        error:
          "Todos los campos son obligatorios: nombre, apellido, usuario, correo y contraseña",
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "El correo electrónico no tiene un formato válido",
      });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    await client.query("BEGIN");

    const userResult = await client.query(
      `INSERT INTO users (first_name, last_name, username, email, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, username, email, role, created_at`,
      [first_name, last_name, username, email, password_hash],
    );

    const user = userResult.rows[0];

    const walletResult = await client.query(
      `INSERT INTO wallets (user_id)
   VALUES ($1)
   RETURNING id`,
      [user.id],
    );

    await client.query(
      `INSERT INTO balances (wallet_id, currency, amount)
   SELECT $1, code, 0
   FROM currencies`,
      [walletResult.rows[0].id],
    );

    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      {
        expiresIn: "2h",
      },
    );

    res.status(201).json({ user, token });
  } catch (error: any) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "El usuario o el correo ya están en uso" });
    }
    console.error(error);
    res.status(500).json({ error: "Error al registrar el usuario" });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Inicia sesión y devuelve un JWT
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Correo o contraseña faltantes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Credenciales inválidas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
authRouter.post("/auth/login", async (req, res) => {
  try {
    const { password } = req.body;
    const email = req.body.email?.trim().toLowerCase();

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "El correo y la contraseña son obligatorios" });
    }

    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, role, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];

    // Dummy hash constante para evitar ataques de temporización si el correo no existe
    const DUMMY_HASH = "$2b$10$7EqJtq98hPqEX7fNZaFWoOijR679q0oPzO24b0f3vR3s1PzV6oX9a";
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      {
        expiresIn: "2h",
      },
    );

    const { password_hash, ...userWithoutPassword } = user;

    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});