# Network Proxies & NAT — Theory and Formal Foundations

Network Address Translation is a stateful rewriting function on the IP/transport headers of in-flight packets. It began as an emergency treatment for IPv4 exhaustion and became a permanent fixture of the Internet's edge — a middlebox that quietly rewrites the very identifiers the end-to-end principle assumed were stable. This document treats NAT as the formal object it is: a translation table keyed on the transport 5-tuple, a state machine with a well-defined behavioral taxonomy (RFC 4787), and a problem that spawned an entire family of traversal protocols (STUN/TURN/ICE — RFC 5389/8445). We close with CGNAT (RFC 6598) and the way IPv6 dissolves the whole edifice.

## Table of contents

1. [The translation function and its state table](#1-the-translation-function-and-its-state-table)
2. [Ephemeral-port space as the binding budget](#2-ephemeral-port-space-as-the-binding-budget)
3. [NAT behavior taxonomy (RFC 4787)](#3-nat-behavior-taxonomy-rfc-4787)
4. [Why symmetric NAT breaks STUN](#4-why-symmetric-nat-breaks-stun)
5. [STUN: binding discovery formally (RFC 5389)](#5-stun-binding-discovery-formally-rfc-5389)
6. [TURN: relay allocation as fallback](#6-turn-relay-allocation-as-fallback)
7. [ICE: gathering, pairing, nomination (RFC 8445)](#7-ice-gathering-pairing-nomination-rfc-8445)
8. [Hairpinning / NAT loopback](#8-hairpinning--nat-loopback)
9. [CGNAT and the shared-address regime (RFC 6598)](#9-cgnat-and-the-shared-address-regime-rfc-6598)
10. [The end-to-end violation and how IPv6 removes NAT](#10-the-end-to-end-violation-and-how-ipv6-removes-nat)
11. [Principal-level synthesis](#11-principal-level-synthesis)
12. [References](#12-references)

---

## 1. The translation function and its state table

A NAT is a function `T` that maps an *internal* transport endpoint to an *external* one and back. For source NAT (SNAT / NAPT — Network Address Port Translation, the near-universal home/enterprise variant), the outbound rewrite is:

```
(src_ip_internal, src_port_internal, dst_ip, dst_port, proto)
        │  outbound
        ▼
(src_ip_public,   src_port_external, dst_ip, dst_port, proto)
```

The NAT device owns one (or few) public addresses. Because dozens to thousands of internal hosts share those addresses, the *port* is the disambiguator: NAPT rewrites both the source IP **and** the source port, then records the mapping so that the return packet — whose destination is `(src_ip_public, src_port_external)` — can be reversed back to the original internal endpoint.

The recorded state is the **translation table** (also: NAT table, conntrack table on Linux). Each entry is keyed, in the general case, on the full 5-tuple:

```
key   = (proto, internal_ip, internal_port, remote_ip, remote_port)
value = (public_ip, external_port, timers, flags)
```

Whether the NAT keys on the *full* 5-tuple or on a *reduced* tuple is the single most consequential design choice — it is exactly what determines the behavioral taxonomy in §3. Two extremes:

- **Endpoint-independent** mapping: the NAT keys the *allocation* only on `(proto, internal_ip, internal_port)`. The same `external_port` is reused for every remote destination. One internal socket ⇒ one public identity, stable across peers.
- **Endpoint-dependent** (address-and-port-dependent) mapping: the NAT keys on the full 5-tuple. A new `external_port` is allocated for *every distinct remote* `(remote_ip, remote_port)`. One internal socket ⇒ many public identities.

Each entry carries **timers**. NAT is soft state: a mapping lives only as long as traffic refreshes it. RFC 4787 mandates a TCP established-connection idle timeout of **at least 2 hours 4 minutes** and, critically, a UDP mapping timer of **at least 2 minutes** (recommended 5). This UDP timer is why long-lived UDP sessions (VoIP, QUIC, game traffic, VPNs) send keepalives — without them the mapping evaporates and inbound return packets are dropped. TCP entries additionally track connection state (SYN/established/FIN) to prune closed flows quickly.

```mermaid
sequenceDiagram
    autonumber
    participant H as Internal host<br/>10.0.0.7:51000
    participant N as NAT<br/>public 203.0.113.9
    participant S as Server<br/>93.184.216.34:443
    Note over N: Stage 1 — outbound: allocate & record
    H->>N: src 10.0.0.7:51000 → dst 93.184.216.34:443
    N->>N: table[UDP,10.0.0.7,51000,93.184.216.34,443]<br/>= (203.0.113.9, 40001, t=now)
    N->>S: src 203.0.113.9:40001 → dst 93.184.216.34:443
    Note over N: Stage 2 — inbound: reverse via table lookup
    S->>N: src 93.184.216.34:443 → dst 203.0.113.9:40001
    N->>N: match entry → rewrite dst to 10.0.0.7:51000<br/>refresh timer
    N->>H: src 93.184.216.34:443 → dst 10.0.0.7:51000
    Note over N: Stage 3 — idle: reclaim
    N-->>N: timer expires (UDP ≥2 min) → evict entry;<br/>later inbound packets have no match → DROP
```

The asymmetry in Stage 3 is the essence of NAT's "firewall by accident" property: with no matching entry, an unsolicited inbound packet has nowhere to go and is silently discarded. Inbound reachability requires a *pre-existing* mapping created by outbound traffic (or a static port-forward). This is simultaneously NAT's security benefit and its connectivity curse.

---

## 2. Ephemeral-port space as the binding budget

The external port is drawn from a finite pool. A TCP/UDP port number is 16 bits ⇒ 65,536 values, of which the usable ephemeral range is conventionally **49152–65535** (IANA dynamic range, 16,384 ports) though many NATs draw from a wider span such as 1024–65535 (~64,500). The precise bound depends on mapping policy:

- Under **endpoint-independent mapping**, the budget is *per internal endpoint that initiates traffic*. The NAT needs one external port per distinct `(internal_ip, internal_port)` socket, and can reuse it across all remotes. A single public IP therefore supports on the order of tens of thousands of *concurrently active internal sockets*.
- Under **endpoint-dependent (symmetric) mapping**, the budget is consumed *per flow*. Every `(internal socket, remote endpoint)` pair burns a distinct external port. A single host opening thousands of connections (a crawler, a busy proxy, a browser loading a sharded page) can exhaust the port pool by itself.

The formal capacity constraint is:

```
concurrent_mappings ≤ (num_public_ips) × (usable_ephemeral_ports)
```

When the left side approaches the right, the NAT enters **port exhaustion**: new outbound flows cannot be allocated and connections fail — often intermittently and non-deterministically, since success depends on the momentary occupancy of the pool. This is the dominant scaling limit of large NATs and the reason CGNAT (§9) partitions the port space explicitly. It is also why "symmetric NAT" is the enemy of scale: it multiplies the port cost of every host by its fan-out.

---

## 3. NAT behavior taxonomy (RFC 4787)

The older "cone/symmetric" vocabulary comes from RFC 3489 (STUN's first edition). RFC 4787 (BEHAVE) replaced it with two *orthogonal* properties that describe behavior precisely; the cone terms are derived shorthands.

**Mapping behavior** — does the *external port assignment* depend on the destination?
- *Endpoint-Independent Mapping (EIM)*: same external port for all destinations from one internal socket.
- *Address-Dependent Mapping*: new external port per distinct destination IP.
- *Address-and-Port-Dependent Mapping*: new external port per distinct destination IP **and** port.

**Filtering behavior** — which inbound sources are allowed to reuse an existing mapping?
- *Endpoint-Independent Filtering (EIF)*: once a mapping exists, *any* external source may send to it.
- *Address-Dependent Filtering*: only the IP the internal host already contacted may send back.
- *Address-and-Port-Dependent Filtering*: only the exact `(ip, port)` already contacted may send back.

RFC 4787's key recommendations (REQ-1, REQ-8): NATs **SHOULD** use Endpoint-Independent Mapping and **SHOULD NOT** use Address-and-Port-Dependent Mapping, precisely because the latter destroys traversability. The legacy cone taxonomy maps onto these axes:

| Legacy term | Mapping behavior | Filtering behavior | External port stable across peers? | STUN-traversable? | Ephemeral-port cost |
|---|---|---|---|---|---|
| **Full-cone** | Endpoint-Independent | Endpoint-Independent | Yes | Yes (easiest) | 1 per internal socket |
| **Restricted-cone** | Endpoint-Independent | Address-Dependent | Yes | Yes | 1 per internal socket |
| **Port-restricted-cone** | Endpoint-Independent | Address-and-Port-Dependent | Yes | Yes (needs synchronized hole-punch) | 1 per internal socket |
| **Symmetric** | Address-and-Port-Dependent | Address-and-Port-Dependent | **No** | **No** (STUN alone fails) | 1 per *flow* |

The three cone variants all share **Endpoint-Independent Mapping** — the external port a host learns by talking to a STUN server is the *same* port peers will see. That shared stability is what makes hole punching work. Symmetric NAT is defined by Address-and-Port-Dependent *mapping*: the external port differs per destination, so the port learned via STUN is useless for any other peer.

---

## 4. Why symmetric NAT breaks STUN

STUN's core trick (§5) is to let a host discover its own public `(ip, port)` by asking a public server what source address it observed. Hole punching then relies on an unstated but essential assumption:

> The external port a host presents to the STUN server is the **same** external port it will present to the peer.

That assumption holds *if and only if* the NAT uses Endpoint-Independent Mapping. Formally, let `M(i, r)` be the external port the NAT assigns to internal socket `i` when talking to remote `r`. STUN measures `M(i, r_stun)`. Hole punching needs the peer to reach `M(i, r_peer)`.

- **EIM (cone NATs):** `M(i, r_stun) = M(i, r_peer)` for all `r`. The learned port is correct. STUN succeeds.
- **Address-and-Port-Dependent Mapping (symmetric):** `M(i, r_stun) ≠ M(i, r_peer)` in general, because the NAT allocates a *fresh* port per destination. The port learned from the STUN server maps only to the STUN server; when the peer aims at it, either no entry exists or the filtering rule rejects the peer's source. The hole punch lands on a port the NAT will not accept from that peer.

The failure is structural, not a matter of tuning. It is why RFC 8445's ICE degrades to a **TURN relay** (§6) when at least one side is behind a symmetric NAT: the only reliably reachable rendezvous is a public relay both peers can send to, since neither can predict the other's ephemeral port. Some tools attempt *birthday-paradox port prediction* against symmetric NATs, but that is a probabilistic hack, not a protocol guarantee, and modern randomized-allocation NATs defeat it.

---

## 5. STUN: binding discovery formally (RFC 5389)

STUN (Session Traversal Utilities for NAT, RFC 5389, obsoleting RFC 3489) is a lightweight client/server protocol. The client sends a **Binding Request** to a public STUN server; the server replies with a **Binding Success Response** carrying the `XOR-MAPPED-ADDRESS` attribute — the source transport address the server observed, which *is* the client's post-NAT public endpoint on the path to that server.

Message structure (formal essentials):
- 20-byte header: 2-bit leading zeros, 14-bit **Message Type** (method + class), 16-bit **Message Length**, 32-bit **Magic Cookie** = `0x2112A442`, 96-bit **Transaction ID**.
- The magic cookie both disambiguates STUN from other protocols on a shared port and is XORed into the reflected address (`XOR-MAPPED-ADDRESS`) — this defeats broken ALGs that would otherwise "helpfully" rewrite a plaintext address embedded in the payload.
- Integrity via `MESSAGE-INTEGRITY` (HMAC-SHA1 over the message with a shared/short-term credential) and `FINGERPRINT` (CRC-32) for demultiplexing.

What STUN gives you is precisely one fact: *"through the NAT you sit behind, and toward me, your address is X:Y."* It says nothing authoritative about mapping/filtering type on its own (RFC 5389 deliberately removed the old RFC 3489 NAT-classification tests as unreliable; type inference now belongs to ICE connectivity checks). STUN is cheap, stateless on the server, and the foundation on which ICE builds *server-reflexive* candidates.

---

## 6. TURN: relay allocation as fallback

When direct traversal is impossible (symmetric NAT, restrictive enterprise firewalls, hairpin failures), TURN (Traversal Using Relays around NAT, RFC 8656, updating RFC 5766) supplies a public **relay**. The client sends an **Allocate** request; the TURN server reserves a **relayed transport address** on its own public IP and returns it. All peer traffic is then bounced through that relay:

```
peer  ⟶  TURN relay (public)  ⟶  client (behind NAT)
```

Formally, TURN converts a hard NAT-traversal problem into a trivial one: both endpoints now talk to a *publicly reachable* address (the relay), and the relay forwards. Mechanisms:
- **Allocation**: `(client, server-transport-address)` yields a relayed address with a lifetime (default 10 min, refreshed via Refresh requests). The allocation consumes a port on the TURN server — a real capacity cost.
- **Permissions**: the client installs per-peer permissions so the relay only forwards from authorized sources (a filtering analog).
- **Channels / Send indications**: bulk data uses lightweight ChannelData messages (4-byte header) to avoid STUN framing overhead per packet.

TURN is the *guaranteed* path but the *expensive* one: it consumes server bandwidth for the entire media stream and adds a relay hop of latency. ICE therefore treats TURN candidates as lowest priority — used only when nothing better connects. Operationally, a real deployment budgets a small single-digit percentage of sessions to relay; a spike toward that ceiling is a signal that symmetric NATs or firewalls are more prevalent than assumed.

---

## 7. ICE: gathering, pairing, nomination (RFC 8445)

ICE (Interactive Connectivity Establishment, RFC 8445) is the orchestration layer that combines direct paths, STUN reflexive paths, and TURN relays into a single systematic search for a working route. It runs in three formal phases.

**Candidate gathering.** Each agent enumerates *candidates* — potential transport addresses — of three types, each with a priority reflecting expected quality:
- **Host candidates**: the agent's own local interface addresses (LAN, VPN). Highest priority.
- **Server-reflexive (srflx)**: the public address discovered via STUN (§5). Medium priority.
- **Relayed**: a TURN relay address (§6). Lowest priority.

Candidates are exchanged out-of-band through a signaling channel (e.g., SDP over SIP/WebSocket) — ICE assumes a rendezvous mechanism already exists to trade candidate lists.

**Pairing and connectivity checks.** Each agent forms the cross product of its local candidates with the remote's candidates, ordered into a prioritized **check list**. It then probes each pair with **STUN Binding Requests sent peer-to-peer** — this is the actual hole-punching act: sending outbound to a peer both opens the local NAT mapping *and* tests whether the pair works. Because both sides send simultaneously, port-restricted-cone NATs are punched through. The prioritization formula (RFC 8445 §5.1.2) is deterministic and symmetric so both agents agree on the ordering:

```
priority = (2^24)·type_pref + (2^8)·local_pref + (256 − component_id)
```

**Nomination.** Once a candidate pair succeeds a connectivity check, the **controlling** agent nominates it (ICE's regular nomination sets the `USE-CANDIDATE` flag on a check for the chosen pair). The nominated pair for each component becomes the *selected pair*; media flows over it. Keepalives maintain the mapping thereafter.

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent A (controlling)
    participant SA as STUN/TURN A
    participant Sig as Signaling channel
    participant SB as STUN/TURN B
    participant B as Agent B (controlled)
    Note over A,B: Stage 1 — gather candidates
    A->>SA: STUN Binding / TURN Allocate
    SA-->>A: srflx + relayed candidates
    B->>SB: STUN Binding / TURN Allocate
    SB-->>B: srflx + relayed candidates
    Note over A,B: Stage 2 — exchange via signaling
    A->>Sig: SDP: host + srflx + relay
    Sig->>B: A's candidate list
    B->>Sig: SDP: host + srflx + relay
    Sig->>A: B's candidate list
    Note over A,B: Stage 3 — prioritized connectivity checks (hole punch)
    A->>B: STUN Binding Req (pair p1, high prio)
    B->>A: STUN Binding Req (pair p1, symmetric)
    A-->>B: check p1 succeeds (both mappings open)
    Note over A,B: Stage 4 — nomination
    A->>B: STUN Binding Req + USE-CANDIDATE (p1)
    B-->>A: success → p1 is the selected pair
    Note over A,B: media flows over p1; keepalives sustain it
```

If *every* direct pair fails — the symmetric-NAT case of §4 — the highest-priority *succeeding* pair is a relay↔relay or relay↔srflx pair, and ICE gracefully lands on TURN. The design guarantees connectivity whenever any relay is reachable, while opportunistically preferring the cheapest working path.

---

## 8. Hairpinning / NAT loopback

**Hairpinning** (a.k.a. NAT loopback) is the case where two hosts *behind the same NAT* must reach each other via the NAT's *public* address. This arises whenever an internal peer only knows the other peer's server-reflexive candidate — which is on the shared public IP — as happens routinely in ICE when both endpoints sit behind the same CGNAT.

The packet path bends back on itself like a hairpin:

```
Host A (10.0.0.7)  →  dst = 203.0.113.9:40002 (public, the NAT's own)
        the NAT must recognize the destination as one of its own mappings,
        translate BOTH src and dst, and send it back inward:
        →  src = 203.0.113.9:40001 (A's external), dst = 10.0.0.8:52000 (B internal)
Host B (10.0.0.8)  ←
```

RFC 4787 REQ-9 requires NATs to **support hairpinning** and specifies that the hairpinned packet's *source* address, as seen by the destination internal host, must be the **external** mapped address (not the raw internal one) — so that B's reply logic and any ICE checks remain consistent with what B expects. NATs that lack hairpinning support silently drop the loopback packet, and same-NAT peers can only connect via a TURN relay (an absurd but real outcome: two machines on the same LAN relaying through a public server). Hairpin support is therefore a correctness requirement, not a nicety, for peer-to-peer media inside large shared networks.

---

## 9. CGNAT and the shared-address regime (RFC 6598)

Carrier-Grade NAT (CGNAT, a.k.a. Large-Scale NAT / NAT444) pushes translation up into the ISP. Subscribers get private addresses; the ISP performs a *second* NAT between subscribers and the public Internet — hence NAT444: private ⇒ CGNAT-shared ⇒ public.

RFC 6598 allocated a dedicated block for the intermediate "shared address space": **100.64.0.0/10** (100.64.0.0 – 100.127.255.255, ~4.19M addresses). It is deliberately *not* RFC 1918 private space: reusing 10/8 or 192.168/16 there would collide with subscribers' own home networks. 100.64/10 is non-globally-routable but distinct, sitting between the customer premises and the carrier NAT.

Because thousands of subscribers now share a handful of public IPs, CGNAT allocates the port space in **port blocks**: subscriber *k* is deterministically or dynamically assigned a contiguous range (e.g., 512 or 1024 ports) of some public IP. Deterministic port-block allocation is preferred operationally because it makes the reverse mapping *computable from the public 5-tuple alone* — essential for lawful-intercept and abuse attribution logging without storing per-flow records. The capacity arithmetic is brutal:

```
subscribers_per_public_ip = usable_ports / ports_per_subscriber
   e.g. 64512 / 512 ≈ 126 subscribers per public IPv4 address
```

Consequences of shared public IPs:

| Consequence | Mechanism | Impact |
|---|---|---|
| Port starvation | fixed per-subscriber port block | tab-heavy browsing / P2P exhausts the block → connection failures |
| Collective reputation | many users behind one IP | one abuser triggers CAPTCHAs / bans for all sharers |
| Broken inbound / port-forward | no per-subscriber public IP | self-hosting, some P2P, and static forwards impossible |
| Geolocation blur | IP maps to carrier POP | location/IP-based features degrade |
| Traversal harder | often symmetric-ish behavior + hairpin dependence | more sessions fall back to TURN |
| Logging burden | attribution needs port+time | ISP must retain port-block logs for compliance |

CGNAT is a coping mechanism for IPv4 scarcity that trades a real resource (public addresses) for a shared, contended one (ports) — and imports every downside of address sharing.

---

## 10. The end-to-end violation and how IPv6 removes NAT

The **end-to-end principle** (Saltzer, Reed, Clark) holds that the network core should be a dumb, stateless forwarder and that addressing should identify endpoints unambiguously and stably. NAT violates this on multiple axes:

- **Address transparency is broken.** A host's identity as seen by a peer is not its own address but a NAT-assigned rewrite that varies by path (symmetric) and expires (soft state). Protocols that embed addresses in their payload (SIP, FTP active mode, some RPC) break unless an Application Layer Gateway rewrites them — pushing application knowledge into the network, exactly what end-to-end forbids.
- **Statefulness at the core.** NAT holds per-flow state; a NAT reboot severs every connection. The network is no longer a stateless commodity.
- **Asymmetric reachability.** Inbound connections require pre-existing outbound state, so the "any host can address any host" invariant is lost. Peer-to-peer becomes a research problem (all of §5–§8 exists *only* because of this).
- **Layering violation.** NAT, a network-layer device, must parse and rewrite transport-layer ports (and, via checksums, reach into transport headers) — coupling layers the architecture kept separate.

**IPv6 removes the *need* for NAT** by eliminating its root cause — address scarcity. With a 128-bit address space, every device (indeed every network — a typical residential /64 offers 2⁶⁴ addresses) gets a globally unique, routable address. There is no motive to multiplex hosts behind a shared address, so:
- Every endpoint has a stable, path-independent public identity ⇒ STUN/TURN/ICE reduce to trivial or unnecessary for addressing (a firewall may still filter, but the *address* is real).
- Hairpinning, port exhaustion, port-block logging, and shared-reputation problems vanish — they are all artifacts of address sharing.
- The end-to-end invariant is restored at the addressing layer.

IPv6 keeps a stateful **firewall** at the edge for security (default-deny inbound is still sound policy), but that is *filtering*, not *translation*: no address rewrite, no per-flow mapping table required for connectivity, no ambiguity about who a host is. NAT66 exists but is discouraged (RFC 4864 argues the security goals people attribute to NAT are achievable with stateful firewalling alone, without the translation). The historical lesson: NAT was never a feature — it was a symptom of a full address space, and IPv6 is the cure.

---

## 11. Principal-level synthesis

- Treat NAT as a **stateful function over the 5-tuple** with soft-state timers, not as a black box. Every anomaly (dropped inbound, dead UDP session, intermittent connection failure) is explained by table lookup, filtering rule, or timer expiry.
- The **mapping/filtering axes of RFC 4787** are the right mental model; cone terms are lossy shorthand. Endpoint-Independent Mapping is the property that makes traversal cheap; Address-and-Port-Dependent Mapping (symmetric) is the property that forces relays.
- Design traversal as **ICE** — never hand-roll hole punching. ICE's prioritized search *guarantees* connectivity (falling back to TURN) while *preferring* the cheapest working path. Budget TURN capacity as a real cost and monitor the relay-fallback rate as a NAT-hostility signal.
- **Port budget is the scaling wall.** For any large NAT or CGNAT, `concurrent_mappings ≤ public_ips × usable_ports` is the governing inequality; symmetric mapping multiplies the per-host cost by fan-out. Deterministic port-block allocation buys computable attribution at the cost of a hard per-subscriber ceiling.
- The strategic direction is **IPv6**: it does not "traverse" NAT better — it removes the reason NAT exists. Everything in §5–§9 is technical debt paid down by a large enough address space.

---

## 12. References

- **RFC 4787** — NAT Behavioral Requirements for Unicast UDP (mapping/filtering taxonomy, timers, hairpinning REQ-9).
- **RFC 5389** — Session Traversal Utilities for NAT (STUN); obsoletes RFC 3489.
- **RFC 8445** — Interactive Connectivity Establishment (ICE); obsoletes RFC 5245.
- **RFC 8656** — Traversal Using Relays around NAT (TURN); updates RFC 5766.
- **RFC 6598** — IANA-Reserved IPv4 Prefix for Shared Address Space (100.64.0.0/10).
- **RFC 4864** — Local Network Protection for IPv6 (why stateful firewalling replaces NAT's security role).
- **RFC 2663** — IP Network Address Translator (NAT) Terminology and Considerations.
- Saltzer, Reed, Clark — *End-to-End Arguments in System Design* (1984).

*Next step:* [Staff level](staff.md)
