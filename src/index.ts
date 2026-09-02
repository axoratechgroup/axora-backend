import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { corsOptions } from "./config/cors.js";
import { swaggerSpec } from "./config/swagger.js";
import { authRouter } from "./routes/auth.routes.js";
import { walletRouter } from "./routes/wallet.routes.js";
import { adminRouter } from "./routes/admin.routes.js";

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (req, res) => {
  res.json(swaggerSpec);
});

app.use(authRouter);
app.use(walletRouter);
app.use(adminRouter);

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 AXORA Backend corriendo en http://localhost:3000");
});