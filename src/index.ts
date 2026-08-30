import express from "express";
import cors from "cors";
import { pool } from "./config/database.js";
import { authenticateToken } from "./middleware/auth.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { corsOptions } from "./config/cors.js";

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

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

    await client.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [user.id]);

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

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 AXORA Backend corriendo en http://localhost:3000");
});
