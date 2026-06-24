# Networking Fundamentals

> Senior-level networking interview questions spanning TCP/IP internals, DNS, HTTP/1-2-3, TLS, load balancing, and sockets, tied to how Go's net and net/http packages behave in production.

**38 questions** across **12 topics** · Level: senior

## Topics

- [OSI vs TCP/IP Model](#osi-vs-tcpip-model) (2)
- [TCP Internals](#tcp-internals) (7)
- [TCP vs UDP and QUIC](#tcp-vs-udp-and-quic) (2)
- [IP, Ports, NAT, MTU](#ip-ports-nat-mtu) (3)
- [DNS](#dns) (4)
- [HTTP/1, HTTP/2, HTTP/3](#http1-http2-http3) (4)
- [HTTP Semantics](#http-semantics) (3)
- [TLS](#tls) (4)
- [Network Load Balancing](#network-load-balancing) (2)
- [Sockets and Go net Internals](#sockets-and-go-net-internals) (3)
- [Proxies and WebSockets](#proxies-and-websockets) (2)
- [Network Debugging](#network-debugging) (2)

---

## OSI vs TCP/IP Model

#### 1. Which layers of the OSI model actually matter day-to-day for a backend engineer, and how do they map onto the TCP/IP model?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `osi`, `tcp-ip`, `layers`, `fundamentals`

The 7-layer OSI model is a teaching abstraction; the 4-layer TCP/IP model is what the internet actually implements. In practice you care about three boundaries. **L3/Network (IP)** decides routing and addressing — relevant for subnets, NAT, MTU. **L4/Transport (TCP/UDP)** gives you ports, reliability, flow/congestion control — this is where connection pooling, TIME_WAIT, and timeouts live. **L7/Application (HTTP, gRPC, DNS)** is where most of your code operates. OSI's session/presentation layers (5/6) collapse into the application layer in TCP/IP — TLS, for example, sits between L4 and L7 and doesn't fit cleanly. The trade-off: OSI's clean separation rarely survives contact with reality (e.g., a L7 load balancer terminates TLS, reads HTTP, and re-establishes L4), so reason about real protocol boundaries, not textbook layers.

**Key points**
- TCP/IP is 4 layers (Link, Internet, Transport, Application); OSI is 7 and mostly pedagogical
- L3=routing/IP, L4=ports/reliability/TCP, L7=app protocols
- OSI session/presentation collapse into TCP/IP application layer
- TLS straddles L4-L7 and breaks the clean layering model

**Follow-ups**
- Where does TLS sit in this model, and why is that ambiguous?
- Why does a L7 load balancer create two separate TCP connections?

---

#### 2. An L7 load balancer 'terminates' a connection. What does that mean at the layer level, and what are the consequences?

*Difficulty:* 🟡 medium  ·  *Tags:* `load-balancing`, `l7`, `proxy`, `termination`

Termination means the LB completes the full L4 (TCP) and often L7 (TLS + HTTP) lifecycle with the client, then opens a *separate* connection to the backend. There is no single end-to-end TCP session; there are two. Consequences: (1) the backend sees the LB's source IP, so client IP must be propagated via `X-Forwarded-For` or PROXY protocol; (2) TLS is decrypted at the LB, so it can route on Host/path/headers but you lose end-to-end encryption unless you re-encrypt to the backend; (3) the LB can pool/reuse backend connections independently of client connections, improving efficiency; (4) timeouts, keep-alive, and HTTP/2 settings are negotiated independently per hop, so an HTTP/2 client to the LB may become HTTP/1.1 to the backend. The trade-off is rich routing and offload versus losing the simple one-connection mental model — debugging requires correlating two connections.

**Key points**
- Termination = LB completes client TCP/TLS/HTTP, opens separate backend connection
- Client IP lost unless forwarded via X-Forwarded-For or PROXY protocol
- TLS decrypted at LB — re-encrypt for end-to-end security
- Protocol can differ per hop (HTTP/2 front, HTTP/1.1 back)

**Follow-ups**
- How does the PROXY protocol differ from X-Forwarded-For?
- When would you prefer an L4 (pass-through) LB instead?

---

## TCP Internals

#### 3. Walk through the TCP 3-way handshake and the 4-way close. Why is close 4 segments but open is 3?

*Difficulty:* 🟡 medium  ·  *Tags:* `tcp`, `handshake`, `fin`, `connection-lifecycle`

**Open (3-way):** client sends SYN (seq=x), server replies SYN-ACK (seq=y, ack=x+1), client sends ACK (ack=y+1). Three segments suffice because the server can piggyback its SYN onto the ACK of the client's SYN — both directions' sequence numbers get synchronized together. **Close (4-way):** each direction is closed independently because TCP is full-duplex. The active closer sends FIN, the peer ACKs it (its receive side now half-closed), but the peer may still have data to send. When the peer is done it sends its own FIN, which the original closer ACKs. The server *can't* merge its FIN with the ACK the way the SYN-ACK merged, because it generally still has data or buffered writes to flush — the application hasn't called close yet. That asymmetry is why close needs 4 segments (though a FIN+ACK can sometimes coalesce, making it appear as 3).

**Key points**
- Open: SYN -> SYN-ACK -> ACK; server merges SYN into the ACK
- Close: FIN/ACK in each direction independently (full-duplex half-close)
- Server can't merge its FIN because it may still be sending data
- Sequence numbers are synchronized in both directions during open

**Follow-ups**
- What is a half-closed connection and when is it useful?
- What happens if the final ACK in the handshake is lost?

---

#### 4. What is TIME_WAIT, why does it exist, and how would you diagnose a server drowning in TIME_WAIT sockets?

*Difficulty:* 🟠 hard  ·  *Tags:* `tcp`, `time-wait`, `port-exhaustion`, `tuning`

TIME_WAIT is a state the **active closer** enters after sending the final ACK, lasting 2*MSL (typically 60s on Linux). It exists for two reasons: (1) to ensure the final ACK reaches the peer — if it's lost, the peer retransmits its FIN and TIME_WAIT lets us re-ACK; (2) to prevent delayed segments from an old connection being misinterpreted by a new connection reusing the same 4-tuple. The pain: a high-throughput client (or a server that actively closes) exhausts ephemeral ports because each closed connection holds a port for 60s. Diagnose with `ss -tan state time-wait | wc -l` and check `net.ipv4.ip_local_port_range`. Fixes: enable connection reuse/keep-alive so you close far fewer connections (the real fix); set `SO_REUSEADDR`; enable `tcp_tw_reuse` (safe, uses timestamps) — avoid the removed `tcp_tw_recycle`. In Go, the usual root cause is not reusing `http.Transport`, so reuse it.

**Key points**
- Active closer enters TIME_WAIT for 2*MSL (~60s on Linux)
- Purpose: re-ACK lost final ACK + block stale segments on reused 4-tuple
- Ephemeral port exhaustion is the production symptom
- Real fix is keep-alive/connection reuse, not just tcp_tw_reuse


```
// Diagnose:
//   ss -tan state time-wait | wc -l
//   cat /proc/sys/net/ipv4/ip_local_port_range
//   sysctl net.ipv4.tcp_tw_reuse
//
// Go fix: share one Transport so connections are pooled, not churned.
var client = &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 100, // default is 2 — raise for fan-out
        IdleConnTimeout:     90 * time.Second,
    },
}
```

**Follow-ups**
- Why is tcp_tw_recycle dangerous behind NAT?
- Would moving the active close to the client side help?

---

#### 5. Explain TCP flow control vs congestion control. They both throttle the sender — what's the difference?

*Difficulty:* 🟠 hard  ·  *Tags:* `tcp`, `flow-control`, `congestion-control`, `windows`

Both limit how much the sender transmits, but they protect different resources. **Flow control** protects the *receiver*: the receiver advertises a receive window (rwnd) in every ACK indicating buffer space available. The sender never sends more unacked data than rwnd. This is end-to-end and explicit. Window scaling (RFC 1323) lets rwnd exceed 64KB for high bandwidth-delay-product links. **Congestion control** protects the *network*: the sender maintains a congestion window (cwnd) inferred from loss/delay signals, since the network gives no explicit credit. The effective send window is `min(rwnd, cwnd)`. The trade-off and key insight: flow control is precise (receiver tells you exactly), congestion control is a guess based on feedback (packet loss in Reno/CUBIC, RTT increase in BBR). A small receive buffer caps throughput regardless of network capacity — common cause of 'fast network, slow transfer' bugs.

**Key points**
- Flow control (rwnd) protects the receiver's buffer; advertised in ACKs
- Congestion control (cwnd) protects the network; inferred, not advertised
- Effective window = min(rwnd, cwnd)
- Window scaling needed for high bandwidth-delay-product links

**Follow-ups**
- What is the bandwidth-delay product and why does it cap throughput?
- How does BBR differ from loss-based CUBIC?

---

#### 6. Describe TCP slow start and AIMD (additive-increase/multiplicative-decrease). Why this shape?

*Difficulty:* 🟠 hard  ·  *Tags:* `tcp`, `slow-start`, `aimd`, `congestion-control`

A new connection has no idea of available bandwidth, so it probes. **Slow start:** cwnd starts small (often 10 MSS, IW10) and *doubles* every RTT (exponential) until it hits ssthresh or detects loss. Despite the name it ramps aggressively. **Congestion avoidance / AIMD:** past ssthresh, cwnd grows *additively* (+1 MSS per RTT) — cautious probing. On loss, cwnd is cut *multiplicatively* (halved in Reno) and ssthresh updated. The asymmetry (slow add, fast cut) is what makes TCP stable and fair: multiplicative decrease responds quickly to congestion to drain queues, additive increase shares freed capacity fairly among flows. The practical consequence for backends: short connections (a single small HTTP request) often finish *before* slow start ramps up, so they never reach line rate — another reason connection reuse matters, since an established connection retains its cwnd and starts fast.

**Key points**
- Slow start: cwnd doubles per RTT (exponential) from IW10 until loss/ssthresh
- AIMD: +1 MSS/RTT additive growth, halved on loss (multiplicative)
- Asymmetry gives stability and fairness across competing flows
- Short connections die in slow start — reuse keeps a warm cwnd

**Follow-ups**
- How does fast retransmit/fast recovery avoid restarting slow start?
- Why does HTTP/2's single warm connection beat HTTP/1.1's many cold ones?

---

#### 7. What is TCP head-of-line blocking, and how does it manifest in HTTP/2 specifically?

*Difficulty:* 🟠 hard  ·  *Tags:* `tcp`, `head-of-line`, `http2`, `quic`

TCP delivers a single in-order byte stream. If one segment is lost, every byte *after* it must wait in the kernel buffer until that segment is retransmitted and arrives — even bytes that belong to logically independent data. That's head-of-line (HoL) blocking, and it's a property of the transport, not the application. **In HTTP/2:** the protocol multiplexes many streams over one TCP connection. At the HTTP layer there's no HoL blocking — frames interleave. But because all streams ride one TCP connection, a single lost TCP segment stalls *every* multiplexed stream until recovery, even though they're independent. So HTTP/2 traded HTTP-level HoL (HTTP/1.1's serialized requests per connection) for transport-level HoL that's *worse* on lossy networks because one loss now affects N streams. This is precisely why HTTP/3 moved to QUIC over UDP: QUIC gives each stream independent loss recovery, so a lost packet only blocks its own stream.

**Key points**
- TCP's in-order byte stream means one lost segment blocks all bytes after it
- HTTP/2 removes HTTP-layer HoL but inherits TCP-layer HoL on its single connection
- One lost segment stalls ALL multiplexed HTTP/2 streams
- HTTP/3 / QUIC fixes this with per-stream independent recovery

**Follow-ups**
- Why does QUIC's per-stream delivery avoid this?
- On a clean low-loss network, does HTTP/2 HoL even matter?

---

#### 8. What is Nagle's algorithm, how does it interact with delayed ACKs, and when do you disable it in Go?

*Difficulty:* 🟡 medium  ·  *Tags:* `tcp`, `nagle`, `tcp-nodelay`, `latency`, `go`

Nagle's algorithm reduces tiny-packet overhead: it withholds sending a small segment while there's unacknowledged data in flight, coalescing small writes into fewer, larger packets. Great for bulk throughput, bad for latency-sensitive request/response. The classic pathology is **Nagle + delayed ACK**: the receiver delays its ACK (up to ~40-200ms) hoping to piggyback it on response data, while the sender (Nagle) won't send the next small chunk until it gets that ACK — a deadlock-like stall of tens of milliseconds. Symptom: a chatty protocol that mysteriously pauses ~40ms per round. Fix: disable Nagle with `TCP_NODELAY`. In Go, `net.TCPConn.SetNoDelay(true)` does this, and notably Go's standard library sets `TCP_NODELAY` by default on accepted/dialed TCP connections — so http servers/clients already have Nagle off. You'd only re-enable Nagle (`SetNoDelay(false)`) for a bulk-transfer socket where you want coalescing.

**Key points**
- Nagle coalesces small writes while unacked data is in flight (throughput over latency)
- Nagle + delayed ACK can cause ~40ms stalls in request/response patterns
- TCP_NODELAY disables it; Go sets it by default on TCP conns
- net.TCPConn.SetNoDelay controls it explicitly


```go
tcpConn := conn.(*net.TCPConn)
_ = tcpConn.SetNoDelay(true)  // disable Nagle (Go default for net/http)
// SetNoDelay(false) re-enables coalescing for bulk transfers
```

**Follow-ups**
- Why does Go disable Nagle by default for HTTP?
- What does TCP_CORK do and how is it different?

---

#### 9. Distinguish TCP keep-alive from HTTP keep-alive. They sound the same but solve different problems.

*Difficulty:* 🟡 medium  ·  *Tags:* `tcp`, `keep-alive`, `http`, `go`, `transport`

Different layers, different jobs. **TCP keep-alive** (SO_KEEPALIVE) is an L4 mechanism: the kernel sends empty probe segments on an *idle* connection to detect a dead peer (crashed host, pulled cable, dead NAT mapping). Default idle is ~2 hours — far too long to be useful by default; you tune `tcp_keepalive_time/intvl/probes`. Its purpose is liveness detection and keeping NAT/firewall mappings warm. **HTTP keep-alive** (a.k.a. persistent connections) is an L7 concept: after an HTTP response, the TCP connection is *not* closed so the next request reuses it, avoiding a fresh handshake and slow-start. Controlled by the `Connection: keep-alive` header (default in HTTP/1.1) and `Keep-Alive` timeout hints. In Go, `http.Transport` manages HTTP keep-alive via its idle connection pool, while `net.Dialer.KeepAlive` configures the TCP-level probes. Confusing them leads to setting the wrong knob when connections go stale.

**Key points**
- TCP keep-alive (L4): kernel probes to detect dead peers and hold NAT mappings
- HTTP keep-alive (L7): reuse the TCP connection for multiple requests
- Default TCP keep-alive idle is ~2h — usually must be tuned
- Go: net.Dialer.KeepAlive (TCP) vs http.Transport idle pool (HTTP)


```go
d := &net.Dialer{KeepAlive: 30 * time.Second} // TCP-level probes
tr := &http.Transport{
    DialContext:     d.DialContext,
    IdleConnTimeout: 90 * time.Second, // HTTP-level idle reuse window
}
```

**Follow-ups**
- Why might an idle HTTP/1.1 connection be closed by a proxy mid-reuse?
- How do you tune TCP keep-alive to detect a dead peer in 30s?

---

## TCP vs UDP and QUIC

#### 10. When do you choose UDP over TCP? Give concrete senior-level examples and the trade-offs you accept.

*Difficulty:* 🟡 medium  ·  *Tags:* `udp`, `tcp`, `protocol-choice`, `real-time`

Choose UDP when you can tolerate (or want to control) loss and ordering yourself, and the per-packet handshake/ordering cost of TCP hurts. **Examples:** real-time media (VoIP, video) — a late packet is useless, so retransmission only adds latency; DNS — single small request/response where a TCP handshake would triple the round trips; QUIC/HTTP/3 — builds its own reliability over UDP; gaming and telemetry where freshest data beats complete data; multicast (TCP can't multicast). **Trade-offs you accept:** no built-in reliability, ordering, flow/congestion control, or connection state — you implement what you need. UDP is also a DDoS amplification vector and is more likely to be rate-limited or blocked by middleboxes. TCP remains the default for anything needing reliable, ordered, congestion-friendly byte streams (most APIs). The senior framing: 'TCP gives you a reliable stream you can't tune; UDP gives you a datagram you must build on.'

**Key points**
- UDP for real-time media, DNS, QUIC, gaming, multicast
- You trade away reliability/ordering/congestion control for control + low latency
- UDP is an amplification/DDoS vector and more often blocked by middleboxes
- TCP is the default for reliable ordered streams (most APIs)

**Follow-ups**
- Why does DNS fall back to TCP for large responses?
- How does QUIC reimplement TCP-like guarantees over UDP?

---

#### 11. QUIC sits on top of UDP yet provides reliability. What does it improve over TCP+TLS, and what does it cost?

*Difficulty:* 🔴 staff  ·  *Tags:* `quic`, `http3`, `udp`, `tls`, `connection-migration`

QUIC reimplements connection state, reliability, congestion control, and TLS 1.3 in user space over UDP. Improvements: (1) **no transport HoL blocking** — independent streams have independent loss recovery, so one lost packet doesn't stall other streams (TCP can't do this); (2) **0-RTT / 1-RTT connection setup** — QUIC merges the transport and TLS handshakes, so a fresh connection is 1-RTT and a resumed one can be 0-RTT, versus TCP (1 RTT) + TLS 1.3 (1 RTT) = 2 RTT; (3) **connection migration** — a connection is identified by a Connection ID, not the 4-tuple, so it survives IP changes (Wi-Fi to cellular) without re-handshaking; (4) faster protocol evolution since it lives in user space, not the kernel/middleboxes. Costs: higher CPU (user-space crypto and packet handling, no kernel/NIC offload historically), UDP is sometimes blocked or deprioritized, observability tooling is younger, and amplification protections add complexity. It's the foundation of HTTP/3.

**Key points**
- Per-stream loss recovery eliminates TCP's transport-level HoL blocking
- Combined transport+TLS handshake: 1-RTT new, 0-RTT resumed (vs ~2-RTT for TCP+TLS)
- Connection ID enables seamless connection migration across IP changes
- Costs: more CPU, fewer offloads, UDP blocking, immature tooling

**Follow-ups**
- What replay risks come with QUIC/TLS 0-RTT data?
- Why was QUIC built in user space rather than as a kernel protocol?

---

## IP, Ports, NAT, MTU

#### 12. What uniquely identifies a TCP connection, and why does that matter for client-side scaling?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `ip`, `ports`, `4-tuple`, `scaling`

A TCP connection is identified by a 4-tuple: (source IP, source port, destination IP, destination port). On the server side this rarely limits you — many clients connect to one (IP, port), and each client supplies a distinct source IP/port, so the server can hold huge numbers of connections (limited by memory/fds, not the tuple). On the **client side**, when you open many connections to the *same* server (same dest IP+port) from one source IP, the only varying field is your source (ephemeral) port. That space is bounded (`ip_local_port_range`, ~28k by default), and TIME_WAIT holds ports for ~60s after close. So a single client machine hammering one backend can exhaust ephemeral ports — the classic source of 'cannot assign requested address' errors. Mitigations: connection reuse/keep-alive (fewer closes), more source IPs, widening the port range, or `tcp_tw_reuse`. This is why a shared, reused `http.Transport` matters so much in Go.

**Key points**
- Connection = (src IP, src port, dst IP, dst port) 4-tuple
- Server side rarely tuple-limited; client side is
- Same client->same server varies only the ephemeral source port
- Port exhaustion -> reuse connections, add IPs, widen range

**Follow-ups**
- Why doesn't the server run out of the same way?
- How does NAT change the visible source port?

---

#### 13. Explain NAT and why it complicates long-lived and inbound connections.

*Difficulty:* 🟡 medium  ·  *Tags:* `nat`, `ports`, `keep-alive`, `p2p`

NAT (Network Address Translation) maps many private addresses behind one public IP by rewriting source IP/port on outbound packets and keeping a translation table to reverse it on the return. It's why IPv4 still functions despite exhaustion. Complications: (1) **inbound connections** are impossible without explicit port forwarding or hole-punching, because the NAT has no table entry for an unsolicited inbound packet — this breaks peer-to-peer and is why you need STUN/TURN/ICE; (2) **idle timeouts** — NAT mappings expire (often 30s-5min for UDP, longer for TCP), so a long-lived idle connection silently dies; the fix is application or TCP keep-alives to keep the mapping warm; (3) **the same public IP** is shared by many clients, so server-side rate limiting or `tcp_tw_recycle` (which keyed on source IP) misbehaves badly behind NAT. For backends, the practical takeaways are: don't trust source IP as identity, and send keep-alives on long-lived idle connections.

**Key points**
- NAT rewrites src IP/port and tracks a translation table
- Inbound/P2P needs port forwarding or STUN/TURN hole-punching
- Idle NAT mappings expire — keep-alives keep them warm
- Shared public IP breaks IP-based rate limiting and tcp_tw_recycle

**Follow-ups**
- What problem does CGNAT add on top of home NAT?
- How do keep-alive intervals relate to NAT timeout windows?

---

#### 14. What is MTU and path MTU discovery, and how does a 'PMTU black hole' cause hangs that look random?

*Difficulty:* 🟠 hard  ·  *Tags:* `mtu`, `pmtud`, `fragmentation`, `debugging`

MTU (Maximum Transmission Unit) is the largest L2 frame payload a link carries — typically 1500 bytes on Ethernet. TCP negotiates an MSS (~MTU minus IP/TCP headers, ~1460) so segments fit without IP fragmentation. **Path MTU Discovery (PMTUD)** finds the smallest MTU along the whole path: the sender sets the IP Don't-Fragment bit; a router with a smaller MTU drops the packet and returns ICMP 'fragmentation needed', telling the sender to shrink. **Black hole:** if a firewall blocks those ICMP messages (a common misconfiguration), the sender keeps sending too-large DF packets that get silently dropped with no feedback. Symptom: the handshake (small packets) succeeds, then large transfers — a big POST body, a TLS certificate — hang or stall mysteriously, often only on certain paths (VPNs, tunnels with lower MTU like 1400). Fixes: allow ICMP type 3 code 4, or use MSS clamping on the gateway to advertise a smaller MSS. This is a frequent cause of 'small requests work, large ones time out.'

**Key points**
- MTU = max L2 payload (1500 on Ethernet); MSS = MTU minus headers
- PMTUD uses DF bit + ICMP 'fragmentation needed' to find smallest path MTU
- Blocking that ICMP causes a black hole: large DF packets dropped silently
- Symptom: handshake OK, large transfers hang; fix via ICMP allow or MSS clamping

**Follow-ups**
- Why do VPNs and tunnels commonly trigger this?
- How does MSS clamping avoid relying on ICMP?

---

## DNS

#### 15. Trace a full DNS resolution for api.example.com and distinguish recursive from iterative resolution.

*Difficulty:* 🟡 medium  ·  *Tags:* `dns`, `resolution`, `recursive`, `iterative`

Your app calls the **stub resolver** (in Go, often the pure-Go resolver or libc), which asks a **recursive resolver** (e.g. 8.8.8.8 or your ISP's). The recursive resolver does the legwork **iteratively**: it asks a root server, which returns a referral to the `.com` TLD servers (NS records); it asks a TLD server, which referrals to example.com's authoritative servers; it asks the authoritative server, which returns the A/AAAA record. Each of those steps is *iterative* — each server answers 'I don't know, ask them' rather than chasing it themselves. The recursive resolver does this chasing on your behalf — that's the *recursive* part — then caches the answer per its TTL and returns it. So the client experiences one recursive query; the resolver performs several iterative queries. Caching at every level (stub, recursive, OS) is what keeps DNS fast and the root servers from melting. The trade-off: caching means propagation delays — a changed record isn't seen until TTLs expire.

**Key points**
- Stub -> recursive resolver -> root -> TLD -> authoritative
- Recursive resolver does iterative queries on the client's behalf
- Iterative = referrals ('ask them'); recursive = 'I'll chase it and answer'
- Caching at each layer per TTL; trade-off is propagation delay

**Follow-ups**
- Where does negative caching (NXDOMAIN) fit in?
- Why does a low TTL increase resolver load but speed failover?

---

#### 16. Compare A, AAAA, CNAME, and SRV records, and name a footgun with CNAME at the zone apex.

*Difficulty:* 🟡 medium  ·  *Tags:* `dns`, `records`, `cname`, `srv`

**A** maps a name to an IPv4 address; **AAAA** to an IPv6 address. **CNAME** is an alias — it points one name to *another name*, and resolution then continues from that target. **SRV** advertises a service's host *and port* (plus priority/weight), used by protocols like SIP, XMPP, and Kubernetes service discovery, letting clients discover where a service runs without hardcoding ports. Key CNAME footgun: a CNAME cannot coexist with other records on the same name, and **the zone apex** (e.g. `example.com` itself) must carry SOA and NS records — so you legally cannot put a CNAME at the apex. That breaks the common desire to alias `example.com` to a load balancer's hostname. Workarounds: provider-specific ALIAS/ANAME/flattened records that resolve the target to A/AAAA at query time, or just use A records. Also, every CNAME adds a resolution hop, so deep CNAME chains add latency.

**Key points**
- A=IPv4, AAAA=IPv6, CNAME=alias to another name, SRV=host+port+priority/weight
- SRV powers service discovery (Kubernetes, SIP, XMPP)
- CNAME can't coexist with other records and is illegal at the zone apex
- Use ALIAS/ANAME or A records to point an apex at a load balancer

**Follow-ups**
- How does Kubernetes use SRV records for headless services?
- Why do CNAME chains add latency and how deep is too deep?

---

#### 17. How is DNS used for load balancing, and what are its limitations versus a real load balancer?

*Difficulty:* 🟠 hard  ·  *Tags:* `dns`, `load-balancing`, `ttl`, `geodns`

DNS load balancing returns multiple A/AAAA records (or rotates them) so clients spread across IPs — round-robin DNS — or returns different answers by geography/latency (GeoDNS, anycast-backed) to steer clients to the nearest region. It's cheap, requires no data-path infrastructure, and works for any protocol. **Limitations:** (1) **caching defeats agility** — resolvers and OSes cache per TTL (and some ignore low TTLs), so removing a dead host from rotation can take minutes; DNS is a poor failover mechanism on its own; (2) **no health awareness** by default — plain round-robin happily hands out a dead IP unless paired with health-checked DNS; (3) **uneven distribution** — clients cache one answer and reuse it, and a recursive resolver fronts many users, so 'balance' is coarse; (4) **no L7 routing** — DNS can't route by path/header or terminate TLS. So DNS is great for coarse, geographic, first-hop distribution, but you put a real L4/L7 load balancer behind the DNS name for fine-grained, health-aware, fast-failover balancing.

**Key points**
- Round-robin / GeoDNS returns multiple or location-specific records
- Cheap, protocol-agnostic, no data-path infra
- Caching/TTL makes failover slow; no built-in health checks
- Coarse distribution and no L7 routing — pair with a real LB

**Follow-ups**
- How does health-checked DNS (e.g. Route 53) mitigate dead hosts?
- Why is anycast better than GeoDNS for some latency-routing cases?

---

#### 18. In Go, what surprises engineers about DNS resolution and TTL caching in net/http?

*Difficulty:* 🟠 hard  ·  *Tags:* `dns`, `go`, `transport`, `ttl`, `caching`

Go has *two* resolvers selectable via `GODEBUG=netdns=...`: the pure-Go resolver and the cgo/libc one. The big surprise: **Go's standard library does not cache DNS by itself and does not honor record TTLs** — it relies on the OS/recursive resolver for caching. A related and more dangerous surprise: by default `http.Transport` keeps connections alive and pooled, so once it has dialed an IP it *keeps reusing that connection*, ignoring later DNS changes. If a backend's IP changes (a blue/green deploy, an autoscaled LB), a long-lived Go service can keep talking to the old IP until those connections close. Mitigations: set a sane `IdleConnTimeout` and `MaxConnsPerHost`/connection lifetime so connections re-dial periodically, or implement a custom `DialContext` that re-resolves and rotates. People often reach for a caching resolver expecting TTL respect; the real fix for IP-change agility is bounding connection lifetime, not DNS caching.

**Key points**
- GODEBUG=netdns selects pure-Go vs cgo/libc resolver
- Go stdlib doesn't cache DNS or honor TTLs — OS does the caching
- http.Transport reuses pooled connections, ignoring later DNS changes
- Fix IP-change agility with connection lifetime limits, not DNS caching


```go
// Force re-dial periodically so DNS changes are picked up.
tr := &http.Transport{
    MaxConnsPerHost: 0,
    IdleConnTimeout: 30 * time.Second,
}
// Or rotate via a custom DialContext that re-resolves and dials a fresh IP.
// GODEBUG=netdns=go forces the pure-Go resolver; netdns=cgo uses libc.
```

**Follow-ups**
- When would you embed a caching DNS resolver in front of Go?
- How would you force per-request re-resolution for a flaky backend?

---

## HTTP/1, HTTP/2, HTTP/3

#### 19. What changed from HTTP/1.0 to HTTP/1.1, and why was pipelining a failure in practice?

*Difficulty:* 🟡 medium  ·  *Tags:* `http1`, `persistent-connections`, `pipelining`, `keep-alive`

HTTP/1.0 opened a new TCP connection per request and closed it after the response — every request paid a fresh handshake and slow-start. **HTTP/1.1** made **persistent connections** the default (`Connection: keep-alive`), reusing one TCP connection for many sequential request/response pairs, which dramatically cut latency and connection churn. It also added the `Host` header (enabling virtual hosting), chunked transfer encoding, and better caching. **Pipelining** let a client send multiple requests without waiting for each response, but it failed in practice because: responses must come back *in request order* over one connection, so a slow first response blocks all the queued ones — application-level head-of-line blocking. Buggy proxies mishandled it, and browsers disabled it. The real-world workaround was opening 6 parallel connections per host, which wastes resources and fights congestion control. HTTP/2's multiplexing is the proper fix for what pipelining tried and failed to do.

**Key points**
- 1.0 = one connection per request; 1.1 = persistent connections by default
- 1.1 added Host header, chunked encoding, better caching
- Pipelining required in-order responses -> HoL blocking; proxies broke it
- Browsers used ~6 parallel connections instead; HTTP/2 multiplexing replaced it

**Follow-ups**
- Why does the Host header make virtual hosting possible?
- How does chunked transfer encoding stream without Content-Length?

---

#### 20. Explain HTTP/2 multiplexing, HPACK header compression, and why it uses a single connection.

*Difficulty:* 🟠 hard  ·  *Tags:* `http2`, `multiplexing`, `hpack`, `compression`

HTTP/2 is binary and frames everything. **Multiplexing:** many independent *streams* (each a request/response) interleave their frames over one TCP connection, each with a stream ID, so a slow response no longer blocks others at the HTTP layer — solving HTTP/1.1's serialization without 6 parallel sockets. **HPACK:** HTTP headers are hugely repetitive (same cookies, user-agent, etc. on every request); HPACK compresses them with a static table of common headers plus a dynamic per-connection table so repeated headers cost a few bytes, with Huffman coding for the rest. It's designed to resist the CRIME compression attack by not blindly compressing across security boundaries. **Single connection** is deliberate: one warm connection keeps a single congestion window that ramps once and stays warm, plays nicely with the network, and HPACK's dynamic table benefits from request locality. The catch (covered separately) is TCP-level head-of-line blocking — one lost segment stalls all streams — which HTTP/3 addresses.

**Key points**
- Binary framing; many streams multiplexed over one TCP connection
- Multiplexing removes HTTP-layer HoL without parallel sockets
- HPACK = static + dynamic header tables + Huffman; CRIME-resistant
- Single warm connection keeps one congestion window; downside is TCP HoL

**Follow-ups**
- Why was HTTP/2 server push deprecated?
- How does HTTP/2 flow control work per-stream and per-connection?

---

#### 21. HTTP/2 server push was supposed to be a big win. Why was it deprecated, and what replaced it?

*Difficulty:* 🔴 staff  ·  *Tags:* `http2`, `server-push`, `early-hints`, `preload`

Server push let a server proactively send resources (e.g. CSS/JS) it predicted the client would request after the HTML, without waiting for the request — saving a round trip. In practice it was deprecated (Chrome removed support; many servers dropped it) because: (1) **the server usually pushed things the client already had cached**, wasting bandwidth — the server can't reliably know the client's cache state; (2) **it competed with the actual HTML for the connection's bandwidth and congestion window**, sometimes making the page *slower*; (3) it was complex to implement correctly with cache digests, which never gained traction; (4) the latency it saved was modest versus the waste. The replacement is **103 Early Hints** plus `<link rel=preload>`: the server sends a cheap 103 informational response listing resources to preload, and the *client* decides whether to fetch them (respecting its own cache). That keeps the cache-awareness on the side that actually has the cache, which is the core lesson.

**Key points**
- Push proactively sent resources to save a round trip
- Failed: server can't know client cache, pushed redundant bytes
- Competed with HTML for bandwidth/cwnd, sometimes slower
- Replaced by 103 Early Hints + rel=preload — client decides

**Follow-ups**
- How does 103 Early Hints interact with proxies and HTTP/1.1 clients?
- Why does keeping cache decisions client-side matter generally?

---

#### 22. What does HTTP/3 change versus HTTP/2, and what operational considerations come with adopting it?

*Difficulty:* 🟠 hard  ·  *Tags:* `http3`, `quic`, `qpack`, `alt-svc`

HTTP/3 keeps HTTP/2's semantics (multiplexed streams, header compression via QPACK instead of HPACK) but runs over **QUIC/UDP instead of TCP/TLS**. The headline win is eliminating **transport-level head-of-line blocking**: QUIC streams have independent loss recovery, so one lost packet only blocks its own stream — a big improvement on lossy/mobile networks where HTTP/2's single TCP connection suffered. It also gets faster (0/1-RTT) connection setup and connection migration across IP changes. **Operational considerations:** (1) UDP must be allowed and may be deprioritized by middleboxes, so you keep HTTP/2 as a fallback (clients discover HTTP/3 via the `Alt-Svc` header); (2) higher CPU due to user-space crypto/packet handling and fewer kernel/NIC offloads; (3) observability tooling (tcpdump filters, load-balancer support, WAFs) is younger; (4) load balancers must understand QUIC and connection IDs to route migrating connections. So adopt HTTP/3 with HTTP/2 fallback and validate your LB/observability stack first.

**Key points**
- Same HTTP/2 semantics but over QUIC/UDP, QPACK instead of HPACK
- Eliminates transport-level HoL via per-stream recovery — wins on lossy networks
- Adds 0/1-RTT setup and connection migration
- Ops: Alt-Svc fallback to HTTP/2, more CPU, younger tooling, QUIC-aware LBs

**Follow-ups**
- How does Alt-Svc advertise and discover HTTP/3?
- Why is QPACK designed differently from HPACK for QUIC's out-of-order delivery?

---

## HTTP Semantics

#### 23. Define HTTP method safety vs idempotency, and why both matter for retries and proxies.

*Difficulty:* 🟡 medium  ·  *Tags:* `http`, `idempotency`, `safety`, `retries`, `go`

**Safe** methods (GET, HEAD, OPTIONS) are read-only — they shouldn't change server state, so caches and prefetchers can call them freely. **Idempotent** methods produce the same end state whether called once or N times: GET, HEAD, PUT, DELETE, OPTIONS are idempotent; **POST is neither safe nor idempotent**, and PATCH generally isn't either. Why it matters: (1) **Retries** — clients, proxies, and load balancers will automatically retry idempotent requests on a timeout or network error, but retrying a non-idempotent POST risks duplicate side effects (double charge, double order). So you design POSTs with **idempotency keys** so a retried POST is deduplicated server-side. (2) **Caching/proxies** assume safe methods are cacheable and won't cache or replay unsafe ones. (3) In Go, `http.Transport` will automatically retry idempotent requests once if a pooled connection turns out to be dead, but it won't retry requests with a body it can't rewind or non-idempotent methods — which is why intermittent POST failures sometimes surface that GETs don't.

**Key points**
- Safe = no state change (GET/HEAD/OPTIONS); idempotent = same state after N calls
- PUT/DELETE idempotent; POST/PATCH typically neither
- Idempotent requests are safe to auto-retry; POST needs idempotency keys
- Go's Transport auto-retries idempotent requests on dead pooled conns, not POSTs

**Follow-ups**
- How would you implement an idempotency key for a payments POST?
- Why can Go's Transport not safely retry a streaming request body?

---

#### 24. Explain HTTP caching with Cache-Control and ETag, including conditional revalidation.

*Difficulty:* 🟠 hard  ·  *Tags:* `http`, `caching`, `etag`, `cache-control`

**Cache-Control** governs freshness. `max-age=N` makes a response fresh for N seconds (served from cache with no network); `no-cache` means cache it but *revalidate before use*; `no-store` means never cache; `private` vs `public` controls shared-cache (CDN/proxy) eligibility; `immutable` promises it never changes within its lifetime. Once a cached response is **stale**, the client doesn't blindly refetch — it **revalidates** conditionally. **ETag** is an opaque validator (often a content hash): the server sends `ETag: "abc"`, and on revalidation the client sends `If-None-Match: "abc"`. If unchanged, the server returns **304 Not Modified** with no body — saving bandwidth while confirming freshness. `Last-Modified` + `If-Modified-Since` is the time-based equivalent (weaker, 1-second granularity). The senior trade-off: aggressive `max-age` cuts latency and origin load but risks serving stale content, so the common pattern is long max-age on content-hashed/immutable asset URLs (cache-busting via the URL) and short max-age + ETag revalidation on mutable resources. `Vary` tells caches which request headers (e.g. Accept-Encoding) make responses distinct.

**Key points**
- Cache-Control: max-age/no-cache/no-store/private/public/immutable
- ETag + If-None-Match -> 304 Not Modified for cheap revalidation
- Last-Modified/If-Modified-Since is the weaker time-based validator
- Pattern: immutable hashed URLs (long max-age) + ETag for mutable resources; Vary for content negotiation


```go
func handler(w http.ResponseWriter, r *http.Request) {
    etag := `"v3-abc123"`
    if match := r.Header.Get("If-None-Match"); match == etag {
        w.WriteHeader(http.StatusNotModified) // 304, no body
        return
    }
    w.Header().Set("ETag", etag)
    w.Header().Set("Cache-Control", "public, max-age=60")
    // ... write body
}
```

**Follow-ups**
- What is stale-while-revalidate and why is it useful?
- Why must you set Vary: Accept-Encoding when serving gzip?

---

#### 25. A junior reaches for 200 for everything. Walk through choosing status codes correctly, including the tricky ones.

*Difficulty:* 🟡 medium  ·  *Tags:* `http`, `status-codes`, `semantics`, `api-design`

Status codes carry machine-readable semantics that caches, proxies, retry logic, and clients depend on — overloading 200 breaks all of them. **2xx success:** 200 OK, 201 Created (return `Location`), 202 Accepted (async, not yet done), 204 No Content. **3xx redirect:** 301 permanent vs 302/307 temporary; 304 Not Modified (revalidation). **4xx client error:** 400 malformed, 401 Unauthenticated (you don't know who they are — send `WWW-Authenticate`), 403 Forbidden (we know who you are, you can't), 404 Not Found, 409 Conflict, 422 Unprocessable Entity (well-formed but semantically invalid), 429 Too Many Requests (send `Retry-After`). **5xx server error:** 500 generic, 502 Bad Gateway (bad upstream response), 503 Service Unavailable (overloaded/down, often with `Retry-After`), 504 Gateway Timeout (upstream too slow). The senior distinctions that matter: 401 vs 403 (auth vs authz), 502 vs 503 vs 504 (which hop failed), and never returning 200 with an error body — it defeats client retry/alerting and load-balancer health checks.

**Key points**
- Status codes drive caching, retries, and LB health checks — don't overload 200
- 401 (who are you?) vs 403 (you can't) — auth vs authz
- 422 (semantically invalid) vs 400 (malformed); 429 with Retry-After
- 502 (bad upstream response) vs 503 (down/overloaded) vs 504 (upstream timeout)

**Follow-ups**
- When is 307/308 required instead of 301/302 for non-GET methods?
- Why is returning 200 with {"error":...} an anti-pattern?

---

## TLS

#### 26. Walk through the TLS 1.3 handshake and explain how it improved on TLS 1.2.

*Difficulty:* 🟠 hard  ·  *Tags:* `tls`, `handshake`, `forward-secrecy`, `tls13`

TLS 1.2 needed **two round trips**: ClientHello/ServerHello to negotiate cipher suite, then a key exchange exchange before encrypted data flowed. TLS 1.3 cut this to **one RTT** and tightened security. Flow: the client sends ClientHello already including its key share (guessing the group, e.g. X25519) and supported parameters; the server replies ServerHello with its key share, certificate, and Finished — all subsequent data is encrypted. Both sides derive the same shared secret via (EC)DHE, so application data flows after one round trip. Improvements: (1) **1-RTT** (and 0-RTT resumption for repeat connections); (2) **removed legacy crypto** — no RSA key transport (which lacked forward secrecy), no CBC/RC4, no static keys — every handshake now has **forward secrecy** by mandating ephemeral DH, so compromising the server's long-term key doesn't decrypt past traffic; (3) fewer negotiable knobs means fewer downgrade/footgun attacks; (4) most of the handshake is encrypted, hiding the certificate from passive eavesdroppers. Go enables TLS 1.3 by default in modern versions via `crypto/tls`.

**Key points**
- TLS 1.3 = 1-RTT (vs 2-RTT in 1.2) by sending key share in ClientHello
- Mandatory forward secrecy via ephemeral (EC)DHE; no RSA key transport
- Removed weak ciphers (RC4, CBC, static keys) — smaller attack surface
- Encrypts most of the handshake incl. certificate; 0-RTT for resumption

**Follow-ups**
- Why is forward secrecy worth the extra DH computation?
- What replay risk does TLS 1.3 0-RTT introduce and how is it mitigated?

---

#### 27. Explain certificate chain of trust and SNI. How does a server present the right cert for many domains on one IP?

*Difficulty:* 🟠 hard  ·  *Tags:* `tls`, `certificates`, `sni`, `chain-of-trust`

**Chain of trust:** a leaf certificate is signed by an intermediate CA, which is signed (transitively) up to a **root CA** whose public key is pre-installed in the client's trust store. The server presents the leaf *and* intermediates; the client verifies each signature up the chain to a trusted root, checks validity dates, hostname match, and revocation (OCSP/CRL). A missing intermediate is a classic bug — works in browsers that cache intermediates but fails for stricter clients like Go. **SNI (Server Name Indication):** in the TLS handshake the client must pick a server *before* HTTP's Host header is available (HTTP is inside the encrypted tunnel). SNI is a ClientHello extension carrying the target hostname *in cleartext*, letting one server/IP host many domains and select the matching certificate during the handshake — essential for virtual hosting and CDNs. The privacy gap (SNI leaks the hostname) is addressed by Encrypted Client Hello (ECH). In Go, `tls.Config.GetCertificate` uses the SNI name to choose the cert dynamically.

**Key points**
- Leaf -> intermediate(s) -> root CA in client trust store; verify signatures + hostname + dates + revocation
- Missing intermediate works in browsers but fails strict clients like Go
- SNI carries the hostname in cleartext in ClientHello so one IP serves many certs
- ECH encrypts SNI; Go uses tls.Config.GetCertificate keyed on SNI


```go
cfg := &tls.Config{
    GetCertificate: func(hi *tls.ClientHelloInfo) (*tls.Certificate, error) {
        return certFor(hi.ServerName) // pick cert by SNI hostname
    },
}
```

**Follow-ups**
- Why does Go reject a chain that browsers accept?
- What problem does Encrypted Client Hello (ECH) solve?

---

#### 28. What is mTLS and why use it for service-to-service auth? Contrast with bearer tokens.

*Difficulty:* 🔴 staff  ·  *Tags:* `tls`, `mtls`, `service-to-service`, `security`, `go`

In normal TLS only the **server** proves its identity. **mTLS (mutual TLS)** also makes the **client** present a certificate, so both ends authenticate during the handshake. For service-to-service traffic inside a mesh, this gives strong, transport-level identity: each service has a short-lived cert (often issued by an internal CA / SPIFFE-SVID), and a server can authorize peers by certificate identity rather than trusting the network. **Versus bearer tokens (JWT/API keys):** a bearer token is a secret in the request — if leaked (logs, SSRF, a compromised proxy) it can be replayed by anyone; it's bound to the request, not the connection. An mTLS client cert proves possession of a private key that never leaves the client and authenticates at the connection level, so it can't be replayed by a passive observer and gives you encryption + identity in one step. Trade-offs: mTLS needs cert issuance, rotation, and revocation infrastructure (why service meshes like Istio/Linkerd automate it), and it authenticates *workloads*, not *end users* — you often combine mTLS for service identity with tokens for user identity. In Go, set `tls.Config.ClientAuth = RequireAndVerifyClientCert` and a `ClientCAs` pool.

**Key points**
- mTLS: both client and server present certs — mutual, transport-level identity
- Strong workload identity (SPIFFE/short-lived certs); authorize by cert, not network
- Bearer tokens are replayable secrets in the request; mTLS proves key possession at connection level
- Needs issuance/rotation/revocation infra (service meshes automate it); authenticates workloads not users


```go
srv := &http.Server{
    TLSConfig: &tls.Config{
        ClientAuth: tls.RequireAndVerifyClientCert,
        ClientCAs:  caPool, // trust roots for client certs
    },
}
```

**Follow-ups**
- How does a service mesh handle cert rotation transparently?
- Why still layer user-level tokens on top of mTLS?

---

#### 29. What is TLS session resumption, and what's the security trade-off with session tickets and 0-RTT?

*Difficulty:* 🟠 hard  ·  *Tags:* `tls`, `session-resumption`, `0-rtt`, `tickets`

A full handshake is expensive (asymmetric crypto + round trips). **Resumption** lets a returning client skip the full handshake by reusing keying material from a prior session. Two mechanisms: **session IDs** (server stores session state, client presents the ID — costs server memory and doesn't scale across a fleet) and **session tickets** (the server encrypts the session state into a ticket the *client* stores and presents later — stateless, scales across servers, but all servers must share the ticket-encryption key). **TLS 1.3 0-RTT** goes further: a resuming client can send application data in its very first flight, before the handshake completes, eliminating the round trip entirely. The trade-offs: (1) session tickets require **rotating the ticket key** regularly — a stolen, never-rotated key breaks forward secrecy for all resumed sessions; (2) **0-RTT data is replayable** — an attacker can capture and resend the early data, so it must be restricted to **idempotent, safe operations** (never a 0-RTT POST that charges a card). Most stacks therefore gate 0-RTT to GETs or disable it for state-changing endpoints.

**Key points**
- Resumption skips the full handshake: session IDs (server state) vs tickets (client-held, stateless)
- Tickets scale across a fleet but require a shared, rotated ticket-encryption key
- TLS 1.3 0-RTT sends app data before handshake completes — saves a round trip
- 0-RTT data is replayable -> restrict to idempotent/safe operations; rotate ticket keys

**Follow-ups**
- How does ticket-key rotation preserve forward secrecy?
- Why must a server reject 0-RTT for non-idempotent requests?

---

## Network Load Balancing

#### 30. Compare L4 and L7 load balancing. When do you choose each, and what do you give up?

*Difficulty:* 🟠 hard  ·  *Tags:* `load-balancing`, `l4`, `l7`, `architecture`

**L4 (transport)** balances by the TCP/UDP 4-tuple — it forwards packets/connections without parsing the payload. It's fast, low-latency, protocol-agnostic (works for any TCP/UDP service, including TLS pass-through), and can preserve the client IP via Direct Server Return. But it can't route on URL/host/header, can't terminate TLS, and a connection is pinned to one backend for its lifetime. **L7 (application)** terminates the connection, parses HTTP, and routes on path, host, headers, or cookies; it can do TLS termination, retries, sticky sessions, header rewriting, and per-request balancing across HTTP/2 streams. The cost is more CPU/latency, it must understand the protocol, and it breaks end-to-end TLS unless re-encrypting. **Choosing:** use L4 for raw throughput, non-HTTP protocols, or when you need end-to-end encryption and minimal overhead (e.g. database, gRPC pass-through); use L7 for HTTP routing, canary/path-based traffic splitting, auth at the edge, and observability. Real architectures layer them: L4 (or anycast) at the edge for scale, L7 behind it for routing.

**Key points**
- L4 routes by 4-tuple, payload-agnostic, fast, TLS pass-through, connection-pinned
- L7 parses HTTP: route by path/host/header, TLS termination, retries, per-request balancing
- L4 can't do content routing; L7 costs CPU and breaks E2E TLS unless re-encrypting
- Common to layer: L4/anycast edge + L7 behind for routing

**Follow-ups**
- How does L7 balance individual HTTP/2 streams vs L4's connection pinning?
- When does connection pinning at L4 cause uneven load?

---

#### 31. Explain anycast and why it's powerful for DNS, CDNs, and DDoS absorption.

*Difficulty:* 🔴 staff  ·  *Tags:* `anycast`, `bgp`, `cdn`, `ddos`, `load-balancing`

Anycast advertises the *same* IP prefix from *many* geographically distributed locations via BGP. The internet's routing fabric naturally delivers a client's packets to the **topologically nearest** advertising site, so one IP transparently maps to dozens of edge locations. Why it's powerful: (1) **latency** — clients hit the closest PoP without any DNS trickery, ideal for DNS root servers, public resolvers (1.1.1.1, 8.8.8.8), and CDN edges; (2) **DDoS absorption** — attack traffic is spread across all anycast sites instead of converging on one, so each site only handles its slice, and BGP can withdraw or shift routes; (3) **failover** — if a site goes down, BGP reconverges and routes clients to the next-nearest site automatically. The catch: anycast works cleanly for **stateless or short-lived** request/response (UDP DNS, individual HTTP requests). For **long-lived stateful TCP** connections, a routing change mid-connection can re-route packets to a *different* site that has no connection state, killing the connection — so anycast is used carefully with stable routing or paired with stateless protocols. That's a key reason DNS-over-UDP and QUIC (with connection IDs surviving path changes) suit anycast well.

**Key points**
- Same IP advertised from many sites via BGP; routing picks nearest PoP
- Cuts latency (DNS resolvers, CDNs) with no DNS-level steering
- Spreads DDoS across sites; BGP enables automatic failover
- Risk: routing change mid-connection breaks long-lived stateful TCP — best for stateless/short-lived

**Follow-ups**
- Why does QUIC tolerate anycast path changes better than plain TCP?
- How does GeoDNS differ from anycast for latency routing?

---

## Sockets and Go net Internals

#### 32. How does Go's net package achieve massive concurrency with blocking-style code? Explain the netpoller and epoll/kqueue.

*Difficulty:* 🔴 staff  ·  *Tags:* `go`, `netpoller`, `epoll`, `kqueue`, `concurrency`

Go lets you write `conn.Read()` as if it blocks, while serving hundreds of thousands of connections on a handful of OS threads — the **netpoller** is how. Under the hood, every network fd is set **non-blocking**, and Go registers it with the OS's readiness API: **epoll** on Linux, **kqueue** on BSD/macOS, IOCP on Windows. When your goroutine calls `Read` and the socket isn't ready, the runtime doesn't block the OS thread — it **parks the goroutine** and hands the thread back to the scheduler to run other goroutines. A dedicated background poller (and the scheduler at safe points) calls epoll_wait to learn which fds became ready, then **unparks** the goroutines waiting on them, which resume from where they blocked. So one OS thread multiplexes many goroutines, and blocking-looking code is actually cooperative async I/O. The result: cheap goroutine-per-connection concurrency without the callback hell of an event loop, and without one OS thread per connection. The trade-off is that truly blocking syscalls (file I/O, cgo, DNS via cgo) can still tie up an M, which is why the scheduler spins up extra threads for those.

**Key points**
- All net fds are non-blocking; registered with epoll/kqueue/IOCP
- Blocked Read parks the goroutine and frees the OS thread (M)
- Netpoller calls epoll_wait, unparks goroutines when fds are ready
- Goroutine-per-connection scales without a thread per connection or callbacks

**Follow-ups**
- Why can blocking file I/O or cgo still consume an OS thread?
- How do deadlines (SetReadDeadline) interact with the netpoller?

---

#### 33. Explain connection pooling in http.Client. Which Transport knobs matter, and what's the default trap?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `http-client`, `transport`, `connection-pool`

`http.Client` itself is a thin wrapper; the connection pool lives in `http.Transport`. After a request completes and the body is fully read and closed, the connection returns to an **idle pool** keyed by (scheme, host, proxy) and is reused for the next request — avoiding a fresh TCP+TLS handshake and slow-start. Key knobs: **`MaxIdleConns`** (total idle conns across all hosts), **`MaxIdleConnsPerHost`** (idle conns kept per host — its **default is 2**, the classic trap), **`MaxConnsPerHost`** (caps total, idle+active, per host — backpressure), **`IdleConnTimeout`** (how long idle conns survive). The default trap: with `MaxIdleConnsPerHost=2`, a high-fan-out service talking to one backend keeps only 2 idle connections, so beyond 2 concurrent requests it constantly opens new connections and closes the excess — causing TIME_WAIT buildup, handshake overhead, and port pressure, exactly the symptom that looks like a leak. The other trap is creating a **new Transport/Client per request**, which gives every request a fresh, unpooled connection. Fix: one shared Transport, raise `MaxIdleConnsPerHost` to your concurrency level, set sane timeouts.

**Key points**
- Pool lives in Transport; conn returns to idle pool after body is read+closed
- MaxIdleConnsPerHost default is 2 — the classic fan-out trap
- MaxIdleConns/MaxConnsPerHost/IdleConnTimeout control pool size and lifetime
- Never create a Transport per request; share one and raise per-host idle limit


```
var client = &http.Client{
    Timeout: 10 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 100, // default 2 — raise for fan-out
        MaxConnsPerHost:     200,
        IdleConnTimeout:     90 * time.Second,
    },
}
```

**Follow-ups**
- Why does the body have to be fully read for the conn to be reused?
- How would you tune these for a service making 500 concurrent calls to one backend?

---

#### 34. What exactly happens if you don't close resp.Body (or don't drain it) in Go, and why is it such a common bug?

*Difficulty:* 🟠 hard  ·  *Tags:* `go`, `http-client`, `resp-body`, `resource-leak`

Two distinct leaks. (1) **Not calling `resp.Body.Close()`** leaks the underlying connection: the Transport can't return it to the idle pool, so it stays checked out, and the fd/connection is held until GC eventually finalizes it (unreliable, slow). Under load this exhausts connections, file descriptors, and `MaxConnsPerHost`, so requests start blocking or failing — looks like a hang or a resource leak. (2) **Closing without fully reading** prevents connection *reuse*: the Transport can only return a connection to the pool if the body is read to EOF *and* closed, because the leftover bytes must be consumed to reset the stream. If you close early, the connection is dropped instead of reused, silently defeating pooling and causing handshake churn. It's common because the happy path 'works' in tests and low traffic — the symptoms only appear under concurrency. The correct idiom is always defer Close, and if you don't need the body, drain it with `io.Copy(io.Discard, resp.Body)` so the connection is reusable. Also remember the body is non-nil even on non-2xx responses, so you must close it then too.

**Key points**
- Missing Close() leaks the connection/fd until GC — exhausts pool under load
- Close without draining to EOF prevents reuse, defeating pooling
- Idiom: defer resp.Body.Close() + io.Copy(io.Discard, body) if unused
- Body is non-nil even on errors/non-2xx — close it anyway


```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()              // always close to free the conn
// ... read what you need, then ensure the rest is drained for reuse:
_, _ = io.Copy(io.Discard, resp.Body)
```

**Follow-ups**
- Why is io.Copy(io.Discard, body) preferable to ioutil.ReadAll when discarding?
- How does a context cancellation interact with body close and reuse?

---

## Proxies and WebSockets

#### 35. Contrast a forward proxy and a reverse proxy, with the role nginx plays in each.

*Difficulty:* 🟡 medium  ·  *Tags:* `proxy`, `reverse-proxy`, `forward-proxy`, `nginx`

Both sit between client and server, but they face opposite directions and serve opposite parties. A **forward proxy** acts on behalf of *clients*: outbound traffic from a set of clients goes through it, which can enforce egress policy, cache, anonymize the client, or bypass geo-restrictions. The server sees the proxy, not the real client. A **reverse proxy** acts on behalf of *servers*: inbound traffic from the internet hits the proxy, which then routes to backend services. Clients think they're talking to the origin; they're talking to the proxy. **nginx** is most commonly a reverse proxy — terminating TLS, load balancing, caching responses, rate limiting, serving static assets, and routing by host/path to upstreams — and it offloads these cross-cutting concerns from application servers. (nginx can also be a forward proxy, but that's less common.) The senior framing: forward proxy = 'protect/shape the clients,' reverse proxy = 'protect/scale the servers.' Reverse proxies are where you put TLS termination, WAFs, compression, and the L7 routing discussed earlier.

**Key points**
- Forward proxy fronts clients (egress control, anonymize); server sees the proxy
- Reverse proxy fronts servers (ingress routing); client sees the proxy
- nginx is typically a reverse proxy: TLS termination, LB, caching, rate limiting, static
- Reverse proxy is where cross-cutting edge concerns live

**Follow-ups**
- Why put TLS termination at the reverse proxy rather than the app?
- How does a reverse proxy preserve the original client IP?

---

#### 36. Walk through the WebSocket upgrade handshake. How does it start as HTTP and what changes after?

*Difficulty:* 🟠 hard  ·  *Tags:* `websocket`, `upgrade`, `http`, `full-duplex`

WebSocket reuses HTTP for the initial handshake so it traverses the same ports/proxies as web traffic, then upgrades to a persistent, full-duplex frame protocol. The client sends a normal HTTP/1.1 GET with `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key: <random base64>`, and a version header. The server, if it accepts, responds **101 Switching Protocols** with `Upgrade: websocket`, `Connection: Upgrade`, and `Sec-WebSocket-Accept` = base64(SHA-1(key + magic GUID)) — proving it understood the handshake (not a generic echo). After the 101, the **same TCP connection** stops being HTTP and becomes a bidirectional WebSocket frame stream: either side can send messages anytime, with no request/response coupling, low per-message overhead (a few bytes of framing), and built-in ping/pong for liveness. Operational notes: it's a long-lived connection, so reverse proxies must be configured to pass the Upgrade headers and use long idle timeouts; L7 load balancers must support WebSocket; and because it bypasses HTTP semantics after upgrade, you implement your own auth/heartbeat/backpressure. WebSocket runs over HTTP/1.1; over HTTP/2 there's a separate CONNECT-based mechanism.

**Key points**
- Starts as HTTP/1.1 GET with Upgrade/Connection/Sec-WebSocket-Key headers
- Server replies 101 Switching Protocols with Sec-WebSocket-Accept = SHA-1(key+GUID)
- Same TCP connection becomes a full-duplex frame stream after upgrade
- Proxies/LBs must forward Upgrade headers and allow long idle timeouts

**Follow-ups**
- What is the Sec-WebSocket-Accept magic GUID protecting against?
- How do you handle backpressure and heartbeats on a WebSocket?

---

## Network Debugging

#### 37. Precisely distinguish latency, bandwidth, and throughput. Why can a high-bandwidth link still feel slow?

*Difficulty:* 🟡 medium  ·  *Tags:* `latency`, `bandwidth`, `throughput`, `performance`

**Latency** is the time for one bit to travel end-to-end (RTT is the round trip) — bounded ultimately by distance/speed of light plus queuing. **Bandwidth** is the link's theoretical capacity (bits/sec the pipe *can* carry). **Throughput** is the *actual* data rate you achieve, which is usually less than bandwidth due to protocol overhead, loss, and — critically — latency. A high-bandwidth, high-latency link feels slow because of the **bandwidth-delay product**: TCP can only have `cwnd`/`rwnd` bytes in flight before it must wait for an ACK, so on a long-RTT path a small window throttles you far below the pipe's capacity even though the pipe is huge. That's why a transcontinental link with tiny default buffers transfers slowly, and why window scaling and larger buffers matter. The classic analogy: bandwidth is the width of the pipe, latency is its length, throughput is how much water you actually move. For request/response APIs, **latency dominates user experience** (each round trip costs RTT), which is why you minimize round trips (connection reuse, HTTP/2 multiplexing, fewer chatty calls) rather than just buying more bandwidth.

**Key points**
- Latency = per-bit travel time (RTT = round trip); bandwidth = capacity; throughput = achieved rate
- Throughput < bandwidth due to overhead, loss, and latency
- Bandwidth-delay product: small window on high-RTT link caps throughput
- Round trips dominate API UX — reduce them rather than just adding bandwidth

**Follow-ups**
- How do you size a TCP buffer for a given bandwidth-delay product?
- Why does HTTP/2 multiplexing help latency-bound workloads more than bandwidth?

---

#### 38. A backend call intermittently times out. Walk through your debugging toolkit: ss/netstat, curl -v, tcpdump/wireshark.

*Difficulty:* 🟠 hard  ·  *Tags:* `debugging`, `tcpdump`, `ss`, `curl`, `wireshark`

Work down the layers, narrowing fast. **`ss` / `netstat`** first (ss is the modern, faster one): `ss -tanp` shows connection states and owning processes — look for piles of TIME_WAIT (port exhaustion), SYN_SENT (can't reach peer / firewall drop), CLOSE_WAIT (app not closing sockets — a leak), or a full send/recv queue (slow consumer). **`curl -v`** (or `-vvv`) isolates the application layer: it prints DNS resolution, TCP connect time, the TLS handshake (cert chain, SNI, negotiated version/cipher), request/response headers, and status — great for separating 'DNS slow' vs 'TLS failing' vs 'app returns 503.' Add `-w` with timing fields (`time_namelookup`, `time_connect`, `time_appconnect`, `time_starttransfer`) to see *where* the time goes. **`tcpdump` / `wireshark`** is the ground truth when higher tools lie: capture with `tcpdump -i any host X and port 443 -w cap.pcap`, then in Wireshark look for retransmissions (loss/black-hole/PMTU), no SYN-ACK (firewall/route), RST (peer refused/closed), or a handshake that completes but stalls on a large frame (the PMTU black hole). The discipline: form a hypothesis at one layer, confirm or eliminate it, then descend only as needed — and for intermittent issues, capture continuously and correlate with the failure timestamps.

**Key points**
- ss/netstat: connection states — TIME_WAIT (port exhaustion), CLOSE_WAIT (leak), SYN_SENT (unreachable), full queues
- curl -v: DNS/TCP/TLS/HTTP layers separated; -w timing fields localize the delay
- tcpdump/wireshark: packet ground truth — retransmits, missing SYN-ACK, RST, PMTU stalls
- Method: hypothesize per layer, confirm/eliminate, descend; capture continuously for intermittent bugs


```
# Connection states + owning process
ss -tanp
# Where does the time go?
curl -w 'dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\n' -o /dev/null -s https://api.example.com
# Packet capture for offline analysis
tcpdump -i any host api.example.com and port 443 -w cap.pcap
```

**Follow-ups**
- How do you tell a CLOSE_WAIT leak from a TIME_WAIT pileup, and what causes each?
- What Wireshark signature distinguishes packet loss from a PMTU black hole?

---
