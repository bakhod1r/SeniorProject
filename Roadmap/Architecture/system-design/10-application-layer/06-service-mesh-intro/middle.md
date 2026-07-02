# Service Mesh — Middle

A service mesh moves service-to-service concerns — mutual TLS, retries, timeouts, load balancing, and telemetry — out of application code and into a network of proxies that sit next to every workload. This tier explains *how* that works mechanically: what runs where, how a request actually traverses the proxy path, and how configuration reaches the proxies without redeploying your app.

## Table of Contents

1. [The two-plane model](#1-the-two-plane-model)
2. [The sidecar and injection](#2-the-sidecar-and-injection)
3. [Tracing a request through the mesh](#3-tracing-a-request-through-the-mesh)
4. [How config reaches the data plane: xDS](#4-how-config-reaches-the-data-plane-xds)
5. [Identity and mTLS](#5-identity-and-mtls)
6. [Traffic management: shifting, retries, timeouts, circuit breaking](#6-traffic-management-shifting-retries-timeouts-circuit-breaking)
7. [Telemetry for free](#7-telemetry-for-free)
8. [Where this goes next](#8-where-this-goes-next)

---

## 1. The two-plane model

Every mesh splits cleanly into two planes with distinct jobs and lifecycles.

| Aspect | Data plane | Control plane |
|---|---|---|
| What it is | Proxies (Envoy in Istio; a purpose-built Rust micro-proxy in Linkerd) co-located with each workload | Central component (`istiod`, Linkerd's `destination`/`identity` controllers) |
| Job | Actually move packets: terminate connections, apply mTLS, route, retry, load-balance, emit metrics | Compute intent from config and push it to proxies; issue certificates; track endpoints |
| Where it runs | One instance per pod/workload (sidecar) | A few replicas, cluster-wide |
| On the request path? | Yes — every request goes through it | No — a proxy that loses its control plane keeps serving with its last-known config |
| Reacts to | Live traffic | API changes (routing rules, policies) and service-registry changes (pods coming and going) |

The key property: the **control plane is off the hot path**. It configures proxies asynchronously. A control-plane outage stops *new* config from propagating but does not stop traffic — proxies run on cached state. This is why meshes can be highly available even during upgrades.

---

## 2. The sidecar and injection

The data-plane proxy runs as a **sidecar**: a second container in the same pod as your application container. Same network namespace, same lifecycle, but a separate process. Because they share the namespace, the proxy can transparently intercept the app's inbound and outbound traffic.

**Injection** is how the sidecar gets there. Two mechanisms:

- **Automatic (admission webhook):** you label a namespace (e.g. `istio-injection=enabled`). When Kubernetes admits a new pod, a mutating admission webhook rewrites the pod spec to add the proxy container plus an init container.
- **Manual:** you run a CLI (`istioctl kube-inject`, `linkerd inject`) that emits the mutated YAML ahead of time.

**Traffic capture** is the second half. An init container (or a CNI plugin) installs `iptables` rules in the pod's network namespace that redirect all inbound and outbound TCP to the sidecar's ports. The application makes an ordinary `connect()` to `orders:8080`; the kernel silently reroutes that connection to the local proxy. **The application code is unchanged and unaware.** That transparency is the whole point — no SDK, no library, no per-language client.

---

## 3. Tracing a request through the mesh

Consider service **A** calling service **B**. Both have sidecars. Here is the full path, including the mTLS handshake and one retry.

```mermaid
sequenceDiagram
    autonumber
    participant App as App A (container)
    participant PA as Sidecar A (Envoy)
    participant CP as Control Plane (istiod)
    participant PB as Sidecar B (Envoy)
    participant Svc as App B (container)

    Note over PA,PB: Both sidecars already hold config pushed earlier via xDS
    CP-->>PA: (earlier) routes, clusters, endpoints, cert for identity A
    CP-->>PB: (earlier) routes, listeners, cert for identity B

    App->>PA: plaintext HTTP GET /order (iptables redirects to localhost proxy)
    Note over PA: Match route for "B", pick endpoint via LB, apply timeout budget
    PA->>PB: mTLS ClientHello — presents SPIFFE cert (identity A)
    PB->>PA: mTLS ServerHello — presents SPIFFE cert (identity B)
    Note over PA,PB: Each verifies the other's cert against the mesh CA; mutual auth established
    PA->>PB: encrypted HTTP GET /order over the mTLS tunnel
    PB->>Svc: plaintext HTTP GET /order (loopback inside pod B)
    Svc-->>PB: 503 Service Unavailable (transient)
    Note over PB,PA: 503 is a retriable condition
    PA->>PB: retry over same/pooled mTLS connection
    PB->>Svc: plaintext GET /order (retry)
    Svc-->>PB: 200 OK
    PB-->>PA: encrypted 200 OK
    PA-->>App: plaintext 200 OK
    Note over PA,PB: Both proxies emit metrics/spans for this exchange
```

Read the diagram as three concerns layered on one request:

- **Interception** (steps 3, 8, 13): `iptables` makes the app-to-proxy and proxy-to-app hops look like ordinary local connections.
- **Security** (steps 4–7): the wire between the two pods is an mTLS tunnel. The app sends and receives plaintext on loopback; encryption happens entirely in the proxies.
- **Resilience** (steps 9–12): sidecar A owns the retry. The app never sees the transient 503; it sees a single successful call.

---

## 4. How config reaches the data plane: xDS

The control plane and Envoy sidecars speak **xDS** — the *x* Discovery Service protocol, a gRPC streaming API. Each proxy opens a long-lived stream to the control plane and receives typed configuration resources, pushed whenever they change:

| Resource | Answers the question |
|---|---|
| **LDS** (Listener Discovery) | What ports/filters do I listen on? |
| **RDS** (Route Discovery) | Given a request, which cluster does it go to? |
| **CDS** (Cluster Discovery) | What upstream services exist, and how do I load-balance them? |
| **EDS** (Endpoint Discovery) | What are the current healthy IPs behind each cluster? |
| **SDS** (Secret Discovery) | What certificates/keys do I use for mTLS? |

The flow: you write high-level intent as Kubernetes resources (an Istio `VirtualService`, `DestinationRule`, or a Gateway API `HTTPRoute`). The control plane **watches the Kubernetes API and the service registry**, translates that intent plus live endpoint data into concrete xDS resources, and streams them to exactly the proxies that need them. When a pod for service B scales up, EDS pushes the new endpoint to every proxy that talks to B — no restart, no polling.

This is the mechanism behind "no redeploy to change routing": your app's binary is fixed, but its network behavior is reconfigured live through xDS.

---

## 5. Identity and mTLS

Mesh security rests on **workload identity**, not IP addresses. Each workload gets a cryptographic identity, commonly a **SPIFFE ID** encoded in an X.509 certificate — for example `spiffe://cluster.local/ns/prod/sa/orders`, derived from the Kubernetes service account.

- The control plane runs (or fronts) a **certificate authority**. On startup, each sidecar requests a cert for its workload's identity; the CA signs it. Certs are short-lived and rotated automatically (hours, not months), delivered over SDS.
- On every connection, both sidecars perform a **mutual TLS handshake**: each presents its cert and verifies the peer's cert against the mesh CA. This authenticates *both* ends — the caller proves who it is, not just the server.
- Because identity is verified per connection, you can write **authorization policies** in terms of identity ("`payments` may call `ledger`; nothing else may") rather than brittle network ACLs.

The application never handles keys, never manages certs, and never rotates anything. mTLS is a property of the mesh, applied uniformly.

---

## 6. Traffic management: shifting, retries, timeouts, circuit breaking

All of these are proxy behaviors configured through the control plane. The app is not involved.

**Traffic shifting / canary.** Route rules split traffic by weight across subsets of a service. A canary release sends, say, 95% to `reviews:v1` and 5% to `reviews:v2`. You adjust the weights (or gate on headers, e.g. only internal users hit `v2`) and the change takes effect via RDS/CDS push — no deploy. This is how meshes decouple *release* (getting code onto machines) from *rollout* (directing traffic to it).

**Retries.** The sidecar retries failed requests on retriable conditions (connection failures, `5xx`, specific gRPC statuses) up to a configured limit, ideally with a per-try timeout and a bounded overall budget. Because the caller's sidecar owns this, retry policy is consistent across every client language.

**Timeouts.** A request timeout caps how long the caller's proxy waits for the upstream before failing fast. This prevents a slow dependency from holding connections open and exhausting the caller.

**Circuit breaking.** Configured as connection-pool and outlier-detection limits on a cluster: cap concurrent connections/requests to an upstream, and **eject** an endpoint that returns errors past a threshold, temporarily removing it from load balancing. This stops a failing instance from absorbing traffic and prevents cascading overload.

A caution that senior tiers develop: retries and timeouts interact. Naive retries at every hop multiply load during an incident. The mesh gives you the *knobs*; using them safely (budgets, jitter, per-try caps) is a discipline, not a default.

---

## 7. Telemetry for free

Because every request passes through proxies on both ends, the mesh is the ideal place to observe traffic *uniformly*, without instrumenting each service:

- **Metrics:** each proxy emits request count, error rate, and latency percentiles per source/destination pair — the "golden signals" for every edge in the call graph, in a consistent schema across all languages.
- **Distributed tracing:** proxies can start and propagate trace context (spans), giving you a request's path across services. One caveat that matters: the *app* must forward the incoming trace headers on its outbound calls, or the trace breaks at each hop — the proxy cannot correlate ingoing and outgoing requests for you.
- **Access logs:** per-request logs from the proxy, including which route matched, whether a retry fired, and the response flags (e.g. why a connection was ejected).

The result is a live topology of who-calls-whom with health data on every link — obtained by adding a proxy, not by editing services.

---

## 8. Where this goes next

You now have the mechanics: two planes, a transparently injected sidecar, the request path with its mTLS tunnel and proxy-owned retry, and xDS as the config pipeline. The senior tier weighs the **costs** this machinery imposes — the added latency and resource overhead of two proxy hops per request, the operational burden of running and upgrading the control plane, the debugging complexity of a transparent proxy in the path — and covers the alternatives (proxyless/gRPC, ambient/per-node data planes) and when a mesh is *not* worth it.

Canonical references: [istio.io](https://istio.io), [linkerd.io](https://linkerd.io), [envoyproxy.io](https://www.envoyproxy.io).

*Next step:* [Service Mesh — Senior](senior.md)
