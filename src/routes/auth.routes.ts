import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "../config/database.js";
import { sendEmail } from "../services/email.js";
import { buildPasswordResetEmail, buildWelcomeEmail } from "../services/emailTemplates.js";
import {
  loginRateLimiter,
  recordFailedLogin,
  clearLoginAttempts,
  registerRateLimiter,
  forgotPasswordRateLimiter,
} from "../middleware/rateLimiter.js";
import { validateStrongPassword } from "../utils/password.validator.js";

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

authRouter.post("/auth/register", registerRateLimiter, async (req, res) => {
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

    const passwordValidation = validateStrongPassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
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

    try {
      sendEmail({
        to: user.email,
        ...buildWelcomeEmail(user.first_name, process.env.FRONTEND_URL || "http://localhost:5173"),
      }).catch((error) => {
        console.error("Error enviando email de bienvenida:", error);
      });
    } catch (error) {
      console.error("Error construyendo email de bienvenida:", error);
    }
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
authRouter.post("/auth/login", loginRateLimiter, async (req, res) => {
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
      recordFailedLogin(req);
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    clearLoginAttempts(req);

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


/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Solicita un link para restablecer la contraseña
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Mensaje genérico (no revela si el email existe en el sistema)
 *       400:
 *         description: Falta el email
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

authRouter.post("/auth/check-email", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Falta el email" });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, first_name FROM users WHERE email = $1",
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        exists: false,
        error: "El correo electrónico no se encuentra registrado en nuestro sistema.",
      });
    }

    return res.status(200).json({
      exists: true,
      first_name: userResult.rows[0].first_name,
      message: "Correo encontrado en el sistema.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al verificar el correo electrónico" });
  }
});

authRouter.post("/auth/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Falta el email" });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, first_name FROM users WHERE email = $1",
      [email],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "El correo electrónico no se encuentra registrado en nuestro sistema.",
      });
    }

    const user = userResult.rows[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;

    sendEmail({
      to: email,
      ...buildPasswordResetEmail(user.first_name, resetLink),
    }).catch((error) => {
      console.error("Error enviando email de recuperacion:", error);
    });

    res.status(200).json({
      message: "Se ha enviado un enlace para restablecer tu contraseña a tu correo electrónico.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo procesar la solicitud" });
  }
});

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Restablece la contraseña usando el token recibido por email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Contraseña actualizada
 *       400:
 *         description: Token inválido, usado, vencido, o contraseña muy corta
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

authRouter.post("/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Faltan datos: token y newPassword son requeridos" });
  }

  const passwordValidation = validateStrongPassword(newPassword);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ error: passwordValidation.error });
  }

  const client = await pool.connect();

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const resetResult = await client.query(
      `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1`,
      [tokenHash],
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ error: "El enlace de recuperación no es válido" });
    }

    const resetRow = resetResult.rows[0];

    if (resetRow.used_at) {
      return res.status(400).json({ error: "Este enlace ya fue utilizado" });
    }

    if (new Date(resetRow.expires_at) < new Date()) {
      return res.status(400).json({ error: "El enlace de recuperación ha expirado" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      resetRow.user_id,
    ]);
    await client.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [
      resetRow.id,
    ]);
    await client.query("COMMIT");

    res.status(200).json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    res.status(500).json({ error: "No se pudo restablecer la contraseña" });
  } finally {
    client.release();
  }
});