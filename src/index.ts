import express from "express";
import { pool } from "./config/database.js";

const app = express();

app.use(express.json());

app.get("/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users ORDER BY created_at DESC"
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error al obtener los usuarios",
    });
  }
});

app.post("/users", async (req, res) => {
  try {
    const { first_name, last_name, username, email } = req.body;

    if (!first_name || !last_name || !username || !email) {
      return res.status(400).json({
        error: "first_name, last_name, username y email son obligatorios",
      });
    }

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, username, email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [first_name, last_name, username, email]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error al crear el usuario",
    });
  }
});

app.listen(3000, () => {
  console.log("🚀 AXORA Backend corriendo en http://localhost:3000");
});