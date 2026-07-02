# Peer-to-Peer Architecture — Middle

The junior tier answered *what* a P2P system is: every node is both client and server, there is no central authority, and the network survives as long as some peers stay online. This tier answers *how* that actually works. Three mechanical problems dominate every P2P design:

1. **Lookup** — given a key (a file hash, a chat room id), which peer holds the value? Structured overlays answer this in `O(log N)` hops with a Distributed Hash Table; unstructured overlays flood or random-walk.
2. **Membership** — peers constantly join and leave (*churn*). The overlay must repair its routing tables without a coordinator.
3. **Dissemination** — how does a new block, tweet, or piece of a file spread to millions of peers? Gossip / epidemic protocols push it in `O(log N)` rounds.

We walk each one with concrete protocols: Kademlia (the DHT behind BitTorrent's DHT, IPFS, and Ethereum's node discovery), BitTorrent's swarm mechanics, and epidemic gossip.

## Table of Contents

1. [Structured vs. Unstructured Overlays](#1-structured-vs-unstructured-overlays)
2. [Distributed Hash Tables: the Kademlia Model](#2-distributed-hash-tables-the-kademlia-model)
3. [DHT Lookup, Step by Step](#3-dht-lookup-step-by-step)
4. [Peer Discovery: Bootstrapping into the Overlay](#4-peer-discovery-bootstrapping-into-the-overlay)
5. [Churn: Handling Peers That Join and Leave](#5-churn-handling-peers-that-join-and-leave)
6. [Gossip / Epidemic Dissemination](#6-gossip--epidemic-dissemination)
7. [BitTorrent Mechanics: Pieces, Swarm, Tit-for-Tat](#7-bittorrent-mechanics-pieces-swarm-tit-for-tat)
8. [Content Addressing](#8-content-addressing)
9. [What to Carry into Senior](#9-what-to-carry-into-senior)

---

## 1. Structured vs. Unstructured Overlays

An **overlay network** is a logical graph laid *on top of* the physical Internet: each peer knows a handful of other peers (its neighbors) by IP:port, and messages hop peer-to-peer along those logical edges. The design question is how neighbors are chosen and how that determines lookup cost.

- **Unstructured overlays** connect peers arbitrarily (whoever you met at bootstrap). To find content you **flood** (send the query to all neighbors, who forward it, bounded by a TTL) or do a **random walk**. Simple and churn-tolerant, but lookup is `O(N)` in the worst case and rare content can be *missed* even when it exists. Gnutella and early file-sharing networks worked this way.
- **Structured overlays** assign every peer and every key an id in the same address space and place neighbors deterministically, so the graph forms a navigable structure (a ring, a hypercube, a tree of prefixes). Lookup is guaranteed `O(log N)` hops. DHTs (Kademlia, Chord, Pastry) are the canonical structured overlays.

| Dimension | Unstructured (Gnutella-style) | Structured (DHT / Kademlia) |
|---|---|---|
| Neighbor selection | Arbitrary / ad-hoc | Deterministic by id distance |
| Lookup method | Flood or random walk | Iterative routing by key |
| Lookup cost | `O(N)` worst case | `O(log N)` hops |
| Finds rare content? | Not guaranteed | Guaranteed (if it exists) |
| Keyword / fuzzy search | Natural (flood matches substrings) | Hard (needs exact key) |
| Churn tolerance | Very high (no structure to repair) | Good, but routing tables need maintenance |
| Typical use | Full-text search, small networks | Content lookup by hash, node discovery |

The trade-off is search *expressiveness* vs. lookup *efficiency*. DHTs give you cheap exact-key lookup but cannot do "find files whose name contains *jazz*"; unstructured overlays do the reverse. Real systems combine them — BitTorrent uses a Kademlia DHT for peer lookup but relies on out-of-band search (websites, indexes) for discovery.

---

## 2. Distributed Hash Tables: the Kademlia Model

A DHT implements a giant `map[key]value` spread across all peers, where no single peer holds the whole map. Kademlia (Maymounkov & Mazières, 2002) is the dominant design; here is its machinery.

**Shared id space.** Peers and keys share a 160-bit id space (SHA-1 sized). A peer's id is random; a key is the hash of the content or a hash of the lookup term (e.g., in BitTorrent the key is the *infohash* of a torrent). A `(key, value)` pair is stored on the peers whose ids are **closest** to the key.

**XOR distance.** Kademlia defines distance between two ids as their bitwise `XOR`, interpreted as an integer: `d(a, b) = a ⊕ b`. This metric is symmetric (`d(a,b) = d(b,a)`) and satisfies the triangle inequality, which is what lets routing converge. "Closest peers to key K" means the peers minimizing `id ⊕ K`.

**k-buckets (the routing table).** Each peer keeps 160 buckets, one per bit position `i`. Bucket `i` holds up to `k` known peers (typically `k = 20`) whose id shares the first `i` bits with this peer but differs at bit `i` — i.e., peers at XOR-distance in `[2^i, 2^{i+1})`. The result: the peer knows *many* peers close to itself and *exponentially fewer* peers far away. That skewed knowledge is exactly what produces `O(log N)` lookup — each hop can fix at least one more high bit of the target, halving the remaining distance.

| Concept | Kademlia term | Purpose |
|---|---|---|
| Peer/key identifier | 160-bit id | Places nodes and keys in one space |
| Distance metric | XOR of ids | Symmetric, enables convergent routing |
| Routing table | 160 k-buckets | More neighbors nearby, fewer far away |
| Replication width | `k` (≈20) | Store/return the `k` closest peers to a key |
| Parallelism | `α` (≈3) | Query `α` peers per round to hide slow/dead nodes |

---

## 3. DHT Lookup, Step by Step

Lookup is **iterative**: the searcher stays in control and asks progressively closer peers, rather than passing the query along recursively. To find the value for key `K`, a peer sends `FIND_NODE(K)` to the `α` closest peers it knows; each replies with the `k` closest peers *it* knows to `K`; the searcher merges the responses, picks the closest unqueried peers, and repeats. Because each round moves strictly closer under XOR distance, it terminates in `O(log N)` rounds.

```mermaid
sequenceDiagram
    autonumber
    participant S as Searcher (looking up key K)
    participant P1 as Peer A (close-ish to K)
    participant P2 as Peer B (closer to K)
    participant P3 as Peer C (holds K)

    Note over S: Pick the α closest peers to K from local k-buckets
    S->>P1: FIND_NODE(K)
    P1-->>S: Here are k peers I know nearest K (incl. B)
    Note over S: Merge results; B is closer than anything queried
    S->>P2: FIND_NODE(K)
    P2-->>S: Nearest peers I know (incl. C)
    Note over S,P3: No returned peer is closer than C — converged
    S->>P3: FIND_VALUE(K)
    P3-->>S: value for K (e.g., list of peers seeding this torrent)
    Note over S: Cache (K,value) at the closest peer that lacked it
```

Two message variants share the same routing: `FIND_NODE` returns only peer contacts (used to place data or discover nodes), while `FIND_VALUE` short-circuits and returns the stored value the moment any queried peer has it. `STORE` uses `FIND_NODE` to locate the `k` closest peers to `K`, then writes the value to all `k` of them for redundancy.

| Overlay | Lookup hops | Routing table size | Notes |
|---|---|---|---|
| Chord | `O(log N)` | `O(log N)` fingers | Ring successor + finger table |
| Kademlia | `O(log N)` | `160 × k` contacts | XOR metric, iterative, parallel `α` |
| Pastry | `O(log N)` | `O(log N)` | Prefix routing + leaf set |
| Flooding (unstructured) | `O(N)` | small | No guarantee, TTL-bounded |

The `160 × k` upper bound on the routing table is loose — most high buckets are empty because the network has far fewer than `2^160` peers, so real tables hold on the order of `k · log N` live contacts.

---

## 4. Peer Discovery: Bootstrapping into the Overlay

A brand-new peer knows *nobody* and must get its first contact from somewhere outside the overlay. This is the **bootstrap problem**, and there is no fully decentralized answer for the very first contact — you always need an out-of-band hint.

- **Bootstrap nodes** — hard-coded, well-known, long-lived peers whose addresses ship in the client. A joining peer contacts one, then runs a lookup *for its own id* to populate its k-buckets from the peers it meets along the way. IPFS ships bootstrap multiaddrs; Ethereum ships "bootnodes"; BitTorrent's DHT ships a few router hostnames (e.g. `router.bittorrent.com`) that resolve to bootstrap nodes.
- **Trackers** — in classic BitTorrent, a **tracker** is a lightweight HTTP/UDP server named in the `.torrent` file. A peer sends the infohash and receives a random subset of the swarm's current peers. The tracker is a directory, not a data relay: it never touches file content. Trackerless torrents replace it with the DHT.
- **mDNS / local discovery** — on a LAN, peers announce themselves via multicast DNS so nearby peers find each other with zero configuration and no Internet round-trip. IPFS uses mDNS for local-network peer discovery.
- **PEX (Peer Exchange)** — once you know *any* swarm member, gossip-style exchange lets peers trade lists of other peers, reducing dependence on trackers and DHT.

The pattern is layered: bootstrap gets you *one* contact; a self-lookup or tracker query turns that into *many*; PEX and DHT maintenance keep the list fresh thereafter.

---

## 5. Churn: Handling Peers That Join and Leave

**Churn** is the continuous arrival and departure of peers — in public P2P networks a large fraction of peers may have session lifetimes of minutes. A structured overlay must keep routing correct and data available despite this, without a coordinator.

Mechanisms Kademlia-style systems use:

- **Passive routing-table maintenance.** Every message a peer receives carries the sender's id, so normal traffic keeps k-buckets fresh for free. When a bucket is full and a new contact appears, Kademlia pings the *least-recently-seen* contact; if it replies it stays (old, stable nodes are preferred — a deliberate bias, since a node that has been up a long time is statistically likely to stay up), otherwise it is evicted. This resists a class of attacks and favors reliable peers.
- **Replication with `k` copies.** Because each `(key, value)` lives on the `k` closest peers, losing a few to departure does not lose the data. Peers periodically **republish** keys they hold so that as the closest set shifts (new peers join closer to the key), replicas migrate to the new closest set.
- **Failure detection by lookup, not heartbeat.** Dead peers are discovered lazily when a lookup or store times out; the requester simply drops them and uses the next-closest live contact (`α` parallelism means one dead peer rarely stalls a lookup).
- **Graceful vs. ungraceful departure.** Well-behaved clients announce departure or hand off state; crashed peers just vanish, and the replication + republish loop repairs the gap on the next cycle.

The key mental model: a DHT is **self-healing through redundancy and lazy repair**, not through a controller that tracks who is alive.

---

## 6. Gossip / Epidemic Dissemination

Lookup finds a specific value; **gossip** spreads a value to *everyone*. In an epidemic protocol, each peer periodically picks a few random peers and exchanges state with them, exactly like a disease spreading through a population. A single new item reaches all `N` peers in `O(log N)` rounds, and the load is spread evenly — no peer is a bottleneck and no single failure stops propagation.

Three interaction styles:

- **Push** — an informed peer sends the new item to random peers. Fast at first, wasteful at the end (most targets already have it).
- **Pull** — peers ask random peers "anything new?" Efficient late in the process when most peers are already informed.
- **Push-pull** — combine both; converges fastest and is what most production systems use.

Gossip also carries *anti-entropy* (periodic full-state reconciliation to repair anything a push missed) and *rumor-mongering* (spread an item aggressively while it is "hot," then stop). This is how blockchain networks flood new transactions and blocks, how Cassandra and Consul propagate cluster membership, and how IPFS's pubsub spreads messages. The trade-off vs. structured routing: gossip is dead-simple and extremely robust to churn, but delivers items *eventually* with redundant traffic rather than by a precise path.

---

## 7. BitTorrent Mechanics: Pieces, Swarm, Tit-for-Tat

BitTorrent is the cleanest concrete P2P system to study because its incentives and data flow are explicit.

- **Pieces and blocks.** A file is split into fixed-size **pieces** (commonly 256 KiB–1 MiB), each with a SHA-1 hash listed in the `.torrent` metadata. A downloaded piece is verified against its hash before use, so corrupt or malicious data is detected immediately. Pieces are further split into smaller **blocks** for pipelining requests.
- **Swarm.** All peers trading a given torrent form a **swarm**. A **seed** has the complete file; a **leecher** is still downloading. Peers learn each other via tracker, DHT, and PEX.
- **Rarest-first piece selection.** A peer preferentially downloads the piece that is *least* replicated across its neighbors. This keeps rare pieces alive (protecting against the last seed vanishing) and maximizes the number of distinct pieces in circulation, so peers stay useful to each other.
- **Tit-for-tat and choking.** BitTorrent discourages free-riding with a **choking** algorithm: each peer uploads only to the few neighbors currently giving it the best download rates (it *unchokes* them and *chokes* the rest). This is a tit-for-tat incentive — cooperate with those who cooperate with you. **Optimistic unchoking** periodically gives a random choked peer a chance, both to bootstrap new peers and to discover better partners.
- **Endgame mode.** Near completion, the last few blocks are requested from *all* peers at once so a single slow peer cannot stall the final piece.

```mermaid
sequenceDiagram
    autonumber
    participant L as New Leecher
    participant T as Tracker / DHT
    participant P1 as Seed
    participant P2 as Peer (partial)

    Note over L: Parse .torrent → infohash + per-piece SHA-1 hashes
    L->>T: announce(infohash) — "who is in this swarm?"
    T-->>L: peer list (P1, P2, ...)
    L->>P1: handshake(infohash) + BITFIELD exchange
    L->>P2: handshake(infohash) + BITFIELD exchange
    Note over L: Choose rarest pieces P2 has that L lacks
    L->>P2: REQUEST block of rarest piece
    P2-->>L: PIECE (block data)
    Note over L: SHA-1(piece) matches manifest → keep; else discard & re-fetch
    L->>P1: unchoke P1 (it gave us best rate) — tit-for-tat
    Note over L,P2: L now has pieces → serves them to others (client + server)
```

---

## 8. Content Addressing

Traditional URLs are **location-addressed**: `https://host/path` says *where* to fetch, so if the host moves or dies, the link breaks, and you must trust that the host returned the right bytes. P2P systems instead use **content addressing**: the address of data *is the hash of the data itself*.

- **Self-verifying.** Given content-address `H`, any peer that hands you bytes lets you recompute the hash and confirm it equals `H`. Wrong or tampered bytes are rejected — you don't have to trust the source, only the math. This is what lets a DHT safely fetch a value from an unknown peer.
- **Deduplication.** Identical content produces one address everywhere, so the network stores it once regardless of how many people "uploaded" it.
- **Immutability.** A content-address names one exact bitstream forever. To publish a *new* version you get a *new* address; a separate mutable-naming layer (IPFS's IPNS, or a signed pointer) maps a stable human name to the latest hash.
- **In practice.** IPFS addresses blocks by CID (a hash-based Content Identifier) and looks them up via a Kademlia DHT keyed on that CID. BitTorrent's infohash is the content address of the whole torrent. Git commit ids and blockchain block hashes are the same idea.

Content addressing is the connective tissue of the whole tier: it produces the *keys* that the DHT routes on, the *hashes* that verify BitTorrent pieces, and the *ids* that gossip protocols dedupe on.

---

## 9. What to Carry into Senior

You should now be able to explain, mechanically:

- Why structured overlays (DHTs) buy `O(log N)` exact-key lookup while unstructured overlays trade that for flexible search.
- How Kademlia's XOR metric and k-buckets turn skewed neighbor knowledge into logarithmic, convergent iterative routing.
- How peers bootstrap (bootstrap nodes, trackers, mDNS, PEX) and how the overlay self-heals under churn via `k`-replication, republish, and lazy failure detection.
- How gossip spreads items epidemically in `O(log N)` rounds, and where that beats structured routing.
- BitTorrent's rarest-first + tit-for-tat + choking machinery, and how content addressing makes every peer's bytes self-verifying.

Senior shifts from *how it works* to *how to design and reason about it under adversity*: Sybil and eclipse attacks on DHTs, NAT traversal and connectivity, consistency and replication guarantees, incentive design and its failure modes, and when a P2P architecture is genuinely the right call versus a false economy.

*Next step:* [Peer-to-Peer Architecture — Senior](senior.md)
