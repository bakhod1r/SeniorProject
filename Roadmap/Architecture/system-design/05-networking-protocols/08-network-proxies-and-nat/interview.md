# Network Proxies & NAT — Interview Questions

A staged bank of interview questions on forward and reverse proxies, load balancers, and Network Address Translation (NAT). Each answer is written to be repeated almost verbatim in a real interview: it states the mechanism, then the trade-off, then the operational consequence at scale.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is a proxy, and what is the difference between a forward proxy and a reverse proxy?**

> A proxy is an intermediary that terminates a client's connection and opens its own connection to the real destination, so neither end talks directly to the other.
>
> The distinction is *whose side the proxy sits on and whose identity it hides*:
>
> - A **forward proxy** sits in front of *clients*. Clients are configured to send their traffic through it, and it fetches resources on their behalf. It hides the *client* from the server. Examples: a corporate egress proxy, a caching/filtering proxy, a privacy proxy.
> - A **reverse proxy** sits in front of *servers*. Clients think they are talking to the origin, but they actually hit the proxy, which forwards to a pool of backends. It hides the *server topology* from clients. Examples: NGINX, Envoy, HAProxy, a CDN edge.
>
> Rule of thumb: a forward proxy is chosen by the client; a reverse proxy is chosen by the operator and is invisible to the client.

**Q2: What is NAT and why does it exist?**

> NAT (Network Address Translation) rewrites the IP addresses (and usually ports) in packet headers as they cross a boundary — typically between a private network and the public internet.
>
> It exists mainly because of **IPv4 address scarcity**. There are only ~4.3 billion IPv4 addresses, far fewer than the number of connected devices. NAT lets an entire home or office share *one* public IP: internal devices use private addresses (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and the NAT device maps their outbound connections onto the single public address.
>
> A useful side effect is a crude firewall: because there is no static mapping for unsolicited inbound packets, the outside world cannot reach internal hosts unless they initiate the connection first.

**Q3: What is a load balancer, and how is it different from a reverse proxy?**

> A load balancer distributes incoming requests across multiple backend servers to spread load and provide redundancy. A reverse proxy is a broader concept — an intermediary in front of servers that can do routing, caching, TLS termination, compression, and more.
>
> In practice they overlap heavily: most reverse proxies *can* load balance, and most load balancers *are* reverse proxies. The cleanest way to say it in an interview:
>
> - **Every load balancer is (functionally) a reverse proxy**, but its defining job is *distribution*.
> - **Not every reverse proxy is a load balancer** — a reverse proxy in front of a single backend still adds TLS, caching, and WAF value.
>
> A related distinction is **L4 vs L7**: an L4 load balancer forwards TCP/UDP by IP:port without understanding the payload; an L7 reverse proxy parses HTTP and can route on path, host, or headers.

**Q4: What are private IP address ranges and why do they matter for NAT?**

> Private ranges are blocks reserved by RFC 1918 that are never routed on the public internet: `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`. Because they are non-routable publicly, many networks can reuse the same private addresses simultaneously without conflict.
>
> They matter for NAT because they are exactly what NAT translates *from*. Internal hosts get a private address; the NAT gateway swaps it for a public one on the way out and swaps it back on the way in. Without private ranges (or with them routed globally) NAT would have nothing consistent to hide behind.

**Q5: When a request goes through a reverse proxy, why doesn't the backend see the real client's IP address?**

> Because the reverse proxy opens a *new* TCP connection to the backend using its own source IP. From the backend's perspective, every request appears to come from the proxy, not from the many real clients behind it.
>
> To recover the original client IP, the proxy must explicitly pass it along — most commonly by adding an `X-Forwarded-For` HTTP header (or the standardized `Forwarded` header), or by using the PROXY protocol at the TCP layer. The backend then has to be configured to *trust* and read that header. If it isn't, logs, rate limiting, and geolocation all wrongly attribute every request to the proxy's IP.

---

## Middle Questions

**Q6: Explain SNAT, DNAT, and PAT, and where each is used.**

> These are the three flavors of address/port translation:
>
> | Term | What it rewrites | Direction | Typical use |
> |------|------------------|-----------|-------------|
> | **SNAT** (Source NAT) | Source IP (± port) | Outbound | Home/office internet access; cloud NAT gateway egress |
> | **DNAT** (Destination NAT) | Destination IP (± port) | Inbound | Port forwarding; publishing an internal server; L4 load balancer VIP |
> | **PAT** (Port Address Translation, a.k.a. NAT overload / masquerade) | Source IP *and* source port | Outbound | Many private hosts sharing one public IP |
>
> **SNAT** changes who the packet *appears to come from*. **DNAT** changes where the packet *is sent*. **PAT** is the specific SNAT variant that also rewrites the source port so a single public IP can multiplex thousands of connections — the mapping key becomes the full 5-tuple, disambiguated by port. The "NAT" everyone means at home is really PAT.

**Q7: What is port forwarding and how does it relate to DNAT?**

> Port forwarding is a static DNAT rule. You tell the NAT device: "any packet arriving on my public IP at port X should be rewritten and delivered to internal host Y at port Z." It's how you expose a game server, SSH box, or camera behind a home router to the internet.
>
> The key point is that it makes *unsolicited inbound* traffic possible, which NAT otherwise blocks. Without a forwarding rule, the NAT table only has entries created by *outbound* connections, so inbound packets that match nothing get dropped. Port forwarding pre-populates a permanent mapping.

**Q8: Why does NAT break inbound connections and peer-to-peer communication?**

> NAT builds its translation table *reactively* — an entry is created only when an inside host sends a packet out. That entry maps `(inside IP:port) → (public IP:port)` and lets return traffic for that flow back in.
>
> This breaks two things:
>
> 1. **Inbound-initiated connections.** A packet from outside that isn't a reply to an existing flow matches no table entry, so the NAT drops it. That's why you can't just connect *to* a laptop behind a home router.
> 2. **Peer-to-peer.** If both peers are behind NATs, neither can initiate to the other's private address (non-routable) or public address (no inbound mapping). Each is waiting for the other to "answer the door" that neither can open.
>
> The workarounds are port forwarding (static, manual) or NAT traversal techniques like STUN/TURN/ICE (dynamic, for P2P/VoIP/WebRTC).

**Q9: What is `X-Forwarded-For` and what are its limitations?**

> `X-Forwarded-For` (XFF) is a de-facto HTTP header that proxies append the client's IP to as a request passes through them. After several hops it looks like:
>
> ```
> X-Forwarded-For: 203.0.113.7, 70.41.3.18, 10.0.0.5
> ```
>
> read left-to-right as `original client, first proxy, second proxy…`.
>
> Limitations:
>
> - **It's a plain, appendable header, so a client can forge it.** If the backend blindly trusts the leftmost value, an attacker sets `X-Forwarded-For: <victim or trusted IP>` and spoofs their apparent origin — bypassing IP allowlists or rate limits.
> - **Multiple values require careful parsing.** You must count hops from the *right* (the values *your own* trusted proxies added) rather than trusting the left.
> - It's non-standard; `Forwarded` (RFC 7239) is the standardized replacement but less widely deployed.

**Q10: How do you safely recover the real client IP behind a chain of proxies?**

> The rule is: **trust only the part of the header your own infrastructure added, and count from the right.**
>
> Concretely:
>
> 1. Configure the backend with a list of *trusted proxy IPs* (your load balancers, CDN egress ranges).
> 2. Walk `X-Forwarded-For` from right to left, discarding entries contributed by trusted hops.
> 3. The first *untrusted* address you hit is the real client. Everything to its left is attacker-controlled and must not be trusted.
>
> Frameworks encode this as a "number of trusted proxies" or "trusted CIDR" setting (e.g. `set_real_ip_from` in NGINX, `ForwardedHeaders` middleware in ASP.NET, `ProxyFix` in Flask). For a stronger guarantee at L4, use the **PROXY protocol**, which the client cannot forge because it's injected by the proxy on the TCP stream itself.

**Q11: What is the PROXY protocol and when would you use it over `X-Forwarded-For`?**

> The PROXY protocol is a small header prepended to the *TCP stream* (before any application bytes) that carries the original source and destination IP:port. It was designed by HAProxy for exactly the case where a proxy operates at L4 and can't inject HTTP headers — e.g. TLS passthrough, raw TCP, or non-HTTP protocols.
>
> You use it over XFF when:
>
> - The traffic isn't HTTP (so there's no header to add), or
> - TLS is terminated *at the backend* (so the L4 proxy can't see or rewrite HTTP), or
> - You want client-IP info that the application client cannot forge, since PROXY protocol is spoken between the proxy and backend, not exposed to the end client.
>
> The trade-off: the backend *must* be configured to expect it, or it will mis-parse the header bytes as application data and the connection breaks. It's all-or-nothing per listener.

**Q12: What are the main responsibilities a reverse proxy takes on in a real deployment?**

> A reverse proxy is where cross-cutting concerns concentrate so backends can stay simple:
>
> - **TLS termination** — decrypt HTTPS at the edge, centralize certificate management, offload crypto from app servers.
> - **Load balancing & health checks** — distribute across backends, eject unhealthy ones.
> - **Caching** — serve static and cacheable responses without hitting the origin.
> - **Routing** — dispatch by host, path, header, or weight (canary/blue-green).
> - **WAF / security** — filter malicious requests, enforce rate limits, block bad IPs.
> - **Compression & protocol translation** — gzip/brotli, HTTP/2 or HTTP/3 to clients while speaking HTTP/1.1 to backends.
> - **Observability** — a single place to emit access logs, metrics, and traces.
>
> The theme: it's the choke point where you enforce policy and terminate protocols, keeping the backend fleet focused on business logic.

---

## Senior Questions

**Q13: Walk through how a WebRTC call between two peers behind NAT actually connects — STUN, TURN, and ICE.**

> Two browsers behind home NATs can't reach each other's private addresses. ICE (Interactive Connectivity Establishment) is the framework that finds a working path by gathering *candidates* and testing them.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant A as Peer A (behind NAT A)
>     participant SA as NAT A
>     participant STUN as STUN server
>     participant SB as NAT B
>     participant B as Peer B (behind NAT B)
>
>     Note over A,B: 1. Gather candidates
>     A->>STUN: "What is my public IP:port?"
>     STUN-->>A: 198.51.100.9:51000 (server-reflexive)
>     B->>STUN: "What is my public IP:port?"
>     STUN-->>B: 203.0.113.5:62000 (server-reflexive)
>
>     Note over A,B: 2. Exchange candidates via signaling (out of band)
>     A-->>B: SDP: host + srflx candidates
>     B-->>A: SDP: host + srflx candidates
>
>     Note over A,B: 3. Connectivity checks (hole punching)
>     A->>SB: STUN check to B's srflx
>     B->>SA: STUN check to A's srflx
>     Note over SA,SB: Both send outbound → both NATs<br/>open mappings → path succeeds
>     A->>B: Media flows directly (P2P)
> ```
>
> Steps in words:
>
> 1. **STUN** tells each peer its own *public* IP:port as seen from outside (a "server-reflexive" candidate). This solves "what does the world see me as?"
> 2. Peers exchange all candidates (host, srflx, relay) through a **signaling channel** (your own server, out of band).
> 3. **ICE connectivity checks** try candidate pairs. Because each peer sends an outbound STUN check, both NATs open outbound mappings roughly simultaneously — **UDP hole punching** — and the direct path lights up.
> 4. If no direct path works (typically symmetric NAT), ICE falls back to **TURN**: a relay server in the public internet that both peers *can* reach outbound, which forwards media between them. TURN always works but costs bandwidth and adds latency, so it's the last resort.

**Q14: Why does symmetric NAT defeat STUN-based hole punching, and what do you do about it?**

> Hole punching relies on an assumption: the public port a NAT assigns to an internal socket is *stable regardless of destination*. Under that assumption, the port STUN reports is the same port the peer should send to.
>
> **Symmetric NAT breaks that.** It allocates a *different* external port for each unique destination `(dst IP, dst port)`. So the mapping the peer learned by talking to the STUN server is not the mapping that would be used to talk to the *other peer* — the port is different and unpredictable. The connectivity check arrives at a port with no mapping and is dropped.
>
> What you do: **fall back to TURN**. When ICE detects that direct checks fail (a strong signal of symmetric NAT on one or both ends), it uses a relayed candidate. Both peers reach the TURN server outbound, and the server relays. It's guaranteed to work but consumes server bandwidth, which is why large real-time platforms provision and monitor TURN capacity carefully.

**Q15: Describe the NAT types in RFC 4787 and why the classification matters.**

> RFC 4787 replaced the older "full-cone / restricted / port-restricted / symmetric" folklore with two orthogonal, precise properties:
>
> | Property | Values | Meaning |
> |----------|--------|---------|
> | **Mapping behavior** | Endpoint-Independent / Address-Dependent / Address-and-Port-Dependent | Does the NAT reuse the same external port for a given internal socket regardless of destination? |
> | **Filtering behavior** | Endpoint-Independent / Address-Dependent / Address-and-Port-Dependent | Which external hosts are allowed to send *inbound* on an existing mapping? |
>
> - **Endpoint-Independent Mapping (EIM)** is the friendly kind: one external port per internal socket, reused for all destinations. STUN + hole punching works. RFC 4787 *requires* EIM ("REQ-1") for good traversal.
> - **Address-and-Port-Dependent Mapping** is effectively the old "symmetric NAT" — a new port per destination, which defeats STUN.
>
> It matters because your P2P success rate is basically a function of how many endpoints are EIM. Interviewers want to see you separate *mapping* (does traversal work at all) from *filtering* (a secondary security constraint), rather than reciting the four legacy cone types.

**Q16: What is conntrack, and how can it cause outages at scale?**

> `conntrack` is the Linux kernel's connection-tracking table (used by netfilter/iptables and by NAT). Every tracked flow — every NAT mapping, every stateful firewall rule match — consumes a table entry, keyed by the 5-tuple, with a timeout.
>
> It causes outages in two classic ways:
>
> 1. **Table exhaustion.** The table has a fixed maximum (`nf_conntrack_max`). Under high connection churn — a busy NAT gateway, or a proxy fronting thousands of short-lived connections — the table fills. New connections then get *dropped* with `nf_conntrack: table full` in dmesg, and the symptom looks like random, intermittent connection failures rather than an obvious overload.
> 2. **Slow-path insertions and lock contention** on very high connection rates.
>
> The fixes: raise `nf_conntrack_max` and hash-table size, tune timeouts (especially `nf_conntrack_tcp_timeout_time_wait`), mark high-volume flows as `NOTRACK` where NAT isn't needed, or bypass conntrack entirely for the hot path. This is a favorite question because the failure mode is invisible until you know to look at conntrack counters.

**Q17: Explain SNAT / ephemeral port exhaustion behind a NAT gateway, and how to mitigate it.**

> When many hosts share one public IP via PAT, every outbound connection needs a unique *source port* on that public IP so return traffic can be demultiplexed. The mapping key is `(public IP, protocol, dst IP, dst port, src port)`, but for a *single popular destination* the only free variable is the source port — and there are only ~64K ephemeral ports (realistically ~28K in the default range).
>
> So if thousands of hosts behind one NAT IP all hammer the *same* destination `IP:port` (say, one S3 endpoint or one database VIP), you can run out of source ports and new connections fail — even though CPU and bandwidth are fine. In AWS this is exactly the "NAT gateway allows ~55,000 simultaneous connections to a *single* destination" limit; exceeding it throws `ErrorPortAllocation`.
>
> Mitigations:
>
> - **Spread destinations** — more distinct `dst IP:port` combinations multiply available mappings.
> - **Add more public IPs** to the NAT (each adds a fresh 64K port space per destination).
> - **Reuse connections** — HTTP keep-alive / connection pooling drastically cuts how many mappings you burn.
> - **Reduce `TIME_WAIT` hold** so ports free faster (tune timeouts, not `tcp_tw_reuse` blindly).
> - **Give heavy talkers a direct path** (VPC endpoint, direct routing) so they never traverse the shared NAT at all.

**Q18: What is CGNAT and what problems does it create for application operators?**

> CGNAT (Carrier-Grade NAT, a.k.a. LSN / NAT444) is NAT run by the *ISP*, not the customer. The ISP hands subscribers addresses from the shared `100.64.0.0/10` range (RFC 6598), then PATs *many* subscribers onto a much smaller pool of public IPs. So there can be a second layer of NAT: home router NAT *inside* carrier NAT.
>
> Consequences for the app operator:
>
> - **Shared public IPs.** Hundreds of unrelated users appear to come from the *same* source IP. So IP-based rate limiting, IP allowlisting, fraud scoring, and "block this IP" moderation can punish or admit thousands of innocent users at once. IP is no longer a good identity signal.
> - **Inbound is impossible** for those subscribers — no port forwarding, worse P2P — because they don't control the carrier NAT.
> - **Abuse attribution and legal/logging** get murky: mapping a public IP+port+timestamp back to a subscriber requires the carrier's NAT logs, which you don't have.
>
> Practically: never treat client IP as a stable identity, and lean on cookies, tokens, or device fingerprints for anything security-sensitive.

---

## Professional / Deep-Dive Questions

**Q19: You run an L7 reverse proxy that fronts a CDN which itself fronts your app. How do you get a trustworthy client IP, and where do the trust boundaries lie?**

> This is a multi-hop trust problem: `client → CDN edge → your reverse proxy → app`. Each hop appends to `X-Forwarded-For`, so the header is only trustworthy up to the point where *your* controlled infrastructure took over.
>
> ```mermaid
> flowchart LR
>     C[Real client<br/>203.0.113.7] -->|"XFF: (may be forged)"| E[CDN edge]
>     E -->|"XFF: 203.0.113.7"| R[Your reverse proxy]
>     R -->|"XFF: 203.0.113.7, cdn-egress"| A[App server]
>     subgraph trusted[Trusted zone]
>         E
>         R
>         A
>     end
> ```
>
> The design:
>
> 1. **Establish the trusted edge.** The CDN is the *only* place that sees the true TCP source. So the CDN must be configured to *overwrite* (not append) the client-IP field with the observed peer address, discarding any client-supplied XFF. Cloudflare's `CF-Connecting-IP` / AWS CloudFront's behavior do exactly this.
> 2. **Pin the CDN.** Lock your reverse proxy so it only accepts traffic from the CDN's published egress ranges (mTLS or firewall). Otherwise an attacker bypasses the CDN, hits your proxy directly, and forges the "trusted" header.
> 3. **Count trusted hops.** In the app, configure the number of trusted proxies (CDN + your LB) and read the client IP by stripping exactly that many entries from the right of XFF.
>
> The load-bearing insight: **the client IP is only as trustworthy as the weakest hop that can be reached directly.** If the origin is publicly reachable, all header-based trust collapses.

**Q20: A team reports intermittent `connection reset` errors from services behind a NAT gateway under load, with CPU and bandwidth well within limits. How do you diagnose it?**

> The profile — intermittent failures, healthy CPU/bandwidth — screams a *stateful table or port limit*, not throughput. I'd triage the NAT/translation layer specifically:
>
> 1. **Check port allocation.** On a cloud NAT gateway, look at the `ErrorPortAllocation` metric (AWS) or equivalent. A nonzero value confirms ephemeral SNAT port exhaustion to a hot destination.
> 2. **Check conntrack.** On a Linux NAT host: `conntrack -C` (current entries) vs `nf_conntrack_max`, and `dmesg | grep conntrack` for "table full". Near-full is the smoking gun.
> 3. **Check for a single hot destination.** Break connection counts down by `dst IP:port`. Exhaustion almost always clusters on one endpoint (a shared cache, a payment API) because that's the only tuple where source port is the sole degree of freedom.
> 4. **Check `TIME_WAIT` accumulation.** Short-lived connections holding ports in `TIME_WAIT` shrink the usable pool.
>
> Fixes, in order of leverage: enable **connection pooling / keep-alive** to slash mapping creation; **spread destinations** or add NAT public IPs; give the hot talker a **direct/VPC endpoint** bypassing NAT; then tune timeouts. I'd reserve raising `nf_conntrack_max` for genuine capacity needs, not to paper over a churn problem.

**Q21: Compare terminating TLS at the reverse proxy vs. passing it through to the backend. What are the trade-offs?**

> | Aspect | TLS termination at proxy | TLS passthrough to backend |
> |--------|--------------------------|----------------------------|
> | Where cert lives | At the edge (central mgmt) | On each backend |
> | Proxy can inspect payload | Yes — routing, caching, WAF, XFF injection | No — sees only encrypted bytes (L4 only) |
> | CPU cost of crypto | Offloaded to proxy fleet | On each app server |
> | Client-IP propagation | HTTP `X-Forwarded-For` works | Needs PROXY protocol (no HTTP visibility) |
> | End-to-end encryption | Broken at the edge (re-encrypt for "TLS bridging" if needed) | True end-to-end |
> | Compliance (e.g. PCI in-scope backend) | Backend may be out of TLS scope | Backend inside encryption boundary |
>
> The decision hinges on whether the proxy needs to *understand* the request. If you want L7 routing, caching, or a WAF, you must terminate — and then optionally re-encrypt to the backend ("TLS bridging" / mutual TLS in the mesh) to keep the internal hop private. If regulatory or zero-trust requirements demand the backend see raw TLS, you pass through and lose all L7 features, recovering client IP via PROXY protocol. Most large systems terminate at the edge and re-encrypt internally — best of both, at the cost of double crypto.

**Q22: How does IPv6 change the NAT story, and does NAT disappear entirely?**

> IPv6's address space (~3.4×10³⁸) removes the *scarcity* that made NAT mandatory. Every device can have a globally routable address, so the primary reason for NAT — sharing one public IPv4 among many hosts — evaporates. End-to-end reachability, which NAT destroyed, is restored: hole punching, inbound connections, and P2P "just work."
>
> But NAT doesn't fully disappear:
>
> - **NAT64/DNS64** is *added* to let IPv6-only clients reach IPv4-only servers during the long transition — so translation persists, just in the other direction.
> - Some operators want NAT's perceived benefits (topology hiding, easy renumbering) and deploy **NPTv6** (prefix translation), though the IETF discourages it.
> - The *security* people associated with NAT is actually the job of a **stateful firewall**, and IPv6 keeps that firewall — you get "default-deny inbound" via firewall policy, not via address translation. This is the key clarification: NAT was never a security feature; it was address sharing with a firewall side effect. IPv6 separates the two cleanly.
>
> So: IPv6 removes the *need* for NAT, keeps the *firewall*, and adds translation only as a compatibility bridge.

**Q23: Walk through what actually happens to a packet's headers as an internal host loads a website through a home NAT.**

> Follow one outbound packet and its reply:
>
> ```mermaid
> flowchart TB
>     subgraph out[Outbound]
>         O1["src 192.168.1.20:54000<br/>dst 93.184.216.34:443"] -->|NAT rewrites source| O2["src 203.0.113.9:61000<br/>dst 93.184.216.34:443"]
>     end
>     O2 --> NT["NAT table entry:<br/>192.168.1.20:54000 ↔ 203.0.113.9:61000<br/>↔ 93.184.216.34:443"]
>     subgraph in[Reply]
>         I1["src 93.184.216.34:443<br/>dst 203.0.113.9:61000"] -->|NAT reverses using table| I2["src 93.184.216.34:443<br/>dst 192.168.1.20:54000"]
>     end
>     NT -.matches.-> I1
> ```
>
> 1. The host sends a packet with **source** `192.168.1.20:54000` (private) and **destination** the web server `:443`.
> 2. The NAT gateway rewrites the source to its **public** IP and a chosen public port (`203.0.113.9:61000`), recomputes the IP/TCP checksums, and records the mapping in its table.
> 3. The server replies to `203.0.113.9:61000` — it never knew the private address existed.
> 4. The reply hits the NAT, which looks up the table, rewrites the **destination** back to `192.168.1.20:54000`, fixes checksums, and delivers it inside.
>
> The mapping is created by the *outbound* packet and is what makes the *inbound* reply routable — which is precisely why unsolicited inbound (no prior outbound) has no entry and gets dropped.

---

## Staff / Judgment Questions

**Q24: A product needs low-latency real-time media (video calls) for millions of users, many behind CGNAT and symmetric NAT. How do you architect connectivity, and how do you control cost?**

> I'd frame this as maximizing the fraction of calls that stay *peer-to-peer* while guaranteeing a fallback, then aggressively controlling the fallback's cost because that's where the money leaks.
>
> **Architecture:**
>
> - Use **ICE** end to end: gather host, server-reflexive (**STUN**), and relayed (**TURN**) candidates for every peer.
> - Run **STUN** cheaply and globally — it's tiny, stateless, high-fanout. Most EIM NATs succeed here at near-zero cost.
> - Provision **TURN** as the guaranteed fallback for symmetric NAT and CGNAT, where direct paths fail. This is the expensive part: TURN relays *all* media, so it's real, sustained bandwidth.
>
> **Cost control (the judgment):**
>
> - **Measure the relay ratio.** Track what fraction of sessions fall back to TURN. That single number drives cost. If it's high, invest in TURN-over-UDP/TLS/443 to punch through restrictive networks and in TURN placement near users.
> - **Place TURN close to users** (edge/region-local) to cut both latency and cross-region egress cost.
> - **Prefer `relay` only when necessary** — ICE should exhaust cheaper candidate pairs first.
> - **Cap and prioritize.** Under pressure, degrade bitrate on relayed sessions before P2P ones, since relayed bytes cost you directly.
> - Consider **TURN-TCP/TLS on 443** as a last resort for locked-down corporate networks, accepting higher latency for connectivity.
>
> The staff-level point: the technical challenge (traversal) is solved by ICE, but the *business* challenge is that every symmetric-NAT/CGNAT user who can't go P2P becomes a recurring bandwidth bill. So you engineer to *minimize the relay ratio* and to make the unavoidable relays cheap and local.

**Q25: You're designing the edge tier for a large platform. How do you decide between an L4 load balancer and an L7 reverse proxy at the front door, and how do they compose?**

> I don't treat it as either/or — the right answer at scale is usually **L4 in front, L7 behind**, and the decision is about where you need *visibility* versus where you need *raw throughput and resilience*.
>
> **Decision factors:**
>
> | Need | Favors |
> |------|--------|
> | Route by path/host/header, canary, caching, WAF, TLS termination | **L7 reverse proxy** |
> | Maximum throughput, minimal latency, non-HTTP protocols | **L4 load balancer** |
> | Preserve true client IP with zero header trust | L4 with **DSR** or PROXY protocol |
> | Absorb huge connection counts / DDoS SYN floods cheaply | **L4** (stateless-ish, no payload parsing) |
> | Blue-green, A/B, request mirroring, auth at edge | **L7** |
>
> **How they compose:** A stateless **L4** layer (often ECMP/anycast to many nodes) terminates the raw TCP/UDP and spreads connections across a fleet of **L7** proxies (Envoy/NGINX). The L4 tier gives you cheap horizontal scale, DDoS absorption, and clean failover; the L7 tier gives you the smart routing, TLS termination, caching, and WAF. The L4 layer is intentionally "dumb and fast"; the L7 layer is "smart and stateful."
>
> The judgment call is **cost of statefulness**: every L7 feature means parsing, buffering, and per-connection memory, which limits how many connections a node holds and makes it a fatter DDoS target. So I push as much as possible down to L4 and reserve L7 for traffic that genuinely needs request-level intelligence. The client-IP concern (Q19–Q20) rides along: decide early whether you'll carry it via L7 headers or L4 PROXY protocol, because retrofitting trust boundaries later is painful.

**Q26: When would you deliberately *avoid* putting a shared NAT gateway in the egress path, and what do you use instead?**

> I avoid a shared NAT gateway when the workload's egress pattern will fight NAT's structural limits — namely **high connection churn or heavy traffic to a few destinations** — or when NAT adds cost/latency for no benefit.
>
> Concretely, I'd route *around* the NAT when:
>
> - **A few backends generate enormous connection volume to one endpoint** (e.g. a data pipeline hammering one object store). That's the SNAT port-exhaustion trap (Q17). Instead I use a **VPC/private endpoint** or direct peering so the traffic never touches the shared NAT — no port pressure, lower latency, and often no data-processing charge.
> - **Data-processing cost dominates.** Cloud NAT gateways bill per-GB *and* per-hour. For terabyte-scale egress to cloud services, private endpoints or gateway endpoints (which are free or cheaper) beat NAT economically.
> - **The workload needs a stable, allowlistable source IP** — then I'd use dedicated egress IPs / EIPs, not the shared pool, so partners can firewall me predictably.
> - **The workload needs inbound reachability** — NAT structurally blocks it (Q8), so I'd front it with a load balancer / DNAT rule instead.
>
> Conversely I *keep* NAT for the common case: many small, bursty, diverse-destination outbound flows from private subnets that just need internet access. The staff judgment is recognizing that a NAT gateway is a *stateful, port-limited, per-GB-billed* component — cheap and correct for diffuse traffic, a bottleneck and a bill for concentrated traffic — and steering each workload accordingly.

---

*Next step:* [Congestion Control & TCP Tuning — Junior](../09-congestion-control-and-tcp-tuning/junior.md)
