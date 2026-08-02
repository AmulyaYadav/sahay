/**
 * JSON body parsing that tolerates an absent body.
 *
 * Fastify's built-in parser rejects `Content-Type: application/json` with a
 * zero-length body (FST_ERR_CTP_EMPTY_JSON_BODY). That is defensible in the
 * abstract, but it fails the request before routing reaches the handler, so
 * every no-body POST — cancel a request, leave an event, log out, mark a
 * conversation read — came back as a bare 400 "Something went wrong" with
 * nothing to act on.
 *
 * A POST that carries no body is a perfectly ordinary thing for a client to
 * send. Treat it as absent and let the route decide: handlers that need a body
 * run it through zod and produce a proper validation error naming the missing
 * fields, and handlers that need nothing simply proceed.
 *
 * Malformed JSON is still a 400 — that is a real client error, not an omission.
 */
export function parseJsonBody(raw: string): unknown {
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
}
