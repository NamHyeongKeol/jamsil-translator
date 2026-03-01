const RESEND_API_URL = "https://api.resend.com/emails";

function resolveResendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "";
  return {
    apiKey,
    fromEmail,
    configured: Boolean(apiKey && fromEmail),
  };
}

export function isResendConfigured(): boolean {
  return resolveResendConfig().configured;
}

export async function sendPasswordResetEmail(args: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const config = resolveResendConfig();
  if (!config.configured) {
    throw new Error("resend_not_configured");
  }

  const text = [
    "Mingle password reset",
    "",
    "A password reset request was received for your account.",
    `Reset link: ${args.resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = [
    "<p><strong>Mingle password reset</strong></p>",
    "<p>A password reset request was received for your account.</p>",
    `<p><a href="${args.resetUrl}" target="_blank" rel="noopener noreferrer">Reset password</a></p>`,
    "<p>If you did not request this, you can ignore this email.</p>",
  ].join("");

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [args.to],
      subject: "Reset your Mingle password",
      text,
      html,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const reason = body.slice(0, 240);
    throw new Error(`resend_send_failed_${response.status}${reason ? `:${reason}` : ""}`);
  }
}

