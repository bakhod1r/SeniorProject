# controller-runtime — Specification

> **Focus:** Precise reference for the Go library `sigs.k8s.io/controller-runtime` — the foundation under Kubebuilder and the Operator SDK that ships the manager, the client, the cache, the reconciler, and the controller builder used by every modern Kubernetes operator.
>
> **Sources:**
> - Package docs: https://pkg.go.dev/sigs.k8s.io/controller-runtime
> - GitHub: https://github.com/kubernetes-sigs/controller-runtime
> - Kubebuilder book: https://book.kubebuilder.io
> - Operator pattern: https://kubernetes.io/docs/concepts/extend-kubernetes/operator/

---

## 1. The operator pattern

Kubernetes treats every resource as a desired-state declaration. A *controller* observes the cluster, compares observed state to desired state, and takes action to close the gap — over and over, forever.

| Loop step | Mechanism |
|-----------|-----------|
| **Observe** | An *informer* watches the API server and maintains a local cache |
| **Diff** | The reconciler reads the cached object plus dependents |
| **Act** | The reconciler issues create/update/patch/delete via the client |
| **Repeat** | A `workqueue` re-queues on change, error, or requested `RequeueAfter` |

A *operator* is just one or more controllers packaged with the Custom Resource Definitions (CRDs) they reconcile. The reconciliation function must be **idempotent**: running it twice with the same input must converge to the same state.

---

## 2. Top-level packages

| Import path | Role |
|-------------|------|
| `sigs.k8s.io/controller-runtime` (`ctrl`) | Conveniences — `NewControllerManagedBy`, `Log`, `SetupSignalHandler` |
| `.../pkg/manager` | `Manager` — runs caches, controllers, webhooks, leader election, metrics |
| `.../pkg/client` | `Client` — typed CRUD with optional cache-backed reads |
| `.../pkg/cache` | Cache implementation: informers + indexers |
| `.../pkg/reconcile` | `Reconciler` interface, `Request`, `Result` |
| `.../pkg/controller` | Controller builder, options, watches |
| `.../pkg/builder` | Higher-level builder — `For`, `Owns`, `Watches` |
| `.../pkg/handler` | Event handlers — `EnqueueRequestForObject`, `EnqueueRequestForOwner` |
| `.../pkg/source` | Event sources — `Kind`, `Channel` |
| `.../pkg/predicate` | Predicate filters on events |
| `.../pkg/controller/controllerutil` | `CreateOrUpdate`, `SetControllerReference`, `AddFinalizer` |
| `.../pkg/webhook` | Validating / mutating / conversion webhook framework |
| `.../pkg/envtest` | In-process etcd + apiserver for integration tests |

---

## 3. `manager.Manager`

```go
mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
    Scheme:                 scheme,
    LeaderElection:         true,
    LeaderElectionID:       "my-operator.example.com",
    Metrics:                metricsserver.Options{BindAddress: ":8080"},
    HealthProbeBindAddress: ":8081",
    Cache:                  cache.Options{DefaultNamespaces: map[string]cache.Config{"app": {}}},
})
```

| Responsibility | API |
|----------------|-----|
| Boot informer cache | `mgr.GetCache()` |
| Provide a client | `mgr.GetClient()` (cache-backed) |
| Provide a live client | `mgr.GetAPIReader()` (no cache) |
| Register controllers | `ctrl.NewControllerManagedBy(mgr)` |
| Register webhooks | `mgr.GetWebhookServer().Register(...)` |
| Run | `mgr.Start(ctx)` blocks until ctx is cancelled |
| Leader election | `LeaderElection: true` + `LeaderElectionID` |
| Health probes | `AddHealthzCheck`, `AddReadyzCheck` |

The manager **owns the cache** and **shares it across all controllers** it runs. Multiple controllers reconciling the same kind reuse one informer.

---

## 4. `client.Client`

```go
type Client interface {
    Reader        // Get, List
    Writer        // Create, Delete, Update, Patch, DeleteAllOf
    StatusClient  // Status().Update / Patch
    SubResourceClientConstructor
    Scheme() *runtime.Scheme
    RESTMapper() meta.RESTMapper
}
```

| Call | Reads from | Writes to |
|------|-----------|-----------|
| `c.Get(ctx, key, obj)` | **Cache** | — |
| `c.List(ctx, list, opts...)` | **Cache** | — |
| `c.Create(ctx, obj)` | — | API server |
| `c.Update(ctx, obj)` | — | API server |
| `c.Patch(ctx, obj, patch)` | — | API server |
| `c.Status().Update(ctx, obj)` | — | API server (status subresource) |
| `mgr.GetAPIReader().Get(...)` | API server (no cache) | — |

`Update` requires the latest `resourceVersion` (optimistic locking) — a 409 `Conflict` means the resource changed under you; refetch and retry.

---

## 5. `reconcile.Reconciler`

```go
type Reconciler interface {
    Reconcile(context.Context, Request) (Result, error)
}

type Request struct {
    NamespacedName types.NamespacedName
}

type Result struct {
    Requeue      bool          // re-enqueue immediately (with rate-limit backoff)
    RequeueAfter time.Duration // re-enqueue after this delay (no backoff)
}
```

Return rules:

| Return | Behavior |
|--------|----------|
| `(Result{}, nil)` | Success; no re-queue. Re-queue happens only on watched events |
| `(Result{}, err)` | Re-queue with rate-limited backoff |
| `(Result{Requeue: true}, nil)` | Re-queue immediately under backoff |
| `(Result{RequeueAfter: d}, nil)` | Re-queue after `d`; ignores backoff |

The `Request` contains only the namespaced name — not the object. The reconciler must `Get` the current state at the top of each call.

---

## 6. Controller builder

```go
err := ctrl.NewControllerManagedBy(mgr).
    Named("widget-controller").
    For(&v1.Widget{}).
    Owns(&appsv1.Deployment{}).
    Watches(&v1.Config{}, handler.EnqueueRequestsFromMapFunc(mapConfig)).
    WithEventFilter(predicate.GenerationChangedPredicate{}).
    WithOptions(controller.Options{MaxConcurrentReconciles: 5}).
    Complete(&WidgetReconciler{Client: mgr.GetClient()})
```

| Method | Effect |
|--------|--------|
| `For(obj)` | Primary kind; watches it and enqueues its own namespaced name on changes |
| `Owns(obj)` | Watches dependent kind; enqueues the *owner* (via owner refs) on changes |
| `Watches(src, handler)` | Arbitrary source with a custom handler |
| `WithEventFilter(pred)` | Predicate applied to *all* sources |
| `WithOptions(...)` | Concurrency, rate limiter, etc. |
| `Complete(r)` | Registers and starts when manager runs |

---

## 7. Event sources, handlers, predicates

| Type | Purpose | Examples |
|------|---------|----------|
| `source.Kind` | Watch a Kubernetes kind via the cache | `source.Kind(cache, &v1.Pod{}, handler)` |
| `source.Channel` | Inject events from external code | Used in tests, external sync |
| `handler.EnqueueRequestForObject` | Enqueue the changed object itself | Used by `For` |
| `handler.EnqueueRequestForOwner` | Walk owner refs and enqueue the owner | Used by `Owns` |
| `handler.EnqueueRequestsFromMapFunc` | Custom mapping from event → list of requests | Used by `Watches` |
| `predicate.GenerationChangedPredicate` | Drop events where `.spec` didn't change | Skip status-only updates |
| `predicate.LabelChangedPredicate` | Fire only on label edits | |
| `predicate.AnnotationChangedPredicate` | Fire only on annotation edits | |
| `predicate.ResourceVersionChangedPredicate` | Fire on any change | Default-ish |

---

## 8. `controllerutil` helpers

| Helper | Purpose |
|--------|---------|
| `controllerutil.SetControllerReference(owner, child, scheme)` | Set the owner ref so `Owns` and garbage-collection work |
| `controllerutil.CreateOrUpdate(ctx, c, obj, mutate)` | Idempotent upsert with a mutate callback |
| `controllerutil.CreateOrPatch(ctx, c, obj, mutate)` | Same, but uses Patch (smaller, safer for status) |
| `controllerutil.AddFinalizer(obj, name)` | Append a finalizer string if absent |
| `controllerutil.RemoveFinalizer(obj, name)` | Remove a finalizer string |
| `controllerutil.ContainsFinalizer(obj, name)` | Membership test |

`CreateOrUpdate` fetches first; if found, calls `mutate` with the existing object; if not, calls `mutate` on an empty one and creates. The mutate callback is the only place to set spec fields.

---

## 9. Finalizers — protocol

| Step | Action |
|------|--------|
| 1. On reconcile, if `DeletionTimestamp.IsZero()` and finalizer absent | `AddFinalizer`, `Update` |
| 2. If `!DeletionTimestamp.IsZero()` and finalizer present | Run cleanup (external resources, dependents) |
| 3. After cleanup | `RemoveFinalizer`, `Update` |
| 4. Kubernetes deletes the object | Only when *all* finalizers are gone |

A finalizer string is conventionally `domain/name`, e.g. `widgets.example.com/cleanup`.

---

## 10. RBAC marker comments

```go
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
func (r *WidgetReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) { ... }
```

Run `controller-gen rbac:roleName=manager-role paths="./..."` to emit a `Role` / `ClusterRole` from these markers.

---

## 11. Webhook framework

| Webhook | Interface | Triggered on |
|---------|-----------|--------------|
| Mutating | `admission.CustomDefaulter.Default(ctx, obj)` | Create / Update — modifies the object |
| Validating | `admission.CustomValidator.{ValidateCreate, ValidateUpdate, ValidateDelete}` | Create / Update / Delete — accept or reject |
| Conversion | `conversion.Convertible` on the API type | API-server converting between versions |

Register through the manager:

```go
err := ctrl.NewWebhookManagedBy(mgr).
    For(&v1.Widget{}).
    WithDefaulter(&WidgetDefaulter{}).
    WithValidator(&WidgetValidator{}).
    Complete()
```

---

## 12. envtest

```go
testEnv := &envtest.Environment{
    CRDDirectoryPaths: []string{filepath.Join("..", "config", "crd", "bases")},
}
cfg, err := testEnv.Start()      // boots etcd + kube-apiserver in this process
defer testEnv.Stop()

k8sClient, _ := client.New(cfg, client.Options{Scheme: scheme})
```

`envtest` runs a real `kube-apiserver` and `etcd` binary (pinned by `setup-envtest`) on localhost. No scheduler, no kubelet. Behavior matches a real API server for control-plane code paths but pods never run.

---

## 13. Default rate limiter

```go
workqueue.DefaultControllerRateLimiter()
```

is two limiters joined by `MaxOf`:

| Limiter | Behavior |
|---------|----------|
| Exponential | `5ms × 2^n` per-item backoff, capped at 1000s |
| Bucket | Token bucket: 10 qps, burst 100 (cluster-wide for this controller) |

Items are de-duplicated in the queue: enqueuing the same `Request` twice while one is still queued collapses to one entry.

---

## 14. Metrics endpoints

| Metric | Meaning |
|--------|---------|
| `controller_runtime_reconcile_total{result}` | Reconcile outcomes |
| `controller_runtime_reconcile_errors_total` | Reconciles that returned a non-nil error |
| `controller_runtime_reconcile_time_seconds` | Latency histogram |
| `workqueue_depth{name}` | Items waiting per controller |
| `workqueue_adds_total{name}` | Total enqueues |
| `workqueue_retries_total{name}` | Total re-enqueues after error |
| `workqueue_unfinished_work_seconds{name}` | Age of oldest in-flight item |
| `leader_election_master_status` | 1 if this pod is the leader |

The manager exposes these on the configured `Metrics.BindAddress`.

---

## 15. Non-goals / limitations

- controller-runtime does **not** scaffold CRDs or YAML — that is `kubebuilder` / `operator-sdk`.
- It does **not** validate `spec` fields beyond OpenAPI; richer logic goes in a webhook.
- The cache is **eventually consistent** with the API server; immediately after a `Create`, a `Get` may miss.
- The cache is **per-manager**; running two managers on the same cluster doubles the watch load.
- It does not provide a UI or a CLI — operators are control-plane code only.

---

## 16. Related references

- API reference: https://pkg.go.dev/sigs.k8s.io/controller-runtime
- Architectural overview: https://github.com/kubernetes-sigs/controller-runtime/blob/main/FAQ.md
- client-go informers (the underlying mechanism): https://pkg.go.dev/k8s.io/client-go/informers
- Kubebuilder book: https://book.kubebuilder.io
- Operator SDK: https://sdk.operatorframework.io
