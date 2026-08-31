import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { pool } from "./config/database.js";
import { authenticateToken } from "./middleware/auth.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { corsOptions } from "./config/cors.js";
import { swaggerSpec } from "./config/swagger.js";

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (req, res) => {
  res.json(swaggerSpec);
});

/**
 * @openapi
 * /users:
 *   get:
 *     summary: Lista los usuarios registrados
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401:
 *         description: Token de acceso no proporcionado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Token inválido o expirado
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
app.get("/users", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, created_at
      FROM users
      ORDER BY created_at DESC`,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error al obtener los usuarios",
    });
  }
});

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
app.post("/auth/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const { first_name, last_name, username, email, password } = req.body;

    if (!first_name || !last_name || !username || !email || !password) {
      return res.status(400).json({
        error:
          "Todos los campos son obligatorios: nombre, apellido, usuario, correo y contraseña",
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
      RETURNING id, first_name, last_name, username, email, created_at`,
      [first_name, last_name, username, email, password_hash],
    );

    const user = userResult.rows[0];

    const walletResult = await client.query(
      `INSERT INTO wallets (user_id)
   VALUES ($1)
   RETURNING id`,
      [user.id]
    );

    await client.query(
      `INSERT INTO balances (wallet_id, currency, amount)
   SELECT $1, code, 0
   FROM currencies`,
      [walletResult.rows[0].id]
    );

    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, email: user.email },
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
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "El correo y la contraseña son obligatorios" });
    }

    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
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
 *         description: Token de acceso no proporcionado
 *       403:
 *         description: Token inválido o expirado
 *       404:
 *         description: El usuario no tiene wallet
 *       500:
 *         description: Error del servidor
 */
app.get("/wallet", authenticateToken, async (req, res) => {
  try {
    const walletResult = await pool.query(
      `SELECT id, created_at FROM wallets WHERE user_id = $1`,
      [req.user!.id],
    );

    const wallet = walletResult.rows[0];

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
app.get("/admin/users", authenticateToken, async (req, res) => {
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
app.get("/admin/transactions", authenticateToken, async (req, res) => {
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
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 AXORA Backend corriendo en http://localhost:3000");
});
