# controller-runtime — Professional

## 1. What "running an operator in production" means

You're not just running a Go program; you're running a privileged control-plane component on a shared Kubernetes cluster. That changes the engineering job:

1. **Availability.** The operator is the only thing that reconciles its CRs. If it's down, those resources stop converging — even if the rest of the cluster is healthy.
2. **Blast radius.** A buggy reconciler can update thousands of objects in a tight loop. Rate limits, scoping, and rollback strategies aren't optional.
3. **Multi-tenancy.** RBAC, namespace scoping, and webhook safety controls determine what the operator *can* break.
4. **Observability.** "Did the operator do the right thing?" is the only question that ever matters in an incident, and the answer must be evident from metrics and logs.

The rest of this file is the production checklist.

---

## 2. Leader election

```go
mgr, err := ctrl.NewManager(cfg, ctrl.Options{
    LeaderElection:                true,
    LeaderElectionID:              "widget-operator.example.com",
    LeaderElectionNamespace:       "widget-system",
    LeaderElectionResourceLock:    "leases",
    LeaseDuration:                 ptr.To(15 * time.Second),
    RenewDeadline:                 ptr.To(10 * time.Second),
    RetryPeriod:                   ptr.To(2 * time.Second),
    LeaderElectionReleaseOnCancel: true,
})
```

The defaults are reasonable. The settings to think about:

| Knob | Effect |
|------|--------|
| `LeaseDuration` | How long another candidate must wait before assuming leadership |
| `RenewDeadline` | If the leader can't renew in this window, it stops processing |
| `RetryPeriod` | How often candidates poll the lease |
| `ReleaseOnCancel: true` | On graceful shutdown, hand off immediately; without it, failover waits `LeaseDuration` |

**Always** enable leader election when running > 1 replica. Without it, two managers process the same events and fight over writes — exactly the split-brain you wanted to avoid.

---

## 3. Health and readiness probes

```go
mgr.AddHealthzCheck("ping", healthz.Ping)
mgr.AddReadyzCheck("informers", func(req *http.Request) error {
    if !mgr.GetCache().WaitForCacheSync(req.Context()) {
        return errors.New("cache not synced")
    }
    return nil
})
```

The contract for a Kubernetes-aware operator:

- **Liveness**: always succeed unless the process is wedged. Failing liveness restarts the pod — only use for true deadlocks.
- **Readiness**: succeed once the cache is synced and we're the leader (or running non-leader-elected). A non-leader pod is *running but not ready* in this model — the Service won't send traffic, and `kubectl rollout status` waits for it.

In the Deployment:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8081 }
  initialDelaySeconds: 15
readinessProbe:
  httpGet: { path: /readyz, port: 8081 }
  periodSeconds: 5
```

---

## 4. Metrics and dashboards

The manager exposes Prometheus metrics on `metricsserver.Options.BindAddress`. The non-negotiable panels for an on-call dashboard:

| Panel | Metric (example) | Alert when |
|-------|------------------|------------|
| Reconcile error rate | `rate(controller_runtime_reconcile_errors_total[5m])` | Sustained > 0.1/s |
| Reconcile latency p99 | `histogram_quantile(0.99, controller_runtime_reconcile_time_seconds_bucket)` | > 1s |
| Workqueue depth | `workqueue_depth{name="widget-controller"}` | Climbing without plateau |
| Workqueue oldest unfinished | `workqueue_unfinished_work_seconds{name=...}` | > 60s |
| Leader status | `leader_election_master_status` | No leader for > 30s |
| API server QPS | `rest_client_requests_total` (rate) | Higher than your client-go QPS budget |

The last one is sneaky: a misconfigured controller can DDoS its own API server. The `rest.Config` carries `QPS` (default 20) and `Burst` (default 30). For a single operator pod that's enough; if you run many, raise these *and* keep an eye on the metric.

---

## 5. Structured logging

```go
import "sigs.k8s.io/controller-runtime/pkg/log/zap"

ctrl.SetLogger(zap.New(zap.UseFlagOptions(&zap.Options{
    Development: false,
    TimeEncoder: zapcore.RFC3339TimeEncoder,
})))
```

Production log discipline:

- **`Info` for state transitions** ("reconciled", "finalizer added", "deleted"). Skip "starting reconcile" lines — there are too many.
- **`Error` only for actionable errors.** A `NotFound` you swallowed is not an error. A failed `Update` after retries is.
- **Always include the object key** via `ctrl.LoggerFrom(ctx)` — the manager injects `controller=...`, `name=...`, `namespace=...`.
- **No per-reconcile logs without correlation IDs.** Status-spam logs hide the line you actually want to see.

---

## 6. RBAC scoping in practice

The naïve operator has a `ClusterRole` granting `*` on all the kinds it touches. The production operator scopes by:

1. **Namespace** — if your CRs only exist in one namespace, switch the manager to namespaced mode (`DefaultNamespaces`) and grant a `Role` instead of a `ClusterRole`.
2. **Verbs** — never grant `delete` if you don't delete. Never grant `*` if you can enumerate.
3. **Resources** — `secrets` is the highest-value subset; grant it only where necessary, ideally with `resourceNames` if you only need specific Secrets.
4. **Sub-resources** — `pods/exec`, `pods/portforward`, `*/scale` are separately grantable. Don't ask for them unless used.

```yaml
- apiGroups: ["apps.example.com"]
  resources: ["widgets"]
  verbs: ["get", "list", "watch", "update", "patch"]
- apiGroups: ["apps.example.com"]
  resources: ["widgets/status", "widgets/finalizers"]
  verbs: ["update", "patch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

Run `kubectl auth can-i --as=system:serviceaccount:widget-system:widget-controller list secrets -A` after deploying to verify what the operator can actually do.

---

## 7. Multi-namespace patterns

Three deployment topologies, ordered by isolation:

| Topology | When |
|----------|------|
| One cluster-wide operator | Cluster-scoped CRDs or shared platform feature |
| One operator per namespace (no leader election across) | Strict tenant isolation; each tenant gets its own pod |
| One operator, namespaced cache, cluster-wide CRDs | Most common middle ground — operator only touches enumerated namespaces |

For the third, the cache config:

```go
Cache: cache.Options{
    DefaultNamespaces: map[string]cache.Config{
        "tenant-a": {},
        "tenant-b": {},
    },
},
```

The manager will then only `list+watch` those namespaces. Add namespaces dynamically only by restarting the pod — cache namespace lists are sealed at start.

---

## 8. Graceful shutdown

```go
ctx := ctrl.SetupSignalHandler()
if err := mgr.Start(ctx); err != nil {
    setupLog.Error(err, "manager exited")
    os.Exit(1)
}
```

`SetupSignalHandler` installs handlers for `SIGINT` and `SIGTERM`. On signal:

1. The returned context is cancelled.
2. Each `Runnable`'s context goes too.
3. Controllers stop pulling from their work-queues but **complete in-flight reconciles**.
4. The webhook server stops accepting connections after a drain period.
5. Leader election is released (with `ReleaseOnCancel: true`).
6. `mgr.Start` returns.

Kubernetes' `terminationGracePeriodSeconds` (default 30s) must be **longer** than your slowest reconcile, or the pod is `SIGKILL`ed mid-write and a half-applied state ships. For a controller that talks to external systems, 60–120s is reasonable; document it.

---

## 9. Deployment manifest checklist

A minimal but real Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: widget-operator
  namespace: widget-system
spec:
  replicas: 2
  selector:
    matchLabels: { app: widget-operator }
  template:
    metadata:
      labels: { app: widget-operator }
    spec:
      serviceAccountName: widget-operator
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
      - name: manager
        image: ghcr.io/example/widget-operator:v0.4.2
        args: ["--leader-elect", "--metrics-bind-address=:8080"]
        ports:
        - { containerPort: 8080, name: metrics }
        - { containerPort: 8081, name: probe }
        - { containerPort: 9443, name: webhook }
        resources:
          requests: { cpu: 100m, memory: 256Mi }
          limits:   { cpu:   1, memory: 512Mi }
        env:
          - name: GOMEMLIMIT
            value: "450MiB"
        livenessProbe:  { httpGet: { path: /healthz, port: probe } }
        readinessProbe: { httpGet: { path: /readyz,  port: probe } }
        securityContext:
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities: { drop: ["ALL"] }
```

Three details:

- **`replicas: 2`** with leader election. Exactly one is active; the other is hot standby.
- **`GOMEMLIMIT`** matches the container limit minus headroom — see the memory-management module.
- **Read-only root + dropped caps**. An operator never needs to write the filesystem; if it does, you have a different problem.

---

## 10. Webhooks in production

Validating webhooks should:

- **Fail closed for important checks** (`failurePolicy: Fail`). A degraded webhook blocking creates is better than letting through invalid resources.
- **Fail open for advisory checks** (`failurePolicy: Ignore`). A label policy that occasionally lets a deploy through is better than an outage.
- **Be fast** — < 100ms p99. The API server calls webhooks synchronously on every admission request for the matching kinds.
- **Be idempotent** — they may be called multiple times for one create due to retries.
- **Never depend on the webhook's own controller being ready** — if the webhook gates resources the controller needs, you've built a deadlock.

Mutating webhooks have one extra rule: **never change fields the user owns**. Set defaults, add labels, write annotations. Don't override `spec.replicas`.

---

## 11. CRD lifecycle and conversion

Your CRDs are part of the operator deployment. Two strategies:

1. **Operator installs CRDs.** The operator's helm chart includes the CRD YAML; `controller-gen` generates it. Simple but couples upgrades.
2. **CRDs installed separately.** A platform team installs them out-of-band; the operator only assumes they exist. Better for shared clusters.

For multi-version CRDs (you bumped `v1alpha1` to `v1`), implement a **conversion webhook**:

```go
ctrl.NewWebhookManagedBy(mgr).For(&v1.Widget{}).Complete()

// In v1alpha1:
func (src *Widget) ConvertTo(dstRaw conversion.Hub) error { ... }
func (dst *Widget) ConvertFrom(srcRaw conversion.Hub) error { ... }
```

Pick **one hub version** that knows the full schema; spokes convert to/from it. The API server invokes the webhook when a client asks for an object in a different version than is stored.

---

## 12. Error budgets for reconcilers

A useful SLO for an operator is "fraction of reconciles that converged in one step". Approximated as:

```
SLI = 1 - (reconciles_with_requeue + reconciles_with_error) / reconciles_total
```

For most controllers, healthy is > 0.95. A drop means either:

- The cluster genuinely has a lot of churn (look at watched-kind change rate).
- Your reconcile is wrong and keeps not converging (look at top requeue reasons in logs).

Error budgets aren't just dashboarding — they're the contract that lets you say "this PR slowed the operator down by 12% of budget, hold the release".

---

## 13. Upgrade and rollback safety

Operator upgrades are *control-plane* upgrades. Two practical rules:

1. **The new operator must be safe with old CRs.** If you renamed `.spec.foo` to `.spec.bar`, the upgrade must read both. Otherwise existing resources break during the rollout.
2. **The old operator must be safe with new CRs.** During the rollout, both versions are running. The old version sees new resources and will likely fail to reconcile them — that's fine, but it must not panic or corrupt state.

In practice that means **never delete or rename CRD fields**. Add new fields, deprecate, and eventually remove in a subsequent major version. Use webhooks to enforce defaults so old objects work after the new operator starts.

---

## 14. Observability — events, logs, traces

| Signal | Use for |
|--------|---------|
| `EventRecorder` | User-facing lifecycle messages; show up in `kubectl describe` |
| Structured logs | Operator debugging; include reconcile key always |
| Metrics | Aggregate behavior; SLO tracking; alerting |
| Traces | Latency attribution across the reconcile + downstream API calls (`controller-runtime` supports OpenTelemetry spans on `Reconcile`) |

A real operator emits at least one Kubernetes Event per state transition on every CR — that's what end-users actually read.

---

## 15. Summary

Running an operator in production is leader election plus health probes plus scoped RBAC plus a tight observability loop on top of the reconcile pattern. Bound the blast radius with namespaced caches and label selectors. Treat webhooks as critical infrastructure and benchmark them. Build dashboards on `controller-runtime_reconcile_*` and `workqueue_*`, alert on error rates and oldest-unfinished-work. Never roll out a CRD change that breaks the previous operator version mid-rollout. The reconcile loop is simple; the operational discipline around it is what makes the operator boring — which is the goal.

---

## Further reading
- Operator best practices (SDK): https://sdk.operatorframework.io/docs/best-practices/
- Kubernetes leader election design: https://github.com/kubernetes/community/blob/master/contributors/design-proposals/api-machinery/leader-election.md
- Server-side apply field management: https://kubernetes.io/docs/reference/using-api/server-side-apply/#managers
- Webhook configuration: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/
- CRD versioning: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/
