# UDP — Middle

> **Axis: applied.** Junior answered "what is a datagram and why would I choose UDP?" This level answers the operational question a working engineer hits: *how do I actually send UDP correctly under real load without corrupting data, fragmenting packets, or melting the network?* We go byte-for-byte through the header, pin down the size you are allowed to send, and confront the two things UDP does **not** give you — reliability and congestion control — that your application must supply itself.

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [The UDP Header, Byte by Byte](#2-the-udp-header-byte-by-byte)
3. [Datagram Size, the Path MTU, and Fragmentation](#3-datagram-size-the-path-mtu-and-fragmentation)
4. [No Flow Control, No Congestion Control — and Why That Bites](#4-no-flow-control-no-congestion-control--and-why-that-bites)
5. [Building Reliability on Top of UDP](#5-building-reliability-on-top-of-udp)
6. [Multicast and Broadcast](#6-multicast-and-broadcast)
7. [Where UDP Is Actually Used](#7-where-udp-is-actually-used)
8. [Middle Checklist](#8-middle-checklist)

---

## 1. Prerequisites
- You can read a socket API: `socket(AF_INET, SOCK_DGRAM, 0)`, `sendto`, `recvfrom`.
- You understand that IP delivers packets between hosts and UDP adds only **ports + a checksum** on top.
- You have seen TCP's three-way handshake and know it provides ordering, retransmission, and congestion control — the exact features UDP omits.
- You know an IP packet has a maximum size and that Ethernet's classic MTU is 1500 bytes.

The one-sentence mental model to carry into this level: **UDP is IP with two port numbers and an optional integrity check bolted on — nothing else.** Every guarantee TCP gives you that UDP does not, you now own.

---

## 2. The UDP Header, Byte by Byte

UDP's entire header is **8 bytes** — four 16-bit fields (RFC 768). Compare that to TCP's 20-byte minimum header with sequence numbers, acknowledgment numbers, window size, and flags. The smallness *is* the design.

```text
 0      7 8     15 16    23 24    31   ← bit offset
+--------+--------+--------+--------+
|     Source Port | Destination Port|   bytes 0–3
+--------+--------+--------+--------+
|      Length     |     Checksum    |   bytes 4–7
+--------+--------+--------+--------+
|            data (payload)         |
+-----------------------------------+
```

| Field | Size | Meaning | Practical notes |
|-------|------|---------|-----------------|
| **Source Port** | 16 bits | Sender's port; where replies should go | May be `0` if no reply is expected. The OS picks an ephemeral port (typically 49152–65535) when you don't `bind`. |
| **Destination Port** | 16 bits | The well-known port the datagram is addressed to | 53 = DNS, 67/68 = DHCP, 123 = NTP, 443 = QUIC/HTTP-3. The kernel demultiplexes to the socket bound here. |
| **Length** | 16 bits | Length of header + data, in bytes | Minimum 8 (header only, empty payload). Theoretical max 65,535; real payload ceiling is 65,507 over IPv4 (65,535 − 8 UDP − 20 IP). |
| **Checksum** | 16 bits | Integrity check over header + data + a pseudo-header | **Optional over IPv4** (a value of `0` means "not computed"); **mandatory over IPv6**. Covers a *pseudo-header* (src/dst IP, protocol, length) so a misdelivered datagram is detected. |

Three consequences fall directly out of this header:

1. **No connection, no state.** There is no sequence number, no flags, no window. The kernel keeps essentially nothing per "flow." That is why a single UDP socket can serve millions of clients (a DNS resolver) without per-client memory.
2. **The checksum is weak and one-shot.** It is a 16-bit one's-complement sum — it catches most single-bit and small burst errors but is far weaker than a CRC. If it fails, the kernel **silently drops** the datagram; your application never hears about it. There is no retransmission. If you need strong integrity, add your own (e.g., a CRC32 or HMAC in the payload).
3. **The pseudo-header matters.** Because the checksum covers the source and destination IP addresses, a datagram delivered to the wrong host (e.g., due to a corrupted IP header) is caught. This is why you cannot naively rewrite IP addresses (NAT) without recomputing the UDP checksum.

> A concrete gotcha: over IPv4 many senders leave the checksum at `0` to save CPU. That is legal but means a corrupted payload arrives at your application looking perfectly valid. Over IPv6 this shortcut is forbidden precisely because IPv6 dropped the IP-layer header checksum, so UDP's checksum is the *only* integrity check.

---

## 3. Datagram Size, the Path MTU, and Fragmentation

This is the single most important operational skill at the middle level, and where most naive UDP code goes wrong.

**The chain of limits.** A UDP payload sits inside an IP packet, which travels inside a link-layer frame. Each layer imposes a maximum:

```text
Ethernet frame MTU ............ 1500 bytes   (classic; the number to memorize)
  − IPv4 header ................  20 bytes   (40 for IPv6)
  − UDP header .................   8 bytes
  ───────────────────────────────────────
  = safe UDP payload ..........~1472 bytes over IPv4 on a 1500-MTU link
                              ~1452 bytes over IPv6
```

**What happens if you exceed it.** If you `sendto` a 4000-byte UDP payload, IP must **fragment** it into multiple packets that are reassembled at the destination. Fragmentation is quietly hostile:

- **All-or-nothing loss amplification.** If *any one* fragment is lost, the *entire* datagram is discarded — the receiver cannot deliver a partial datagram to your app. A single 1% per-packet loss rate on a datagram split into 4 fragments gives roughly `1 − 0.99⁴ ≈ 4%` effective datagram loss. Fragmentation multiplies your loss.
- **Middleboxes drop fragments.** Many firewalls, NATs, and load balancers cannot route non-first fragments (they lack the port numbers, which appear only in the first fragment) and simply drop them. Your datagram vanishes with no error.
- **Reassembly cost and attacks.** The receiver must buffer fragments and run a reassembly timer; this is a classic DoS surface (fragment floods).

**Path MTU vs link MTU.** Your local link may be 1500, but a tunnel (VPN, PPPoE, GRE) somewhere along the path may be smaller (often 1400 or less). The **path MTU** is the minimum MTU across every hop. You usually don't know it.

**The practical rule engineers actually use:** keep UDP payloads **under ~1200 bytes** (many protocols use 1200 exactly). This sits safely below even tunneled paths and IPv6's guaranteed minimum MTU of 1280 bytes, so no fragmentation occurs anywhere.

```text
Real-world size budgets:
  DNS over UDP (classic) .......... 512 bytes   (RFC 1035 original limit)
  DNS with EDNS0 .................. often 1232   (chosen to dodge fragmentation)
  QUIC initial packets ............ ≤ 1200 bytes payload target
  Safe cross-internet UDP ......... ≤ 1200 bytes  ← the number to remember
```

If your message is genuinely larger than the safe MTU, **do not rely on IP fragmentation** — split it yourself at the application layer into MTU-sized chunks with your own sequence numbers, exactly as Section 5 describes. You control the loss granularity that way: losing one chunk costs you one chunk, not the whole message.

---

## 4. No Flow Control, No Congestion Control — and Why That Bites

TCP watches for loss and *slows down*: it has a congestion window that shrinks when packets drop and a receive window that stops the sender from overrunning a slow receiver. **UDP has neither.** `sendto` hands the datagram to the kernel and returns immediately; the kernel forwards it as fast as the socket buffer drains. Nothing throttles you.

**Flow control (receiver protection).** If you blast datagrams faster than the receiver's application can `recvfrom` them, the kernel's per-socket receive buffer (`SO_RCVBUF`) fills and further datagrams are **silently dropped**. The sender gets no signal. A slow consumer therefore loses data invisibly under a fast producer.

**Congestion control (network protection).** This is the dangerous one. If every UDP sender ignores loss and keeps transmitting at full rate, a congested link never recovers — queues stay full, loss stays high, and throughput collapses. This is **congestion collapse**, the failure mode TCP's congestion control was invented to prevent. A UDP application that does not pace itself is antisocial: it can starve the TCP flows sharing the same link (which *do* back off) and degrade the whole network.

```text
The obligation:
  If your UDP traffic is more than a trickle, YOU must implement:
    • Pacing        — space packets out; don't dump a burst into the socket.
    • Loss response — detect drops and reduce your send rate.
    • A rate cap     — a ceiling you never exceed regardless of demand.

  "TCP-friendliness" means: under the same loss, send no more than a
  TCP flow would. QUIC and modern RTP implementations do exactly this,
  running a congestion-control algorithm (e.g., CUBIC, BBR) in userspace.
```

**The key insight:** choosing UDP does not *remove* the need for congestion control — it **moves that responsibility from the kernel into your application**. QUIC's designers embraced this: by building congestion control in userspace over UDP, they can ship a new algorithm as a software update instead of waiting years for OS kernels and middleboxes to change. VoIP/RTP applications similarly monitor loss and jitter and adapt their codec bitrate downward. If you skip this, you have not built a "fast" protocol — you have built a bad network citizen.

---

## 5. Building Reliability on Top of UDP

When you need *some* of TCP's guarantees but not all of them, you build them yourself in the payload. This is "reinventing bits of TCP" — and it is exactly what QUIC does. The three primitives:

| Guarantee you want | What you add to the payload | Cost |
|--------------------|-----------------------------|------|
| **Detect loss / reorder** | A monotonically increasing **sequence number** per datagram | 4–8 bytes/packet; sender keeps a send counter |
| **Confirm delivery** | Receiver returns an **ACK** naming the highest (or each) sequence received | An extra packet per ACK (or batched/cumulative ACKs) |
| **Recover loss** | Sender keeps unacked packets and **retransmits** after a timeout (RTO) or on duplicate-ACK signal | Buffer memory + a retransmission timer per outstanding packet |
| **Order delivery** | Receiver **buffers** out-of-order arrivals and releases them in sequence | Reorder buffer; head-of-line blocking if you insist on strict order |
| **Not overload the net** | A **congestion window / pacer** (Section 4) | Complexity; this is the hard part |

The reliable-send loop, staged:

```mermaid
sequenceDiagram
    autonumber
    participant S as Sender
    participant R as Receiver
    S->>R: DATA seq=1
    S->>R: DATA seq=2
    Note over S: buffer seq 1,2 until ACKed; start RTO timers
    R-->>S: ACK 1
    R-->>S: ACK 2
    Note over R: seq 1,2 delivered in order
    S->>R: DATA seq=3
    Note over R: seq 3 LOST in the network
    S->>R: DATA seq=4
    Note over R: got seq=4 but not seq=3 → gap! buffer 4, don't deliver yet
    R-->>S: ACK 4 (still missing 3)
    Note over S: RTO for seq=3 fires (no ACK 3)
    S->>R: DATA seq=3 (retransmit)
    R-->>S: ACK 3
    Note over R: gap filled → deliver seq 3, then buffered 4, in order
```

Design decisions you must make explicitly — this is where "reinventing TCP" gets nuanced:

- **How much reliability do you actually need?** Full in-order reliability turns your protocol back into TCP-over-UDP, and you inherit **head-of-line blocking**: one lost packet stalls everything behind it. Often you want *partial* reliability. A game sends position updates where only the *latest* matters — a lost update is simply overwritten by the next, so you skip retransmission entirely and just carry a sequence number to discard stale arrivals.
- **ACK strategy.** Per-packet ACKs are simple but chatty. Cumulative ACKs ("I have everything through N") and selective ACKs ("I have N, and also N+2, N+3") reduce overhead and let the sender retransmit precisely.
- **RTO estimation.** Retransmitting too eagerly wastes bandwidth and worsens congestion; too slowly adds latency. TCP estimates the round-trip time and its variance (smoothed RTT) to set the timeout adaptively — you should too.
- **Idempotency.** Retransmits and duplicate deliveries mean the receiver may see the same sequence number twice. Dedup on sequence number, or make processing idempotent.

> **The honest conclusion:** if you find yourself implementing sequence numbers, cumulative ACKs, RTO estimation, reordering buffers, *and* congestion control, you have rebuilt TCP — and you should ask whether TCP (or QUIC, which already did this work carefully) is the right choice. UDP is worth the effort only when you need something TCP cannot give: partial reliability, multiple independent streams without cross-stream head-of-line blocking, multicast, or userspace control over the congestion algorithm.

---

## 6. Multicast and Broadcast

UDP can address **more than one recipient at once** — something TCP, being strictly point-to-point, cannot do. This is a genuine capability, not just a performance tweak.

- **Broadcast** — a datagram sent to a special address (e.g., `255.255.255.255` or a subnet-directed `192.168.1.255`) is delivered to *every* host on the local link. Used for local discovery when you don't yet know anyone's address. **DHCP** relies on this: a booting client has no IP yet, so it broadcasts `DHCPDISCOVER` to reach any server on the segment. Broadcast is IPv4-only and does not cross routers.
- **Multicast** — a datagram sent to a multicast group address (`224.0.0.0`–`239.255.255.255` in IPv4) is delivered only to hosts that have *joined* that group (via IGMP). The network replicates the packet at branch points, so the sender transmits **once** regardless of how many receivers there are. This is how you fan out efficiently: streaming market-data feeds to hundreds of trading servers, IPTV video distribution, and service-discovery protocols like **mDNS** (multicast DNS, used by Bonjour/Zeroconf) and **SSDP** (UPnP discovery).

```text
Delivery scope:
  Unicast   → one specific host          (most UDP: DNS query, NTP)
  Broadcast → every host on the subnet   (DHCP discovery; IPv4 only)
  Multicast → every host that joined the group, replicated by the network
              (market data, IPTV, mDNS, SSDP)
```

Two operational cautions: multicast typically does **not** traverse the public internet (routers don't forward it by default), so it is a data-center / LAN tool. And because it is one-to-many with no ACKs, multicast reliability (if you need it) is even harder than unicast — you cannot have every receiver ACK a single sender without an ACK implosion, so systems use negative-acknowledgment (NAK) or forward error correction instead.

---

## 7. Where UDP Is Actually Used

UDP wins wherever the cost of TCP's guarantees — connection setup latency, head-of-line blocking, per-connection state — outweighs their benefit. Concrete cases:

| Protocol | Port | Why UDP fits |
|----------|------|--------------|
| **DNS** | 53 | One tiny request, one tiny reply. A connection handshake would double the latency. Retransmit is trivial (just re-ask). Falls back to TCP only when the response exceeds the safe UDP size. |
| **DHCP** | 67/68 | The client has **no IP address yet**, so it must broadcast — impossible over connection-oriented TCP. |
| **NTP** | 123 | A single request/response exchanges timestamps. Retransmitting a lost time sample is pointless; you just take the next one. Minimal overhead keeps the timing measurement clean. |
| **VoIP / RTP** | dynamic | For live audio/video, a **late packet is useless** — you'd rather drop it and play the next frame than stall waiting for a retransmit. UDP's "no retransmission" is a *feature* here; the app conceals loss (packet-loss concealment) instead of fixing it. |
| **QUIC / HTTP-3** | 443 | Runs a *full* reliable, congestion-controlled, encrypted, multi-stream transport **in userspace over UDP** — precisely to escape the ossification of TCP in kernels and middleboxes, and to eliminate cross-stream head-of-line blocking. |

The unifying pattern: pick UDP when **(a)** the exchange is tiny and stateless (DNS, NTP), **(b)** you fundamentally cannot use a connection (DHCP, discovery), **(c)** timeliness beats completeness (real-time media), or **(d)** you want to build your *own* transport with control TCP won't give you (QUIC). In every other case — bulk transfer, request/response over long-lived connections, anything where every byte must arrive in order — TCP is the correct default and UDP is a trap that makes you re-implement it badly.

---

## 8. Middle Checklist
- [ ] I keep UDP payloads **under ~1200 bytes** to avoid IP fragmentation on any real path; larger messages are chunked at the application layer with my own sequence numbers.
- [ ] I know the checksum is optional over IPv4 (and weak), and I add stronger integrity (CRC/HMAC) if corruption matters.
- [ ] If I send more than a trickle of UDP, I implement pacing and a loss-driven rate cap so I don't cause congestion collapse or starve TCP flows.
- [ ] Where I need reliability, I have decided **which** guarantees I need (loss detection? ordering? full reliability?) rather than blindly rebuilding all of TCP.
- [ ] I dedup on sequence number so retransmits/duplicates are harmless.
- [ ] I have consciously verified that UDP is the right tool — that TCP or QUIC would not serve better — before owning all of this myself.

---

*Next step:* [UDP — Senior](senior.md)
