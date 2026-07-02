# Peer-to-Peer Architecture — Professional

At the professional tier we stop treating a P2P network as a bag of "nodes that talk to each other" and start treating it as a **structured overlay with provable routing properties**. The unit of reasoning is no longer the request but the **keyspace**: a giant identifier ring or metric space into which both nodes and content are hashed, so that any participant can locate the responsible peer for any key in `O(log n)` hops while holding only `O(log n)` routing state. This document develops the mechanics — Kademlia's XOR metric, the geometry of k-buckets, the iterative lookup, gossip/epidemic dissemination bounds, Merkle-DAG content addressing, and the formal framing of churn and Sybil resistance — with the rigor a systems engineer needs to design or debug one.

---

## Table of Contents

1. [From Client-Server to Structured Overlays](#1-from-client-server-to-structured-overlays)
2. [The Distributed Hash Table Abstraction](#2-the-distributed-hash-table-abstraction)
3. [Kademlia: The XOR Metric](#3-kademlia-the-xor-metric)
4. [k-Buckets and Routing-Table Geometry](#4-k-buckets-and-routing-table-geometry)
5. [Iterative FIND_NODE and O(log n) Convergence](#5-iterative-find_node-and-olog-n-convergence)
6. [Chord vs Kademlia vs Pastry](#6-chord-vs-kademlia-vs-pastry)
7. [Gossip and Epidemic Dissemination](#7-gossip-and-epidemic-dissemination)
8. [Content Addressing and Merkle DAGs](#8-content-addressing-and-merkle-dags)
9. [Churn and Routing-Table Maintenance](#9-churn-and-routing-table-maintenance)
10. [Byzantine and Sybil Resistance](#10-byzantine-and-sybil-resistance)
11. [Summary](#11-summary)

---

## 1. From Client-Server to Structured Overlays

A client-server system places authority at a known address. A P2P system distributes both **data** and **routing authority** across symmetric participants, none of which holds a global view. The engineering problem this creates is *lookup*: given a key `k`, which peer(s) currently hold or are responsible for it, and how do I reach one of them without a directory?

Three overlay families answer this differently:

- **Unstructured** (early Gnutella): no placement rule; queries flood or random-walk. Cheap to join, resilient to churn, but lookup is `O(n)` in the worst case and rare items may never be found. Termination is probabilistic (TTL-bounded).
- **Structured (DHT)** (Chord, Kademlia, Pastry): keys and nodes share one identifier space; a deterministic rule maps each key to a responsible node, and a routing table lets any node forward toward that node in `O(log n)` hops. Guaranteed lookup, at the cost of maintenance under churn.
- **Hybrid / tracker-assisted** (classic BitTorrent): a centralized or DHT-based tracker bootstraps peer discovery; the actual data transfer is fully peer-to-peer.

The professional pivot is understanding that a DHT converts an unbounded search into a **greedy walk that strictly reduces a distance metric** at every hop. Everything below is a study of that metric and the data structures that make the walk cheap.

---

## 2. The Distributed Hash Table Abstraction

A DHT exposes a hash-table interface — `put(key, value)`, `get(key) -> value` — partitioned across a dynamic set of nodes. Both nodes and keys are hashed into the same `m`-bit identifier space (typically `m = 160`, i.e. SHA-1 output, or 256 bits). This shared space is the crux: **a key and a node ID are comparable**, so "which node owns key `k`" is answered by a distance rule over IDs.

Two properties are wanted from the placement rule:

- **Load balance.** With a good hash, each of `n` nodes owns `~K/n` of the `K` keys, and the largest share is `O((K/n) log n)` with high probability. This is exactly the [consistent-hashing](#consistent-hashing-vs-dht-keyspace) result.
- **Minimal disruption on membership change.** When a node joins or leaves, only `O(K/n)` keys must migrate — the keys adjacent to the departing/arriving node in the metric — not the whole table.

### Consistent hashing vs DHT keyspace

Consistent hashing and a DHT keyspace are the *same idea viewed from two altitudes*:

- **Consistent hashing** is the *placement* layer. It answers "who owns key `k`?" by hashing `k` onto a ring (or metric space) and assigning it to the nearest node clockwise (Chord) or by XOR-closeness (Kademlia). Virtual nodes smooth the variance so no node owns a disproportionate arc.
- **The DHT** adds a *routing* layer on top: each node keeps a sparse, distance-stratified routing table so it can *find* the owner in `O(log n)` hops without knowing all `n` nodes. Plain consistent hashing (as used inside a single Dynamo-style cluster) needs no routing overlay because every node knows the full ring; a DHT is what you build when `n` is too large or too dynamic for anyone to hold the full membership.

So: consistent hashing solves *ownership*; the DHT overlay solves *reachability* when membership itself must be discovered hop by hop.

---

## 3. Kademlia: The XOR Metric

Kademlia (Maymounkov & Mazières, *"Kademlia: A Peer-to-peer Information System Based on the XOR Metric"*, 2002) defines the distance between two `m`-bit identifiers `x` and `y` as their bitwise exclusive-or interpreted as an integer:

```
d(x, y) = x ⊕ y
```

This looks trivial but is a genuine **metric** and that is the whole point. It satisfies:

- **Identity:** `d(x, x) = 0`, and `d(x, y) = 0 ⟹ x = y`.
- **Symmetry:** `d(x, y) = d(y, x)` — because `⊕` is commutative. (This is Kademlia's key advantage over Chord, whose clockwise distance is *asymmetric*: `d(a→b) ≠ d(b→a)`. Symmetry means the node A learns about while querying is also a node for whom A is a useful contact, so routing tables self-populate from ordinary traffic.)
- **Triangle inequality:** `d(x, z) ≤ d(x, y) ⊕ d(y, z)`, which follows from `x ⊕ z = (x ⊕ y) ⊕ (y ⊕ z)` and the fact that `a ⊕ b ≤ a + b` bitwise.
- **Unidirectionality:** for any `x` and any distance `Δ`, there is exactly *one* `y` with `d(x, y) = Δ`. This guarantees that lookups for the same key **converge along the same path** regardless of the origin, so caching along that path is effective.

### Why XOR gives a tree

Interpret each ID as a leaf of a binary trie of depth `m`. The XOR distance between two leaves is governed by the height of their lowest common ancestor: the **length of the shared prefix** determines the most-significant differing bit, and that bit dominates the distance. Two IDs sharing a long prefix are close; sharing no prefix are maximally far. A Kademlia node's obligation is simply to know *some* peers in each subtree that does **not** contain itself — one subtree per bit position — which is exactly `O(log n)` subtrees, hence `O(log n)` routing state.

---

## 4. k-Buckets and Routing-Table Geometry

Each node partitions the other `n-1` possible IDs by XOR distance into `m` buckets. **Bucket `i`** holds contacts whose distance from this node lies in the range `[2^i, 2^{i+1})` — equivalently, contacts that share exactly `m - i - 1` leading bits with us and differ at bit `i`. Bucket `i` therefore covers a subtree of the ID trie of size `2^i`.

Because IDs are uniformly hashed, the number of live nodes actually falling in bucket `i` shrinks geometrically as `i` decreases (closer buckets cover exponentially smaller ID ranges). Kademlia caps each bucket at **`k` contacts** (typically `k = 20`) — enough that with high probability at least one of any `k` peers survives a bootstrap interval, giving redundancy against churn.

### The LRU-with-liveness eviction rule

A k-bucket is an **LRU list biased toward long-lived nodes**. On seeing a message from a known contact, move it to the tail (most-recently-seen). On seeing a *new* contact:

1. If the bucket has `< k` entries, append it.
2. If the bucket is full, PING the *least-recently-seen* (head) contact. If it responds, keep it and **discard the newcomer**; if it fails to respond, evict it and admit the newcomer.

This encodes a measured observation about churn: **the longer a node has been up, the longer it is likely to stay up** (uptime distributions are heavy-tailed / roughly Pareto). Preferring incumbents makes routing tables resistant to churn *and* raises the cost of flooding the table with fresh malicious identities — a first line of Sybil defense (see §10).

The whole routing table is thus `O(m)` buckets × `k` contacts = `O(log n · k)` = `O(log n)` state, with the closest subtrees kept densely and the far subtrees sampled sparsely.

---

## 5. Iterative FIND_NODE and O(log n) Convergence

Kademlia's four RPCs are `PING`, `STORE`, `FIND_NODE`, and `FIND_VALUE`. Lookup is built on `FIND_NODE(target)`, which asks a peer to return the `k` contacts it knows closest (by XOR) to `target`.

Kademlia does **iterative** (not recursive) routing: the *initiator* drives the whole lookup, so it observes progress at every step and controls parallelism. The algorithm:

1. Pick the `α` (parallelism, typically 3) contacts closest to `target` from the initiator's own buckets. Maintain a shortlist sorted by XOR distance to `target`.
2. Send `FIND_NODE(target)` to those `α` peers in parallel.
3. Merge every returned contact into the shortlist. Each response is expected to contain peers **strictly closer** to `target` than the responder (because each responder halves the remaining distance on average).
4. From the (updated) shortlist, query the closest `α` **not-yet-queried** peers.
5. Terminate when a full round returns no node closer than the best already seen — the `k` closest live nodes to `target` have converged.

Each hop resolves at least one more bit of the shared prefix with `target`, so the number of unresolved bits — and thus the expected hop count — is `O(log n)`. The `α` parallelism trades a modest bandwidth increase for lower tail latency and robustness to a few dead contacts stalling the walk.

```mermaid
sequenceDiagram
    autonumber
    participant I as Initiator (ID …0000)
    participant A as Peer A (d=1011)
    participant B as Peer B (d=0110)
    participant C as Peer C (d=0011)
    participant T as Owner ≈ target (d=0000)
    Note over I: Target key K; shortlist seeded α=2 nearest known
    I->>A: FIND_NODE(K)   [dist 1011]
    I->>B: FIND_NODE(K)   [dist 0110]
    A-->>I: k closest it knows → includes C (0011)
    B-->>I: k closest it knows → includes C (0011)
    Note over I: Best distance improved 0110 → 0011 (a bit resolved)
    I->>C: FIND_NODE(K)   [dist 0011]
    C-->>I: k closest → includes owner T (0000)
    I->>T: FIND_NODE(K) / FIND_VALUE(K)
    T-->>I: value or self as owner
    Note over I,T: No closer node returned → converged in O(log n) rounds
```

`FIND_VALUE` short-circuits: if any queried peer holds the value it returns it immediately instead of contacts, and the initiator then **caches** the value at the closest peer that *didn't* have it — a self-tuning cache that hugs popular keys near their owners.

---

## 6. Chord vs Kademlia vs Pastry

All three are `O(log n)` DHTs; they differ in metric geometry, routing-table structure, and how gracefully they tolerate churn.

| Dimension | **Chord** | **Kademlia** | **Pastry** |
|---|---|---|---|
| Metric | Clockwise numeric distance on a ring (asymmetric) | XOR (symmetric, unidirectional) | Numeric prefix + ring proximity |
| Routing state | Finger table: `O(log n)` fingers + successor list | `O(log n)` k-buckets × `k` | Leaf set + routing table + neighborhood set, `O(log n)` |
| Lookup cost | `O(log n)` hops | `O(log n)` hops | `O(log₂ᵇ n)` hops (base `2^b`) |
| Routing style | Recursive or iterative; greedy toward successor | Iterative, `α`-parallel | Recursive, prefix-matching |
| Table repair | Periodic `stabilize` + fix-fingers | Passive: learns from every RPC it receives | Active leaf-set / neighborhood repair |
| Symmetry | No — inbound ≠ outbound routes | Yes — path-independent, cacheable | Partial |
| Locality awareness | None (pure ID space) | None inherently | Yes — neighborhood set uses network proximity |
| Churn resilience | Weaker; incorrect fingers cause lookup failures until stabilize | Strong; `k`-redundant buckets + parallel `α` | Moderate; needs active repair |

**Reading the table.** Chord is the cleanest to prove and teach — one ring, one successor rule, finger `i` points halfway-plus around the ring — but its asymmetry means it can't learn routing entries from incoming queries and it depends on a background `stabilize` protocol to stay correct under churn. Pastry adds *network locality* (its neighborhood set prefers physically nearby peers), reducing real latency, at the cost of a more complex three-structure table and active repair. Kademlia wins in production (Ethereum's discv5, IPFS, BitTorrent's Mainline DHT) precisely because **symmetry makes maintenance nearly free**: every message a node receives carries a candidate contact for a bucket, so tables self-heal from ordinary traffic without a dedicated stabilization round.

---

## 7. Gossip and Epidemic Dissemination

DHT routing solves *point* lookup. Broadcasting an update to *all* peers — membership changes, block announcements, CRDT deltas — is the domain of **gossip (epidemic) protocols**, which trade determinism for extreme robustness. The model is borrowed directly from mathematical epidemiology (SIR: Susceptible / Infected / Removed).

Each round, every "infected" node contacts a small constant number of random peers and shares the update. Three interaction modes:

| Mode | Mechanism | Rounds to full coverage | Message cost | Best when |
|---|---|---|---|---|
| **Push** | Infected nodes send to random peers | `O(log n)` but slow *tail* — last few nodes hard to hit | High late-stage waste (most targets already infected) | Update is fresh, few sources |
| **Pull** | Every node asks a random peer "anything new?" | Fast *once* a constant fraction is infected; slow start | High early-stage waste (nothing to pull yet) | Update is already widespread |
| **Push-pull** | Both directions per contact | `O(log n)` with best constants; **doubly-exponential** tail collapse | Lowest total, converges fastest | General case — the default |

### The dissemination bound

With push, if `S_r` nodes are still susceptible after round `r`, the infection roughly **doubles** each round while susceptibles are plentiful (`I_{r+1} ≈ 2·I_r`), so it takes `log₂ n` rounds to reach a constant fraction. The residue then decays: the number still-susceptible shrinks super-exponentially, and total time to reach *all* `n` nodes with high probability is `log₂ n + ln n + O(1)` rounds. Push-pull sharpens the tail because in the late phase, susceptible nodes actively pull from the saturated majority — coverage completes in `O(log n)` rounds with small hidden constants, and message complexity per node is `O(log n)`.

```mermaid
sequenceDiagram
    autonumber
    participant N0 as Seed
    participant R1 as Round-1 set
    participant R2 as Round-2 set
    participant R3 as Round-3 set
    Note over N0: Infected = 1
    N0->>R1: push-pull to random fanout f
    Note over R1: Infected ≈ f  (round 1)
    R1->>R2: each infected → random peers
    Note over R2: Infected ≈ f²  (doubling regime)
    R2->>R3: continue; susceptibles now scarce
    Note over R3: pull dominates tail → residue collapses
    Note over N0,R3: ~log(n) rounds ⇒ whole network, O(log n) msgs/node
```

The engineering payoff: gossip has **no single point of failure, no leader, and self-corrects** — a lost message just means a node hears the update one round later. The cost is redundancy (nodes receive updates they already have) and only *eventual*, probabilistic consistency. This is why anti-entropy gossip underpins Cassandra/Dynamo membership, blockchain block/transaction propagation, and IPFS's pubsub.

---

## 8. Content Addressing and Merkle DAGs

BitTorrent, IPFS, and blockchains share a foundational move: **address data by the hash of its content, not by location**. A content identifier (CID) is (essentially) `hash(bytes)`. This yields three properties for free:

- **Integrity / self-verification.** Anyone who fetches the bytes can recompute the hash and confirm they got exactly the requested content — no trusted server needed. Tampering changes the CID.
- **Deduplication.** Identical content has one address, stored once, regardless of how many "files" reference it.
- **Immutability.** A CID names one specific byte sequence forever; you cannot mutate content behind an address.

### Merkle DAGs

Large objects are chunked and assembled into a **Merkle DAG**: leaf nodes hold data blocks; internal nodes hold the CIDs (hashes) of their children plus metadata. The root CID transitively commits to the entire tree — change any leaf and every hash up to the root changes.

```
            root CID = H(link_A, link_B)
               /                    \
        link_A = H(chunk0)   link_B = H(node_C)
            |                        /        \
         chunk0            H(chunk1)          H(chunk2)
                              |                   |
                           chunk1             chunk2
```

- **BitTorrent** uses a Merkle-ish structure: the `.torrent` file (or v2 metadata) carries per-piece hashes so each downloaded piece is independently verified before sharing onward. The DHT (Mainline) locates *peers* for an info-hash; the piece hashes verify *content*.
- **IPFS** (ipfs.tech) generalizes this: everything is a Merkle DAG of blocks addressed by CID; a Kademlia DHT maps a CID → the peers advertising it (the *provider records*), then Bitswap fetches blocks. Deduplication is structural — a shared subtree is one set of blocks.
- **Blockchains** use Merkle trees for transaction sets (the block header commits to a Merkle root of transactions) enabling `O(log n)` **Merkle proofs**: a light client verifies a transaction's inclusion by checking a logarithmic-length path to a trusted root, without downloading the block.

A **DAG** (not a tree) because deduplication lets multiple parents point at a shared child subtree; and it must be acyclic because a cycle would require a hash to contain itself — impossible under a collision-resistant hash. Content addressing thus makes the *data model itself* tamper-evident and location-independent, which is the substrate every serious P2P system is built on.

---

## 9. Churn and Routing-Table Maintenance

**Churn** — the continuous arrival and departure of peers — is the defining operational stress of a P2P overlay. Session times are heavy-tailed; median lifetimes in public swarms can be minutes. A routing table full of dead contacts silently degrades lookups into timeouts and dead-ends.

Maintenance strategies map onto the three DHTs:

- **Kademlia (passive + refresh).** Buckets self-heal because every incoming RPC surfaces a live contact. The LRU-with-PING eviction (§4) keeps stable, long-lived nodes and quietly drops the dead. A bucket that has seen no traffic for a refresh interval (e.g. 1 hour) is *refreshed* by looking up a random ID inside its range, repopulating it. Redundancy `k` and parallelism `α` mean a lookup tolerates several dead contacts per hop.
- **Chord (active stabilize).** A periodic `stabilize` verifies the successor pointer and `fix_fingers` re-checks one finger per round. Between stabilizations the finger table can be stale, and under high churn lookups may transiently fail; correctness is restored, not continuously guaranteed.
- **Pastry (active leaf-set repair).** Leaf-set and neighborhood-set entries are probed and replaced from known backups on failure.

Two quantities frame the design:

- **Half-life** of the network (time for half the nodes to be replaced). Maintenance traffic must be frequent relative to half-life or the table decays faster than it repairs.
- **Redundancy vs cost.** Larger `k` and `α` buy churn tolerance at linear bandwidth cost; replication factor `r` (store each key on the `r` closest nodes) buys data durability at storage cost. Values are chosen so that `P(all r replicas leave within a repair interval)` is negligible.

The professional instinct: **assume every routing entry is probably-dead until proven live, and design so that a lookup degrades gracefully — retrying the next-closest contact — rather than failing on the first timeout.**

---

## 10. Byzantine and Sybil Resistance

Open P2P networks are *permissionless*: anyone can join, so the adversary model is Byzantine (nodes may lie, drop, or forge) and specifically **Sybil** (one entity fabricates many identities to gain disproportionate influence).

### The Sybil attack, formally

Because a node's position and responsibilities derive from its ID, an adversary who can **freely choose or cheaply mint IDs** can:

- **Eclipse** a target by surrounding it — filling the target's buckets near a key with adversary IDs so all lookups for that key route only through the adversary.
- **Position-farm** — generate IDs XOR-close to a valuable key to become its responsible node and censor or forge `STORE`/`FIND_VALUE`.

Douceur's result (2002) is the sobering baseline: **without a trusted certification authority or a physical/economic cost on identity, Sybil attacks cannot be fully prevented** in a fully decentralized system. Every mitigation therefore raises the *cost* of identities rather than forbidding them.

### Mitigations and their trade-offs

| Mechanism | How it raises identity cost | Trade-off |
|---|---|---|
| **ID = hash(IP\|port)** or crypto-puzzle-bound ID | Ties identity to a scarce resource (address, PoW) so minting many is expensive | Attackers with many IPs / hashpower still scale |
| **Proof-of-Work / Proof-of-Stake** | Influence ∝ scarce external resource, not identity count | Energy or capital cost; centralization pressure |
| **k-redundancy + `α`-parallel lookup** | Correct answer survives if *any* of `k` contacts is honest | Only probabilistic; fails if a bucket is fully eclipsed |
| **Diverse bucket population** (prefer distinct prefixes / IP subnets) | Harder to fill a bucket with correlated adversary nodes | Weakens if attacker controls diverse IP space |
| **Long-lived-node preference** (LRU eviction, §4) | New malicious IDs can't displace established honest peers | Slows, doesn't stop, a patient attacker |
| **Reputation / web-of-trust / social graph** | Bounds Sybils by scarcity of honest social edges | Requires out-of-band trust; not fully open |

The clean framing: a permissionless DHT can guarantee routing *only up to the fraction of honest nodes along redundant paths*. Blockchains "solve" the open-membership Byzantine problem by making identity-independent — consensus weighs **work or stake, not node count** — which is precisely why Nakamoto consensus was a breakthrough: it sidesteps Sybil by refusing to count identities at all. A P2P system's security posture is therefore chosen, not assumed: pick your identity-cost mechanism deliberately, size `k`/`α`/`r` for your threat model, and treat "any honest node on the path" as the property you are actually buying.

---

## 11. Summary

- A structured overlay (DHT) turns unbounded search into a **greedy walk that strictly reduces a distance metric**, giving `O(log n)` lookup with `O(log n)` routing state.
- **Consistent hashing** answers *ownership*; the **DHT overlay** answers *reachability* when membership must be discovered hop by hop.
- **Kademlia's XOR metric** is a genuine metric — symmetric, unidirectional, triangle-obeying — and its symmetry makes routing tables self-heal from ordinary traffic, which is why it dominates production.
- **k-buckets** are LRU lists biased toward long-lived nodes; **iterative `α`-parallel `FIND_NODE`** resolves one prefix bit per hop and converges in `O(log n)` rounds.
- **Gossip/epidemic** dissemination reaches all `n` nodes in `O(log n)` rounds with `O(log n)` messages/node; **push-pull** has the best constants and tail behavior.
- **Content addressing + Merkle DAGs** make data self-verifying, deduplicated, immutable, and location-independent — the shared substrate of BitTorrent, IPFS, and blockchains.
- **Churn** demands you assume every routing entry is probably-dead; **Sybil resistance** is about raising identity cost, never eliminating the attack, and holds only up to the honest fraction on redundant paths.

*Next step:* [Peer-to-Peer Architecture — Staff](staff.md)
