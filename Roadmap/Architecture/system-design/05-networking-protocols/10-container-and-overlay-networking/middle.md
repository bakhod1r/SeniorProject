# Container & Overlay Networking — Middle

This tier explains the *mechanics*. How does a process inside a pod get its own IP? How does a `ClusterIP` — an address no machine actually owns — deliver a packet to a pod running on a different node? We build the picture bottom-up: single-host primitives (namespaces, veth, bridge), then the CNI contract, then the two ways clusters connect pods across nodes (overlay vs routed), then Services, DNS, and NetworkPolicy. The payoff is a full packet trace from pod A to pod B on another host.

## Table of contents

1. [Single-host primitives: netns, veth, bridge](#1-single-host-primitives-netns-veth-bridge)
2. [The CNI contract: how a pod gets an IP](#2-the-cni-contract-how-a-pod-gets-an-ip)
3. [Cross-node connectivity: overlay vs routed](#3-cross-node-connectivity-overlay-vs-routed)
4. [VXLAN encapsulation in detail](#4-vxlan-encapsulation-in-detail)
5. [Kubernetes Services: ClusterIP and kube-proxy](#5-kubernetes-services-clusterip-and-kube-proxy)
6. [iptables vs IPVS kube-proxy modes](#6-iptables-vs-ipvs-kube-proxy-modes)
7. [DNS with CoreDNS](#7-dns-with-coredns)
8. [End-to-end packet trace](#8-end-to-end-packet-trace)
9. [Network policies at a working level](#9-network-policies-at-a-working-level)
10. [Takeaways](#10-takeaways)

---

## 1. Single-host primitives: netns, veth, bridge

Container networking is not magic; it is three Linux kernel features composed together.

- **Network namespace (netns)** — a private copy of the kernel's network stack: its own interfaces, routing table, `iptables` rules, ARP table, and sockets. Every pod gets one netns, shared by all containers in the pod (this is why containers in a pod reach each other over `localhost`). The host's own stack is the "root" (default) namespace.
- **veth pair** — a virtual Ethernet cable: two interfaces where anything sent into one end comes out the other. One end lives inside the pod netns (typically `eth0`), the other end lives in the root namespace. This is the bridge between the pod's private stack and the host.
- **Linux bridge** — a software L2 switch (e.g. `cni0` or `docker0`) in the root namespace. The host-side ends of every pod's veth pair are plugged into it, so all pods on one node share an L2 segment and can reach each other directly by MAC.

On a single node the flow is: `pod eth0` → veth → `cni0` bridge → veth → `pod eth0`. The bridge learns MAC-to-port mappings just like a hardware switch. Off-node traffic leaves the bridge and hits the host routing table, where the cross-node mechanism (Section 3) takes over.

```
  Pod A netns            Root namespace            Pod B netns
 ┌───────────┐         ┌──────────────┐          ┌───────────┐
 │  eth0     │──veth───│    cni0      │───veth───│   eth0    │
 │ 10.244.1.2│         │   (bridge)   │          │10.244.1.3 │
 └───────────┘         └──────┬───────┘          └───────────┘
                              │ (host routing → other nodes)
                          host eth0
```

## 2. The CNI contract: how a pod gets an IP

Kubernetes itself does *not* wire pods. It delegates to a **CNI (Container Network Interface) plugin** through a small, well-defined contract. When the kubelet needs a pod on the network, it invokes the configured CNI binary with:

- an **operation** — `ADD` (attach) or `DEL` (detach), plus `CHECK`;
- the pod's **netns path** and container ID via environment variables;
- a **network config** (JSON) read from `/etc/cni/net.d/`, passed on stdin.

On **ADD**, the plugin performs the single-host setup of Section 1 inside the target netns: create the veth pair, move one end into the netns as `eth0`, attach the host end to the bridge (or set up routes for a routed plugin), then call an **IPAM (IP Address Management)** module to allocate an IP from the node's pod CIDR, and install the pod's default route. It returns the assigned IP as JSON. On **DEL**, it tears all of this down and releases the IP.

This contract is why the data plane is pluggable: Flannel, Calico, Cilium, and Weave all implement the same ADD/DEL interface but differ wildly in *how* they connect nodes. The kubelet does not know or care which one is installed.

```
kubelet ──exec──▶ CNI plugin (ADD)
                     ├─ create veth pair, put eth0 in pod netns
                     ├─ IPAM: allocate IP from node pod CIDR
                     ├─ install default route inside pod
                     └─ return { "ip": "10.244.1.2/24" }
```

The **Kubernetes network model** the CNI plugin must satisfy has three flat rules: every pod gets a unique IP; every pod can reach every other pod **without NAT**; and a pod sees its own IP as the same address others use to reach it. This "flat pod network" is the invariant every plugin upholds.

## 3. Cross-node connectivity: overlay vs routed

Within a node, the bridge handles everything. Across nodes, pod IPs are not routable on the physical (underlay) network, so the plugin must get a packet destined for `10.244.2.5` (on node B) out of node A and delivered correctly. There are two dominant strategies.

- **Overlay (encapsulation)** — wrap each pod-to-pod packet inside a new outer packet addressed node-to-node. The physical network only ever sees node IPs; the pod network is a virtual L2/L3 fabric layered on top. VXLAN is the common encapsulation (Section 4). This works on *any* underlay because it hides pod IPs entirely — but adds per-packet CPU cost and header overhead (MTU shrinks).
- **Routed / underlay (no encapsulation)** — make pod CIDRs first-class routes in the network. Each node advertises "pod CIDR `10.244.2.0/24` lives at me" via **BGP**, so routers and peer nodes forward pod-destined packets natively. Calico's BGP mode is the canonical example. Packets travel unencapsulated at native speed, but this requires the underlay to accept and honor pod routes (or a BGP-capable fabric).

| Dimension | Overlay (VXLAN) | Routed (BGP / underlay) |
|---|---|---|
| Packet on the wire | Encapsulated (outer UDP/IP + inner frame) | Native pod IP packet |
| Underlay requirement | Any IP network; nodes just need L3 reachability | Underlay must route/accept pod CIDRs (BGP peers) |
| Per-packet CPU | Higher (encap/decap on every hop) | Minimal |
| MTU / overhead | ~50 bytes lost per packet to headers | None |
| Route propagation | VNI + VTEP tables, often via control plane | BGP advertises pod CIDRs to fabric |
| Visibility to network gear | Pod IPs hidden inside tunnel | Pod IPs visible to routers/firewalls |
| Typical plugins | Flannel (vxlan), Calico VXLAN, Weave | Calico BGP, Cilium native routing |

Rule of thumb: overlays maximize portability (run anywhere), routed modes maximize performance and observability (but need cooperative networking).

## 4. VXLAN encapsulation in detail

**VXLAN (Virtual eXtensible LAN)** tunnels L2 Ethernet frames inside UDP datagrams. The pieces:

- **VTEP (VXLAN Tunnel Endpoint)** — the entity that encapsulates outgoing frames and decapsulates incoming ones. On each node the plugin creates a virtual interface (e.g. `flannel.1` or `vxlan.calico`) that acts as the VTEP.
- **VNI (VXLAN Network Identifier)** — a 24-bit segment ID in the VXLAN header, isolating one virtual network from another (up to ~16M segments).
- **Encapsulation** — the original inner Ethernet frame (with pod source/dest MAC and IP) is prefixed with a VXLAN header, then a **UDP** header (destination port **4789**), then an **outer IP** header addressed from the source node to the destination node.

When node A sends to a pod on node B, the VTEP looks up which node hosts the destination pod's CIDR, wraps the frame, and sends the outer packet over normal UDP to node B's IP. Node B's VTEP receives on port 4789, strips the outer headers, and injects the original frame onto its local bridge as if it had arrived locally. Because ~50 bytes of headers are added, the pod interface MTU is reduced (commonly to 1450) to avoid fragmentation.

## 5. Kubernetes Services: ClusterIP and kube-proxy

Pods are ephemeral — their IPs change on every restart. A **Service** gives a stable virtual address in front of a set of pods selected by label. A `ClusterIP` Service gets an IP from the *service* CIDR (distinct from the pod CIDR), and this IP is **not owned by any interface** — no machine answers ARP for it. It is a purely virtual target realized by packet rewriting.

The realization is done by **kube-proxy**, a per-node agent. It watches the API server for Services and their `EndpointSlices` (the current set of ready pod IPs backing each Service). For each Service it programs the kernel so that any packet sent to `ClusterIP:port` is **DNAT'd** (destination NAT) to one of the backing pod IPs, chosen roughly at random for load balancing. The reverse rewrite on the return path is handled by conntrack, so the client is unaware.

Key consequence: a Service ClusterIP is meaningless off-cluster and never appears on the wire beyond the sending node — kube-proxy rewrites it to a real pod IP *before* the packet is routed or encapsulated. The overlay/routed layer only ever carries real pod IPs.

## 6. iptables vs IPVS kube-proxy modes

kube-proxy can implement the ClusterIP-to-pod DNAT in two main modes.

| Aspect | iptables mode | IPVS mode |
|---|---|---|
| Mechanism | Chains of `iptables`/netfilter DNAT rules | In-kernel L4 load balancer (hash tables) |
| Rule lookup | Sequential list traversal per Service/endpoint | O(1) hash lookup |
| Scaling | Rule count grows with Services × endpoints; updates get slow at large scale | Handles thousands of Services efficiently |
| Load-balancing options | Effectively random (probability rules) | Multiple: round-robin, least-conn, dest-hash, etc. |
| Default | Long-standing default in most clusters | Opt-in; better for large clusters |
| Dependency | netfilter only | Requires kernel IPVS modules |

In **iptables mode**, each Service becomes a chain that, using statistical `--probability` matches, DNATs the connection to one endpoint chain per pod. It is robust and ubiquitous but the flat rule set can reach tens of thousands of rules, making rule reload latency the bottleneck. In **IPVS mode**, kube-proxy programs the kernel's IP Virtual Server, which uses hash tables and pluggable scheduling algorithms, giving near-constant-time lookups and faster updates at high Service counts. Both still rely on netfilter for some ancillary rules (masquerade, node ports).

## 7. DNS with CoreDNS

Clients address Services by *name*, not IP. **CoreDNS** runs as an in-cluster DNS server (itself a Service) and is injected into every pod's `/etc/resolv.conf` via the kubelet. A Service `payments` in namespace `shop` resolves as `payments.shop.svc.cluster.local` to its ClusterIP. The `search` domains in `resolv.conf` let a pod use short names like `payments` (within its own namespace) or `payments.shop`.

So the full name-to-delivery path is: pod queries CoreDNS → CoreDNS returns the ClusterIP → the pod sends to that ClusterIP → kube-proxy DNATs to a live pod endpoint. Headless Services (`clusterIP: None`) instead return the individual pod IPs directly, used when the client needs to reach specific pods (e.g. StatefulSets).

## 8. End-to-end packet trace

Now the whole picture: **pod A on node 1** calls `http://payments:8080`, whose Service ClusterIP is backed by **pod B on node 2**, over a VXLAN overlay.

```mermaid
sequenceDiagram
    autonumber
    participant A as Pod A (node1)
    participant DNS as CoreDNS
    participant KP as kube-proxy (node1)
    participant V1 as VTEP node1
    participant V2 as VTEP node2
    participant B as Pod B (node2)

    A->>DNS: Resolve payments.shop.svc.cluster.local
    DNS-->>A: ClusterIP 10.96.0.20
    Note over A: App opens TCP to 10.96.0.20:8080
    A->>KP: Packet dst=10.96.0.20:8080 leaves pod eth0 → bridge → host
    Note over KP: kube-proxy rule matches ClusterIP;<br/>picks endpoint pod B 10.244.2.5:8080
    KP->>KP: DNAT dst 10.96.0.20 → 10.244.2.5 (conntrack records it)
    Note over KP: Routing: 10.244.2.0/24 reachable via VXLAN → node2
    KP->>V1: Hand packet to VTEP interface
    Note over V1: Encap: inner frame (src 10.244.1.2 → dst 10.244.2.5)<br/>wrapped in UDP:4789, outer IP node1 → node2, VNI set
    V1->>V2: Outer UDP packet over physical underlay
    Note over V2: Decap: strip outer headers,<br/>inject original frame on node2 bridge
    V2->>B: Frame delivered to pod B eth0 (dst 10.244.2.5:8080)
    Note over B: App sees connection; replies. conntrack<br/>reverses DNAT so source appears as ClusterIP
    B-->>A: Response traverses the tunnel back and un-DNATs
```

The critical ordering: **DNS first**, then **DNAT before encapsulation**. The ClusterIP never leaves node 1 — it is rewritten to pod B's real IP, and only that real pod IP travels (encapsulated) across the underlay. Conntrack remembers the translation so the return packet is un-DNAT'd and pod A sees the reply as coming from the ClusterIP it dialed.

## 9. Network policies at a working level

By default the flat pod network allows *any* pod to talk to *any* pod. A **NetworkPolicy** is a namespaced object that restricts this. It selects pods (`podSelector`) and declares allowed **ingress** and/or **egress** rules by pod labels, namespaces, or IP blocks and ports.

Two mechanics matter operationally:

- **Deny-by-default is opt-in per direction.** As soon as *any* policy selects a pod for a given direction, that direction becomes default-deny for that pod, and only explicitly listed sources/destinations are allowed. A pod with no policy selecting it stays fully open.
- **Enforcement is by the CNI plugin, not the API server.** NetworkPolicy objects are inert unless the installed plugin implements them (Calico, Cilium, Weave do; the reference bridge/Flannel plugin alone does not). The plugin translates policies into `iptables`/eBPF rules on each node, dropping packets that no rule permits.

A minimal example — allow ingress to `db` pods only from `api` pods on port 5432:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-allow-api
  namespace: shop
spec:
  podSelector:
    matchLabels: { app: db }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: api }
      ports:
        - protocol: TCP
          port: 5432
```

## 10. Takeaways

- A pod's network is a **netns** joined to the host via a **veth pair** into a **bridge**; that is the entire single-host story.
- The **CNI ADD/DEL contract** is how the kubelet delegates wiring; IPAM assigns the pod IP, and the plugin decides the cross-node data plane.
- Cross-node traffic is either **encapsulated (VXLAN: VTEP/VNI, UDP 4789)** for portability or **routed (BGP-advertised pod CIDRs)** for native performance.
- A **ClusterIP** is virtual; **kube-proxy** (iptables or IPVS) **DNATs** it to a real pod endpoint *before* routing/encapsulation — so overlays only ever carry real pod IPs.
- **CoreDNS** maps Service names to ClusterIPs; **NetworkPolicy** is enforced by the CNI plugin and flips a pod to default-deny per direction once it is selected.

*Next step:* [Container & Overlay Networking — Senior](senior.md)
