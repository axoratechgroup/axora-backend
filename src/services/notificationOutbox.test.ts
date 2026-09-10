import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const { query, send } = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn() }));
vi.mock("../config/database.js", () => ({ pool: { query } }));
vi.mock("./email.js", () => ({ sendEmail: send }));
import { enqueueTransactionNotifications, dispatchTransactionNotifications } from "./notificationOutbox.js";

const transaction = { id: "tx-1", type: "TRANSFER", status: "COMPLETED", to_amount: "50", to_currency: "USD",
  created_at: "2026-09-07T19:30:00Z", sender_username: "ana", recipient_username: "camilo", description: "Cena" };

function prepare(role: string, email: string) {
  query.mockResolvedValueOnce({ rows: [{ recipient_role: role, recipient_email: email }] })
    .mockResolvedValueOnce({ rows: [transaction] }).mockResolvedValueOnce({ rows: [] });
}

describe("notification outbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("FRONTEND_URL", "https://axora.example");
    send.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("encola mediante el cliente transaccional y conserva registros existentes", async () => {
    const client = { query: vi.fn().mockResolvedValue({}) };
    await enqueueTransactionNotifications(client as unknown as PoolClient, "tx-1");
    expect(query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (transaction_id, type, recipient_role) DO NOTHING"), ["tx-1"]);
  });
  it("entrega dos correos separados y personalizados para una transferencia", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "n1" }, { id: "n2" }] });
    prepare("sender", "ana@example.com");
    prepare("recipient", "camilo@example.com");
    await dispatchTransactionNotifications("tx-1");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "ana@example.com", subject: expect.stringContaining("enviada") });
    expect(send.mock.calls[1][0]).toMatchObject({ to: "camilo@example.com", subject: expect.stringContaining("Recibiste") });
    expect(query.mock.calls.filter(([sql]) => sql.includes("status = 'SENT'"))).toHaveLength(2);
  });
  it.each(["TOP_UP", "SWAP"])("envía un solo correo para %s", async (type) => {
    query.mockResolvedValueOnce({ rows: [{ id: "n1" }] })
      .mockResolvedValueOnce({ rows: [{ recipient_role: "owner", recipient_email: "ana@example.com" }] })
      .mockResolvedValueOnce({ rows: [{ ...transaction, type, from_currency: "EUR", from_amount: "45" }] })
      .mockResolvedValueOnce({ rows: [] });
    await dispatchTransactionNotifications("tx-1");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("un fallo del primer correo no impide enviar al segundo destinatario", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "n1" }, { id: "n2" }] });
    prepare("sender", "ana@example.com");
    prepare("recipient", "camilo@example.com");
    send.mockRejectedValueOnce(new Error("Fallo SES"));
    await expect(dispatchTransactionNotifications("tx-1")).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'FAILED'"), expect.arrayContaining(["n1"]));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'SENT'"), ["n2"]);
  });
  it("no reenvía filas ya enviadas o reclamadas por otro proceso", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "n1" }] }).mockResolvedValueOnce({ rows: [] });
    await dispatchTransactionNotifications("tx-1");
    expect(send).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status IN ('PENDING', 'FAILED') AND attempts < 3"), ["n1"]);
  });
});
