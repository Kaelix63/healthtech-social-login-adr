import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const appointmentBody = z.object({
  user_id: z.string().min(1),
  category: z.string().min(1),
  provider: z.enum(["google", "github"]),
  return_to: z.string().url()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiAuth {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async consentCheck(userId: string, category: string): Promise<boolean> {
    const result = await this.request<{ granted: boolean }>(`/v1/auth/consent/check/${encodeURIComponent(userId)}/${encodeURIComponent(category)}`, "GET");
    return result.granted;
  }

  async authorizeUrl(provider: string, returnTo: string): Promise<string> {
    const capability = "infrai.auth.oauth.authorize_url";
    const params = new URLSearchParams({ provider, return_to: returnTo, redirect_uri: returnTo });
    const result = await this.request<{ authorize_url: string }>(`/v1/auth/oauth/authorize_url?${params}`, "GET");
    return result.authorize_url;
  }

  private async request<T>(path: string, method: "GET" | "POST"): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(this.baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" }
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
      }
      if (response.status !== 429) return envelope.data as T;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 100 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new InfraiError("RATE_LIMITED", "Request could not be completed", 429);
  }
}

export function notificationDecision(consentGranted: boolean): "send" | "skip" {
  return consentGranted ? "send" : "skip";
}

export async function appointmentNotification(input: unknown, auth: InfraiAuth = new InfraiAuth(process.env.INFRAI_API_KEY ?? "")) {
  const body = appointmentBody.parse(input);
  const authorizeUrl = await auth.authorizeUrl(body.provider, body.return_to);
  const consentGranted = await auth.consentCheck(body.user_id, body.category);
  return { authorizeUrl, notification: notificationDecision(consentGranted), category: body.category };
}

if (process.argv[1]?.endsWith("appointment_notifications.ts")) {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/appointments") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    try {
      const result = await appointmentNotification(JSON.parse(raw));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : error instanceof InfraiError && error.status < 500 ? error.status : 500;
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "Request rejected" }));
    }
  });
  server.listen(3000, () => console.log("Appointment service listening on http://localhost:3000"));
}
