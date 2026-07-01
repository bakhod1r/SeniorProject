# HTTP Evolution (1.1 / 2 / 3 / QUIC) — Interview Questions

A structured question bank covering the semantic continuity and transport revolution across HTTP/1.1, HTTP/2, HTTP/3, and QUIC. Answers favor mechanism and judgment over trivia — the goal is to explain *why* each generation exists and *when* it actually helps.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What are the main differences between HTTP/1.1, HTTP/2, and HTTP/3 at a glance?**

> All three share the *same semantics* — methods, status codes, headers, and URLs are identical. What changes is the wire format and the transport underneath.
>
> | Aspect | HTTP/1.1 | HTTP/2 | HTTP/3 |
> |--------|----------|--------|--------|
> | Released | 1997 (RFC 2068/2616) | 2015 (RFC 7540) | 2022 (RFC 9114) |
> | Message format | Text, line-oriented | Binary frames | Binary frames |
> | Transport | TCP | TCP | QUIC over UDP |
> | Concurrency | One request per connection at a time (or pipelining, unused) | Multiplexed streams on one TCP connection | Multiplexed streams on one QUIC connection |
> | Header compression | None | HPACK | QPACK |
> | Encryption | Optional (TLS separate) | Effectively required by browsers | Mandatory (TLS 1.3 baked into QUIC) |
> | Head-of-line blocking | Application-level | TCP-level only | Eliminated |
>
> The one-sentence version: HTTP/2 fixed *application-level* concurrency over TCP; HTTP/3 changed the transport to fix the *TCP-level* problems HTTP/2 still had.

**Q2: What is HTTP keep-alive and why does it matter?**

> Keep-alive (persistent connections) lets multiple request/response pairs reuse a single TCP connection instead of opening a fresh one each time. In HTTP/1.0 every request typically paid a full TCP handshake (and TLS handshake if secured); HTTP/1.1 made persistent connections the default, signaled by `Connection: keep-alive` (and only closed via `Connection: close`).
>
> It matters because connection setup is expensive: a TCP handshake is one round trip, TLS 1.2 adds two more. On a page with dozens of resources, reopening connections per request would multiply latency and burn server file descriptors. Keep-alive amortizes that cost — but on HTTP/1.1 a single connection still serves only one request at a time, which is the limitation HTTP/2 addresses.

**Q3: Why does HTTP/1.1 have a head-of-line blocking problem?**

> On an HTTP/1.1 connection, responses must come back in request order, and only one request is "in flight" per connection at any moment. If the first response is slow (a large file, a slow query), every request queued behind it waits — even if those later responses are ready. That is application-layer head-of-line (HOL) blocking.
>
> Browsers worked around it by opening 6 parallel connections per origin, giving 6 lanes instead of 1. But 6 lanes is still a small number, each lane has its own congestion-control ramp-up, and the workaround wastes server resources. HTTP/1.1 also defined *pipelining* (sending requests without waiting for responses), but it kept the strict response ordering, so it never solved HOL and was effectively never deployed.

**Q4: What is multiplexing in HTTP/2?**

> Multiplexing means many concurrent requests and responses share a single connection, interleaved as independent *streams*. Each stream has an ID; the connection is chopped into small binary frames, each tagged with its stream ID, and frames from different streams are interleaved on the wire. The receiver reassembles them per stream.
>
> This removes the "one request at a time" limit and makes the 6-connections-per-origin hack obsolete. A browser can fire 100 requests on one connection and receive responses in whatever order the server finishes them. It also means header compression state and congestion-control state are shared across all requests, which is more efficient than 6 independent connections.

**Q5: Is HTTP/3 encrypted by default?**

> Yes, mandatorily. HTTP/3 runs over QUIC, and QUIC integrates TLS 1.3 into the transport itself — there is no unencrypted QUIC. Even the transport handshake and most packet headers are protected. This is stricter than HTTP/1.1 (where plaintext `http://` is valid) and HTTP/2 (where the spec technically allows cleartext `h2c`, though browsers only ship `h2` over TLS). If you speak HTTP/3, you are encrypted — encryption is not a bolt-on layer but part of the protocol.

**Q6: How does a client discover it can use HTTP/3?**

> Almost always via the `Alt-Svc` (Alternative Services) header. A client first connects over HTTP/1.1 or HTTP/2 (TCP+TLS), and the server responds with something like `Alt-Svc: h3=":443"; ma=86400`, advertising that the same origin is reachable via HTTP/3 on port 443 for the next 86,400 seconds. The client caches this and races or switches future connections to HTTP/3.
>
> HTTP/3 can't be negotiated via ALPN on the very first connection the way HTTP/2 can, because the client doesn't yet know UDP/QUIC is available — it has to be *told*. Some ecosystems are adding DNS-based discovery (HTTPS/SVCB resource records) so the client can learn about HTTP/3 before the first byte, avoiding the initial TCP round trip entirely.

---

## Middle Questions

**Q7: Walk through HTTP/2's binary framing layer. What frame types matter?**

> HTTP/2 replaces text with a binary framing layer. Every message is split into frames with a common 9-byte header: length, type, flags, and a 31-bit stream identifier. The key types:
>
> - **HEADERS** — carries the HPACK-compressed request/response header block; opens a stream.
> - **DATA** — the message body payload.
> - **SETTINGS** — connection-level parameters (max concurrent streams, initial window size, max frame size), exchanged at connection start.
> - **WINDOW_UPDATE** — flow-control credit for a stream or the whole connection.
> - **RST_STREAM** — abruptly cancel a single stream without killing the connection.
> - **PING** — liveness / RTT measurement.
> - **GOAWAY** — graceful connection shutdown, telling the peer the highest stream it will process.
> - **PRIORITY** — stream dependency/weight hints (largely deprecated in practice).
>
> Binary framing is what makes multiplexing possible: because everything is length-delimited and stream-tagged, frames can interleave deterministically without the ambiguity of parsing text.

**Q8: What is HPACK and what problem does it solve?**

> HPACK is HTTP/2's header compression. HTTP headers are hugely repetitive — the same `user-agent`, `cookie`, `accept-encoding` are re-sent on every request, and on a multiplexed connection with hundreds of requests that overhead dominates. HPACK addresses this with:
>
> 1. A **static table** of ~61 common header name/value pairs (`:method: GET`, `:status: 200`, etc.) referenced by index.
> 2. A **dynamic table** that both peers build up as headers are seen, so a repeated header collapses to a single index reference.
> 3. **Huffman coding** for literal strings that aren't in a table.
>
> HPACK was deliberately designed to resist the CRIME attack: it avoids the generic DEFLATE compression that let attackers infer secrets by observing compressed size. The catch — the dynamic table creates *ordering dependency* between requests, which becomes a real problem for HTTP/3 (see QPACK).

**Q9: Why was HTTP/2 server push deprecated?**

> Server push let a server preemptively send resources (say, CSS/JS) alongside an HTML response before the client asked, via a `PUSH_PROMISE` frame. The theory: eliminate a round trip. In practice it was a net loss and Chrome removed support in 2022.
>
> The problems: the server pushes *blind* to the client's cache, so it frequently pushed resources the browser already had, wasting bandwidth. Getting push priorities and flow control right was extremely hard, and it often competed with the critical HTML for bandwidth, *delaying* the page it was trying to speed up. Meanwhile a simpler, cache-aware alternative won: `<link rel=preload>` and `103 Early Hints`, which *tell* the client what to fetch and let the client's cache logic decide. Push solved a real problem badly; hints solve it well.

**Q10: HTTP/2 fixed application-level HOL blocking. What HOL problem remains?**

> TCP-level head-of-line blocking. HTTP/2 multiplexes many logical streams over *one* TCP connection, but TCP is a single, strictly-ordered byte stream. TCP guarantees in-order delivery of *all* bytes on the connection, and it has no idea those bytes belong to independent streams.
>
> So if one TCP segment is lost, TCP holds back *every* subsequent byte — from *all* streams — until that one segment is retransmitted and arrives. Stream 7's data may be sitting fully received in the kernel buffer, but the application can't read it because stream 3 lost a packet earlier in the byte stream. Ironically, on a lossy network HTTP/2 can perform *worse* than HTTP/1.1's 6 connections, because 6 independent TCP flows isolate loss to one lane, while HTTP/2 concentrates all loss impact onto a single flow.

**Q11: How does HTTP/3 eliminate transport-level HOL blocking?**

> QUIC makes streams first-class *inside the transport*. Instead of one ordered byte stream, QUIC carries multiple independent streams, each with its own sequencing and reliability. When a UDP packet carrying stream 3's data is lost, QUIC knows exactly which stream it belonged to and only stalls *that* stream. Stream 7's data is delivered to the application immediately.
>
> This is only possible because QUIC lives in user space over UDP, so it controls its own loss detection and delivery semantics rather than inheriting TCP's global ordering. Note the subtlety: HOL is eliminated *between* streams, but *within* a single stream, ordering still applies — a loss inside one stream still stalls that stream. HTTP/3 wins because a lost packet no longer contaminates unrelated requests.

**Q12: Why does QUIC run over UDP instead of being a new protocol on top of IP?**

> Two words: deployability and ossification. In principle QUIC could be its own IP protocol number, but the internet is full of middleboxes (NATs, firewalls, load balancers) that only reliably pass TCP and UDP. A brand-new IP protocol would be dropped by huge swaths of the network. UDP is the pragmatic substrate: it's already universally routed, gives QUIC just the bare port-based multiplexing it needs, and lets everything else — connections, streams, reliability, congestion control, encryption — be implemented in *user space*.
>
> User space is the second reason. TCP lives in the kernel; deploying a TCP change means shipping new kernels to billions of devices, which takes a decade. QUIC ships with the application (browser, server library), so protocol evolution happens at software-release speed. UDP-plus-user-space is what makes QUIC iterable at all.

---

## Senior Questions

**Q13: Explain QUIC connection migration. Why couldn't TCP do this?**

> A TCP connection is identified by the 4-tuple: source IP, source port, destination IP, destination port. Change any of them — for example, your phone switches from Wi-Fi to cellular and your IP changes — and the TCP connection is dead; you must reconnect and re-handshake.
>
> QUIC identifies a connection by a **Connection ID** carried in the packet, not by the IP/port tuple. When your network changes, packets arrive with a new source address but the same Connection ID, and the server recognizes the connection and continues seamlessly — no new handshake, in-flight requests survive. This is huge for mobile: switching networks or roaming no longer breaks downloads or long-lived streams. QUIC validates the new path (a quick address-validation exchange to prevent traffic amplification/hijacking) before shifting fully, but the *connection state* — including TLS keys — is preserved.

**Q14: What is 0-RTT in QUIC, and what's the security risk?**

> 0-RTT (zero round-trip time) lets a returning client send *application data in its very first packet*, before the handshake completes, by reusing a pre-shared key (a session ticket) from a previous connection. Normally even QUIC's fast 1-RTT handshake costs one round trip before data flows; 0-RTT eliminates even that, which is a meaningful latency win for repeat visits.
>
> The risk is **replay**. 0-RTT data isn't protected by the full handshake's freshness guarantees, so an attacker who captures a 0-RTT packet can resend it, and the server may process it again. That's harmless for idempotent, safe requests (`GET /home`) but dangerous for state-changing ones (`POST /transfer-money`). The mitigation: servers must only accept *idempotent* requests in 0-RTT and defer anything non-idempotent to after the handshake completes, or maintain anti-replay tracking. Many deployments simply restrict 0-RTT to `GET`/`HEAD`.

**Q15: What is QPACK and why couldn't HTTP/3 just reuse HPACK?**

> QPACK is HTTP/3's header compression — conceptually HPACK (static table, dynamic table, Huffman), but redesigned for QUIC's independent streams.
>
> The problem with HPACK on HTTP/3: HPACK's dynamic table requires headers to be processed **in strict order**, because each header block can reference table entries built by previous blocks. That's fine over TCP's globally-ordered stream. But QUIC streams are independent and can arrive *out of order* — the whole point of eliminating HOL blocking. If HTTP/3 used HPACK unchanged, a header block on stream 5 might reference a dynamic-table entry from stream 3 that hasn't arrived yet, forcing HOL blocking back into the compression layer — defeating the entire design.
>
> QPACK fixes this by decoupling the encoder's table updates onto dedicated unidirectional streams and adding explicit dependency tracking: a header block that references dynamic entries is *blocked* only if those specific entries aren't yet available, and encoders can be configured to avoid such references entirely (trading a little compression for zero blocking). It preserves HPACK's compression benefits without reintroducing ordering dependency across streams.

**Q16: Trace what happens on the wire for a fresh HTTPS request over HTTP/1.1+TLS vs HTTP/3.**

> ```mermaid
> sequenceDiagram
>     participant C as Client
>     participant S as Server
>     Note over C,S: HTTP/1.1 over TCP + TLS 1.2 (worst case)
>     C->>S: TCP SYN
>     S->>C: SYN-ACK
>     C->>S: ACK  (1 RTT — TCP up)
>     C->>S: TLS ClientHello
>     S->>C: ServerHello, cert
>     C->>S: TLS Finished  (2 RTT — TLS up)
>     C->>S: HTTP GET
>     S->>C: HTTP 200 (3 RTT — data)
>     Note over C,S: HTTP/3 over QUIC (1-RTT), or 0-RTT on resume
>     C->>S: QUIC Initial (ClientHello) + optional 0-RTT data
>     S->>C: QUIC handshake + 1-RTT keys
>     C->>S: HTTP GET (1 RTT — or 0 RTT on resume)
>     S->>C: HTTP 200
> ```
>
> The point: TCP+TLS 1.2 costs up to 3 RTTs before the first byte of response. QUIC folds the transport and cryptographic handshakes together (TLS 1.3 baked in) to reach 1 RTT for a fresh connection and 0 RTT for a resumed one. Combined with connection migration and per-stream loss recovery, this is the concrete latency story behind HTTP/3.

**Q17: What is connection coalescing and when does it apply?**

> Connection coalescing lets a client reuse one existing HTTP/2 or HTTP/3 connection for *multiple origins* when they resolve to the same server and the TLS certificate covers all of them. If `a.example.com` and `b.example.com` share an IP and a wildcard/SAN certificate, the browser can send requests for both over the single connection it already opened — no second handshake, no second connection ramp-up.
>
> It saves handshakes and shares congestion/compression state, which is why serving many subdomains behind one cert on shared infrastructure can be faster than sharding domains (the old HTTP/1.1 "domain sharding" trick, which is actively *harmful* under HTTP/2/3). The requirements: same resolved server (or same IP for HTTP/2) and a certificate that authenticates all the hostnames. HTTP/3 coalescing is slightly looser since it keys on the cert and authority rather than strictly the IP.

**Q18: How does gRPC use HTTP/2, and why does it depend on it?**

> gRPC is built directly on HTTP/2 and leans on its features rather than treating it as a dumb pipe. Each gRPC call maps to one HTTP/2 stream: the method is a `:path`, metadata rides as headers, and the message payload flows as length-prefixed frames in the DATA stream. gRPC's four call types — unary, server-streaming, client-streaming, and bidirectional-streaming — map cleanly onto HTTP/2 streams, using the fact that both directions of a stream stay open and can send frames independently.
>
> It depends on HTTP/2 because that streaming/multiplexing is unavailable in HTTP/1.1 — you cannot do true bidirectional streaming over a single 1.1 connection. This is also why browsers can't speak native gRPC directly: they don't expose raw HTTP/2 frame control to JavaScript, so browser clients need `grpc-web` and a proxy to bridge. gRPC-over-HTTP/3 is emerging and inherits QUIC's per-stream loss isolation, which suits many small concurrent RPCs well.

---

## Professional / Deep-Dive Questions

**Q19: When does HTTP/2 actually help, and when does it hurt versus HTTP/1.1?**

> HTTP/2 helps when a page loads *many* resources over a network with *low to moderate* loss: multiplexing collapses dozens of requests onto one warm connection, sharing congestion state and eliminating per-request handshakes, and HPACK crushes redundant headers. This is the common case for content-rich web pages.
>
> HTTP/2 hurts — or at least underperforms — in specific conditions:
>
> - **High packet loss.** Because all streams share one TCP flow, a single lost packet HOL-blocks *every* stream. HTTP/1.1's 6 independent connections isolate loss per lane, so on a lossy link (poor mobile, satellite) HTTP/1.1 can win.
> - **A single large transfer.** Multiplexing gives nothing over one connection moving one big file; you just pay framing overhead.
> - **Servers with poor prioritization.** If the server interleaves frames badly, critical resources can starve behind non-critical ones.
>
> The honest summary: HTTP/2 is a strict improvement in most real-world web traffic but has a genuine failure mode on lossy networks — which is precisely the gap HTTP/3 was designed to close.

**Q20: What are the observability and operational tradeoffs of adopting HTTP/3?**

> HTTP/3 buys latency and resilience but complicates operations:
>
> - **UDP through the network.** Many corporate firewalls, older middleboxes, and some ISPs throttle or block UDP/443. Clients must be able to *fall back* to HTTP/2 over TCP, and you must monitor the fallback rate — a spike means a network path is blocking QUIC.
> - **Encrypted transport headers.** QUIC encrypts most of the packet including transport metadata, so the packet-level inspection ops teams relied on (following TCP sequence numbers, reading connection state off the wire) is gone. Debugging moves into application logs and QUIC-aware tooling like **qlog/qvis** and endpoint-exported keys — you can no longer just `tcpdump` and read it.
> - **CPU cost.** User-space QUIC does per-packet crypto and ack processing that the kernel did efficiently for TCP; QUIC has historically used noticeably more CPU per byte, though hardware offload and optimization narrow the gap.
> - **Load balancing.** Because connections survive IP changes via Connection ID, L4 load balancers must route on Connection ID, not the 4-tuple — otherwise migration breaks. This requires QUIC-aware LBs.
> - **Stateful connections and pooling.** 0-RTT anti-replay and session tickets add cache/state to manage across a fleet.
>
> The mature stance: deploy HTTP/3 with HTTP/2 as a mandatory fallback, instrument the fallback and QUIC-block rates, and invest in qlog-based tooling before you need it in an incident.

**Q21: How do flow control and congestion control differ between HTTP/2 and QUIC?**

> **Flow control** (protecting a slow receiver from being overwhelmed) exists at two granularities in both. HTTP/2 has connection-level and stream-level flow control via `WINDOW_UPDATE` frames — but it sits *on top of* TCP's own receive window, so you effectively have two layers of flow control that can interact awkwardly. QUIC implements stream-level and connection-level flow control natively, with no separate underlying transport window to fight, giving cleaner, single-layer control.
>
> **Congestion control** (avoiding overwhelming the *network*) is the sharper contrast. HTTP/2 inherits whatever congestion controller the kernel's TCP uses (Cubic, BBR) and cannot change it. QUIC implements congestion control in user space, so the endpoint chooses and tunes the algorithm and can ship improvements with a software update. QUIC also has *richer signals*: because acknowledgments are per-packet-number with explicit ranges (no ambiguous retransmissions), it distinguishes an original packet's loss from a retransmission's — resolving TCP's long-standing retransmission ambiguity and enabling more accurate RTT estimation and loss recovery.

**Q22: If someone reports "we enabled HTTP/2 and page loads got slower on mobile," how do you diagnose it?**

> First, confirm the direction with data — bucket real-user-monitoring by connection type and compare HTTP/1.1 vs HTTP/2 cohorts, don't trust anecdote. Then reason through the likely causes:
>
> 1. **Packet loss + TCP HOL blocking.** Mobile networks are lossy. One TCP connection means one lost packet stalls every stream. Check retransmission rates; if loss is high, this is the classic HTTP/2-on-lossy-links regression, and HTTP/3 is the real fix.
> 2. **Left the HTTP/1.1 optimizations in place.** Domain sharding, inlining, and sprite sheets were HTTP/1.1 workarounds; under HTTP/2 domain sharding forces multiple connections and *defeats* multiplexing and coalescing. Un-shard the domains.
> 3. **Bad server prioritization.** Verify critical CSS/JS isn't being starved behind low-priority frames; test with a server known to prioritize well.
> 4. **Aggressive server push.** If push is on, it may be shipping already-cached bytes and delaying the HTML. Disable it and use `preload`/`103 Early Hints`.
> 5. **TLS/handshake regressions or a broken CDN edge** masquerading as an HTTP/2 problem.
>
> The meta-point: "we enabled HTTP/2" is rarely the whole change — the HTTP/1.1-era performance hacks around it are usually the culprit, and on lossy mobile the honest answer is that HTTP/2's shared-TCP design has a real limitation.

---

## Staff / Judgment Questions

**Q23: You run an API-heavy backend serving mostly small JSON responses between internal services. Do you push to adopt HTTP/3? Defend your answer.**

> I'd be cautious and evidence-driven, not reflexively "newest is best."
>
> The case *for* HTTP/3 here: many small concurrent requests is exactly where per-stream loss isolation shines — a lost packet won't HOL-block unrelated RPCs — and if these services talk across regions or over lossy/variable links, the resilience and 0-RTT wins are real.
>
> The case *against*, and why I'd likely hold: internal service-to-service traffic usually runs over *reliable, low-loss* datacenter networks, which is precisely where TCP-level HOL blocking rarely triggers — so HTTP/3's headline benefit barely fires. Meanwhile I'd pay real costs: higher CPU per byte from user-space crypto (a big deal at high internal QPS), the need for QUIC-aware load balancing on Connection ID, degraded packet-level observability during incidents, and less mature server/proxy support than battle-tested HTTP/2. Most internal RPC stacks (gRPC on HTTP/2) are already well-optimized for this shape.
>
> My decision: keep HTTP/2 for internal RPC, and target HTTP/3 where it earns its cost — *client-facing* edge traffic over the public internet and mobile, where loss and network changes are common. I'd revisit internal HTTP/3 once tooling and CPU efficiency mature, and only after a benchmark on our actual traffic shows a win. The judgment is matching the protocol's strength (lossy, mobile, connection-migrating clients) to where our traffic actually lives.

**Q24: Given the whole evolution, articulate the through-line: what stayed constant, what changed, and what that teaches about protocol design?**

> The through-line is **stable semantics, evolving transport**. Across 1.1, 2, and 3, the application-visible contract — methods, status codes, headers, URLs, caching semantics — barely moved. Application developers largely didn't rewrite anything. What changed sat entirely below that contract:
>
> - **HTTP/1.1 → HTTP/2**: same transport (TCP), new *representation* — binary framing, multiplexing, HPACK — to fix application-level HOL blocking.
> - **HTTP/2 → HTTP/3**: same representation *idea* (binary, multiplexed, streams), new *transport* (QUIC/UDP) to fix the TCP-level HOL blocking, handshake latency, and connection fragility that HTTP/2 couldn't touch from inside TCP.
>
> The design lessons:
>
> 1. **Decouple layers so you can evolve one without breaking the others.** Keeping semantics constant is what let each transport revolution ship without rewriting the web.
> 2. **The network ossifies; design for deployability.** QUIC over UDP-in-user-space exists because middleboxes and kernels made changing TCP effectively impossible — the "right" layer isn't the theoretically clean one, it's the one you can actually deploy.
> 3. **Every fix relocates the bottleneck.** HTTP/2 fixed one HOL problem and exposed a deeper one; solving it required going a whole layer down. Good protocol design anticipates that its own success will surface the next constraint.
> 4. **Simplicity beats cleverness at the edges.** Server push (clever, blind) lost to Early Hints (simple, cache-aware). The winning ideas gave control to the party with the information.

---

*Next step:* [WebSockets](../05-websockets/junior.md)
