# gRPC and Streaming — Junior

gRPC is a **contract-first RPC framework**: you describe a service and its messages in a `.proto` file, generate typed client and server code from it, and then call remote methods as if they were local functions. The wire format is **Protocol Buffers** (compact binary) carried over **HTTP/2**. This page covers the fundamentals: what gRPC is, how Protocol Buffers differ from JSON, the four call types, and when to reach for gRPC over REST.

## Table of contents

1. [What gRPC is](#1-what-grpc-is)
2. [The `.proto` contract and code generation](#2-the-proto-contract-and-code-generation)
3. [Protocol Buffers vs JSON](#3-protocol-buffers-vs-json)
4. [HTTP/2 in one sentence](#4-http2-in-one-sentence)
5. [The four call types](#5-the-four-call-types)
6. [gRPC vs REST — when to use which](#6-grpc-vs-rest--when-to-use-which)
7. [Key takeaways](#7-key-takeaways)

---

## 1. What gRPC is

**RPC** (Remote Procedure Call) means calling a function that runs on another machine and getting a result back — the network hop is hidden behind an ordinary-looking method call. gRPC is Google's open-source RPC framework built on three pillars:

- **A contract** written in a `.proto` file that defines the service (its methods) and the messages those methods send and receive.
- **Code generation**: a compiler reads the `.proto` and emits client and server code in your language, so both sides agree on types by construction.
- **A fast transport**: Protocol Buffers over HTTP/2.

Because the contract comes first and both sides are generated from it, the client and server cannot drift apart on field names or types. This is what "contract-first" means, and it is the biggest difference in mindset from hand-written REST clients.

---

## 2. The `.proto` contract and code generation

A `.proto` file has two ingredients: **messages** (the data shapes) and a **service** (the callable methods). Each field carries a type and a stable **field number** that identifies it on the wire.

```proto
syntax = "proto3";

message GetUserRequest {
  int64 user_id = 1;
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
}

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
}
```

You run the Protocol Buffer compiler (`protoc`, with a gRPC plugin) over this file. It produces two things: **message classes** for serializing/deserializing the data, and a **client stub** plus a **server interface**. You call methods on the stub; you implement methods on the server interface.

```mermaid
flowchart LR
  A[".proto file<br/>service + messages"] --> B["protoc + gRPC plugin<br/>(code generation)"]
  B --> C["Client stub<br/>(typed methods)"]
  B --> D["Server interface<br/>(methods to implement)"]
  C -->|"call GetUser(req)"| E(("HTTP/2<br/>+ Protobuf"))
  E -->|"invoke"| D
  D -->|"return User"| E
  E -->|"typed response"| C
```

The staged flow: **write the contract → generate code → the client calls a typed stub → the request travels as Protobuf over HTTP/2 → the server implementation runs → the typed response comes back.**

---

## 3. Protocol Buffers vs JSON

Protocol Buffers ("Protobuf") is a **binary, typed, schema-driven** serialization format. JSON is **text-based, self-describing, and schema-less**. The differences follow from that:

| Aspect | Protocol Buffers | JSON |
| --- | --- | --- |
| Encoding | Binary | Text (UTF-8) |
| Field identity on wire | Field number (e.g. `1`, `2`) | Field name string (`"email"`) |
| Size | Compact — no field names, packed integers | Larger — names repeated on every object |
| Types | Declared in schema, enforced | Inferred at parse time, loose |
| Human-readable | No (needs the schema to decode) | Yes |
| Schema required | Yes (`.proto`) | No |

Because field **numbers** rather than **names** are sent, a Protobuf payload does not repeat `"user_id"` and `"email"` for every record — it sends `1` and `3`. That makes it smaller and faster to parse. The cost is that you cannot read the bytes without the schema, and you always need the `.proto` to make sense of the data.

Field numbers are also how gRPC stays **backward-compatible**: you can add a new field with a new number, and old code simply ignores what it does not recognize. Never reuse or renumber an existing field.

---

## 4. HTTP/2 in one sentence

gRPC runs over **HTTP/2**, which lets many independent requests and responses (called streams) share a single long-lived connection at the same time — this multiplexing is what makes gRPC's streaming call types practical.

---

## 5. The four call types

The `rpc` declaration in a `.proto` decides the shape of a call by adding the `stream` keyword to the request, the response, both, or neither.

```proto
service Chat {
  rpc Lookup(Query) returns (Result);                        // unary
  rpc Subscribe(Query) returns (stream Event);               // server streaming
  rpc Upload(stream Chunk) returns (Summary);                // client streaming
  rpc Converse(stream Message) returns (stream Message);     // bidirectional
}
```

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Server
  Note over C,S: 1. Unary — one request, one response
  C->>S: request
  S->>C: response
  Note over C,S: 2. Server streaming — one request, many responses
  C->>S: request
  S-->>C: response 1
  S-->>C: response 2
  S-->>C: response N
  Note over C,S: 3. Client streaming — many requests, one response
  C-->>S: request 1
  C-->>S: request 2
  C-->>S: request N
  S->>C: response
  Note over C,S: 4. Bidirectional — many both ways
  C-->>S: request A
  S-->>C: response A
  C-->>S: request B
  S-->>C: response B
```

| Call type | Client sends | Server sends | Typical use |
| --- | --- | --- | --- |
| Unary | One message | One message | Ordinary request/response (like a REST call) |
| Server streaming | One message | A stream of messages | Live feed, large result set, progress updates |
| Client streaming | A stream of messages | One message | Uploading chunks, batching many events into one result |
| Bidirectional | A stream of messages | A stream of messages | Chat, real-time sync, long-lived interactive sessions |

**Unary** is the everyday case and behaves like a normal function call. The three streaming modes exploit HTTP/2's ability to keep sending messages on one open connection without a new round trip each time.

---

## 6. gRPC vs REST — when to use which

Both let services talk over the network; they optimize for different things.

| Dimension | gRPC | REST / JSON |
| --- | --- | --- |
| Transport | HTTP/2 | Usually HTTP/1.1 |
| Payload | Protobuf (binary) | JSON (text) |
| Contract | `.proto`, generated code | Often informal or OpenAPI |
| Streaming | Built-in, four call types | Limited (polling, SSE, WebSocket) |
| Browser support | Needs a proxy (gRPC-Web) | Native |
| Human-readable payloads | No | Yes |
| Best fit | Service-to-service, low latency, streaming | Public APIs, browsers, broad tooling |

**Reach for gRPC when:** you control both ends (internal microservices), you want a strict shared contract and generated clients, you need streaming, or latency and payload size matter.

**Stay with REST/JSON when:** the API is public or browser-facing, consumers are unknown or diverse, human-readable payloads help debugging, or you want maximum tooling and caching support out of the box.

---

## 7. Key takeaways

- gRPC is **contract-first RPC**: the `.proto` defines the service and messages, and code is generated from it so client and server stay in sync.
- **Protocol Buffers** are compact binary and typed; they send field numbers, not names, which makes payloads smaller than JSON but unreadable without the schema.
- gRPC runs over **HTTP/2**, which multiplexes many streams on one connection and enables streaming calls.
- There are **four call types**: unary, server streaming, client streaming, and bidirectional — chosen by where you put the `stream` keyword.
- Prefer gRPC for internal, high-performance, streaming service-to-service calls; prefer REST/JSON for public, browser-facing, human-readable APIs.

Authoritative references: the gRPC docs at grpc.io and the Protocol Buffers docs at protobuf.dev.

*Next step:* [gRPC and Streaming — Middle](middle.md)