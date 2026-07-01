# TCP vs UDP — Theory and Formal Foundations

Two transport protocols sit atop IP, and the choice between them is a choice of *which guarantees you buy and which you build yourself*. TCP (RFC 793, updated by RFC 9293) is a connection-oriented, reliable, ordered, flow- and congestion-controlled byte stream. UDP (RFC 768) is a connectionless, unreliable, unordered datagram service — eight bytes of header over raw IP. This chapter treats both as formal objects: TCP as a finite state machine over a shared sequence space, and its correctness/performance as consequences of the sliding window, the control loops, and the closed-form throughput law that governs them.

## Table of contents

1. [The TCP connection as a state machine](#1-the-tcp-connection-as-a-state-machine)
2. [Sequence numbers, ACKs, and the sliding window](#2-sequence-numbers-acks-and-the-sliding-window)
3. [Flow control vs congestion control — a formal separation](#3-flow-control-vs-congestion-control--a-formal-separation)
4. [Congestion-control algorithms: Reno, CUBIC, BBR](#4-congestion-control-algorithms-reno-cubic-bbr)
5. [The throughput bound — Mathis, worked](#5-the-throughput-bound--mathis-worked)
6. [TIME_WAIT: purpose and exhaustion](#6-time_wait-purpose-and-exhaustion)
7. [UDP: the minimalist datagram](#7-udp-the-minimalist-datagram)
8. [Decision table and closing synthesis](#8-decision-table-and-closing-synthesis)

---

## 1. The TCP connection as a state machine

A TCP endpoint is a finite automaton. RFC 793 defines eleven states; every segment sent or received, and every timer that fires, is a transition. The connection is fully described by the pair of state variables at each end plus the sequence-space bookkeeping. Modeling it as an FSM is not pedagogy — it is how kernels implement it (`tcp_rcv_state_process` in Linux is literally a switch over these states) and how model checkers verify it.

The handshake establishes synchronized sequence numbers (the *SYN* = "synchronize"). The three-way handshake is the minimum message count that lets both sides agree on each other's Initial Sequence Number (ISN) while defending against duplicated segments from prior incarnations: SYN → SYN/ACK → ACK.

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> LISTEN: passive open
    CLOSED --> SYN_SENT: active open / send SYN
    LISTEN --> SYN_RCVD: recv SYN / send SYN,ACK
    SYN_SENT --> SYN_RCVD: recv SYN / send SYN,ACK
    SYN_SENT --> ESTABLISHED: recv SYN,ACK / send ACK
    SYN_RCVD --> ESTABLISHED: recv ACK
    ESTABLISHED --> FIN_WAIT_1: close / send FIN
    ESTABLISHED --> CLOSE_WAIT: recv FIN / send ACK
    FIN_WAIT_1 --> FIN_WAIT_2: recv ACK of FIN
    FIN_WAIT_1 --> CLOSING: recv FIN / send ACK
    FIN_WAIT_2 --> TIME_WAIT: recv FIN / send ACK
    CLOSING --> TIME_WAIT: recv ACK of FIN
    CLOSE_WAIT --> LAST_ACK: close / send FIN
    LAST_ACK --> CLOSED: recv ACK of FIN
    TIME_WAIT --> CLOSED: 2*MSL timeout
    CLOSED --> [*]
```

Read the diagram in three arcs. **Open** (top): the passive side parks in `LISTEN`; the active side fires a SYN and enters `SYN_SENT`; both converge on `ESTABLISHED`. The diagonal `SYN_SENT → SYN_RCVD` edge is the *simultaneous open* — two peers actively connecting to each other cross SYNs and still succeed. **Data transfer**: the entire payload lifetime happens inside `ESTABLISHED`; the FSM has nothing to say about it because reliability there is handled by the window machinery of §2, not by state changes. **Close** (bottom): the four-way teardown. Because each direction of the byte stream closes independently (a *half-close* is legal — you may stop sending while still receiving), teardown needs two FIN/ACK exchanges, not one. The initiator of the close is the side that lands in `TIME_WAIT`; §6 explains why it must wait there for `2·MSL`.

The FSM is *robust by construction*: unexpected segments in a given state trigger an RST or are dropped, never an undefined transition. This total-function property is what lets TLA+ specifications of TCP be model-checked for deadlock- and livelock-freedom.

---

## 2. Sequence numbers, ACKs, and the sliding window

TCP numbers **bytes**, not segments. Every octet in each direction has a 32-bit sequence number, wrapping modulo 2³². A segment carries a sequence number (the number of its first data byte) and, in the reverse direction, an acknowledgment number that is *cumulative*: `ACK = n` means "I have received all bytes with sequence number `< n`; send me byte `n` next." Cumulative ACKs make loss of an ACK harmless — the next ACK subsumes it.

The **sliding window** is the mechanism that decouples "bytes sent" from "bytes acknowledged," permitting many bytes to be in flight without waiting for each to be confirmed. Let:

- `SND.UNA` — oldest unacknowledged sequence number
- `SND.NXT` — next sequence number to send
- `SND.WND` — the send window (bytes the sender is currently allowed to have outstanding)

The invariant the sender maintains at all times is:

```
SND.NXT - SND.UNA  ≤  SND.WND
```

i.e. **bytes in flight ≤ window**. The window slides forward as ACKs advance `SND.UNA`. The effective window is the *minimum* of two independent limits:

```
SND.WND = min( rwnd , cwnd )
```

where `rwnd` is the receiver's advertised window (flow control, §3) and `cwnd` is the sender's congestion window (congestion control, §3–4). This `min` is the single point where the two control loops meet.

Cumulative ACKs alone stall the pipe on any loss (Go-Back-N behavior). Two refinements fix this:

- **Fast retransmit / fast recovery** (RFC 5681): three duplicate ACKs are treated as a loss signal, triggering retransmission *before* the RTO timer expires.
- **Selective Acknowledgment — SACK** (RFC 2018): the receiver reports non-contiguous received ranges in a TCP option, so the sender retransmits *only* the actual holes, approximating Selective-Repeat ARQ.

The retransmission timeout itself is derived from a smoothed RTT estimator (RFC 6298): the sender tracks `SRTT` (smoothed RTT) and `RTTVAR` (mean deviation), and sets `RTO = SRTT + 4·RTTVAR`, clamped to a minimum of 1 s. Karn's algorithm forbids sampling RTT from retransmitted segments (the ACK is ambiguous), and exponential backoff doubles the RTO on each successive timeout.

The **bandwidth–delay product** sets the window you *need*: to keep a link of bandwidth `B` full over round-trip time `RTT`, you must have `BDP = B · RTT` bytes in flight. On a 1 Gbps path with 80 ms RTT, `BDP = 10⁹/8 · 0.08 ≈ 10 MB` — far beyond the 64 KB ceiling of the original 16-bit window field. The **window scale option** (RFC 7323) multiplies `rwnd` by up to 2¹⁴, making full utilization of long fat networks (LFNs) possible.

---

## 3. Flow control vs congestion control — a formal separation

These are constantly conflated in interviews and both are "don't send too fast," but they answer different questions and are enforced by different variables.

**Flow control** protects the *receiver*. It answers: *how much can the receiver buffer right now?* The receiver advertises `rwnd` in every ACK, equal to its free socket-buffer space. The sender obeys `bytes in flight ≤ rwnd`. This is an end-to-end contract between exactly two hosts; the network is invisible to it. Its pathologies are the *silly window syndrome* (tiny windows causing tiny segments), fixed by Nagle's algorithm on the sender and Clark's algorithm on the receiver, and the *zero-window* state, probed by persist timers.

**Congestion control** protects the *network*. It answers: *how much can the path between us carry without building queues and dropping packets?* The network never tells you this number — there is no field for it. The sender must *infer* it from implicit signals (loss, delay, or ECN marks) and encode its estimate in `cwnd`, a purely local variable that appears in no packet.

| Dimension | Flow control | Congestion control |
|---|---|---|
| Protects | The receiver's buffer | The shared network path |
| State variable | `rwnd` (advertised, in every ACK) | `cwnd` (local to sender, never on wire) |
| Signal source | Explicit — receiver tells you | Implicit — inferred from loss/delay/ECN |
| Scope | End-to-end (2 hosts) | Path-wide (all flows sharing bottleneck) |
| Failure mode | Receiver overrun / silly window | Congestion collapse |
| Introduced by | RFC 793 (original) | Van Jacobson, 1988 (RFC 5681) |

The historical stakes are asymmetric. Flow control shipped with TCP in 1981. Congestion control did not — and the result was the **congestion collapse** of October 1986, when the NSFNET backbone throughput fell from 32 kbps to 40 *bits* per second as retransmissions of already-queued packets fed a runaway feedback loop. Van Jacobson's 1988 paper introduced slow start and congestion avoidance, retrofitting the network's missing control loop. Everything in §4 descends from that work.

The sender's actual send window, restated, is `min(rwnd, cwnd)`: flow control and congestion control are two ceilings, and TCP always respects the lower. On modern LANs `rwnd` is rarely the binding constraint; on the wide-area Internet, `cwnd` almost always is.

---

## 4. Congestion-control algorithms: Reno, CUBIC, BBR

A congestion-control algorithm is a function that maps observed feedback to a `cwnd` trajectory over time. Three generations dominate.

### Reno / NewReno — loss-based AIMD

TCP Reno (RFC 5681, with NewReno's loss-recovery refinement in RFC 6582) is the canonical **Additive-Increase / Multiplicative-Decrease** (AIMD) controller. Its rules:

- **Slow start** — while `cwnd < ssthresh`, grow `cwnd` by 1 MSS per ACK, doubling `cwnd` every RTT (exponential probe of the pipe).
- **Congestion avoidance** — once `cwnd ≥ ssthresh`, add roughly 1 MSS per RTT: `cwnd ← cwnd + MSS²/cwnd` per ACK (the *additive increase*).
- **Loss (3 dup-ACKs)** — halve: `ssthresh ← cwnd/2`, `cwnd ← ssthresh` (the *multiplicative decrease*), then fast-recover.
- **Timeout** — collapse to `cwnd = 1 MSS` and re-enter slow start.

Chiu and Jain (1989) proved that AIMD is the linear control law that converges to **fair and efficient** allocation among competing flows — additive increase moves the allocation vector toward the fairness line, multiplicative decrease moves it toward the origin along that line. The visible signature is the **sawtooth**: `cwnd` ramps linearly, halves on loss, repeats. Reno's structural weakness is that a *single* loss per RTT is enough to hold it back, so on high-BDP paths it cannot keep `cwnd` near the BDP — the sawtooth spends most of its time below the line.

### CUBIC — loss-based, RTT-fair (Linux default)

CUBIC (RFC 9438; Ha, Rhee, Xu 2008) replaces linear increase with a **cubic function of time since the last loss**:

```
cwnd(t) = C·(t − K)³ + W_max ,   K = ∛( W_max·β / C )
```

where `W_max` is the window at the last loss, `β` the multiplicative-decrease factor (0.7 in CUBIC vs 0.5 in Reno), and `C` a scaling constant. The curve grows *fast* far below `W_max`, *slowly* near it (concave "plateau"), then *fast again* above it (convex probing). Two consequences: recovery to full utilization after a loss is far quicker on high-BDP links, and — crucially — `cwnd(t)` depends on wall-clock time, **not** on RTT, so CUBIC is *RTT-fair*: flows with different round-trip times converge to comparable shares. CUBIC has been Linux's default since kernel 2.6.19 (2006). It remains loss-based: it needs a dropped packet to learn the ceiling, which means it fills bottleneck buffers (bufferbloat) before it backs off.

### BBR — model-based (bandwidth × RTT)

BBR (Cardwell et al., Google, 2016) discards loss-as-signal entirely. It builds an explicit **model of the path**: it continuously estimates the *bottleneck bandwidth* (`BtlBw`, the max delivery rate observed) and the *round-trip propagation delay* (`RTprop`, the min RTT observed). The optimal operating point — Kleinrock's — is exactly at `BDP = BtlBw · RTprop`: the point of maximum throughput and minimum queueing. BBR paces its send rate at `BtlBw` and caps in-flight data near the BDP, deliberately *not* filling the buffer. It cycles through phases — `STARTUP` (exponential ramp), `DRAIN`, `PROBE_BW` (gain-cycles that probe for more bandwidth), and periodic `PROBE_RTT` (drain the pipe to re-measure `RTprop`). Because it ignores loss, BBR tolerates lossy links (mobile, transcontinental) that would cripple Reno/CUBIC, but early BBRv1 could be unfair to loss-based flows sharing a buffer; BBRv2/v3 add loss and ECN response to address this.

| Property | Reno / NewReno | CUBIC | BBR |
|---|---|---|---|
| Signal | Packet loss | Packet loss | Delivery rate + min RTT (model) |
| `cwnd` growth | Linear in RTT (AIMD) | Cubic in wall-clock time | Rate-paced to `BtlBw`, in-flight ≈ BDP |
| Decrease factor β | 0.5 | 0.7 | n/a (no MD on loss) |
| RTT fairness | Poor (RTT-biased) | Good (time-based) | Good |
| High-BDP links | Weak | Strong | Strong |
| Lossy (non-congestion) links | Very poor | Poor | Strong |
| Bufferbloat | Fills buffers | Fills buffers | Avoids queueing |
| Operating point | Below BDP (sawtooth) | Near BDP after ramp | At BDP (Kleinrock optimum) |
| Default in | Legacy / textbook | Linux (2.6.19+) | Google, YouTube, opt-in Linux |

---

## 5. The throughput bound — Mathis, worked

The **Mathis equation** (Mathis, Semke, Mahdavi, Ott 1997) gives the steady-state throughput of a loss-based AIMD flow (Reno) as a closed form. It is the single most useful back-of-envelope result in transport theory. The bound:

```
                MSS      C
   BW  ≈  ───────────── · ───
             RTT          √p
```

where `MSS` is the maximum segment size, `RTT` the round-trip time, `p` the packet-loss probability, and `C` a constant near 1 (≈ 1.22 for the deterministic-periodic model, often taken as 1 for estimates). The scaling that matters:

> **Throughput is inversely proportional to RTT and to the square root of loss.**

**Derivation sketch.** In steady state, `cwnd` sawtooths between `W/2` and `W` (halve-on-loss). One packet is lost per cycle. A cycle lasts `W/2` RTTs (additive increase climbs from `W/2` to `W`, +1 per RTT). Packets delivered per cycle ≈ the area of the sawtooth ≈ `(3/8)·W²`. Since exactly one loss occurs per cycle, `p = 1 / [(3/8)W²]`, giving `W = √(8/(3p))`. Average throughput = (packets per cycle) × MSS / (cycle duration) resolves to `BW = (MSS/RTT)·√(3/2)/√p`, i.e. the form above with `C ≈ 1.22`.

**Worked example.** A transcontinental TCP transfer, standard Ethernet MSS:

- `MSS = 1460 bytes`
- `RTT = 80 ms = 0.080 s`
- `p = 0.0001` (one packet in ten thousand lost) → `√p = 0.01`
- `C = 1.22`

```
   BW ≈ (1460 / 0.080) · (1.22 / 0.01)
      = 18 250 bytes/s · 122
      = 2 226 500 bytes/s
      ≈ 2.23 MB/s  ≈  17.8 Mbps
```

Now raise loss tenfold to `p = 0.001` (`√p = 0.0316`):

```
   BW ≈ 18 250 · (1.22 / 0.0316) ≈ 704 500 bytes/s ≈ 5.6 Mbps
```

A **10× worse loss rate costs only ~3.16× throughput** (the `√p`) — but note the flip side: on a fat 10 Gbps link, sustaining line rate at 80 ms RTT with a 1460 B MSS demands `p < 2·10⁻¹⁰`, roughly one loss per five billion packets. This is precisely why single-stream Reno *cannot* fill modern high-BDP pipes, and why CUBIC (super-linear recovery) and BBR (loss-agnostic) exist. The Mathis law is the theorem that predicts Reno's failure and motivates its successors.

Two caveats define the model's validity: it describes the loss-based regime (BBR is outside it, by design), and it assumes `rwnd` is not the binding constraint (i.e. window scaling is enabled). Use it as an upper bound and a sanity check, never as a guarantee.

---

## 6. TIME_WAIT: purpose and exhaustion

When an endpoint sends the final ACK of the four-way close, it enters `TIME_WAIT` and stays there for `2·MSL` — twice the Maximum Segment Lifetime (RFC 793 sets MSL = 2 minutes, so `2·MSL` = 4 minutes; Linux hardcodes 60 s). This wait exists for two rigorous reasons, and both are about correctness, not politeness.

**Reason 1 — reliable teardown.** The endpoint's final ACK might be lost. If it is, the peer will retransmit its FIN. `TIME_WAIT` keeps the sender alive long enough (`2·MSL` covers one FIN-round-trip plus one ACK-round-trip) to receive that retransmitted FIN and re-ACK it. Without the wait, the retransmitted FIN would arrive at a `CLOSED` port and provoke an RST — a spurious error on an otherwise clean shutdown.

**Reason 2 — prevent old-incarnation confusion.** Segments from *this* connection may still be wandering the network (delayed, re-routed). If a new connection reused the same four-tuple (`src IP:port, dst IP:port`) immediately, a straggler carrying a plausible sequence number could be delivered into the new connection and silently corrupt its stream. `2·MSL` is exactly the time it takes for *all* segments of the old incarnation to drain from the network (each can live at most one MSL, in each direction). After it, the four-tuple is provably free of ghosts.

**Exhaustion.** The cost of `TIME_WAIT` is that the *initiating* side holds the four-tuple hostage for the full duration. On a busy client — a load balancer, an API gateway, a benchmarking tool making thousands of short-lived connections per second — outbound connections to a single destination are limited by the local ephemeral port range (~28 000 usable ports by default). At high connection churn:

```
   max conns/sec (per dst)  ≈  ephemeral_ports / TIME_WAIT_duration
                            ≈  28000 / 60 s  ≈  ~466 conns/sec
```

Exceed that and new `connect()` calls fail with `EADDRNOTAVAIL` — *TIME_WAIT exhaustion*. Mitigations, in order of preference:

- **Connection reuse / pooling / HTTP keep-alive** — the real fix; amortize the four-tuple across many requests.
- **`SO_REUSEADDR`** and, on Linux, `tcp_tw_reuse` — safely reuse a `TIME_WAIT` tuple for a *new outbound* connection when timestamps (RFC 7323) prove ordering, protecting against ghosts.
- **Widen the ephemeral range** (`ip_local_port_range`) and use multiple destination IPs — more four-tuples.

Note: `tcp_tw_recycle` was removed from Linux (4.12) because it broke NAT'd clients; do not resurrect advice to enable it. And observe the asymmetry — the side that *initiates* the close pays the `TIME_WAIT` cost. Well-designed servers push closing onto the client for exactly this reason.

---

## 7. UDP: the minimalist datagram

UDP is the counter-argument to everything above: it deletes all of it. There is no connection, no state machine, no sequence space, no window, no congestion control, no retransmission. A UDP endpoint is stateless; there is nothing to establish and nothing to tear down. The entire protocol is an 8-byte header (RFC 768):

```
 0      7 8     15 16    23 24    31
+--------+--------+--------+--------+
|     Source Port |  Destination Port |
+--------+--------+--------+--------+
|      Length     |     Checksum      |
+--------+--------+--------+--------+
|              data ...              |
```

- **Source / Destination Port** (16 bits each) — demultiplexing only. Source port is optional (may be zero).
- **Length** (16 bits) — header + data, in bytes.
- **Checksum** (16 bits) — covers header, data, and an IP pseudo-header; optional over IPv4 (zero = disabled), mandatory over IPv6.

That minimalism is the feature. UDP gives you: (1) **datagram boundaries preserved** — one `send()` is one `recv()`, unlike TCP's boundary-erasing byte stream; (2) **no head-of-line blocking** — a lost datagram never stalls the next, whereas TCP must deliver in order and will block a whole stream behind one hole; (3) **zero connection-setup latency** — no RTT spent on a handshake; (4) **full control** — you build exactly the reliability and congestion response your application needs, and *nothing* it doesn't.

The trade is that UDP provides *no* delivery, ordering, duplicate-suppression, or congestion guarantees. Everything TCP does for you becomes your responsibility. This is why modern high-performance protocols are built *over* UDP rather than TCP: **QUIC** (RFC 9000) implements streams, reliability, TLS 1.3, and CUBIC/BBR congestion control on top of UDP — precisely to escape TCP's in-kernel ossification and per-stream head-of-line blocking while keeping the control theory of §2–§4. DNS, real-time media (RTP), and game state also live on UDP because for them, *timeliness beats completeness*: a retransmitted-but-stale video frame is worse than a dropped one.

Because UDP has no congestion control, applications that send heavy UDP traffic **must** implement their own (RFC 8085, "UDP Usage Guidelines"), or they risk re-creating the 1986 congestion collapse for the whole network. Deleting the control loop does not delete the responsibility for it.

---

## 8. Decision table and closing synthesis

| Dimension | TCP | UDP |
|---|---|---|
| Model | Connection-oriented byte stream | Connectionless datagrams |
| Header size | 20–60 bytes | 8 bytes |
| Reliability | Guaranteed (ACK + retransmit) | None (best-effort) |
| Ordering | In-order delivery | Unordered |
| Flow control | Yes (`rwnd`) | No |
| Congestion control | Yes (Reno/CUBIC/BBR) | No — app's responsibility |
| Head-of-line blocking | Yes (one stream) | No |
| Connection setup | 3-way handshake (1 RTT) | None (0 RTT) |
| Message boundaries | Erased (stream) | Preserved (datagram) |
| State per connection | Full FSM + windows + timers | None |
| Multicast / broadcast | No | Yes |
| Typical use | HTTP/1–2, TLS, SSH, file transfer, DB | DNS, RTP/media, gaming, QUIC/HTTP-3, VoIP |

**Synthesis.** The formal difference is where the guarantees live. TCP embeds reliability, ordering, flow control, and congestion control *in the transport layer*, expressed as a state machine over a shared sequence space, driven by two nested control loops (`min(rwnd, cwnd)`) whose steady-state behavior obeys the Mathis law. UDP embeds *nothing* and hands the sequence space, the ARQ, and the control loop to the application. Neither is "better"; they represent different placements of the same set of responsibilities on the end-to-end argument (Saltzer, Reed, Clark 1984): put a function at the layer that can implement it correctly and completely. When the application needs a reliable ordered stream and can tolerate head-of-line blocking, that layer is TCP. When it needs timeliness, custom reliability, or its own congestion model, that layer is the application — over UDP. QUIC is the modern proof that the second option, done rigorously, can subsume the first.

Understanding TCP as an FSM (§1) plus a sliding window (§2) plus two control loops (§3–4) whose ceiling is predicted by a closed-form throughput bound (§5), with correctness guaranteed by `TIME_WAIT` (§6) — and UDP as the deliberate absence of all of it (§7) — is the theory a staff engineer reasons from when deciding what to run in production and why a benchmark is or isn't hitting line rate.

*Next step:* [Staff level](staff.md)
