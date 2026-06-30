# Bandwidth Estimation — Interview Questions

Bandwidth is the dimension that quietly decides your cloud bill, your CDN strategy, and whether a single NIC can carry your peak traffic. Interviewers probe it because the math is unforgiving and the units are a minefield. This bank moves from the core formula through unit conversions, product-specific worked estimates, the bandwidth-delay product, hardware ceilings, and the cost judgment that separates a senior from a staff engineer.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is the core formula for estimating bandwidth from traffic?**

> Bandwidth is throughput: data per unit time. The back-of-envelope form is:
>
> `bandwidth = QPS × average payload size`
>
> If an endpoint serves 5,000 requests/second and each response is 20 KB, then:
>
> `5,000 × 20 KB = 100,000 KB/s = 100 MB/s`
>
> Convert to bits for the network view: `100 MB/s × 8 = 800 Mb/s ≈ 0.8 Gbps`.
>
> Every bandwidth estimate is a variation on this one line. The only hard parts are getting the average payload right (use a realistic, weighted average — not the smallest or largest response), and remembering that the network speaks in bits while storage speaks in bytes.

**Q2: Bits vs bytes — why does the distinction matter and how do you convert?**

> 1 byte = 8 bits. Storage, payload sizes, and disk are measured in **bytes** (KB, MB, GB). Network links, NIC speeds, and ISP plans are measured in **bits** (Kbps, Mbps, Gbps). Mixing them is the single most common bandwidth-estimation error — and it is always an 8× error.
>
> Conversion: multiply bytes by 8 to get bits.
>
> | You have | Multiply by | To get |
> |---|---|---|
> | 100 MB/s (bytes) | × 8 | 800 Mbps (bits) |
> | 1 GB/s (bytes) | × 8 | 8 Gbps (bits) |
> | 1 Gbps (bits) | ÷ 8 | 125 MB/s (bytes) |
> | 10 Gbps NIC | ÷ 8 | 1.25 GB/s (bytes) |
>
> A "10 Gbps" NIC therefore moves only ~1.25 GB of data per second. If you forget the ÷8, you will overestimate your link's data capacity by 8× and under-provision badly.

**Q3: What is the difference between ingress and egress?**

> **Ingress** is traffic flowing *into* your system (uploads, incoming requests, replication pulls). **Egress** is traffic flowing *out* (responses, downloads, replication pushes, data sent to users).
>
> They matter for two separate reasons:
>
> - **Capacity** — a request-heavy service (uploads, log ingestion) is ingress-bound; a read/serving service (CDN origin, video, APIs) is egress-bound. Size the NIC and link for whichever direction peaks.
> - **Cost** — on every major cloud, *ingress is free and egress is billed*. This asymmetry dominates the bandwidth bill. You can pour data in for free, but every byte leaving the cloud — to users or to another region — costs money.
>
> So when someone says "we have 5 Gbps of traffic," always ask: in which direction?

**Q4: A typical API response is 2 KB and the service handles 10,000 QPS. What egress bandwidth do you need?**

> `egress = QPS × payload = 10,000 × 2 KB = 20,000 KB/s = 20 MB/s`
>
> In bits: `20 MB/s × 8 = 160 Mbps`.
>
> That comfortably fits inside a single 1 Gbps NIC (which carries 125 MB/s). Add headroom for peak — if peak is 2× average, plan for `40 MB/s = 320 Mbps`, still well within one link. The takeaway: small JSON APIs are rarely bandwidth-bound; they hit CPU or connection limits first.

**Q5: Why do we add a peak-to-average multiplier to bandwidth estimates?**

> Average daily QPS hides bursts. Traffic is diurnal and spiky — evening peaks, lunchtime spikes, flash sales, viral events. If you provision for the average, you saturate the link during peaks and drop traffic exactly when it matters most.
>
> A standard rule of thumb is **peak ≈ 2× to 3× average** for consumer traffic, higher for event-driven systems. So:
>
> `provisioned bandwidth = average bandwidth × peak factor × safety headroom`
>
> Example: average egress 200 Mbps, peak factor 3, headroom 1.3 → `200 × 3 × 1.3 ≈ 780 Mbps`. You'd provision a 1 Gbps link, not the 250 Mbps the average alone suggests.

---

## Middle Questions

**Q6: Estimate the bandwidth for an image-serving API: 50M images served per day, average 300 KB each.**

> First convert to per-second, since bandwidth is a rate.
>
> `50,000,000 images/day ÷ 86,400 s ≈ 580 images/s` (average)
>
> `egress = 580 × 300 KB ≈ 174,000 KB/s ≈ 174 MB/s`
>
> In bits: `174 × 8 ≈ 1,392 Mbps ≈ 1.4 Gbps` average.
>
> Now apply peak factor 3: `~4.2 Gbps` at peak. That exceeds a single 1 Gbps NIC and pushes into 10 Gbps-instance or multi-instance territory. This is precisely the workload where you put images behind a CDN — serving 300 KB blobs from origin at multiple Gbps is exactly what CDNs exist to absorb.

**Q7: Estimate bandwidth for a video platform: 100,000 concurrent viewers streaming 1080p at 5 Mbps.**

> Video bandwidth is delightfully simple because the bitrate *is* the per-stream bandwidth — no QPS conversion needed.
>
> `total egress = concurrent viewers × bitrate per stream`
> `= 100,000 × 5 Mbps = 500,000 Mbps = 500 Gbps`
>
> That is half a terabit per second. No single origin handles this; it is fundamentally a CDN problem. This is why every video platform is built on edge delivery — the origin serves the CDN, and the CDN's thousands of edge nodes fan out the 500 Gbps to viewers. The estimate also tells you the *daily volume*: at 500 Gbps sustained for, say, 4 peak hours, you're moving petabytes/day, which directly drives the egress bill.

**Q8: How does adaptive bitrate change a video bandwidth estimate?**

> Real platforms don't serve one bitrate — they serve a ladder (e.g., 240p at 0.4 Mbps, 480p at 1.5 Mbps, 720p at 3 Mbps, 1080p at 5 Mbps, 4K at 16 Mbps) and clients pick based on their network. So you estimate with a **viewership-weighted average bitrate**, not the top rung.
>
> | Resolution | Bitrate | % of viewers | Contribution |
> |---|---|---|---|
> | 240p | 0.4 Mbps | 10% | 0.04 |
> | 480p | 1.5 Mbps | 25% | 0.375 |
> | 720p | 3 Mbps | 35% | 1.05 |
> | 1080p | 5 Mbps | 25% | 1.25 |
> | 4K | 16 Mbps | 5% | 0.80 |
> | **Weighted avg** | | | **≈ 3.5 Mbps** |
>
> For 100,000 concurrent viewers: `100,000 × 3.5 Mbps = 350 Gbps`, meaningfully less than the 500 Gbps naïve "everyone at 1080p" figure. Using the top rung over-provisions by ~40% here. Always weight by the actual distribution.

**Q9: A CDN gives you a 95% cache-hit ratio. How much origin bandwidth does that save?**

> Origin bandwidth scales with the **miss** rate, not the hit rate.
>
> `origin bandwidth = total edge bandwidth × (1 − cache-hit ratio)`
>
> Say total user-facing egress is 40 Gbps. At a 95% hit ratio:
>
> `origin = 40 Gbps × (1 − 0.95) = 40 × 0.05 = 2 Gbps`
>
> The CDN absorbs 38 Gbps; your origin only serves 2 Gbps. That's a 20× reduction. Note the nonlinearity at the high end: improving from 95% → 99% drops origin load from 2 Gbps to `40 × 0.01 = 0.4 Gbps` — a 5× further cut from a seemingly small 4-point hit-ratio gain. The last few percent of cache-hit ratio are worth disproportionate engineering effort.

**Q10: How does compression change a bandwidth estimate, and where does it not help?**

> Compression divides payload size by the compression ratio, so it divides bandwidth by the same factor:
>
> `compressed bandwidth = raw bandwidth ÷ compression ratio`
>
> Typical ratios: text/JSON/HTML with gzip or Brotli compress ~3–6×. So a 20 KB JSON response becomes ~4 KB. A service doing `10,000 QPS × 20 KB = 160 Mbps` of raw JSON drops to `~32–53 Mbps` compressed — a 3–5× saving, basically free on the network at the cost of some CPU.
>
> Where it *doesn't* help: already-compressed payloads. JPEG/PNG images, H.264/H.265 video, MP3/AAC audio, and ZIP/gzip files are near their entropy floor — re-compressing them yields ~1.0–1.05× and just wastes CPU. So compression is a big win for an API/HTML platform and almost irrelevant for an image or video platform's media bytes (though their JSON metadata still benefits).

**Q11: Estimate bandwidth for a chat service: 10M active users, each sending 40 messages/day at 200 bytes, fan-out to 1 group of 10.**

> Chat bandwidth is dominated by **fan-out** (egress), not ingress.
>
> Ingress (messages received by servers):
> `10M users × 40 msgs/day = 400M msgs/day ÷ 86,400 ≈ 4,630 msgs/s`
> `ingress = 4,630 × 200 B ≈ 926 KB/s ≈ 7.4 Mbps` — tiny.
>
> Egress (each message delivered to ~10 recipients):
> `egress messages = 4,630 × 10 ≈ 46,300 deliveries/s`
> `egress = 46,300 × 200 B ≈ 9,260 KB/s ≈ 9 MB/s ≈ 74 Mbps`
>
> Even with a 3× peak factor, egress is ~220 Mbps — fits in one NIC. The lesson: text chat is *cheap* on bandwidth; the hard part is connection count (millions of persistent WebSockets) and message routing, not bytes. Add media (images/voice notes) and the picture flips entirely — those blobs dwarf the text.

---

## Senior Questions

**Q12: What is the bandwidth-delay product and why does high RTT cap TCP throughput?**

> A single TCP connection cannot push more unacknowledged data than its **send window**. Because the sender must wait one round-trip for an ACK before the window can advance, the maximum single-stream throughput is bounded:
>
> `throughput ≤ window size ÷ RTT`
>
> The **bandwidth-delay product (BDP)** is `bandwidth × RTT` — the amount of in-flight data a "full pipe" requires. If your window is smaller than the BDP, the link sits idle waiting for ACKs and you can't fill it regardless of how fat it is.
>
> Worked example: default TCP window 64 KB, RTT 100 ms (cross-continent):
>
> `throughput ≤ 64 KB ÷ 0.1 s = 640 KB/s = 5.12 Mbps`
>
> That 5 Mbps is the ceiling **no matter how big the link is** — a 10 Gbps pipe achieves 5 Mbps on that connection. To fill a 1 Gbps link at 100 ms RTT you'd need a window of `1 Gbps × 0.1 s ÷ 8 = 12.5 MB`. Modern stacks use window scaling (RFC 7323) to reach such windows, but the principle holds: high-RTT, long-fat networks need large windows or parallel streams.

**Q13: Show the staged journey of a byte from origin to a distant user, and where bandwidth gets constrained.**

> The constraints stack at every hop. A diagram makes the chokepoints visible:
>
> ```mermaid
> flowchart LR
>     subgraph Origin["Origin Region"]
>         A[App server] -->|NIC egress ceiling| B[Origin LB]
>     end
>     subgraph Transit["WAN Transit"]
>         B -->|cross-region $ + RTT| C[CDN PoP fill]
>     end
>     subgraph Edge["CDN Edge near user"]
>         C -->|cache hit serves locally| D[Edge node]
>     end
>     subgraph User["End User"]
>         D -->|window/RTT cap| E[Client TCP]
>         E -->|last-mile ISP cap| F[Device]
>     end
> ```
>
> Reading it as a bandwidth budget:
>
> 1. **NIC egress ceiling** — the origin can't push more than its instance's egress limit (often 5–25 Gbps).
> 2. **Cross-region transit** — adds RTT (raising BDP) and per-GB cost.
> 3. **CDN edge** — cache hits serve from near the user, so most bytes never cross the WAN; this is where you reclaim bandwidth.
> 4. **Window/RTT cap** — even from a nearby edge, a single TCP stream is bounded by `window ÷ RTT`.
> 5. **Last-mile** — the user's own ISP plan is the final ceiling.
>
> A senior estimate accounts for the tightest of these per leg, not just the headline link speed.

**Q14: What are typical NIC and cloud-instance egress ceilings, and how do they bound a single host?**

> Network throughput on a cloud host is gated by the instance's allocated egress, which scales with instance size — small instances are deliberately throttled. Rough public-cloud guidance:
>
> | Instance class | Typical egress ceiling |
> |---|---|
> | Small/burstable | up to ~5 Gbps (often burst-limited) |
> | Mid-size general purpose | ~10 Gbps |
> | Large compute/memory | ~25 Gbps |
> | Network-optimized / metal | 50–100+ Gbps |
>
> A 25 Gbps ceiling = `25 ÷ 8 ≈ 3.1 GB/s` of data. So if the image API from Q6 needs ~4.2 Gbps at peak, a single mid-size instance (10 Gbps) handles it — but if you scaled to ten times that load (~42 Gbps), you'd exceed even a 25 Gbps host and must fan out across instances *or* offload to a CDN. Always check that your per-host bandwidth estimate fits under the instance's egress allowance before assuming CPU/RAM are the limits.

**Q15: How do egress costs make bandwidth the cloud-bill killer, and how do you estimate the bill?**

> Cloud egress to the internet is priced per GB (commonly ~$0.05–0.09/GB after volume tiers, more for low volumes). Multiply by your monthly egress volume and it dominates fast.
>
> Take the image API: ~174 MB/s average egress.
>
> `174 MB/s × 86,400 s/day = ~15 TB/day`
> `15 TB/day × 30 = ~450 TB/month = ~450,000 GB`
> `450,000 GB × $0.08/GB = ~$36,000/month`
>
> That is just bandwidth — before compute or storage. This is why egress-heavy products live or die on their CDN deal: CDN egress is typically far cheaper per GB and the CDN absorbs 90–99% of bytes, so origin egress (the billed-from-cloud part) collapses to the miss traffic. Always translate a bandwidth estimate into a monthly dollar figure — it's frequently the line item that reframes the entire architecture.

**Q16: How do cross-AZ and cross-region transfer costs differ, and why does that shape topology?**

> Three tiers of data transfer, cheapest to most expensive:
>
> | Path | Typical cost | Notes |
> |---|---|---|
> | Same AZ | free / negligible | keep chatty services co-located |
> | Cross-AZ (same region) | ~$0.01–0.02/GB each way | HA replication pays this |
> | Cross-region | ~$0.02–0.09/GB | plus higher RTT |
> | Egress to internet | ~$0.05–0.09/GB | the headline killer |
>
> The killer detail: cross-AZ is often billed in *both* directions. A chatty microservice mesh that ping-pongs data across AZs can rack up surprising bills. Worked example: a replication stream of 2 Gbps across AZs runs `2 Gbps ÷ 8 × 86,400 × 30 ≈ 648 TB/month`; at $0.01/GB each way that's `648,000 × $0.02 ≈ $13,000/month` purely for crossing an AZ boundary. This is why you co-locate tightly-coupled services in one AZ, replicate only deltas across AZs, and treat cross-region traffic as a last resort or async-only path.

---

## Professional / Deep-Dive Questions

**Q17: Walk through a complete bandwidth estimate for a photo-sharing app at 200M DAU, including the CDN offload and final origin egress.**

> Stage the estimate so the interviewer can follow each multiplier.
>
> **Read volume.** Assume each DAU views 50 photos/day, average rendered size 200 KB (thumbnails + a few full-res):
> `200M × 50 = 10B photo views/day`
> `10B ÷ 86,400 ≈ 115,700 views/s` average.
>
> **Raw edge egress:**
> `115,700 × 200 KB ≈ 23.1 GB/s ≈ 185 Gbps` average; peak ×3 ≈ **555 Gbps**.
>
> **CDN offload at 97% hit ratio:**
> `origin egress = 185 Gbps × (1 − 0.97) = 185 × 0.03 ≈ 5.6 Gbps` average; peak ≈ 16.6 Gbps.
>
> **Where it lands:** 5.6 Gbps average origin egress fits on a small fleet of mid/large instances; the 555 Gbps peak lives entirely at the CDN edge. Without the CDN you'd need ~50–100 origin instances purely for bandwidth — economically and physically impractical.
>
> **Bill sanity check:** edge egress `185 Gbps ≈ 23 GB/s × 86,400 × 30 ≈ 60 PB/month`. At CDN rates (assume blended ~$0.02/GB) that's `60M GB × $0.02 ≈ $1.2M/month` — the dominant cost line, justifying a serious effort on cache-hit ratio, image format (WebP/AVIF), and CDN contract negotiation.

**Q18: Image format and resizing change the payload. How much bandwidth do modern formats save, and how do you fold that into the estimate?**

> Payload size is a lever you control. Two big ones:
>
> - **Modern codecs:** WebP is ~25–35% smaller than equivalent-quality JPEG; AVIF is ~50% smaller. Switching the 200 KB JPEG average to AVIF (~100 KB) **halves all downstream bandwidth and cost**.
> - **Server-side resizing:** serving a 1200px image to a 400px display wastes ~9× the pixels. Generating per-viewport variants cuts the effective average dramatically.
>
> Refold into Q17: if AVIF + right-sizing brings the average from 200 KB to 90 KB, raw edge egress drops from 185 Gbps to `185 × (90/200) ≈ 83 Gbps`, and the monthly CDN bill from ~$1.2M to ~$540K. A format migration is one of the highest-ROI bandwidth interventions there is — pure payload reduction, no architecture change. This is why "reduce the bytes" almost always beats "buy a fatter pipe."

**Q19: How do protocol overheads (headers, TLS, packetization) affect a bandwidth estimate, and when do they matter?**

> The clean `QPS × payload` formula ignores wire overhead. Each layer adds bytes:
>
> - **TCP/IP headers:** ~40 bytes per packet; with ~1,460-byte payloads that's ~2.7% overhead.
> - **TLS:** record headers + handshake; handshake bytes amortize over a connection but matter for short-lived connections.
> - **HTTP headers:** can be hundreds of bytes per request — *huge* relative to a 200-byte chat message, negligible relative to a 200 KB image.
>
> Rule: overhead matters inversely to payload size. For the chat service (200-byte messages), HTTP/TCP headers can **double or triple** effective bytes — which is exactly why chat uses persistent WebSockets (amortizing handshake/headers across the connection) and binary framing. For the image/video platforms, payloads are so large that header overhead rounds to noise. When estimating small-payload, high-QPS systems, add a 1.3–2× overhead factor; for large-payload systems, ignore it.

**Q20: A single user on a 1 Gbps fiber link reports slow downloads from your distant origin. The link isn't saturated. Diagnose with bandwidth math.**

> Classic BDP-limited single-stream case. The link being underutilized is the tell: it's not a link-capacity problem, it's a window/RTT problem.
>
> Suppose RTT to origin is 150 ms and the effective window settles at ~256 KB:
>
> `throughput ≤ 256 KB ÷ 0.15 s ≈ 1.7 MB/s ≈ 13.6 Mbps`
>
> So the user gets ~13 Mbps on a 1 Gbps link — using ~1.4% of it. The fixes, all bandwidth-aware:
>
> 1. **Cut RTT** — serve from a CDN edge near the user (150 ms → 15 ms gives a 10× throughput jump for the same window).
> 2. **Grow the window** — ensure window scaling is enabled and tune buffers so the window can reach the BDP (`1 Gbps × 0.15 s ÷ 8 ≈ 18.75 MB`).
> 3. **Parallelize** — multiple connections (or HTTP/2 multiplexing / QUIC) aggregate around the per-stream cap.
>
> The diagnostic skill is recognizing that "fat link + slow transfer + low utilization" almost always means RTT × window, not bandwidth.

---

## Staff / Judgment Questions

**Q21: At what point do you decide the answer is "add a CDN" vs "compress" vs "change the protocol"? Give the decision logic.**

> Match the intervention to *why* bandwidth is a problem:
>
> | Symptom | Right lever | Why |
> |---|---|---|
> | Many users, cacheable static bytes (images, video, JS) | **CDN** | offloads 90–99% of egress, cuts cost + RTT |
> | Large text/JSON/HTML payloads | **Compression** (gzip/Brotli) | 3–6× reduction, near-free |
> | Already-compressed media too big | **Re-encode / modern codec** (AVIF, H.265) | shrinks the source bytes themselves |
> | Small high-QPS messages, header-dominated | **Protocol change** (WebSocket/gRPC/QUIC, binary framing) | amortizes/eliminates per-message overhead |
> | High-RTT single-stream underrun | **Edge + window tuning / QUIC** | attacks the BDP ceiling, not link size |
> | Cross-AZ/region $ exploding | **Topology change** (co-locate, async deltas) | removes billed boundary crossings |
>
> The staff move is to *quantify each option's payoff before choosing*: a CDN on cacheable content beats everything (20×+ offload); compression is the free first pass on text; codec changes are the highest-ROI for media; protocol changes only pay when overhead is large relative to payload. Don't reach for a fatter pipe when reducing bytes or moving them closer is cheaper.

**Q22: Your monthly egress bill just crossed $500K and finance is asking. How do you build the reduction plan, ordered by ROI?**

> Attack the bill multiplicatively — `cost = volume × price/GB`, and you can move both factors. Ordered by effort-to-savings:
>
> 1. **Verify the CDN is actually hitting** — a hit-ratio regression (cache-busting query strings, short TTLs, vary headers) silently routes bytes to billed origin egress. Raising 90% → 99% cuts origin egress 10×. Cheapest possible win.
> 2. **Reduce payload bytes** — AVIF/WebP images, Brotli on text, right-sized variants. Often a 2× total reduction, halving the bill, with no architecture change.
> 3. **Negotiate committed-use / private CDN pricing** — at this volume, list price is a starting point; committed tiers and direct-connect/private interconnects drop per-GB rates substantially.
> 4. **Move egress off the metered path** — peer with the CDN, use the cloud's CDN-integrated egress (often discounted), or serve from cheaper regions.
> 5. **Eliminate waste** — cross-AZ chatter, unbounded API responses, missing pagination, debug payloads in prod.
>
> Present it as a table of `% bytes affected × expected reduction × $ saved`, sequenced cheapest-first. The first two items frequently cut the bill 40–60% before any contract talks.

**Q23: An interviewer says "just buy a bigger NIC / fatter link." When is that the right answer and when is it a trap?**

> Buying bandwidth is the right answer in a narrow set of cases: **internal, non-cacheable, point-to-point bulk transfer** where bytes are irreducible and the path is fixed — e.g., a data-pipeline shuffling 30 Gbps between services in the same AZ, or bulk replication to a warehouse. There, a bigger NIC / network-optimized instance genuinely is the fix, and it's cheap (intra-AZ traffic is nearly free).
>
> It's a trap for **user-facing egress**, because:
>
> 1. A fatter origin pipe does nothing for the **per-user BDP cap** — `window ÷ RTT` is unchanged by your link size (Q12, Q20).
> 2. It doesn't reduce **egress cost** — you pay per GB regardless of pipe width; a bigger pipe can even *increase* the bill by removing a natural throttle.
> 3. It ignores cheaper levers — CDN offload and payload reduction attack volume, which is what the bill scales on.
>
> The staff answer: "Bigger pipe solves *internal bulk throughput*. It does not solve *user-facing cost or distant-user latency-throughput* — those need CDN, payload reduction, and edge proximity. Which problem are we actually having?"

**Q24: How do you sanity-check a bandwidth estimate so you don't embarrass yourself with an 8× or 1000× error?**

> Run four cheap cross-checks before you commit to a number:
>
> 1. **Units pass** — did you keep bits and bytes straight? Any time a number looks 8× off from intuition, suspect a bit/byte slip. State units in every line.
> 2. **Anchor against a known link** — does the answer fit the physical world? A 1 Gbps NIC = 125 MB/s; a 10 Gbps host = 1.25 GB/s; one viewer at 1080p ≈ 5 Mbps. If your "single server" estimate says 80 Gbps, you've either found a CDN-scale problem or made an error.
> 3. **Convert to a daily volume and a dollar figure** — `bandwidth → TB/month → $/month`. A bill of $3/month or $30M/month for the same modest service flags an order-of-magnitude mistake instantly.
> 4. **Reconcile direction** — is this ingress or egress? Did you apply peak factor? Did you forget CDN offload (estimating origin at full edge volume is a 20×+ overstatement)?
>
> The discipline that separates senior estimates from junior ones isn't more precise inputs — it's these reflexive sanity checks that catch the catastrophic, not the cosmetic, errors. An estimate that's 2× off is fine for capacity planning; one that's 8× or 1000× off is a career-defining whiteboard moment of the wrong kind.

---

*Next step:* [Latency Budgets](../04-latency-budgets/junior.md)
