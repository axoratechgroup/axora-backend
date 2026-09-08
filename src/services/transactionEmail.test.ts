import { describe, expect, it } from "vitest";
import { buildTransactionEmail, type TransactionEmailData } from "./transactionEmail.js";

export const fixture: TransactionEmailData = {
  id: "tx-123", type: "TRANSFER", status: "COMPLETED", from_currency: "USD", from_amount: "50",
  to_currency: "USD", to_amount: "50", applied_exchange_rate: null,
  description: "Cena del viaje", created_at: "2026-09-07T19:30:00Z",
  sender_username: "ana", recipient_username: "camilo", metadata: null,
};

describe("plantilla transaccional AXORA", () => {
  it("personaliza remitente y destinatario sin compartir correos o saldos", () => {
    const sent = buildTransactionEmail(fixture, "sender", "https://axora.example");
    const received = buildTransactionEmail(fixture, "recipient", "https://axora.example");
    expect(sent.text).toContain("Destinatario: @camilo");
    expect(received.text).toContain("Remitente: @ana");
    expect(received.subject).toContain("Recibiste una transferencia");
    expect(sent.text).toContain("50,00 USD");
    expect(sent.html).toContain('src="https://axora.example/axora-email-logo.png"');
    expect(sent.text).toContain("Cena del viaje");
  });
  it("escapa contenido de usuario en HTML manteniendo el texto plano", () => {
    const content = buildTransactionEmail({ ...fixture, description: '<img src=x onerror="alert(1)"> & cena' }, "sender", "https://axora.example");
    expect(content.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; cena");
    expect(content.html).not.toContain('<img src=x');
    expect(content.text).toContain('<img src=x');
  });
  it("omite el motivo ausente", () => {
    expect(buildTransactionEmail({ ...fixture, description: null }, "recipient", "https://axora.example").text).not.toContain("Motivo:");
  });
  it("informa importe neto, tasa y comisión sin recalcular el movimiento", () => {
    const result = buildTransactionEmail({ ...fixture, type: "SWAP", to_currency: "EUR", to_amount: "44.865",
      applied_exchange_rate: "0.9", metadata: { fee_amount: 0.135, fee_currency: "EUR" } }, "owner", "https://axora.example");
    expect(result.text).toContain("Monto acreditado (neto): 44,865 EUR");
    expect(result.text).toContain("Comisión incluida: 0,135 EUR");
    expect(result.text).toContain("Tasa aplicada: 1 USD = 0,90 EUR");
  });
  it("notifica carga al titular y rechaza estados o roles incompatibles", () => {
    expect(buildTransactionEmail({ ...fixture, type: "TOP_UP" }, "owner", "https://axora.example").text).toContain("Monto acreditado: 50,00 USD");
    expect(() => buildTransactionEmail(fixture, "owner", "https://axora.example")).toThrow();
    expect(() => buildTransactionEmail({ ...fixture, status: "FAILED" }, "sender", "https://axora.example")).toThrow();
    expect(() => buildTransactionEmail(fixture, "sender", "javascript:alert(1)")).toThrow();
  });
});
