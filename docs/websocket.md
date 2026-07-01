# WebSocket Protocol

Real-time collaborative editing runs over a single WebSocket connection per client, handled by `CollaborationGateway` (`src/collaboration/collaboration.gateway.ts`). WS traffic shares the same host and port as the HTTP API (see the main [README](../README.md#architecture)).

## Connecting

```
wss://<host>            # production
ws://localhost:<PORT>   # local dev
```

Authenticate with a valid access JWT, passed either as a header or a query param:

```
Authorization: Bearer <token>
```

or

```
wss://<host>/?token=<token>
```

The server checks the token, an IP-based connection rate limit (`WS_CONNECTION_RATE_LIMIT`, per minute), and whether the token is blacklisted (e.g. after logout). If any check fails, the socket is closed immediately with a close code — no messages are exchanged first.

### Close codes

| Code   | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| `4001` | Missing/invalid/expired token, blacklisted token, or no `document_id` sent on `join` |
| `4003` | Authenticated, but not a member of the requested document (`join`)                   |
| `4029` | Connection rate limit exceeded, or 3 consecutive message-rate violations             |
| `1011` | Internal error setting up the document's pub/sub channels                            |

A closed connection at any of these codes will not receive further messages — reconnect with a fresh token if needed.

## Message framing

Every frame is one of two kinds — clients never need to inspect content to tell them apart:

- **Binary frames** — always a raw Yjs update (a CRDT diff), sent as-is (`Buffer`/`ArrayBuffer`), both directions.
- **Text frames** — always JSON, shaped `{ event, data }` for client→server messages and most server→client messages, or `{ type: 'presence', ... }` for presence pushes (see below).

## Client → Server events

### `join`

Sent once, right after connecting, to enter a document's collaboration room.

```json
{ "event": "join", "data": { "document_id": "<uuid>" } }
```

The server checks the caller's membership on that document (author/editor/viewer) and closes with `4003` if none exists. On success, the socket is added to the document's room and the server responds with `initial_state` (below).

### `update`

A raw Yjs binary update — send the buffer produced by your Yjs provider/binding directly as a **binary frame**, no JSON wrapper:

```
<binary Yjs update>
```

Viewers' updates are silently dropped (no ack, no error) — only `editor`/`author` roles can write. Each accepted update is:

1. Persisted to the operation log with a Lamport clock (`operations` table) inside a transaction, alongside a write lock that guarantees monotonic ordering under concurrent writers.
2. Queued in a transactional outbox for durable, cross-instance delivery (survives a worker crash mid-broadcast).
3. Relayed immediately to other local sockets in the room as the same binary frame, for low-latency delivery — the outbox delivery that follows re-applies the identical update on every instance, which Yjs treats as an idempotent no-op.

The submitting client receives an `ack` (see below); it does **not** receive its own update echoed back.

Message rate is capped per connection at `WS_MESSAGE_RATE_LIMIT` per second. Exceeding it once sends a `rate_limit_warning`; three consecutive 1-second windows over the limit closes the socket with `4029`.

## Server → Client events

### `initial_state`

Sent once, in response to `join`.

```json
{
  "event": "initial_state",
  "data": {
    "snapshot": "<base64 Yjs state, or null>",
    "delta": [
      {
        "id": "<uuid>",
        "documentId": "<uuid>",
        "userId": "<uuid>",
        "type": "insert | delete | format | yjs_update",
        "source": "human | ai",
        "operationSequence": 42,
        "clockValue": "17",
        "payload": {
          "...": "operation-specific fields, or null for yjs_update rows"
        },
        "yjsUpdate": "<base64 buffer, or null>",
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "participants": { "<userId>": "<displayName>" }
  }
}
```

- `snapshot` is the most recent compacted Yjs state (base64), or `null` if none exists yet.
- `delta` is every operation recorded since that snapshot (`operationSequence` > snapshot's), in order — replay `snapshot` then each `delta` entry to reconstruct current state. `clockValue` is emitted as a string since it's a bigint. Apply `yjsUpdate` (when present) as a binary Yjs update the same way you'd apply a live `update` broadcast.
- `participants` is the current presence roster for the document (including the joining client itself — filter your own id out client-side), keyed by user id.

### `ack`

Sent to the client that submitted an `update`, confirming persistence.

```json
{ "event": "ack", "data": { "operation_sequence": 43, "status": "ok" } }
```

On failure (DB/transaction error), instead:

```json
{ "event": "ack", "data": { "status": "error" } }
```

No `operation_sequence` is included on error. There's no automatic retry — the client owns re-sending or reconciling.

### `rate_limit_warning`

A soft warning sent the moment a connection first crosses `WS_MESSAGE_RATE_LIMIT` within a 1-second window (before the connection is actually closed):

```json
{
  "event": "rate_limit_warning",
  "data": { "message": "Message rate limit exceeded" }
}
```

### Presence (`type: 'presence'`)

Unlike the events above, presence pushes use `type` instead of `event`, and aren't tied to a request/response — they arrive asynchronously whenever another participant's connection count transitions to/from zero (i.e. their _first_ tab connects or their _last_ tab disconnects; multiple simultaneous tabs from the same user don't trigger repeat events):

```json
{
  "type": "presence",
  "userId": "<uuid>",
  "name": "<displayName>",
  "status": "online"
}
```

or

```json
{
  "type": "presence",
  "userId": "<uuid>",
  "name": "<displayName>",
  "status": "offline"
}
```

Use the `participants` roster from `initial_state` for the initial snapshot, then apply these events incrementally.

## Typical client flow

1. Open the socket with a bearer token.
2. Send `join` with the target `document_id`.
3. Receive `initial_state` — hydrate the Yjs doc from `snapshot` + `delta`, and seed the presence roster from `participants`.
4. Bind your Yjs provider so local edits are sent as binary `update` frames, and incoming binary frames are applied to the local doc.
5. Handle `ack` to confirm writes (and `rate_limit_warning` / an `ack` error if something needs surfacing to the user).
6. Handle presence text frames to update the online/offline roster live.
7. On disconnect, reconnect and repeat from step 2 — the server replays anything missed via `initial_state`'s `delta`.
