import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});

vi.mock("../config/database.js", () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: (...args: any[]) => mockConnect(...args),
  },
}));

vi.mock("../services/exchangeRates.js", () => ({
  getExchangeRate: vi.fn().mockResolvedValue(1.2),
}));

import { getExchangeRate } from "../services/exchangeRates.js";
import { walletRouter } from "./wallet.routes.js";

const getExchangeRateMock = vi.mocked(getExchangeRate);

const app = express();
app.use(express.json());
app.use(walletRouter);

describe("Wallet Routes", () => {
  const JWT_SECRET = "test-secret-key-123456";
  const userPayload = { id: "user-uuid-1", email: "user1@axora.test", role: "user" };
  const token = jwt.sign(userPayload, JWT_SECRET);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe("GET /wallet", () => {
    it("retorna 401 si no se envía token", async () => {
      const response = await request(app).get("/wallet");
      expect(response.status).toBe(401);
    });

    it("retorna 404 si el usuario no tiene wallet registrada", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getWalletByUserId

      const response = await request(app)
        .get("/wallet")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("El usuario no tiene wallet");
    });

    it("retorna 200 y los balances de la wallet", async () => {
      mockQuery
        .mockResolvedValueOnce({
          // getWalletByUserId
          rows: [{ id: "wallet-uuid-1", created_at: "2026-09-01T00:00:00Z" }],
        })
        .mockResolvedValueOnce({
          // balancesResult
          rows: [
            { currency: "USD", currency_name: "Dólar", symbol: "$", amount: "500.00" },
            { currency: "EUR", currency_name: "Euro", symbol: "€", amount: "300.00" },
          ],
        });

      const response = await request(app)
        .get("/wallet")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        wallet_id: "wallet-uuid-1",
        created_at: "2026-09-01T00:00:00Z",
        balances: [
          { currency: "USD", currency_name: "Dólar", symbol: "$", amount: "500.00" },
          { currency: "EUR", currency_name: "Euro", symbol: "€", amount: "300.00" },
        ],
      });
    });
  });

  describe("GET /wallet/transactions", () => {
    it("retorna las transacciones mapeando la contraparte y dirección", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: "wallet-uuid-1" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "tx-1",
              type: "TRANSFER",
              wallet_id: "wallet-uuid-1",
              destination_wallet_id: "wallet-uuid-2",
              from_currency: "USD",
              from_amount: "50",
              sender_username: "user1",
              recipient_username: "user2",
            },
            {
              id: "tx-2",
              type: "TRANSFER",
              wallet_id: "wallet-uuid-2",
              destination_wallet_id: "wallet-uuid-1",
              from_currency: "USD",
              from_amount: "25",
              sender_username: "user2",
              recipient_username: "user1",
            },
          ],
        });

      const response = await request(app)
        .get("/wallet/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.transactions).toHaveLength(2);
      expect(response.body.transactions[0]).toMatchObject({
        direction: "sent",
        counterparty_username: "user2",
      });
      expect(response.body.transactions[1]).toMatchObject({
        direction: "received",
        counterparty_username: "user2",
      });
    });
  });

  describe("POST /wallet/topup", () => {
    it("rechaza montos menores o iguales a 0", async () => {
      const response = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ currency: "USD", amount: -10 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("El monto debe ser mayor a 0");
    });

    it("rechaza si supera el límite de USD 10000", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // getWalletByUserId
        .mockResolvedValueOnce({ rows: [{ amount: "9500" }] }) // balance select
        .mockResolvedValueOnce({ rows: [{ currency: "USD", amount: "9500" }] }) // getWalletTotalInUsd
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ currency: "USD", amount: 600 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("superarías el límite de USD 10000");
      expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    });

    it("acredita saldo exitosamente y retorna la transacción", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // getWalletByUserId
        .mockResolvedValueOnce({ rows: [{ amount: "100" }] }) // balance select
        .mockResolvedValueOnce({ rows: [{ currency: "USD", amount: "100" }] }) // getWalletTotalInUsd
        .mockResolvedValueOnce({}) // UPDATE balances
        .mockResolvedValueOnce({
          // INSERT INTO transactions
          rows: [{ id: "tx-topup-1", type: "TOP_UP", to_amount: "50" }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ currency: "USD", amount: 50 });

      expect(response.status).toBe(200);
      expect(response.body.transaction).toMatchObject({
        id: "tx-topup-1",
        type: "TOP_UP",
      });
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    });
  });

  describe("POST /wallet/transfer", () => {
    it("rechaza si el monto excede el límite de transferencia de USD 2000", async () => {
      const response = await request(app)
        .post("/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recipient_username: "amigo",
          currency: "USD",
          amount: 2500,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("No puedes transferir más de USD 2000");
    });

    it("rechaza si el destinatario no existe", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // sender wallet
        .mockResolvedValueOnce({ rows: [] }) // recipient not found
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recipient_username: "desconocido",
          currency: "USD",
          amount: 50,
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("No existe un usuario con ese nombre de usuario");
    });

    it("rechaza transferencias a uno mismo", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // sender wallet
        .mockResolvedValueOnce({ rows: [{ user_id: "user-uuid-1", wallet_id: "wallet-uuid-1" }] }) // recipient is same
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recipient_username: "user1",
          currency: "USD",
          amount: 50,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("No puedes transferirte dinero a ti mismo");
    });

    it("rechaza si el saldo del emisor es insuficiente", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // sender wallet
        .mockResolvedValueOnce({ rows: [{ user_id: "user-uuid-2", wallet_id: "wallet-uuid-2" }] }) // recipient wallet
        .mockResolvedValueOnce({
          // SELECT FOR UPDATE balances
          rows: [
            { wallet_id: "wallet-uuid-1", amount: "10" },
            { wallet_id: "wallet-uuid-2", amount: "0" },
          ],
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recipient_username: "amigo",
          currency: "USD",
          amount: 100,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Saldo insuficiente");
    });

    it("realiza la transferencia atómica exitosamente", async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // sender wallet
        .mockResolvedValueOnce({ rows: [{ user_id: "user-uuid-2", wallet_id: "wallet-uuid-2" }] }) // recipient wallet
        .mockResolvedValueOnce({
          // SELECT FOR UPDATE balances
          rows: [
            { wallet_id: "wallet-uuid-1", amount: "150" },
            { wallet_id: "wallet-uuid-2", amount: "20" },
          ],
        })
        .mockResolvedValueOnce({}) // UPDATE sender balance
        .mockResolvedValueOnce({}) // UPDATE recipient balance
        .mockResolvedValueOnce({
          // INSERT INTO transactions
          rows: [{ id: "tx-transfer-1", type: "TRANSFER", from_amount: "50" }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({
          recipient_username: "amigo",
          currency: "USD",
          amount: 50,
        });

      expect(response.status).toBe(200);
      expect(response.body.transaction).toMatchObject({
        id: "tx-transfer-1",
        type: "TRANSFER",
      });
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    });
  });

  describe("POST /wallet/exchange", () => {
    it("rechaza si las monedas son idénticas", async () => {
      const response = await request(app)
        .post("/wallet/exchange")
        .set("Authorization", `Bearer ${token}`)
        .send({
          from_currency: "USD",
          to_currency: "USD",
          amount: 100,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Elige dos monedas distintas para cambiar");
    });

    it("realiza el intercambio aplicando la comisión del 0.3%", async () => {
      getExchangeRateMock.mockResolvedValueOnce(0.9); // 1 USD = 0.9 EUR

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "wallet-uuid-1" }] }) // wallet
        .mockResolvedValueOnce({
          // SELECT balances FOR UPDATE
          rows: [
            { currency: "USD", amount: "200" },
            { currency: "EUR", amount: "50" },
          ],
        })
        .mockResolvedValueOnce({}) // UPDATE from_currency balance
        .mockResolvedValueOnce({}) // UPDATE to_currency balance
        .mockResolvedValueOnce({
          // INSERT transaction
          rows: [{ id: "tx-swap-1", type: "SWAP", applied_exchange_rate: 0.9 }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/wallet/exchange")
        .set("Authorization", `Bearer ${token}`)
        .send({
          from_currency: "USD",
          to_currency: "EUR",
          amount: 100,
        });

      expect(response.status).toBe(200);
      expect(response.body.transaction).toMatchObject({
        id: "tx-swap-1",
        type: "SWAP",
      });
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    });
  });
});
