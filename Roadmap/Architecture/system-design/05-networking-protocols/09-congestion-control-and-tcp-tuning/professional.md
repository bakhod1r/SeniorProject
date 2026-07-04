# Congestion Control & TCP Tuning — Professional

Congestion control is the closed-loop feedback system that decides how many bytes a sender may keep in flight before it receives an acknowledgement. It is entirely separate from flow control (which protects a slow *receiver* via the advertised window, `rwnd`). Congestion control protects the *network* — the shared queues at bottleneck links — and the sender's actual send window is `min(cwnd, rwnd)`, where `cwnd` is the congestion window maintained by the algorithm.

This tier formalizes the three dominant algorithm families — loss-based AIMD (Reno), loss-based cubic growth (CUBIC), and model-based rate estimation (BBR) — plus the ECN/DCTCP marking regime and the bandwidth-delay-product math that ties window sizes to throughput. It closes with the specific Linux kernel knobs that make theory operational.

---

## Table of Contents

1. [The Control Loop and cwnd](#1-the-control-loop-and-cwnd)
2. [AIMD Formalized: The Reno Sawtooth](#2-aimd-formalized-the-reno-sawtooth)
3. [Convergence to Fairness](#3-convergence-to-fairness)
4. [CUBIC: The Cubic Growth Function](#4-cubic-the-cubic-growth-function)
5. [BBR: A Model-Based Approach](#5-bbr-a-model-based-approach)
6. [ECN and DCTCP: Marking Instead of Loss](#6-ecn-and-dctcp-marking-instead-of-loss)
7. [Bandwidth-Delay Product: A Worked Example](#7-bandwidth-delay-product-a-worked-example)
8. [Algorithm Comparison](#8-algorithm-comparison)
9. [Kernel Knobs That Matter](#9-kernel-knobs-that-matter)
10. [Key Takeaways](#10-key-takeaways)

---

## 1. The Control Loop and cwnd

Every congestion-control algorithm answers one question: *given the acknowledgements I have observed, how large may `cwnd` be right now?* A connection begins in **slow start**, where `cwnd` grows by roughly one MSS per acknowledged segment — effectively doubling every RTT — until it reaches `ssthresh` (the slow-start threshold) or a loss signal arrives. From there it enters **congestion avoidance**, the linear-growth regime that the AIMD/CUBIC/BBR distinction is really about.

Two RTT-scale quantities dominate behavior:

- **RTprop** — round-trip propagation delay, the minimum RTT with empty queues. It is a physical property of the path.
- **BtlBw** — bottleneck bandwidth, the capacity of the slowest link on the path.

Their product, the bandwidth-delay product (BDP), is the amount of data that fits "in the pipe" at optimal operation. Loss-based algorithms discover BtlBw only indirectly by filling the bottleneck buffer until it overflows; BBR estimates BtlBw and RTprop directly. This distinction is the entire modern story.

---

## 2. AIMD Formalized: The Reno Sawtooth

TCP Reno (standardized as the base congestion-control behavior in **RFC 5681**) implements **Additive Increase / Multiplicative Decrease (AIMD)**:

- **Additive increase** — during congestion avoidance, for each RTT with no loss, increase the window by one MSS:
  `cwnd += MSS × (MSS / cwnd)` per ACK, which sums to approximately `+1 MSS` per RTT.
- **Multiplicative decrease** — on a loss signal (three duplicate ACKs → fast retransmit/fast recovery), halve the window:
  `ssthresh = cwnd / 2`, then `cwnd = ssthresh` (β = 0.5).

The result is the characteristic **sawtooth**: linear ramp up, sharp halving on loss, repeat. A timeout (RTO) is treated more severely — `cwnd` collapses to 1 MSS and the connection re-enters slow start — because a timeout implies the pipe may be empty and the sender has lost its ACK clock.

```mermaid
stateDiagram-v2
    [*] --> SlowStart
    SlowStart --> CongestionAvoidance: cwnd >= ssthresh
    SlowStart --> FastRecovery: 3 dup ACKs
    CongestionAvoidance --> FastRecovery: 3 dup ACKs
    CongestionAvoidance --> SlowStart: RTO (timeout)
    SlowStart --> SlowStart: RTO (timeout)
    FastRecovery --> CongestionAvoidance: new ACK (recovery done)
    FastRecovery --> SlowStart: RTO (timeout)

    note right of CongestionAvoidance
      Additive increase: +1 MSS / RTT
    end note
    note right of FastRecovery
      Multiplicative decrease: cwnd = cwnd x 0.5
    end note
```

The steady-state throughput of a single AIMD flow follows the well-known relation `Throughput ≈ MSS / (RTT × √p)`, where `p` is the loss probability. Two consequences fall directly out of this formula: throughput is **inversely proportional to RTT** (short-RTT flows starve long-RTT flows sharing a link — the RTT-unfairness problem), and throughput degrades with the **square root of loss rate** (a small increase in random loss on high-BDP paths crushes Reno).

---

## 3. Convergence to Fairness

AIMD's real elegance is that it converges to fair sharing regardless of starting point. Consider two flows sharing one bottleneck, plotted on a phase diagram with flow-1's rate on one axis and flow-2's on the other.

- **Additive increase** moves the operating point along a 45° line (both flows gain equally in absolute terms) — this direction is *parallel* to the fairness line.
- **Multiplicative decrease** moves the point along a line *toward the origin* (both flows cut by the same factor) — this direction is *toward* the fairness line.

The combination is a ratchet: additive increase pushes toward the efficiency line (full utilization) without changing the ratio, while multiplicative decrease pulls the ratio toward equality each time congestion is hit. Over many sawtooth cycles the two flows converge onto the fairness line. This geometric argument — why *additive* increase and *multiplicative* (not additive) decrease are the specific combination that yields both stability and fairness — is the core theoretical justification for AIMD. Additive-decrease or multiplicative-increase provably fail to converge.

---

## 4. CUBIC: The Cubic Growth Function

Reno's additive `+1 MSS/RTT` growth is far too timid on high-BDP paths. On a 10 Gbps × 100 ms link the BDP is roughly 125 MB; recovering from a single loss back to full window at +1 MSS/RTT would take hours. **CUBIC** (the default on Linux since kernel 2.6.19, described in **RFC 8312**) replaces linear growth with a cubic function of *time since the last congestion event*:

```
W(t) = C · (t − K)³ + W_max
```

where:
- `W_max` is the window size at the last loss,
- `C` is a scaling constant (default 0.4),
- `K = ∛(W_max · β / C)` is the time it takes to grow back to `W_max` after the reduction (β = 0.7 for CUBIC, so the window drops to `0.7 × W_max` on loss),
- `t` is elapsed time since the last reduction.

The shape matters. Right after a loss (`t` small), `(t − K)³` is large and negative, so growth is rapid — CUBIC quickly recovers most of the lost window. As `t` approaches `K`, the cubic flattens and the window approaches `W_max` gently (the **concave** region), probing cautiously near the level that previously caused loss. Past `K` the function turns **convex** and accelerates again, aggressively searching for newly available bandwidth.

Two properties make CUBIC better than Reno on modern networks:

- **RTT fairness** — because growth is a function of *wall-clock time* rather than *RTTs elapsed*, two CUBIC flows with different RTTs grow their windows at comparable real-time rates. Reno's per-RTT growth inherently favors short-RTT flows; CUBIC largely neutralizes this.
- **High-BDP scalability** — the convex region lets CUBIC ramp to enormous windows quickly, so it saturates fat, long links that Reno cannot.

CUBIC remains loss-based: it still needs to overflow the bottleneck buffer to detect its ceiling, so on deep-buffered paths it induces bufferbloat (large standing queues and latency) even while achieving high throughput.

---

## 5. BBR: A Model-Based Approach

**BBR (Bottleneck Bandwidth and Round-trip propagation time)**, from Google, abandons loss as the primary congestion signal. Instead it continuously *measures* the two path parameters and builds an explicit model of the bottleneck:

- **BtlBw** — estimated as the maximum delivery rate observed over a recent window (typically the max over ~10 RTTs).
- **RTprop** — estimated as the minimum RTT observed over a longer window (typically ~10 seconds).

BBR then **paces** packet transmission at the estimated BtlBw and caps in-flight data near the BDP (`BtlBw × RTprop`). This targets the **Kleinrock optimal operating point**: the unique point where the pipe is exactly full but the bottleneck queue is empty — maximum throughput at minimum latency. Loss-based algorithms cannot sit here because they *define* their operating point by the loss that occurs only *after* the queue is full.

A fundamental measurement obstacle: BtlBw and RTprop cannot be measured simultaneously. Sending faster to probe bandwidth inflates the queue (spoiling the RTprop measurement); draining the queue to measure RTprop means sending below capacity (spoiling the BtlBw measurement). BBR therefore cycles through states, sampling one at a time:

```mermaid
stateDiagram-v2
    [*] --> STARTUP
    STARTUP --> DRAIN: pipe full (BtlBw plateaus)
    DRAIN --> PROBE_BW: queue drained to BDP
    PROBE_BW --> PROBE_RTT: RTprop stale (~10s)
    PROBE_RTT --> PROBE_BW: RTprop refreshed
    PROBE_BW --> PROBE_BW: 8-phase gain cycle

    note right of STARTUP
      Exponential ramp (gain ~2/ln2)
      until delivery rate plateaus
    end note
    note right of DRAIN
      Drain the queue built during STARTUP
    end note
    note right of PROBE_BW
      Steady state: cyclic pacing-gain
      1.25, 0.75, then 1.0 x6 to probe BtlBw
    end note
    note right of PROBE_RTT
      Shrink inflight to ~4 packets
      to re-measure true RTprop
    end note
```

- **STARTUP** — exponential ramp (pacing gain ≈ 2/ln2 ≈ 2.89) to find BtlBw fast, analogous to slow start but ending when the delivery rate stops rising, not when loss occurs.
- **DRAIN** — one-time drain of the queue that STARTUP necessarily built up.
- **PROBE_BW** — the steady state, where BBR runs an 8-phase pacing-gain cycle (one RTT at gain 1.25 to probe for more bandwidth, one at 0.75 to drain the resulting queue, then six at 1.0) — this is what keeps it near the optimal point while still discovering capacity increases.
- **PROBE_RTT** — periodically (when the RTprop sample is older than ~10 s), BBR shrinks inflight to about four packets for ~200 ms to drain all queues and re-measure the true minimum RTT.

Because BBR ignores loss as a congestion signal, it tolerates high random-loss paths (satellite, lossy Wi-Fi, transcontinental) where CUBIC collapses. The known trade-offs — the reason "BBR is strictly better" is wrong — are covered at the Staff tier: BBRv1 can be unfair to CUBIC in shallow buffers, can under-utilize with very shallow buffers, and its inflight cap interacts subtly with ACK aggregation. BBRv2/v3 add loss and ECN awareness to address these.

---

## 6. ECN and DCTCP: Marking Instead of Loss

**Explicit Congestion Notification (ECN, RFC 3168)** lets routers signal congestion *before* dropping packets. Instead of tail-dropping a packet, a congested router sets the CE (Congestion Experienced) codepoint in the IP header; the receiver echoes this back to the sender (ECE flag), and the sender reacts as if a loss occurred but *without* the packet actually being lost or retransmitted. This decouples the congestion signal from packet loss — losing a byte is no longer the price of learning the network is full.

**DCTCP (Data Center TCP)** takes ECN further and is designed for the low-RTT, shallow-buffer world of a data-center fabric. Where standard ECN treats a single CE mark as a binary "cut by half" signal, DCTCP measures the **fraction** of marked packets and reduces the window **proportionally**:

```
α ← (1 − g)·α + g·F           (F = fraction of marked packets this window)
cwnd ← cwnd · (1 − α/2)
```

If only a few packets are marked, `α` is small and the reduction is gentle; if nearly all are marked, the reduction approaches the full 50% cut. This proportional response keeps queue occupancy low and stable, delivering the low latency data-center RPCs need while sustaining throughput. DCTCP requires ECN marking configured at a shallow threshold (mark early, mark often) and is only appropriate inside a controlled fabric — it is not safe to deploy against the public internet, where it would be unfair to conventional TCP.

---

## 7. Bandwidth-Delay Product: A Worked Example

The BDP determines the minimum window needed to keep a pipe full. Throughput is capped by `window / RTT`, so to achieve line rate you need:

```
required window = bandwidth × RTT
```

**Example — 1 Gbps link, 80 ms RTT:**

```
BDP = 1,000,000,000 bits/s × 0.080 s
    = 80,000,000 bits
    = 10,000,000 bytes
    ≈ 9.54 MiB
```

To saturate this path a single flow must keep ~10 MB in flight. But the TCP header's window field is only 16 bits — a maximum of **65,535 bytes**. At 80 ms RTT that hard cap yields:

```
max throughput = 65,535 bytes / 0.080 s ≈ 819,187 bytes/s ≈ 6.55 Mbps
```

— roughly 0.65% of the link. The path is 150× underutilized purely because of the window ceiling.

The fix is **TCP window scaling (RFC 7323)**, negotiated once in the SYN handshake. It applies a left-shift scale factor (up to 14) to the advertised window, extending the effective window to 2³⁰ bytes (1 GiB). With scaling enabled, the socket buffers become the binding constraint — which is exactly why `tcp_rmem`/`tcp_wmem` (Section 9) must be sized to at least the BDP. A common operational bug on high-BDP paths is throughput mysteriously capped well below line rate: the socket buffers were left at default values smaller than the BDP, so the window never grows large enough regardless of the congestion-control algorithm.

Rule of thumb: **size socket buffers to at least the BDP**, often 2×–3× BDP to absorb rate and RTT variation.

---

## 8. Algorithm Comparison

| Dimension | Reno (RFC 5681) | CUBIC (RFC 8312) | BBR |
|---|---|---|---|
| Congestion signal | Packet loss | Packet loss | Modeled BtlBw & RTprop (loss-agnostic) |
| Growth function | Linear: +1 MSS/RTT | Cubic in wall-clock time: `W(t)=C(t−K)³+W_max` | Paces at estimated BtlBw; inflight ≈ BDP |
| Loss response (β) | ×0.5 | ×0.7 | No multiplicative cut (v1); model-driven |
| RTT fairness | Poor (favors short RTT) | Good (time-based growth) | Good (paces to BtlBw) |
| High-BDP behavior | Very poor (√p sensitivity) | Strong (fast convex ramp) | Strong (targets BDP directly) |
| Queue / latency | Fills buffer → bufferbloat | Fills buffer → bufferbloat | Near-empty queue (Kleinrock optimal) |
| Random-loss tolerance | Poor | Poor | Excellent |
| Typical use | Legacy / reference | Linux default, general internet | High-BDP, lossy paths, video/CDN egress |

---

## 9. Kernel Knobs That Matter

On Linux, congestion behavior is tuned through `sysctl` (namespace `net.ipv4.*` and `net.core.*`). The load-bearing knobs:

| Knob | Purpose | Notes |
|---|---|---|
| `net.ipv4.tcp_congestion_control` | Selects the algorithm | `cubic` (default), `bbr`, `reno`, `dctcp`. List available via `tcp_available_congestion_control`; some modules need loading. |
| `net.ipv4.tcp_rmem` / `tcp_wmem` | Per-socket receive/send buffer `min default max` | The `max` must exceed the BDP or the window can't grow. Auto-tuning scales between `min` and `max`. |
| `net.core.rmem_max` / `wmem_max` | Hard ceiling for socket buffers | Caps what `SO_RCVBUF`/`SO_SNDBUF` and auto-tuning can reach; raise alongside `tcp_rmem`/`tcp_wmem`. |
| `net.ipv4.tcp_window_scaling` | Enables the window-scale option | Must be `1` (default) for windows > 64 KB; without it, BDP math is capped at 65 KB. |
| `net.ipv4.tcp_notsent_lowat` | Bytes allowed in the socket write queue but not yet sent | Lower values (e.g. 128 KB) cut local queueing latency for latency-sensitive senders and improve responsiveness under HTTP/2 multiplexing. |
| `net.core.default_qdisc` | Default queueing discipline | Set to `fq` (Fair Queue) — **required** for BBR, which depends on qdisc-level pacing; `fq` also implements pacing and reduces bursts. |
| `net.ipv4.tcp_ecn` | ECN negotiation | `0` off, `1` request+accept, `2` accept-only. DCTCP requires ECN enabled and ECN marking configured on the switches. |

Two operational pairings are worth memorizing:

- **BBR requires `fq`** (or `fq_codel` on recent kernels): BBR's pacing is enforced by the qdisc, so `net.core.default_qdisc=fq` plus `tcp_congestion_control=bbr` is the standard high-BDP egress configuration.
- **DCTCP requires end-to-end ECN**: it is inert without switches configured to CE-mark at a shallow queue threshold, and must stay inside the data center.

Congestion control is per-connection and can be set per-socket via `setsockopt(TCP_CONGESTION)`, so a service can run BBR for its long-haul CDN egress while leaving CUBIC as the host default for everything else.

---

## 10. Key Takeaways

- `cwnd` is the sender-side congestion window; the effective send window is `min(cwnd, rwnd)`. Congestion control protects the network; flow control protects the receiver.
- **AIMD** (Reno, RFC 5681) grows `+1 MSS/RTT` and halves on loss, producing the sawtooth. The AI/MD combination is *specifically* what makes flows converge to fairness — a geometric, provable property.
- **CUBIC** (RFC 8312) grows as `W(t)=C(t−K)³+W_max` in wall-clock time, giving RTT fairness and fast recovery on high-BDP links, but remains loss-based and induces bufferbloat.
- **BBR** models BtlBw and RTprop directly, paces at the bottleneck rate, and targets the Kleinrock optimal point (full pipe, empty queue) via STARTUP → DRAIN → PROBE_BW → PROBE_RTT. It tolerates random loss where CUBIC collapses.
- **ECN (RFC 3168)** and **DCTCP** signal congestion by marking rather than dropping; DCTCP reacts *proportionally* to the mark fraction for low, stable data-center queues.
- **BDP = bandwidth × RTT** sets the window needed to fill a pipe; window scaling (RFC 7323) lifts the 64 KB header cap, and socket buffers (`tcp_rmem`/`tcp_wmem`) must be sized to at least the BDP or throughput stalls far below line rate.
- The essential knobs: `tcp_congestion_control`, `tcp_rmem`/`tcp_wmem` (+ `rmem_max`/`wmem_max`), `tcp_window_scaling`, `tcp_notsent_lowat`, and `default_qdisc=fq` (mandatory for BBR).

*Next step:* [Congestion Control & TCP Tuning — Staff](staff.md)