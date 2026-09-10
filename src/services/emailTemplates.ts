function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

const FOOTER = "AXORA · Tu dinero, sin fronteras. Proyecto educativo: operaciones con saldo simulado.";

interface EmailLayoutParams {
  badge: string;
  title: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  disclaimer?: string;
}

/**
 * Envoltorio visual compartido por todos los emails transaccionales de Axora
 * (bienvenida, recuperar contraseña, confirmación de movimientos). Mantiene
 * una sola identidad de marca y evita repetir el markup en cada plantilla.
 */
export function wrapEmailLayout({ badge, title, intro, bodyHtml, ctaLabel, ctaUrl, disclaimer }: EmailLayoutParams): string {
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 22px;background:#e8821e;color:#2a2623;text-decoration:none;font-weight:bold;border-radius:8px;">${escapeHtml(ctaLabel)}</a></p>`
    : "";
  const note = disclaimer
    ? `<p style="margin:20px 0 0;font-size:13px;color:#8a7f6f;">${escapeHtml(disclaimer)}</p>`
    : "";

  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:20px 8px;background:#f4ede3;color:#2a2623;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background:#fffaf3;">
<tr><td style="padding:26px 24px;background:#2a2623;text-align:center;">
<span style="color:#f6c68b;font-size:26px;font-weight:bold;letter-spacing:6px;">AXORA</span>
</td></tr>
<tr><td style="padding:28px 24px;">
<p style="margin:0 0 8px;color:#a95408;font-size:12px;font-weight:bold;letter-spacing:1px;">${escapeHtml(badge)}</p>
<h1 style="margin:0 0 14px;font-size:22px;">${escapeHtml(title)}</h1>
<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(intro)}</p>
${bodyHtml ?? ""}
${cta}
${note}
</td></tr>
<tr><td style="padding:18px 24px;background:#eadfce;font-size:12px;color:#62594f;">${FOOTER}<br>Este es un correo automático; no respondas a este mensaje.</td></tr>
</table></body></html>`;
}

export function buildPasswordResetEmail(firstName: string, resetLink: string) {
  return {
    subject: "Recuperar tu contraseña de Axora",
    text: `Hola ${firstName},\n\nRecibimos una solicitud para restablecer tu contraseña. Este enlace expira en 30 minutos:\n${resetLink}\n\nSi no solicitaste este cambio, puedes ignorar este correo con tranquilidad.\n\n${FOOTER}`,
    html: wrapEmailLayout({
      badge: "RECUPERAR CONTRASEÑA",
      title: `Hola, ${firstName}`,
      intro: "Recibimos una solicitud para restablecer tu contraseña en Axora.",
      bodyHtml: `<p style="margin:0;padding:14px 16px;background:#f4ede3;border-radius:8px;font-size:13px;">Este enlace expira en <strong>30 minutos</strong> por tu seguridad.</p>`,
      ctaLabel: "Restablecer contraseña",
      ctaUrl: resetLink,
      disclaimer: "Si no solicitaste este cambio, puedes ignorar este correo con tranquilidad.",
    }),
  };
}

export function buildWelcomeEmail(firstName: string, frontendUrl: string) {
  const dashboardUrl = new URL("/dashboard", frontendUrl).href;
  return {
    subject: "¡Bienvenido a Axora!",
    text: `Hola ${firstName},\n\n¡Tu cuenta en Axora fue creada con éxito! Ya puedes cargar saldo, transferir y cambiar entre monedas (USD, EUR, ARS, COP, MXN, BRL) desde un solo lugar.\n\nEntra a tu cuenta: ${dashboardUrl}\n\n${FOOTER}`,
    html: wrapEmailLayout({
      badge: "CUENTA CREADA",
      title: `¡Bienvenido, ${firstName}!`,
      intro: "Tu cuenta en Axora fue creada con éxito.",
      bodyHtml: `<p style="margin:0;padding:14px 16px;background:#f4ede3;border-radius:8px;font-size:13px;">Ya puedes cargar saldo, transferir y cambiar entre monedas (USD, EUR, ARS, COP, MXN, BRL) desde un solo lugar.</p>`,
      ctaLabel: "Ir a mi cuenta",
      ctaUrl: dashboardUrl,
    }),
  };
}
