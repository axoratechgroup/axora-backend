export type RecipientRole = "owner" | "sender" | "recipient";

export interface TransactionEmailData {
  id: string;
  type: "TOP_UP" | "TRANSFER" | "SWAP" | "BUY" | "SELL";
  status: string;
  from_currency: string | null;
  from_amount: string | null;
  to_currency: string;
  to_amount: string;
  applied_exchange_rate: string | null;
  description: string | null;
  created_at: string | Date;
  sender_username: string;
  recipient_username: string | null;
  metadata: { fee_amount?: number; fee_currency?: string } | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function money(value: string | number, currency: string): string {
  return `${Number(value).toLocaleString("es-AR", {
    minimumFractionDigits: 2, maximumFractionDigits: 8,
  })} ${currency}`;
}

export function buildTransactionEmail(tx: TransactionEmailData, role: RecipientRole, frontendUrl: string) {
  const base = new URL(frontendUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("FRONTEND_URL debe ser una URL HTTP(S) sin credenciales");
  }
  if (tx.status !== "COMPLETED") throw new Error("Solo se notifican movimientos completados");
  if (tx.type === "TRANSFER" ? role === "owner" : role !== "owner") {
    throw new Error("Rol de notificación incompatible con la operación");
  }

  const received = role === "recipient";
  let title: string;
  const rows: [string, string][] = [];
  if (tx.type === "TRANSFER") {
    title = received ? "Recibiste una transferencia" : "Tu transferencia fue enviada";
    rows.push([received ? "Monto recibido" : "Monto enviado", money(tx.to_amount, tx.to_currency)]);
    rows.push([received ? "Remitente" : "Destinatario", `@${received ? tx.sender_username : tx.recipient_username}`]);
    if (tx.description) rows.push(["Motivo", tx.description]);
  } else if (tx.type === "TOP_UP") {
    title = "Tu carga de saldo fue confirmada";
    rows.push(["Monto acreditado", money(tx.to_amount, tx.to_currency)]);
  } else if (["SWAP", "BUY", "SELL"].includes(tx.type)) {
    title = "Tu cambio de divisas fue confirmado";
    rows.push(["Monto debitado", money(tx.from_amount!, tx.from_currency!)]);
    rows.push(["Monto acreditado (neto)", money(tx.to_amount, tx.to_currency)]);
    if (tx.applied_exchange_rate) rows.push(["Tasa aplicada", `1 ${tx.from_currency} = ${money(tx.applied_exchange_rate, tx.to_currency)}`]);
    if (tx.metadata?.fee_amount !== undefined) {
      rows.push(["Comisión incluida", money(tx.metadata.fee_amount, tx.metadata.fee_currency ?? tx.to_currency)]);
    }
  } else {
    throw new Error("Tipo de operación no soportado para email");
  }
  rows.push(["Fecha (UTC)", new Date(tx.created_at).toISOString().replace("T", " ").replace(".000Z", " UTC")]);
  rows.push(["Referencia", tx.id]);

  const activityUrl = new URL("/dashboard", base).href;
  const htmlRows = rows.map(([label, value]) => `<tr><td style="padding:12px 8px;border-bottom:1px solid #eadfce;color:#62594f;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:12px 8px;border-bottom:1px solid #eadfce;text-align:right;overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`).join("");
  const footer = "AXORA · Tu dinero, sin fronteras. Proyecto educativo: operaciones con saldo simulado.";
  return {
    subject: `AXORA · ${title}`,
    text: `${title}\n\n${rows.map(([key, value]) => `${key}: ${value}`).join("\n")}\n\nVer mi actividad: ${activityUrl}\n\n${footer}`,
    html: `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:20px 8px;background:#f4ede3;color:#2a2623;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background:#fffaf3;"><tr><td style="padding:26px 24px;background:#2a2623;text-align:center;">
<span style="color:#f6c68b;font-size:26px;font-weight:bold;letter-spacing:6px;">AXORA</span></td></tr>
<tr><td style="padding:24px;"><p style="color:#a95408;">MOVIMIENTO CONFIRMADO</p><h1 style="font-size:24px;">${escapeHtml(title)}</h1><p>Estos son los datos de tu operación en AXORA.</p>
<table aria-label="Detalle del movimiento" style="width:100%;table-layout:fixed;border-collapse:collapse;background:#fff;">${htmlRows}</table>
<p style="margin-top:28px;"><a href="${escapeHtml(activityUrl)}" style="display:inline-block;padding:14px 20px;background:#e8821e;color:#2a2623;text-decoration:none;font-weight:bold;">Ver mi actividad</a></p>
<p style="font-size:13px;">Si no reconoces esta operación, revisa tu cuenta y contacta a soporte.</p></td></tr>
<tr><td style="padding:20px 24px;background:#eadfce;font-size:12px;">${footer}<br>Este es un correo automático; no respondas a este mensaje.</td></tr></table></body></html>`,
  };
}
