import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${rawBody}`);
  const expected = `sha256=${hmac.digest("hex")}`;

  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
