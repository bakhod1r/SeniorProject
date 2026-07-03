# gRPC and Streaming — Middle

The junior tier told you *what* gRPC is: RPC over HTTP/2 with Protobuf, four call types. This tier explains *how it works mechanically* — how a gRPC call becomes HTTP/2 frames, how one TCP connection multiplexes many concurrent calls, how streaming flow control uses the HTTP/2 window, and how deadlines and cancellation actually propagate on the wire.

## Contents

1. [One connection, many streams: HTTP/2 multiplexing](#1-one-connection-many-streams-http2-multiplexing)
2. [How a gRPC call maps onto HTTP/2 frames](#2-how-a-grpc-call-maps-onto-http2-frames)
3. [The gRPC message framing on top of DATA frames](#3-the-grpc-message-framing-on-top-of-data-frames)
4. [Status lives in trailers, not the response body](#4-status-lives-in-trailers-not-the-response-body)
5. [The four call types, mechanically](#5-the-four-call-types-mechanically)
6. [Flow control: the HTTP/2 window and backpressure](#6-flow-control-the-http2-window-and-backpressure)
7. [Deadlines, timeouts, and cancellation propagation](#7-deadlines-timeouts-and-cancellation-propagation)
8. [Metadata: headers you can attach](#8-metadata-headers-you-can-attach)
9. [Protobuf wire encoding at a working level](#9-protobuf-wire-encoding-at-a-working-level)
10. [Tracing a bidirectional streaming call](#10-tracing-a-bidirectional-streaming-call)
11. [What to remember](#11-what-to-remember)

---

## 1. One connection, many streams: HTTP/2 multiplexing

HTTP/1.1 gives you one in-flight request per TCP connection — a second request on the same connection must wait for the first response to finish (head-of-line blocking at the application layer). Clients worked around this by opening 6+ connections per host.

HTTP/2 ([RFC 9113](https://httpwg.org/specs/rfc9113.html)) removes that limit. A single TCP connection carries many independent **streams**, each identified by a numeric **stream ID**. Everything is broken into **frames** — small, length-prefixed units that carry a type, flags, and a stream ID. Frames from different streams are **interleaved** on the wire, so one slow call does not block others.

Key facts for gRPC:

- Each stream ID is a positive integer. Client-initiated streams use **odd** IDs (1, 3, 5, …); IDs only increase and are never reused on a connection.
- **One gRPC call == one HTTP/2 stream.** A call's entire lifetime — request headers, all request messages, all response messages, response headers, and trailers — lives inside a single stream.
- Because streams are multiplexed, thousands of concurrent gRPC calls can share one connection, bounded by `SETTINGS_MAX_CONCURRENT_STREAMS`.

This is the foundation for streaming: an open stream can carry many messages in either direction over time without a new connection or a new request.

---

## 2. How a gRPC call maps onto HTTP/2 frames

A gRPC call is a normal HTTP/2 request whose method is always `POST`. The path is the fully-qualified RPC method, and the content type marks it as gRPC.

The request side of a stream:

- **HEADERS frame** — carries the pseudo-headers and metadata. The essentials:
  - `:method: POST`
  - `:scheme: https`
  - `:path: /package.Service/Method`
  - `:authority: host:port`
  - `content-type: application/grpc` (often `application/grpc+proto`)
  - `te: trailers` (tells the server the client accepts trailers)
  - optional `grpc-timeout`, plus any custom metadata
- **DATA frame(s)** — carry the request message(s), each wrapped in gRPC length-prefix framing (see §3).
- The client signals "no more request data" by setting the **END_STREAM** flag on its last frame (a DATA frame, or an empty DATA frame if there is nothing left to send).

The response side of the same stream:

- **HEADERS frame** — response metadata, including `content-type: application/grpc` and any leading metadata. This is sometimes called the *response headers* or *initial metadata*.
- **DATA frame(s)** — the response message(s).
- **HEADERS frame with END_STREAM** — the **trailers**, carrying the final gRPC status (see §4). Trailers are a second HEADERS block sent *after* the DATA, which is why gRPC requires HTTP/2 (HTTP/1.1 has no clean trailer support for this pattern).

The HTTP status of a well-formed gRPC response is `200 OK` even when the RPC *logically* failed — the real result is in the trailers.

---

## 3. The gRPC message framing on top of DATA frames

HTTP/2 DATA frames are just bytes; gRPC adds its own framing so the receiver knows where each message begins and ends. Every gRPC message on the wire is prefixed with a **5-byte header**:

| Bytes | Field | Meaning |
|-------|-------|---------|
| 1 | Compressed-Flag | `0` = not compressed, `1` = compressed with the method named in `grpc-encoding` |
| 4 | Message-Length | Big-endian `uint32` length of the message that follows |
| N | Message | The serialized Protobuf bytes |

So the payload inside DATA frames is a sequence of `[1-byte flag][4-byte length][message]` units. This length prefix is what lets a single logical stream carry **many** messages: the receiver reads 5 bytes, learns the length, reads that many bytes, decodes one message, and repeats. Message boundaries are independent of HTTP/2 frame boundaries — one message can span several DATA frames, and one DATA frame can contain several messages.

---

## 4. Status lives in trailers, not the response body

Every gRPC call ends with a status carried in the **trailers** (the final HEADERS block with END_STREAM):

- `grpc-status` — a numeric [status code](https://grpc.io/docs/guides/status-codes/) (`0` = `OK`, `4` = `DEADLINE_EXCEEDED`, `14` = `UNAVAILABLE`, etc.).
- `grpc-message` — an optional, human-readable, percent-encoded error description.
- optional `grpc-status-details-bin` — a serialized rich error (e.g. a `google.rpc.Status`).

Two important consequences:

- **The status arrives after the data.** A server can stream 1,000 response messages and only then discover an error; the client sees the messages first, then a non-OK trailer. Well-designed streaming APIs account for partially-consumed streams.
- **Trailers-only responses.** If the server fails before sending any message, it may skip the DATA phase and send a single HEADERS frame that is *both* the response headers and the trailers (with END_STREAM). This is the "Trailers-Only" case.

---

## 5. The four call types, mechanically

All four types are the *same* HTTP/2 stream shape — one HEADERS in each direction, some DATA, then trailers. What differs is **how many messages** each side sends and **when END_STREAM** is set.

| Call type | Client sends | Server sends | Client half-close (END_STREAM) | Server half-close (END_STREAM + trailers) |
|-----------|-------------|--------------|-------------------------------|-------------------------------------------|
| Unary | exactly 1 message | exactly 1 message | after its single message | after its single message |
| Server streaming | exactly 1 message | 0..N messages | after its single message | after the last of N (or on error) |
| Client streaming | 0..N messages | exactly 1 message | after the last of N | after its single message |
| Bidirectional streaming | 0..N messages | 0..N messages | when the client is done | when the server is done |

Notes:

- The two directions half-close **independently**. In bidi, the client can finish sending (END_STREAM on its side) while the server keeps streaming responses, or vice versa.
- "Streaming" is not a different protocol — it is just the same stream staying open longer while multiple length-prefixed messages flow. There is no per-message request/response handshake.
- Ordering within one stream is guaranteed (HTTP/2 delivers a stream's frames in order); ordering *across* streams is not.

---

## 6. Flow control: the HTTP/2 window and backpressure

Streaming needs backpressure: a fast producer must not overwhelm a slow consumer or exhaust memory. HTTP/2 provides this with **flow-control windows**, and gRPC relies on them directly.

- Each side advertises a receive window (`SETTINGS_INITIAL_WINDOW_SIZE`) and there is both a **per-stream** window and a **per-connection** window.
- Sending a DATA frame **decrements** the sender's view of the receiver's window by the payload size. When the window reaches zero, the sender must stop sending DATA on that stream (or the whole connection) until it gets more credit.
- The receiver replenishes credit by emitting **WINDOW_UPDATE** frames as the application consumes bytes.

The practical effect: if a gRPC client stops reading a server stream, the server's stream window drains to zero, the server's writes block, and the pressure travels back to the application. This is why gRPC streaming gives you *automatic* backpressure — but also why a client that opens a stream and never reads can stall the server. Only DATA frames are flow-controlled; HEADERS, SETTINGS, PING, and WINDOW_UPDATE are not.

---

## 7. Deadlines, timeouts, and cancellation propagation

gRPC favors **deadlines** (an absolute point in time) over bare timeouts, and propagates them on the wire.

- The client computes a deadline and sends the remaining time as the `grpc-timeout` request header, e.g. `grpc-timeout: 100m` (100 milliseconds) — a number plus a unit (`H`, `M`, `S`, `m`, `u`, `n`).
- The server sees the deadline as part of the incoming request context. If it makes onward gRPC calls, the deadline is **propagated**: the child call's `grpc-timeout` is derived from the time left, so deadlines shrink down the call chain instead of resetting.
- When the deadline passes, whichever side notices first ends the call with `grpc-status: 4` (`DEADLINE_EXCEEDED`).

Cancellation is separate but related. If the client cancels (or its deadline expires, or it disconnects), gRPC sends an HTTP/2 **RST_STREAM** frame to abort just that stream. The server's handler observes cancellation through its context and should stop work and release resources. Because RST_STREAM targets a single stream ID, cancelling one call does not disturb the other calls multiplexed on the same connection.

---

## 8. Metadata: metadata you can attach

**Metadata** is gRPC's name for key–value pairs that ride in the HTTP/2 HEADERS blocks alongside your messages — the equivalent of HTTP headers.

- **Leading metadata** travels in the initial HEADERS frame (request headers, and the server's response headers).
- **Trailing metadata** travels in the trailers HEADERS frame alongside `grpc-status`.
- Keys are ASCII. A key ending in `-bin` (e.g. `auth-token-bin`) is binary; gRPC base64-encodes its value on the wire because HTTP/2 header values must be text-safe.
- Reserved `grpc-*` and pseudo-header (`:`-prefixed) keys are managed by the framework — do not set them yourself.

Metadata is how you carry auth tokens, request IDs, and tracing context without changing your `.proto` message definitions.

---

## 9. Protobuf wire encoding at a working level

You don't need to hand-encode Protobuf, but understanding the wire format explains its compactness and its forward/backward compatibility rules. See the [Protobuf encoding reference](https://protobuf.dev/programming-guides/encoding/).

A serialized message is a flat sequence of fields. Each field is a **tag** followed by its value. The tag is a single varint that packs the **field number** and the **wire type**:

```
tag = (field_number << 3) | wire_type
```

The wire type (low 3 bits) tells the parser how to read the value:

| Wire type | Value | Used for |
|-----------|-------|----------|
| VARINT | 0 | `int32`, `int64`, `uint*`, `bool`, `enum` |
| I64 | 1 | `fixed64`, `sfixed64`, `double` |
| LEN | 2 | `string`, `bytes`, embedded messages, packed repeated |
| I32 | 5 | `fixed32`, `sfixed32`, `float` |

**Varints** are the workhorse. A varint stores an integer in 7-bit groups, little-endian, using the high bit of each byte as a "more bytes follow" flag. Small numbers cost one byte; large numbers cost more. Example: `300` = `0b100101100` → two bytes `0xAC 0x02`.

Two consequences that matter in practice:

- **Field numbers, not names, are on the wire.** That is why renaming a field is safe but *changing its number is a breaking change*, and why you must never reuse a retired field number.
- **Unknown fields are skippable.** Because each field carries its wire type, a parser that meets a field number it doesn't recognize can skip the right number of bytes and keep going — this is the mechanical basis of Protobuf's forward compatibility.

A `LEN` field (like an embedded message or string) is `tag`, then a varint length, then that many raw bytes — the same length-prefix idea seen in gRPC's own framing.

---

## 10. Tracing a bidirectional streaming call

Here is a complete bidi call on **one** HTTP/2 connection, stream ID 5. Watch the interleaving: request and response DATA frames flow at the same time, each side half-closes independently, and the status arrives in trailers.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant S as Server
    Note over C,S: One TCP connection, one HTTP/2 stream (id=5)
    C->>S: HEADERS (:method POST, :path /chat.Chat/Talk,<br/>content-type application/grpc, grpc-timeout, metadata)
    Note over C,S: Stream 5 open; both sides may now send DATA
    C->>S: DATA [len-prefixed msg #1] (request stream)
    S->>C: HEADERS (response headers / initial metadata)
    S->>C: DATA [len-prefixed msg A] (response stream)
    C->>S: DATA [len-prefixed msg #2]
    S->>C: DATA [len-prefixed msg B]
    Note over C,S: Frames interleave — neither direction blocks the other
    S->>C: WINDOW_UPDATE (replenish flow-control credit)
    C->>S: DATA [msg #3] END_STREAM
    Note over C,S: Client half-closed: it will send no more requests
    S->>C: DATA [len-prefixed msg C]
    S->>C: HEADERS END_STREAM (trailers: grpc-status 0, grpc-message)
    Note over C,S: Server half-closed with status → stream 5 fully closed
```

Reading it back:

- Frames 1–2: the stream opens with the client HEADERS; from here both directions are live.
- Frames 3–8: request messages (`#1`–`#2`) and response messages (`A`–`B`) interleave on the same stream, plus a WINDOW_UPDATE giving the sender more flow-control credit.
- Frame 9: the client sets **END_STREAM** on its last DATA — it half-closes but keeps *reading*.
- Frames 10–11: the server sends a final message, then a trailers HEADERS with END_STREAM carrying `grpc-status: 0`. That closes the stream.

If the client had cancelled instead, step 9 would be an **RST_STREAM** on stream 5, and the server handler would see cancellation via its context.

---

## 11. What to remember

- One gRPC call is one HTTP/2 stream; one connection multiplexes many streams, interleaving their frames.
- The wire shape is always: HEADERS → DATA (length-prefixed gRPC messages) → trailing HEADERS with `grpc-status`. HTTP status is `200` even on logical failure.
- Every gRPC message on DATA frames has a 5-byte prefix: 1 compression flag byte + 4 length bytes. That prefix is what lets one stream carry many messages.
- Streaming is the same stream held open longer; the four call types differ only in message counts and when each side sets END_STREAM.
- Flow control (per-stream and per-connection windows, WINDOW_UPDATE) gives streaming automatic backpressure.
- Deadlines ride in `grpc-timeout` and propagate down the call chain; cancellation is an RST_STREAM on a single stream.
- Protobuf puts field *numbers* and wire types on the wire (varint-encoded tags), which is why field numbers are permanent and unknown fields are safely skippable.

*Next step:* [gRPC and Streaming — Senior](senior.md)
