# ADR-0005: WebSockets as at-most-once hints; REST is the source of truth

## Status
Accepted (2026-07)

## Context
Offers expire in 45 seconds, so participants need low-latency signals. But the target
environment is congested event networks (flaky mobile data, captive portals), where any
"guaranteed delivery" WebSocket design would need per-client queues, acks, and replay —
state that is expensive, failure-prone, and another store of behavioral data.

## Decision
Plain WebSockets (`ws`) at `GET /ws?token=<bearer>` deliver **at-most-once hint frames**
(`zWsFrame`, event names in `WS_EVENTS`). The API/worker publish frames through Redis
pub/sub (`ws:out`, `realtime/hub.ts`) so any process can reach a user connected to any
API instance. Clients treat every frame as "something changed — refetch the relevant REST
resource", and refetch key state wholesale on reconnect. No frame is ever load-bearing:
offer deadlines live in `respond_by` in the database, missed `offer.new` frames are
covered by push notifications and by `GET /offers/pending`. Auth failure closes 4401;
suspension mid-connection sends `session.revoked` then closes 4403.

## Alternatives considered
- **Reliable WS with acks/replay buffers** — rejected: per-connection server state,
  complex failure modes, and a durable log of who-was-told-what (privacy surface).
- **Socket.IO** — rejected: heavier abstraction, fallback transports we don't need, and
  its delivery guarantees are still not real guarantees.
- **Polling only** — rejected: 45 s offer windows would force aggressive polling from
  thousands of clients; worse battery and load than idle sockets.
- **SSE** — viable, but WS gives us client pings for liveness and one channel shape for
  web and React Native.

## Consequences
- Server realtime layer is nearly stateless; horizontal API scaling needs no sticky
  sessions (fanout already goes through Redis).
- Clients must implement refetch-on-reconnect and treat frames as invalidations — this is
  a hard client-side contract, documented in [api-surface.md](../api-surface.md).
- Slightly more REST read traffic; acceptable and cacheable.

## Reconsider when
- A feature genuinely needs ordered, guaranteed streams (e.g. voice-call signalling if
  the `voice_calls` flag ever ships) — that feature should get its own channel design
  rather than hardening this one.
