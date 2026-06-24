# DevOps — Docker / Kubernetes / CI-CD

> Senior Go backend interview Q&A covering Docker internals, production Dockerfiles for Go, Kubernetes objects and operations, probes and graceful shutdown, resource/QoS tuning, scheduling, deployment strategies, service discovery, config/secrets, CI/CD pipelines, and reverse-proxy tuning.

**32 questions** across **12 topics** · Level: senior

## Topics

- [Docker fundamentals](#docker-fundamentals) (4)
- [Dockerfile for Go](#dockerfile-for-go) (3)
- [Docker networking, volumes & compose](#docker-networking-volumes-compose) (3)
- [Kubernetes objects](#kubernetes-objects) (3)
- [Probes & graceful shutdown](#probes-graceful-shutdown) (2)
- [Resources, QoS & autoscaling](#resources-qos-autoscaling) (3)
- [Scheduling & disruption](#scheduling-disruption) (2)
- [Deployment strategies](#deployment-strategies) (2)
- [Service discovery & mesh](#service-discovery-mesh) (2)
- [Config, secrets & packaging](#config-secrets-packaging) (2)
- [CI/CD & GitOps](#cicd-gitops) (4)
- [Reverse proxy & ingress tuning](#reverse-proxy-ingress-tuning) (2)

---

## Docker fundamentals

#### 1. What is the difference between a Docker image and a container, and how do layers relate to the two?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `docker`, `images`, `layers`, `fundamentals`

An **image** is an immutable, read-only template: an ordered stack of filesystem layers plus metadata (env, entrypoint, exposed ports). A **container** is a running (or stopped) instance of an image — the same read-only layers plus a thin writable copy-on-write layer on top, a process tree, and its own namespaces/cgroups.

Layers come from image-building instructions (each `RUN`/`COPY`/`ADD` produces one). They are content-addressed and shared: ten containers from one image share the same read-only layers on disk, and only their writable layers differ. When a container writes to a file from a lower layer, the union filesystem copies it up into the writable layer (copy-on-write).

**Trade-off/failure mode:** writes to the container layer are ephemeral and disappear when the container is removed; persistent data must go on a volume. Treating the writable layer as durable storage is a classic mistake.

**Key points**
- Image = immutable layer stack + metadata; container = image + writable CoW layer + runtime namespaces
- Layers are content-addressed and shared across containers/images
- Writes copy-up into the container's writable layer (copy-on-write)
- Container-layer data is ephemeral; durable data needs volumes

**Follow-ups**
- How does content-addressable storage enable layer dedup across images?
- What happens to the writable layer on `docker commit`?

---

#### 2. How does the Docker build cache work, and how do you order Dockerfile instructions to maximize cache hits?

*Difficulty:* 🟡 medium  ·  *Tags:* `docker`, `build-cache`, `dockerfile`, `ci`

Each instruction produces a layer keyed by a cache identifier derived from the instruction text and the parent layer's ID; for `COPY`/`ADD` it also includes a checksum of the copied files. On rebuild, Docker walks instructions top-down and reuses cached layers until the first cache miss — after which **every** subsequent layer is rebuilt, because each layer depends on its parent.

The practical rule: order from least-frequently-changing to most-frequently-changing. For Go, copy `go.mod`/`go.sum` and run `go mod download` **before** copying source, so dependency resolution stays cached across source edits.

**Failure modes:** `COPY . .` early in the file busts the cache on any file change. Cache-invalidating instructions like `apt-get update` paired separately from `install` can serve stale package indexes. In CI, the daemon often starts cold, so you need registry cache (`--cache-from`) or BuildKit cache mounts/exports to get hits at all.

**Key points**
- Cache key = instruction + parent layer + file checksum for COPY/ADD
- First cache miss invalidates all downstream layers
- Order least-volatile → most-volatile; deps before source
- CI needs --cache-from / BuildKit cache export for a cold daemon


```
# Dependency layer cached across source changes
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /app ./cmd/server
```

**Follow-ups**
- What does BuildKit's `--mount=type=cache` give you over a plain layer cache?
- Why combine `apt-get update && apt-get install` in one RUN?

---

#### 3. Explain how container isolation actually works — namespaces, cgroups, and the union filesystem — and how a container differs from a VM.

*Difficulty:* 🟠 hard  ·  *Tags:* `docker`, `namespaces`, `cgroups`, `isolation`, `linux`

A container is just a Linux process with restricted visibility and resources. **Namespaces** virtualize what a process can *see*: PID (own process tree), mount (own filesystem view), network (own interfaces/routes), UTS (hostname), IPC, user (UID/GID remapping). **Cgroups** virtualize what a process can *use*: CPU shares/quota, memory limits, block-IO, PIDs count. The **union filesystem** (overlay2) presents the stacked read-only image layers plus a writable layer as one merged tree via copy-on-write. Layered on top are capabilities, seccomp, and AppArmor/SELinux to restrict syscalls.

A **VM** virtualizes hardware and runs a full guest kernel under a hypervisor; a **container** shares the host kernel. So containers start in milliseconds and have near-native overhead, but weaker isolation — a kernel exploit crosses the boundary. VMs give stronger isolation at the cost of memory/boot overhead.

**Failure mode:** because the kernel is shared, a container that exhausts kernel resources (PIDs, inotify watches, conntrack entries) can degrade neighbors even with CPU/memory limits set.

**Key points**
- Namespaces = what you can see; cgroups = what you can use; overlay FS = layered CoW root
- Seccomp/capabilities/AppArmor further restrict syscalls
- Container shares host kernel; VM runs its own kernel under a hypervisor
- Shared kernel = fast + cheap but weaker isolation; kernel-resource exhaustion hits neighbors

**Follow-ups**
- Which namespace makes PID 1 inside the container special, and why does signal handling differ?
- When would you reach for gVisor or Kata Containers?

---

#### 4. What is the difference between COPY and ADD, and CMD versus ENTRYPOINT?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `dockerfile`, `copy-add`, `cmd-entrypoint`

**COPY** copies local files/dirs into the image — predictable and preferred. **ADD** does the same but additionally auto-extracts local tar archives and can fetch remote URLs. Those extras are surprising and a supply-chain risk, so the guidance is: use `COPY` always, and `ADD` only when you specifically want tar auto-extraction.

**ENTRYPOINT** defines the executable that always runs; **CMD** supplies default arguments (or a default command if no ENTRYPOINT). At `docker run`, trailing args replace `CMD` but are appended to `ENTRYPOINT`. Use the **exec form** (`["/app"]`, JSON array) not the shell form, because shell form wraps your process in `/bin/sh -c`, which means PID 1 is the shell — it won't forward `SIGTERM` to your Go binary, breaking graceful shutdown.

**Common pattern:** `ENTRYPOINT ["/app"]` + `CMD ["--config=/etc/app.yaml"]` lets operators override flags while keeping the binary fixed.

**Key points**
- COPY is predictable; ADD also untars and fetches URLs (avoid unless you need it)
- ENTRYPOINT = the executable; CMD = default args / fallback command
- run args replace CMD but append to ENTRYPOINT
- Always use exec form so your binary is PID 1 and receives signals

**Follow-ups**
- Why does shell-form ENTRYPOINT break SIGTERM delivery to a Go server?
- How do you make a container both override-friendly and signal-correct?

---

## Dockerfile for Go

#### 5. Write a production-grade multi-stage Dockerfile for a Go service and justify each choice.

*Difficulty:* 🟠 hard  ·  *Tags:* `dockerfile`, `go`, `multi-stage`, `distroless`, `static-binary`

A multi-stage build compiles in a full toolchain stage and copies only the binary into a tiny runtime stage, so the build tools never ship.

Key choices: **`CGO_ENABLED=0`** produces a statically linked binary with no libc dependency, which is what lets you run on `scratch` or distroless. **distroless/static** (or `scratch`) minimizes the attack surface — no shell, no package manager, fewer CVEs. A **non-root user** limits blast radius if the process is compromised. Build flags `-ldflags="-s -w"` strip debug info to shrink the image; `-trimpath` removes local paths for reproducibility. Copy CA certs and `/etc/passwd` (or use distroless which bundles them) so TLS and the non-root UID work.

**Failure modes:** forgetting CA certs → `x509: certificate signed by unknown authority` on outbound HTTPS; building with CGO on but running on scratch → missing-libc crash; running as root → flagged by security scanners and PSA `restricted`.

**Key points**
- Multi-stage: build in toolchain image, ship only the binary
- CGO_ENABLED=0 → static binary → can use scratch/distroless
- distroless/scratch + non-root → minimal attack surface
- Ship CA certs or HTTPS calls fail with x509 errors


```
# ---- build ----
FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w" -o /out/app ./cmd/server

# ---- runtime ----
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
```

**Follow-ups**
- When would you pick distroless over scratch?
- How do you debug a distroless container with no shell?

---

#### 6. Why CGO_ENABLED=0 for container builds, and what breaks if you leave CGO on but deploy to scratch?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `cgo`, `static-binary`, `scratch`, `dns`

By default Go can link against system C libraries (CGO), most commonly through the standard library's `net` and `os/user` packages, which on glibc use the C resolver. With CGO enabled the resulting binary is **dynamically linked** against the build image's libc. If you copy that binary into `scratch` or an Alpine (musl) image, the loader can't find the matching libc and the container crashes immediately with `no such file or directory` (misleading — it's the missing dynamic linker, not the binary).

Setting `CGO_ENABLED=0` forces Go to use its **pure-Go implementations** (including the pure-Go DNS resolver) and produce a fully static binary with no external dependencies, runnable on `scratch`.

**Trade-offs/gotchas:** the pure-Go resolver reads `/etc/resolv.conf` and `/etc/nsswitch.conf` differently from glibc, so DNS edge cases can change. If you genuinely need cgo (e.g., SQLite, certain crypto), you must build against and ship a compatible libc (use a glibc or musl base, not scratch).

**Key points**
- CGO on → dynamically linked against build-image libc
- Copying a dynamic binary into scratch/musl → 'no such file or directory' crash
- CGO_ENABLED=0 → pure-Go static binary, scratch-ready
- Pure-Go DNS resolver behaves slightly differently from glibc

**Follow-ups**
- How do you build a cgo-dependent service (e.g. mattn/go-sqlite3) for a small image?
- What is the `netgo`/`osusergo` build tag set used for?

---

#### 7. What goes in a .dockerignore and why does it matter beyond image size?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `dockerfile`, `dockerignore`, `security`, `build-context`

`.dockerignore` excludes paths from the build context that the daemon (or BuildKit) receives. It matters for three reasons:

1. **Speed** — without it, the entire repo (including `.git`, `node_modules`, build artifacts, large test fixtures) is tarred and sent to the daemon on every build, which is slow and can be hundreds of MB.
2. **Cache correctness** — if you `COPY . .`, files you didn't mean to include (a local `.env`, editor temp files) become part of the layer checksum, so unrelated changes bust the cache.
3. **Security** — it prevents secrets (`.env`, `*.pem`, `.aws/`, `.git` with credentials in history) from being copied into the image, where anyone who pulls it can extract them.

**Failure mode:** people add a secret to `.dockerignore` but still `COPY .env` explicitly elsewhere — ignore rules don't protect against explicit copies. Always also scan published images.

**Key points**
- Shrinks the build context sent to the daemon (speed)
- Keeps stray files out of COPY layer checksums (cache stability)
- Prevents leaking secrets and .git into the image
- Doesn't protect against an explicit COPY of an ignored file


```
.git
*.md
Dockerfile*
.env
*.pem
bin/
tmp/
testdata/
```

**Follow-ups**
- How would you detect a secret that already shipped in a published image?
- Does .dockerignore affect BuildKit secret mounts?

---

## Docker networking, volumes & compose

#### 8. Explain Docker's default networking modes and how containers reach each other.

*Difficulty:* 🟡 medium  ·  *Tags:* `docker`, `networking`, `bridge`, `dns`

Docker provides several drivers. **bridge** (default) puts each container on a virtual L2 network (`docker0` or a user-defined bridge) with a private IP; outbound traffic is NAT'd, and inbound needs explicit `-p host:container` port publishing, which sets up iptables DNAT rules. **host** removes network isolation — the container shares the host's network namespace, so no port mapping and no NAT (lowest latency, but port conflicts and weaker isolation). **none** gives no network. **overlay** spans multiple hosts for Swarm.

Key detail: on the **default** bridge, containers can only reach each other by IP. On a **user-defined** bridge, Docker runs an embedded DNS server so containers resolve each other by **container name** — which is why compose/user-defined networks are preferred.

**Failure modes:** publishing `0.0.0.0:5432` exposes a DB to the whole network unintentionally; relying on default-bridge name resolution silently fails (no DNS there).

**Key points**
- bridge (default) = NAT + explicit port publishing via iptables DNAT
- host = shares host netns, no mapping, lowest latency, weaker isolation
- User-defined bridge adds embedded DNS → resolve by container name
- Default bridge has no name DNS; binding 0.0.0.0 can over-expose services

**Follow-ups**
- Why does publishing a port to 0.0.0.0 bypass the host firewall in some setups?
- How does overlay networking encapsulate cross-host traffic?

---

#### 9. Compare bind mounts, named volumes, and tmpfs, and when you'd use each.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `docker`, `volumes`, `bind-mount`, `tmpfs`, `storage`

**Bind mounts** map a host path directly into the container. Great for local dev (live-reload your source) but tightly couple the container to host layout, can have permission/UID mismatches, and aren't portable. **Named volumes** are managed by Docker in its storage area, decoupled from host paths; preferred for persistent app data (databases) because they're portable, can use volume drivers (e.g., cloud block storage), and survive container removal. **tmpfs** mounts live in RAM only — fast, never hits disk — for sensitive scratch data (secrets, temp files) you don't want persisted.

**Trade-offs/failure modes:** the writable container layer is *not* a volume — data there dies with the container. With bind mounts, a process running as a different UID than the host owner gets permission-denied errors. Volumes default to the data already in the image path on first mount, which can mask files unexpectedly.

**Key points**
- Bind mount = host path; ideal for dev, host-coupled, UID pitfalls
- Named volume = Docker-managed, portable, for persistent data
- tmpfs = RAM-only, for secrets/scratch never persisted
- Container writable layer ≠ durable storage

**Follow-ups**
- How do you fix a UID mismatch on a bind-mounted volume?
- What does mounting an empty named volume over a populated image dir do?

---

#### 10. How do you structure a docker-compose setup for local Go development, and what are its limits?

*Difficulty:* 🟡 medium  ·  *Tags:* `docker-compose`, `local-dev`, `healthcheck`, `go`

Compose declares the app plus its dependencies (Postgres, Redis, a message broker) as services on a shared user-defined network, so services reach each other by name. For Go dev you typically: bind-mount the source for live rebuild, expose the app port, use `depends_on` with **healthchecks** (not just start order) so the app waits until the DB is actually accepting connections, and load config via env files. Use named volumes for DB data so state survives `docker compose down`.

**Limits/failure modes:** `depends_on` without `condition: service_healthy` only orders startup, not readiness — your Go service races the DB and crashes on first connect, so you still need app-side retry. Compose is single-host and not a production scheduler (no rolling updates, autoscaling, or self-healing across nodes) — it's a dev/CI convenience, and prod work should target Kubernetes.

**Key points**
- Services on a shared network resolve each other by name
- Use healthchecks + depends_on condition: service_healthy, not bare ordering
- Named volumes persist DB state across `down`
- Single-host only; not a production orchestrator — keep app-side retry


```
services:
  api:
    build: .
    ports: ["8080:8080"]
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
      retries: 5
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes: { pgdata: {} }
```

**Follow-ups**
- Why is app-side connection retry still required despite healthchecks?
- How would you migrate this compose file toward a Kubernetes manifest?

---

## Kubernetes objects

#### 11. Walk through the core workload objects — Pod, ReplicaSet, Deployment, StatefulSet, DaemonSet — and when to use each.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `deployment`, `statefulset`, `daemonset`, `workloads`

A **Pod** is the smallest deployable unit: one or more co-located containers sharing network and volumes; you rarely create them directly because they aren't self-healing. A **ReplicaSet** keeps N identical Pod replicas running. A **Deployment** manages ReplicaSets to give you declarative rolling updates and rollbacks — the default for stateless services.

A **StatefulSet** gives stable network identity (`pod-0`, `pod-1`), stable per-pod persistent volumes, and ordered/graceful rollout — for databases, brokers, anything where identity and storage matter. A **DaemonSet** runs exactly one Pod per node (or per matching node) — for log shippers, node exporters, CNI agents.

**Failure modes:** running a stateless web app as a StatefulSet costs you fast parallel rollouts for no benefit; running a clustered datastore as a Deployment loses stable identity and storage, corrupting cluster membership. DaemonSets ignore HPA — they scale with node count.

**Key points**
- Pod = smallest unit, not self-healing alone
- Deployment (via ReplicaSet) = stateless rolling updates/rollbacks
- StatefulSet = stable identity + per-pod PVC + ordered rollout for stateful systems
- DaemonSet = one pod per node for node-level agents

**Follow-ups**
- Why does a StatefulSet need a headless Service?
- How does ordered termination help a database StatefulSet?

---

#### 12. Explain Service types (ClusterIP, NodePort, LoadBalancer), headless Services, and Ingress.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `service`, `ingress`, `networking`

A **Service** is a stable virtual IP and DNS name fronting a set of Pods selected by labels, with kube-proxy load-balancing across them. **ClusterIP** (default) is reachable only inside the cluster. **NodePort** opens a fixed port on every node that forwards to the Service — crude, mostly for bootstrapping. **LoadBalancer** provisions a cloud L4 load balancer pointing at the NodePorts — one external LB per service, which gets expensive.

A **headless Service** (`clusterIP: None`) returns the Pod IPs directly via DNS instead of a single VIP — used by StatefulSets and clients that do their own balancing or need per-pod addressing.

**Ingress** is L7 HTTP routing (host/path-based) handled by an ingress controller (nginx, Traefik) behind one LB, so many services share one entry point with TLS termination.

**Failure mode:** one `LoadBalancer` per microservice is a cost/limit trap — front HTTP services with a single Ingress instead.

**Key points**
- ClusterIP internal; NodePort = per-node port; LoadBalancer = cloud L4 LB per service
- Headless (clusterIP: None) returns pod IPs for per-pod addressing
- Ingress = shared L7 routing + TLS behind one LB
- Avoid one LoadBalancer per service; consolidate with Ingress

**Follow-ups**
- How does kube-proxy implement ClusterIP under iptables vs IPVS?
- What does an Ingress give you that a LoadBalancer Service doesn't?

---

#### 13. Compare ConfigMap and Secret, and how Jobs and CronJobs fit in.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `kubernetes`, `configmap`, `secret`, `job`, `cronjob`

**ConfigMap** holds non-sensitive config (env vars, files) injected into Pods as environment variables or mounted files. **Secret** is the same shape but for sensitive data; the important caveat: by default Secrets are only **base64-encoded, not encrypted**, in etcd — you must enable etcd encryption-at-rest and tight RBAC, or use an external secrets manager. Prefer mounting Secrets as files over env vars, since env vars leak via `/proc`, crash dumps, and child processes.

**Job** runs a Pod to completion (a batch task, a migration) and tracks success/retries. **CronJob** schedules Jobs on a cron expression (nightly reports, cleanup).

**Failure modes:** updating a ConfigMap doesn't restart Pods — env-var consumers won't see changes until a rollout (mounted files update eventually but the app must re-read them). CronJobs with `concurrencyPolicy: Allow` can stack overlapping runs if a job overruns its interval; set `Forbid` or `Replace` and a `startingDeadlineSeconds`.

**Key points**
- ConfigMap = non-secret config; Secret = base64 (NOT encrypted) by default
- Enable etcd encryption + RBAC; mount secrets as files, not env vars
- Job runs to completion with retries; CronJob schedules Jobs
- ConfigMap changes need a rollout for env consumers; control CronJob concurrency

**Follow-ups**
- How do you trigger a rollout automatically when a ConfigMap changes?
- What does concurrencyPolicy: Forbid prevent in a CronJob?

---

## Probes & graceful shutdown

#### 14. Distinguish liveness, readiness, and startup probes, and what breaks if you confuse them.

*Difficulty:* 🟠 hard  ·  *Tags:* `kubernetes`, `probes`, `liveness`, `readiness`, `startup`

**Readiness** controls traffic: when it fails, the Pod is removed from Service endpoints but **not** restarted — use it to gate on dependencies (DB reachable, caches warm) and to drain during shutdown. **Liveness** controls restarts: when it fails past the threshold, the kubelet **kills and restarts** the container — use it only for unrecoverable states (deadlock, wedged event loop). **Startup** protects slow-booting apps: until it passes, liveness/readiness are suspended, so a long init doesn't trip liveness and cause a restart loop.

**Classic failure modes:** (1) Using liveness to check a downstream dependency — when the DB blips, every pod fails liveness simultaneously and Kubernetes restarts the *entire* fleet, turning a transient outage into a cascading crash loop. Dependencies belong in readiness. (2) Too-aggressive liveness timeouts under load → false restarts that worsen the load. (3) No startup probe on a slow JVM/Go-with-migrations app → restart loops before it ever serves. Liveness should test only the process's own health, cheaply and locally.

**Key points**
- Readiness gates traffic (no restart); liveness restarts the container
- Startup suspends liveness/readiness during slow boot to avoid restart loops
- Putting a dependency check in liveness → fleet-wide restart storm on a DB blip
- Liveness must be local, cheap, and about the process itself


```
readinessProbe:
  httpGet: { path: /readyz, port: 8080 }
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  failureThreshold: 30
  periodSeconds: 2
```

**Follow-ups**
- What should /healthz check vs /readyz in a Go service?
- How do probes interact during a rolling update to keep zero downtime?

---

#### 15. Implement correct graceful shutdown for a Go HTTP server in Kubernetes — cover SIGTERM, preStop, and terminationGracePeriodSeconds.

*Difficulty:* 🔴 staff  ·  *Tags:* `kubernetes`, `graceful-shutdown`, `sigterm`, `prestop`, `go`

On pod deletion, Kubernetes does two things **concurrently**: removes the pod from Service endpoints and sends `SIGTERM` to PID 1. The race: endpoint removal propagates asynchronously through kube-proxy/iptables across nodes, so for a short window traffic still arrives *after* SIGTERM. If you shut down instantly you drop in-flight and newly-routed requests.

The correct sequence: (1) a **preStop** hook that sleeps a few seconds (or flips readiness to fail) to let endpoint removal propagate before the process starts shutting down; (2) on SIGTERM, the Go server calls `server.Shutdown(ctx)` to stop accepting new connections and drain in-flight ones; (3) `terminationGracePeriodSeconds` must exceed preStop sleep + max request duration, or the kubelet sends `SIGKILL` and truncates draining.

**Failure modes:** shell-form ENTRYPOINT → SIGTERM goes to `sh`, not your binary, so no graceful shutdown at all. Grace period shorter than long-running requests → SIGKILL mid-request. Forgetting preStop → 502s during every rollout despite a correct Shutdown call.

**Key points**
- Endpoint removal and SIGTERM happen concurrently; traffic lags removal
- preStop sleep (or fail readiness) lets iptables propagate before draining
- On SIGTERM call server.Shutdown(ctx) to drain in-flight connections
- terminationGracePeriodSeconds > preStop + longest request, else SIGKILL truncates


```go
// Go: drain on SIGTERM
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()
go srv.ListenAndServe()
<-ctx.Done()
shutCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
_ = srv.Shutdown(shutCtx)
---
# Pod spec
terminationGracePeriodSeconds: 30
lifecycle:
  preStop:
    exec: { command: ["sleep", "5"] }
```

**Follow-ups**
- Why is the preStop sleep needed even with a correct Shutdown call?
- How do you drain long-lived gRPC/WebSocket connections gracefully?

---

## Resources, QoS & autoscaling

#### 16. Explain requests vs limits for CPU and memory, and the resulting QoS classes.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `resources`, `qos`, `oomkill`, `throttling`

**Requests** are what the scheduler reserves to place a Pod and what it guarantees; **limits** are the hard ceiling the kernel enforces at runtime. They behave very differently per resource. **CPU** is compressible: exceeding the limit causes **throttling** (the process is slowed via CFS quota), not death. **Memory** is incompressible: exceeding the limit gets the container **OOMKilled** by the kernel.

The request/limit relationship sets the **QoS class**: **Guaranteed** (requests == limits for every resource) — last to be evicted; **Burstable** (requests set, limits higher or partial) — can use spare capacity but evicted before Guaranteed; **BestEffort** (nothing set) — first evicted under node pressure.

**Failure modes:** requests too low → overcommit and node-pressure evictions; memory limit too tight → OOMKill loops on traffic spikes; CPU limit too tight → latency from throttling that looks like a code bug. Set memory request == limit for predictability; be careful with CPU limits (see throttling/GOMAXPROCS).

**Key points**
- Requests = scheduled/guaranteed; limits = enforced ceiling
- CPU over-limit = throttling (compressible); memory over-limit = OOMKill (incompressible)
- QoS: Guaranteed (req==lim) > Burstable > BestEffort for eviction priority
- Low requests → overcommit evictions; tight mem limit → OOM loops

**Follow-ups**
- Why set memory request == limit but be cautious with CPU limits?
- How does the kubelet decide eviction order under memory pressure?

---

#### 17. Explain the GOMAXPROCS-vs-CPU-limit gotcha. Why do Go services throttle badly under Kubernetes CPU limits, and how do you fix it?

*Difficulty:* 🔴 staff  ·  *Tags:* `go`, `gomaxprocs`, `cpu-limit`, `cfs-throttling`, `kubernetes`, `gotcha`

By default Go sets `GOMAXPROCS` to the number of OS-visible CPUs — i.e., the **node's** core count (say 64), because the Go runtime reads `runtime.NumCPU()`, not the cgroup CPU limit. Kubernetes CPU limits are enforced via the **CFS quota**: a limit of `1` means the cgroup gets 100ms of CPU per 100ms period across all threads.

The collision: Go schedules work across 64 Ps and spins up GC and goroutines as if it has 64 cores, but the quota only allows the equivalent of 1 core of runtime per period. The runtime burns its entire quota in a fraction of the period (often in a burst of parallel GC), then the kernel **throttles every thread for the rest of the period** — producing severe tail-latency spikes and stop-the-world stalls that look like a code bug but are pure scheduler/quota mismatch.

**Fix:** set `GOMAXPROCS` to match the CPU limit. Use `go.uber.org/automaxprocs` (reads the cgroup quota and sets it automatically), or set `GOMAXPROCS` from the limit explicitly, or — on Go 1.25+ — rely on the runtime's new cgroup-aware default. Also prefer fractional-but-integer limits and consider removing CPU limits (keeping requests) for latency-sensitive services so they can burst.

**Key points**
- Default GOMAXPROCS = node cores, ignoring the cgroup CFS quota
- Runtime spawns node-wide parallelism, burns the quota in a burst, then CFS throttles all threads
- Result: GC pauses + tail-latency spikes that mimic a code bug
- Fix: uber-go/automaxprocs, set GOMAXPROCS from the limit, or Go 1.25+ cgroup-aware runtime; consider dropping CPU limits


```
import _ "go.uber.org/automaxprocs" // sets GOMAXPROCS from the cgroup CPU quota at init
// or explicitly:
// runtime.GOMAXPROCS(int(math.Ceil(cpuLimitMillicores / 1000)))
```

**Follow-ups**
- How would you confirm CFS throttling is happening (which metric)?
- What are the trade-offs of removing CPU limits entirely?

---

#### 18. Compare HPA and VPA, and what signals you should and shouldn't scale on.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `hpa`, `vpa`, `autoscaling`, `keda`

**HPA (Horizontal Pod Autoscaler)** changes the *number* of replicas based on a metric (CPU/memory utilization or custom/external metrics like queue depth or RPS). **VPA (Vertical Pod Autoscaler)** changes a single pod's *requests/limits* to right-size it. They generally **conflict on the same resource metric** — running both on CPU fights itself, so use VPA for sizing and HPA for scaling on a different signal.

**Signal choice matters.** CPU utilization is a poor autoscaling signal for I/O-bound Go services (they wait on the network, not the CPU), so scaling lags. Better to scale on a **leading, work-proportional** custom metric — requests-in-flight, queue lag, p99 latency, or RPS — via the custom/external metrics API (e.g., KEDA for queue-driven scaling).

**Failure modes:** scaling on memory rarely works (Go memory is GC-lumpy and doesn't shrink fast → flapping); VPA restarts pods to apply new requests (disruptive unless in-place resize is enabled); HPA without proper readiness causes thrash because new pods receive traffic before warm.

**Key points**
- HPA scales replica count; VPA right-sizes requests/limits
- Don't run both on the same metric — they fight
- CPU is a weak signal for I/O-bound Go; scale on queue depth / RPS / p99 (KEDA)
- Memory scaling flaps with GC; VPA restarts pods to apply changes

**Follow-ups**
- How does KEDA scale a worker pool from queue lag, including to zero?
- What stabilization window settings prevent HPA flapping?

---

## Scheduling & disruption

#### 19. Explain node selectors, affinity/anti-affinity, and taints/tolerations — and how they combine.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `scheduling`, `affinity`, `taints`, `tolerations`

These are two complementary mechanisms. **nodeSelector** and **node affinity** are pod-side *attraction* rules: 'schedule me on nodes with these labels' (e.g., `gpu=true`), with affinity adding soft `preferred` vs hard `required` and richer operators. **Pod affinity/anti-affinity** schedule pods relative to *other pods*: anti-affinity spreads replicas across nodes/zones for HA; affinity co-locates pods that talk a lot.

**Taints/tolerations** are the inverse — node-side *repulsion*: a taint on a node repels all pods unless a pod carries a matching toleration. This reserves nodes (GPU pools, dedicated tenants) so only opted-in pods land there. Affinity *attracts*, taints *repel*, and they're often used together: taint the GPU nodes (keep general pods off) **and** add affinity (steer GPU pods on).

**Failure modes:** required anti-affinity with too few nodes leaves pods `Pending` forever; control-plane taints (`NoSchedule`) silently keep your workload off masters; tolerations don't *attract* — a toleration alone won't pull a pod onto a tainted node without affinity.

**Key points**
- nodeSelector/affinity = pod attraction to node labels (soft/hard)
- Pod anti-affinity spreads replicas for HA; pod affinity co-locates
- Taints repel pods; tolerations let specific pods land — node-side gate
- Combine taint (keep others off) + affinity (steer right pods on); toleration ≠ attraction

**Follow-ups**
- What does topologySpreadConstraints add over anti-affinity?
- Why might required anti-affinity leave pods Pending?

---

#### 20. What is a PodDisruptionBudget, and how does it interact with voluntary vs involuntary disruptions?

*Difficulty:* 🟠 hard  ·  *Tags:* `kubernetes`, `pdb`, `disruption`, `ha`, `drain`

A **PodDisruptionBudget (PDB)** sets a floor (`minAvailable`) or ceiling (`maxUnavailable`) on how many pods of a workload may be down due to **voluntary** disruptions — node drains, cluster upgrades, autoscaler scale-down. The eviction API respects the PDB: a drain *blocks* until evicting the next pod wouldn't violate the budget, so a rolling node upgrade can't take your quorum below the safe line.

Crucially, a PDB only governs **voluntary** disruptions. **Involuntary** events — hardware failure, kernel panic, OOMKill, preemption — ignore PDBs entirely; you can still lose more than the budget allows.

**Failure modes:** `minAvailable: 100%` (or equal to replica count) makes nodes **undrainable** — cluster upgrades hang forever waiting on an eviction that can never satisfy the budget. A PDB on a single-replica deployment blocks all drains. For quorum systems (etcd, Zookeeper) size the PDB so a drain never drops below quorum, but pair it with anti-affinity so involuntary node loss doesn't take multiple members at once.

**Key points**
- PDB bounds pods down during voluntary disruptions (drains/upgrades) via the eviction API
- Drains block until honoring the budget is possible
- Involuntary disruptions (hardware/OOM/preemption) ignore PDBs
- minAvailable == replicas makes nodes undrainable; pair PDB with anti-affinity for real HA

**Follow-ups**
- Why can a too-strict PDB stall a cluster upgrade indefinitely?
- How do PDB and anti-affinity together protect a 3-node quorum?

---

## Deployment strategies

#### 21. Compare rolling update, recreate, blue-green, and canary deployments with their trade-offs.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `deployment-strategies`, `canary`, `blue-green`, `rolling-update`

**Rolling update** (K8s default) replaces pods incrementally, governed by `maxSurge`/`maxUnavailable`, giving zero downtime but running **two versions simultaneously** — so the new version must be backward-compatible with the old (and with the DB schema). **Recreate** kills all old pods, then starts new — simple, no version overlap, but incurs downtime; used when versions can't coexist.

**Blue-green** stands up the full new version (green) alongside old (blue), then flips traffic at the LB/Service atomically — instant cutover and instant rollback, but doubles resource cost and still risks a 'big bang' if the new version is broken. **Canary** routes a small slice of traffic (1–5%) to the new version, watches metrics/SLOs, then progressively shifts — best blast-radius control, but needs traffic-splitting (Ingress/mesh) and good observability to be safe.

**Failure modes:** any non-recreate strategy requires backward-compatible schema and API changes; a non-additive migration during a rolling update breaks the old pods still serving traffic.

**Key points**
- Rolling = zero-downtime but two versions coexist → needs backward compatibility
- Recreate = downtime, no overlap, for incompatible versions
- Blue-green = instant flip + rollback, double resources
- Canary = smallest blast radius via traffic split, needs mesh/Ingress + metrics

**Follow-ups**
- How do maxSurge and maxUnavailable affect rollout speed and capacity?
- What makes a canary 'analysis' automated (e.g. Argo Rollouts/Flagger)?

---

#### 22. How do rollbacks work in Kubernetes, and what makes a rollback unsafe?

*Difficulty:* 🟠 hard  ·  *Tags:* `kubernetes`, `rollback`, `migrations`, `expand-contract`, `deployment`

A Deployment keeps a bounded history of ReplicaSets (`revisionHistoryLimit`); `kubectl rollout undo` scales the previous ReplicaSet back up and the bad one down — a fast, declarative revert of the **pod spec**. GitOps tools do the same by reverting the manifest commit so the cluster reconciles back.

The catch: a rollback only reverts the **application/pod spec**, not **side effects**. If the new version ran a **non-reversible database migration** (dropped a column, changed a type), rolling the code back leaves it talking to a schema it no longer matches → crashes or data corruption. Likewise, rolled-back code may have already written **new-format data** the old code can't read.

**Safe practice:** decouple schema from code via **expand-contract (parallel-change)** migrations — add the new column, deploy code that writes both, backfill, then drop the old column only after the new version is fully stable. That keeps every version backward- and forward-compatible, so a code rollback is always safe. Also ensure feature flags, not deploys, gate risky behavior.

**Key points**
- Rollback scales the previous ReplicaSet back up (or reverts the GitOps commit)
- It reverts pod spec only — not DB migrations or already-written data
- Non-additive migrations make code rollback unsafe → corruption/crashes
- Use expand-contract migrations + feature flags so rollback is always safe

**Follow-ups**
- Walk through an expand-contract migration for renaming a column.
- Why prefer feature flags over deploys for risky behavior changes?

---

## Service discovery & mesh

#### 23. How do kube-proxy, cluster DNS, and headless Services implement service discovery?

*Difficulty:* 🟠 hard  ·  *Tags:* `kubernetes`, `service-discovery`, `kube-proxy`, `dns`, `go`

**Cluster DNS** (CoreDNS) gives every Service a name like `svc.namespace.svc.cluster.local` resolving to the Service's stable ClusterIP. **kube-proxy** programs each node so traffic to that ClusterIP is load-balanced to a healthy backing Pod — historically via **iptables** DNAT rules (O(n) rule chains, slow to update at scale) or **IPVS** (hash-table based, scales better) or, increasingly, eBPF dataplanes (Cilium) that bypass kube-proxy entirely. The ClusterIP is virtual — no process listens on it; the kernel rewrites the destination.

A **headless Service** (`clusterIP: None`) skips the VIP: DNS returns the **individual Pod A-records**, so the client load-balances itself or addresses a specific pod (essential for StatefulSets where `pod-0.svc` must be stable).

**Failure modes (Go-specific):** the pure-Go resolver caches per-lookup and Go's `http.Transport` keeps connections to specific pod IPs, so after a scale-up new pods may get **no traffic** until connections recycle — a notorious gRPC/HTTP client-side LB pitfall. ndots:5 in the default DNS config also causes extra failed lookups for external names.

**Key points**
- CoreDNS maps Service name → stable ClusterIP
- kube-proxy load-balances ClusterIP via iptables/IPVS/eBPF DNAT
- Headless Service returns pod A-records for client-side LB / StatefulSet identity
- Go: long-lived connections skip new pods after scale-up; ndots:5 adds lookup overhead

**Follow-ups**
- Why do persistent gRPC connections defeat ClusterIP load balancing, and how do you fix it?
- What does ndots:5 do to external DNS resolution in a pod?

---

#### 24. What problems do service meshes (Istio/Linkerd) solve, and what do they cost?

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `service-mesh`, `istio`, `linkerd`, `mtls`

A service mesh injects a **sidecar proxy** (Envoy for Istio, a Rust micro-proxy for Linkerd) next to each pod and routes all service-to-service traffic through it. That moves cross-cutting concerns out of application code: **mTLS** everywhere (zero-trust), **L7 traffic management** (canary weights, retries, timeouts, circuit breaking), and **golden-signal observability** (per-call latency/error metrics, distributed tracing) — uniformly across every language, so your Go service doesn't hand-roll retry/TLS/metrics logic.

**Costs/trade-offs:** every hop now traverses two extra proxies, adding **latency** and CPU/memory per pod; the control plane and Envoy config (CRDs) are operationally complex; and the sidecar lifecycle interacts badly with Jobs (sidecar never exits → Job hangs) and with pod startup ordering. Linkerd trades Istio's feature breadth for far lower overhead and simpler ops.

**Rule of thumb:** adopt a mesh when you have enough services that uniform mTLS/observability/traffic-shaping outweighs the latency and operational tax — not for a handful of services where a library suffices.

**Key points**
- Sidecar proxy moves mTLS, retries/timeouts/circuit-breaking, and observability out of app code
- Uniform across languages — no per-service retry/TLS/metrics code
- Costs: extra hop latency, per-pod resource overhead, control-plane complexity
- Sidecars complicate Jobs/startup; Linkerd is lighter than Istio

**Follow-ups**
- Why do sidecars break Kubernetes Jobs, and how do native sidecar containers help?
- When is a resilience library (e.g. in-process retry) better than a mesh?

---

## Config, secrets & packaging

#### 25. How do you manage secrets in Kubernetes securely beyond the built-in Secret object?

*Difficulty:* 🟠 hard  ·  *Tags:* `kubernetes`, `secrets`, `vault`, `sops`, `security`

Built-in Secrets are only **base64-encoded** in etcd, so the baseline hardening is: enable **etcd encryption-at-rest** (preferably with a KMS provider so the key isn't on disk), lock down **RBAC** (anyone with `get secrets` reads them), and never commit them to Git in plaintext.

Production patterns: (1) an **external secrets manager** (Vault, AWS Secrets Manager, GCP Secret Manager) as source of truth, synced in via the **External Secrets Operator** or mounted via the **Secrets Store CSI driver** — secrets never live permanently in etcd and can rotate. (2) For GitOps, **sealed-secrets** or **SOPS** lets you commit *encrypted* secrets safely; only the cluster can decrypt. (3) Prefer **short-lived dynamic credentials** (Vault dynamic DB creds, IRSA/workload-identity for cloud APIs) over long-lived static secrets, eliminating standing credentials entirely.

**Failure modes:** mounting secrets as env vars leaks them via `/proc`, logs, and child processes — mount as files. Rotating the external secret doesn't restart pods, so the app must re-read the file or you need a reloader.

**Key points**
- Enable etcd encryption (KMS) + tight RBAC; base64 is not security
- External Secrets Operator / CSI driver keep source of truth outside etcd with rotation
- GitOps: SOPS or sealed-secrets to commit encrypted secrets
- Prefer short-lived dynamic creds + workload identity; mount as files not env vars

**Follow-ups**
- How does workload identity (IRSA / GKE WI) remove static cloud credentials?
- How do you trigger a pod reload when an external secret rotates?

---

#### 26. Compare Helm and Kustomize for packaging Kubernetes manifests.

*Difficulty:* 🟡 medium  ·  *Tags:* `kubernetes`, `helm`, `kustomize`, `packaging`

**Helm** is a templating + package manager: charts are Go-templated YAML parameterized by `values.yaml`, with releases, versioning, dependencies, and `helm rollback`. It's ideal for **distributing** reusable apps (third-party software) and for heavy parameterization across many environments. Downsides: string templating YAML is error-prone (whitespace bugs, hard to read), and the templated output isn't valid YAML until rendered.

**Kustomize** (built into kubectl) is **template-free**: you keep plain, valid base manifests and apply declarative **overlays** (patches) per environment — no string interpolation, so manifests stay readable and lintable. It's great for **your own** apps with environment variations (dev/staging/prod) but lacks packaging, versioning, and lifecycle hooks.

**Common practice:** use Kustomize for in-house apps and environment overlays, Helm for vendored third-party charts — and they compose (`helm template | kustomize`, or Helm's post-renderer). **Failure mode:** over-templating a Helm chart into an unreadable mess of conditionals when a simple Kustomize overlay would do.

**Key points**
- Helm = Go-templated charts + packaging/versioning/rollback; good for distributing apps
- Kustomize = template-free base + overlays; manifests stay valid YAML
- Helm risks whitespace/template bugs; Kustomize lacks packaging/lifecycle
- Common: Kustomize for own apps, Helm for vendored charts; they compose

**Follow-ups**
- How does Helm's release history enable rollback vs Kustomize's none?
- When does heavy Helm templating become an anti-pattern?

---

## CI/CD & GitOps

#### 27. Design the CI pipeline stages for a Go service. What order, and why each stage?

*Difficulty:* 🟡 medium  ·  *Tags:* `ci-cd`, `go`, `race-detector`, `govulncheck`, `pipeline`

Order stages **fast-and-cheap first** so the pipeline fails early (shift-left). A typical Go pipeline: (1) **lint/vet** — `gofmt -l`/`golangci-lint`/`go vet` catch style and obvious bugs in seconds; (2) **build** — confirms it compiles for the target platform; (3) **test with the race detector** — `go test -race ./...`, the single most valuable gate for a concurrent Go service since it surfaces data races that won't show in normal runs; (4) **coverage check** against a threshold; (5) **security scans** — `govulncheck` (known CVEs in deps), SAST (`gosec`), and image/SBOM scanning (Trivy/Grype); (6) **build and push the image** with an immutable, content-addressed tag (commit SHA, not `latest`); (7) **deploy** (or hand off to GitOps).

**Why this order:** lint failing in 5s is cheaper than discovering it after a 5-minute test+scan. **Caching** the Go module and build cache between runs is the biggest speedup. **Failure modes:** running `-race` only nightly lets races merge; tagging images `latest` makes deploys non-reproducible and rollback ambiguous.

**Key points**
- Fast cheap checks first: lint/vet → build → test -race → coverage → scan → push → deploy
- go test -race is the highest-value gate for concurrent Go
- Add govulncheck/gosec/Trivy for deps, code, and image
- Tag images by commit SHA (immutable), never 'latest'; cache modules + build cache


```
- run: gofmt -l . | tee /dev/stderr | wc -l | grep -qx 0
- run: golangci-lint run ./...
- run: go test -race -covermode=atomic ./...
- run: govulncheck ./...
- run: docker build -t app:${GIT_SHA} . && docker push app:${GIT_SHA}
```

**Follow-ups**
- Why is `go test -race` so much more valuable than plain `go test` here?
- How do you cache the Go build cache across CI runs effectively?

---

#### 28. Compare trunk-based development with Gitflow, and how each shapes CI/CD.

*Difficulty:* 🟡 medium  ·  *Tags:* `ci-cd`, `trunk-based`, `gitflow`, `feature-flags`, `branching`

**Trunk-based development** keeps everyone on short-lived branches merged to `main` at least daily, with `main` always releasable. It demands strong CI (fast tests, required checks) and decouples *deploy* from *release* using **feature flags** so unfinished work can merge dark. It minimizes merge hell and integration drift and is the model for high-DORA, continuous-delivery teams.

**Gitflow** uses long-lived `develop`, `release`, and `feature` branches with scheduled releases. It suits products with explicit versioned releases (shipped software, multiple supported versions) but causes **painful long-lived-branch merges**, delayed integration, and friction with continuous deployment.

**Trade-off:** trunk-based optimizes for flow and frequent small deploys (smaller blast radius, easier rollback) at the cost of needing flags and discipline; Gitflow optimizes for staged, gated releases at the cost of integration pain and slower lead time. For a containerized Go service deploying continuously to Kubernetes, trunk-based + feature flags is the natural fit.

**Key points**
- Trunk-based: short-lived branches, main always releasable, flags decouple deploy from release
- Gitflow: long-lived develop/release branches for scheduled, versioned releases
- Gitflow → merge pain + delayed integration; trunk → needs strong CI + flags
- Continuous deploy to K8s favors trunk-based + feature flags

**Follow-ups**
- How do feature flags let you merge unfinished work to main safely?
- Why do long-lived branches degrade DORA lead time?

---

#### 29. What is GitOps, and how do ArgoCD/Flux change the deployment model versus push-based CI?

*Difficulty:* 🟠 hard  ·  *Tags:* `ci-cd`, `gitops`, `argocd`, `flux`, `reconciliation`

In **push-based** CI/CD the pipeline holds cluster credentials and runs `kubectl apply` to push changes in. **GitOps** inverts this: a Git repo is the **single declarative source of truth** for desired cluster state, and an in-cluster controller (**ArgoCD** or **Flux**) continuously **pulls** and **reconciles** the cluster toward that state. Deploy = merge a commit; the controller does the rest.

Benefits: (1) **drift detection/self-healing** — if someone `kubectl edit`s live state, the controller reverts it to match Git; (2) **auditability** — every change is a reviewed, signed Git commit, and rollback is `git revert`; (3) **security** — the cluster pulls, so no external system holds cluster-admin credentials and you don't punch CI through the firewall.

**Failure modes:** GitOps reconciles declarative state but doesn't run imperative steps (DB migrations need a Job/hook); a manual hotfix straight to the cluster gets **reverted** by the controller, surprising operators; and a bad commit auto-deploys cluster-wide unless you gate with progressive delivery (Argo Rollouts) and health checks.

**Key points**
- Git is the source of truth; controller pulls and reconciles (vs CI pushing kubectl)
- Drift detection + self-healing revert manual changes back to Git
- Auditable (every change a commit) and rollback = git revert
- Cluster pulls → no external creds; but migrations need hooks and manual edits get reverted

**Follow-ups**
- How do you run DB migrations in a GitOps flow?
- Why does a manual kubectl edit get reverted, and how do you do an emergency override?

---

#### 30. What does Terraform/IaC give you, and what are the main operational pitfalls (state, drift)?

*Difficulty:* 🟡 medium  ·  *Tags:* `iac`, `terraform`, `state`, `drift`, `infrastructure`

**Infrastructure as Code** declares infra (clusters, networks, DBs, IAM) in version-controlled config so environments are reproducible, reviewable, and diffable — no click-ops. **Terraform** computes a plan (the diff between desired config and recorded state) and applies it, managing dependency ordering and provider APIs.

The central concept and main pitfall is **state**: Terraform stores a mapping of config → real resources in a state file. It must live in **remote, locked** storage (S3+DynamoDB lock, Terraform Cloud) — local state means lost mappings and **concurrent applies corrupting state**. State holds secrets in plaintext, so it must be encrypted and access-controlled.

**Drift** is the other big issue: someone changes infra in the cloud console, so reality diverges from state; the next `plan` wants to 'fix' it, sometimes destructively. Mitigate with `terraform plan` in CI on every PR, drift detection, and policy-as-code (OPA/Sentinel) gating applies. **Failure modes:** unguarded `apply` recreating a stateful resource (DB) on an innocuous attribute change; no `prevent_destroy` lifecycle on critical resources.

**Key points**
- IaC = versioned, reproducible, reviewable infra (no click-ops)
- State maps config → real resources; must be remote + locked + encrypted
- Local/unlocked state → corruption on concurrent applies; state leaks secrets
- Drift from manual changes → destructive plans; gate with CI plan + policy-as-code + prevent_destroy

**Follow-ups**
- Why is remote state locking essential for a team?
- How does prevent_destroy / plan-in-CI prevent accidental DB recreation?

---

## Reverse proxy & ingress tuning

#### 31. What role does nginx (or an ingress reverse proxy) play in front of a Go service, given Go has a capable HTTP server?

*Difficulty:* 🟡 medium  ·  *Tags:* `nginx`, `reverse-proxy`, `ingress`, `tls`, `go`

Go's `net/http` is production-grade, so the proxy isn't there to 'be the server' — it offloads **edge concerns** so your app stays focused. A reverse proxy/ingress typically handles: **TLS termination** (and SNI/cert management) so the app speaks plain HTTP internally; **L7 routing** (host/path) and a single ingress point; **rate limiting and connection limiting** to shed abusive load before it hits the app; **buffering of slow clients** (slowloris protection) so a trickling client doesn't tie up a Go goroutine/connection; **compression**, **request size limits**, and **static asset serving**; and **load balancing** across replicas with health checks.

**Trade-offs/failure modes:** the proxy can become a bottleneck/SPOF if under-provisioned; default **proxy timeouts** shorter than your slow endpoints cause spurious 504s; and proxy buffering can interfere with **streaming/SSE/gRPC** responses unless disabled. With HTTP/2 or gRPC you must configure the proxy's protocol support explicitly or it downgrades/breaks the connection.

**Key points**
- Proxy offloads TLS, routing, rate/connection limiting, compression, static assets
- Buffers slow clients (slowloris) so they don't tie up Go connections
- Risk: proxy as SPOF/bottleneck; short proxy timeouts → spurious 504s
- Buffering breaks SSE/gRPC streaming; HTTP/2/gRPC need explicit config

**Follow-ups**
- Why does proxy response buffering break Server-Sent Events?
- How do you pass the real client IP through the proxy to the Go app?

---

#### 32. What nginx/ingress settings most affect a Go backend's tail latency and correctness, and how do you tune them?

*Difficulty:* 🟠 hard  ·  *Tags:* `nginx`, `tuning`, `keepalive`, `timeouts`, `tail-latency`

The high-impact knobs: (1) **upstream keepalive** — without `keepalive` to the Go backend, nginx opens a fresh TCP+TLS connection per request, exhausting ephemeral ports and adding handshake latency; enable keepalive and set `proxy_http_version 1.1` + clear `Connection` header. (2) **Timeouts** — `proxy_read/send/connect_timeout` shorter than slow endpoints yield false 504s; longer than your app's own handler timeout wastes connections; align them with the Go server's `ReadHeaderTimeout`/`WriteTimeout`. (3) **Body/buffer limits** — `client_max_body_size` too low rejects uploads with 413; buffering too small spills to disk and adds latency. (4) **`worker_connections`/`worker_processes`** cap concurrent connections; too low silently drops at load.

**Correctness:** set `X-Forwarded-For`/`X-Real-IP` and configure Go to trust them (else you log/limit on the proxy IP); disable buffering (`proxy_buffering off`) for SSE/gRPC streaming. **Failure mode:** mismatched timeouts between proxy and app produce confusing 502/504 patterns that look like app bugs but are pure proxy config; and missing keepalive shows up as TIME_WAIT exhaustion under load.

**Key points**
- Upstream keepalive (+ HTTP/1.1, clear Connection) avoids per-request TLS and port exhaustion
- Align proxy timeouts with Go's Read/Write timeouts to avoid false 504/502
- client_max_body_size and buffer sizes affect uploads and disk spill
- Forward real client IP; disable buffering for SSE/gRPC; mismatches mimic app bugs


```
upstream go_app {
  server app:8080;
  keepalive 64;
}
server {
  location / {
    proxy_pass http://go_app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 30s;
    client_max_body_size 10m;
  }
}
```

**Follow-ups**
- How do you size upstream keepalive vs the Go server's MaxConns?
- Why must the proxy timeout be coordinated with the Go handler's context timeout?

---
