# controller-runtime — Senior

## 1. The cache is the operator

Internalize this picture and most operator behavior becomes predictable:

```
API server  ──watch──▶  Reflector  ─▶  DeltaFIFO  ─▶  Indexer (thread-safe store)
                                                          │
                                                          ├─▶ EventHandlers  ─▶ workqueue (per-controller)
                                                          │                          │
                                                          ▼                          ▼
                                                       client.Get reads          Reconcile(req)
```

The pieces, named:

| Component | Role |
|-----------|------|
| **Reflector** | Single watch connection per kind; pushes events into a FIFO |
| **DeltaFIFO** | Ordered queue of `(Added/Updated/Deleted, obj)` deltas |
| **Indexer** | The cache. `cache.ThreadSafeStore` with optional secondary indexes |
| **EventHandlers** | Fan-out: every controller that registered for this kind is notified |
| **workqueue** | Per-controller, deduped, rate-limited queue of `Request`s |

Crucial facts:

- There is **one informer per (kind, namespace, selector)** in the manager. All controllers watching the same kind share it. Watch load is amortized.
- The handlers only build a `Request{NamespacedName}` and enqueue it — they don't carry the object. The reconciler re-reads from the cache.
- Re-list happens on watch errors, restart, and periodically (default `resync = 0`, meaning no periodic resync; you can set it for safety nets).

---

## 2. Workqueue mechanics

```go
workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter())
```

Three behaviors layered:

1. **Deduplication.** Adding the same `Request` while one is in the queue collapses to a single entry.
2. **Forgetting.** After a successful reconcile, the controller calls `Forget(key)` to clear the rate-limiter state.
3. **Rate-limited re-queue.** On error, `AddRateLimited` re-enqueues after `min(5ms × 2^n, 1000s)` plus token-bucket throttling (10qps/100 burst by default).

That's why two failing reconciles for the same object don't burn your CPU — backoff grows quickly. It's also why **always** returning an error for the same object can starve other work; consider `RequeueAfter` for "I know I'm not ready" cases.

---

## 3. Predicates, in the event flow

A predicate runs in the *handler*, not in the reconciler. Returning `false` drops the event before it ever hits the work-queue.

```go
type Funcs struct {
    CreateFunc  func(event.CreateEvent) bool
    UpdateFunc  func(event.UpdateEvent) bool
    DeleteFunc  func(event.DeleteEvent) bool
    GenericFunc func(event.GenericEvent) bool
}
```

`GenerationChangedPredicate` is roughly:

```go
UpdateFunc: func(e event.UpdateEvent) bool {
    return e.ObjectOld.GetGeneration() != e.ObjectNew.GetGeneration()
},
```

Two senior subtleties:

1. **Generation only increments on `spec` changes.** Status-only writes leave generation alone. So this predicate cuts the echo from your own `Status().Update` cleanly — *unless* you also mutate spec fields, in which case generation rises and your filter fires.
2. **Predicates are per-source, not per-controller.** `For` and each `Owns` / `Watches` has its own predicate slot. `WithEventFilter` applies the same predicate to all of them, which is rarely what you want.

---

## 4. Multi-resource watches with `MapFunc`

A `Watches` with `EnqueueRequestsFromMapFunc` lets one event fan out to many reconciles. The mapping function runs **inside the handler goroutine**, so it must be cheap.

```go
func (r *Reconciler) referencesConfig(ctx context.Context, obj client.Object) []ctrl.Request {
    var widgets v1.WidgetList
    if err := r.List(ctx, &widgets,
        client.InNamespace(obj.GetNamespace()),
        client.MatchingFields{".spec.configRef": obj.GetName()},
    ); err != nil {
        return nil
    }
    out := make([]ctrl.Request, 0, len(widgets.Items))
    for i := range widgets.Items {
        out = append(out, ctrl.Request{NamespacedName: client.ObjectKeyFromObject(&widgets.Items[i])})
    }
    return out
}
```

The `MatchingFields` trick requires a **field indexer** registered before the cache starts:

```go
mgr.GetFieldIndexer().IndexField(ctx, &v1.Widget{}, ".spec.configRef",
    func(o client.Object) []string {
        return []string{o.(*v1.Widget).Spec.ConfigRef}
    })
```

Without the indexer, `MatchingFields` falls back to a full list, which scales linearly in N. **Always index the fields you list by** in a hot path.

---

## 5. Cache reads vs. live reads

```go
cached := mgr.GetClient()       // reads from the cache
live   := mgr.GetAPIReader()    // reads directly from the API server
```

Use the **cache** for everything in `Reconcile` — it's fast and shared, and you'll be re-queued when the underlying object changes anyway.

Use the **live** reader for:

| Case | Why |
|------|-----|
| Reading a secret across many namespaces without watching | The cache would have to watch everything; live skips that |
| Verifying a write you just made | The cache hasn't seen it yet |
| Admission webhook handlers | They run before the watch even sees the object |
| Reading kinds your manager doesn't watch | The cache doesn't know about them |

Live reads cost an API round-trip *and* count against the API server's QPS budget. Don't loop them.

---

## 6. The conflict-and-retry dance

Every `Update` carries a `resourceVersion`. The API server rejects with `409 Conflict` if it's stale. controller-runtime gives you helpers:

```go
import "k8s.io/client-go/util/retry"

err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
    var w v1.Widget
    if err := r.Get(ctx, key, &w); err != nil { return err }
    w.Status.Phase = "Ready"
    return r.Status().Update(ctx, &w)
})
```

`retry.RetryOnConflict` refetches and retries with exponential backoff *within the same reconcile call*. Use it specifically for the read-modify-write pattern.

For most reconciles you don't need it — let the work-queue re-enqueue on error. Use `RetryOnConflict` when the operation must succeed before you return (e.g., setting a finalizer before doing destructive work).

---

## 7. Server-side apply

For controllers that own *fields*, not objects, use server-side apply:

```go
import "k8s.io/apimachinery/pkg/util/jsonpath"

dep := &appsv1.Deployment{
    TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
    ObjectMeta: metav1.ObjectMeta{Name: w.Name, Namespace: w.Namespace},
    Spec:       desiredSpec(&w),
}

err := r.Patch(ctx, dep, client.Apply,
    client.FieldOwner("widget-controller"),
    client.ForceOwnership,
)
```

What changes:

- The patch declares *intent*. The API server merges only the fields you set; fields owned by others (HPA setting `replicas`, the kubelet setting status) are untouched.
- The field manager string (`widget-controller`) tracks ownership. Two controllers can co-own different fields of the same object.
- `ForceOwnership` claims fields previously owned by someone else — use sparingly; it's how field-tug-of-war is resolved.
- The provided object must have `TypeMeta` set — apply uses it to disambiguate.

SSA is the preferred mode for new operators on Kubernetes ≥ 1.22. It eliminates the "I read the object, modified one field, and clobbered changes made by another controller" failure mode.

---

## 8. Eventual consistency, embraced

Your reconciler runs in a world where:

- A `Create` you just issued isn't yet in your cache.
- Another controller may write to the object between your `Get` and your `Update`.
- An object can be deleted between two reads.
- The watch can drop and re-list, briefly delivering "Add" events for objects you already know about.

Rules that follow:

1. **Always `Get` at the top of `Reconcile`.** Never trust a previous reconcile's view.
2. **Treat `NotFound` as success** when the object is gone (`IgnoreNotFound`).
3. **Be tolerant of duplicate "Add" events** — your code already is if it's idempotent.
4. **Don't keep in-memory state about the cluster** that isn't reconstructible from a fresh read. Caches lie if you make them.

---

## 9. Field indexers — design upfront

A field indexer turns a `MatchingFields{".spec.foo": "bar"}` list from O(N) into O(1).

```go
mgr.GetFieldIndexer().IndexField(ctx, &corev1.Pod{}, "spec.nodeName",
    func(o client.Object) []string {
        return []string{o.(*corev1.Pod).Spec.NodeName}
    })
```

Constraints:

- Register **before** `mgr.Start(ctx)`. After start, the cache is sealed.
- The function must be **deterministic** and side-effect-free; it runs on every object the cache sees.
- Returning multiple keys creates a multi-key index. Returning none excludes the object from the index.

Indexers are a feature of the underlying informer, not a separate layer. They cost memory proportional to the cache size; don't index fields you don't list by.

---

## 10. Selecting which objects to cache

The default cache watches **all** objects of a kind across **all** namespaces. For a controller that only cares about one namespace, that's enormous waste.

```go
mgr, _ := ctrl.NewManager(cfg, ctrl.Options{
    Cache: cache.Options{
        DefaultNamespaces: map[string]cache.Config{
            "production": {},
            "staging":    {},
        },
        ByObject: map[client.Object]cache.ByObject{
            &corev1.Secret{}: {
                Label: labels.SelectorFromSet(labels.Set{"managed-by": "widget-operator"}),
            },
        },
    },
})
```

Two scopes you'll actually use:

- **`DefaultNamespaces`** — limits the manager's namespace scope. Cluster-wide RBAC drops to namespaced RBAC.
- **`ByObject.Label` / `ByObject.Field`** — applies a watch-time selector. The API server filters server-side; your cache never sees the rest.

Label-selecting on Secrets is the canonical example: caching all Secrets in a busy cluster is the fastest way to OOM the operator pod.

---

## 11. PartialObjectMetadata for cheap watches

Some controllers only need an object's name, namespace, and labels — they never read `spec`. For those, watch as metadata-only:

```go
import "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}).
    Watches(
        &metav1.PartialObjectMetadata{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "ConfigMap"}},
        handler.EnqueueRequestsFromMapFunc(mapFn),
    ).
    Complete(r)
```

The cache stores only `ObjectMeta` — typically 1–10% the size of the full object. For watching tens of thousands of ConfigMaps or Secrets, this turns a memory crisis into a non-issue.

---

## 12. Conflicts — when to retry, when to error

| Conflict source | Strategy |
|-----------------|----------|
| Two controllers fighting over `spec` | Use SSA with distinct field managers; one or both must yield |
| Your own status write losing to a fresh user edit | `RetryOnConflict` and re-merge |
| Cache lag causing stale `resourceVersion` | Re-queue (return the error) — the next reconcile sees the new version |
| Multiple reconciles racing on the same object | Should never happen: the work-queue serializes per key |

The last point is worth re-reading. **The work-queue ensures only one in-flight reconcile per object key.** If you see concurrent updates from your own controller, you're either holding goroutines past `Reconcile`'s return or running multiple manager instances without leader election.

---

## 13. Manager lifecycle and `Runnable`

Beyond controllers and webhooks, you can register arbitrary `Runnable`s with the manager:

```go
mgr.Add(manager.RunnableFunc(func(ctx context.Context) error {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return nil
        case <-ticker.C:
            // periodic work
        }
    }
}))
```

The manager:

1. Starts the cache and waits for sync.
2. Starts non-leader-election runnables (webhook server, metrics).
3. Acquires leader election (if enabled).
4. Starts leader-election runnables (controllers).
5. On shutdown: cancels context, waits for all runnables to return.

Anything that should run only on the leader (controllers, custom singletons) goes in `Add`. Anything always-on (health probes) goes in `AddMetricsServerExtraHandler` or registers before manager start.

---

## 14. Summary

The senior view of controller-runtime is the informer + cache + workqueue + reconciler stack, with predicates and indexers as the levers you turn for performance and correctness. Use the cache for reads, the live reader for verification and webhook-time access, server-side apply for field-level coexistence, and `RetryOnConflict` for read-modify-write that must succeed inline. Scope the cache aggressively — by namespace, by label, and via `PartialObjectMetadata` — long before your operator ships.

---

## Further reading
- Informer mechanics: https://pkg.go.dev/k8s.io/client-go/tools/cache
- Server-side apply: https://kubernetes.io/docs/reference/using-api/server-side-apply/
- controller-runtime FAQ: https://github.com/kubernetes-sigs/controller-runtime/blob/main/FAQ.md
- Workqueue rate limiting: https://pkg.go.dev/k8s.io/client-go/util/workqueue
- Field indexers: https://book.kubebuilder.io/reference/watching-resources/externally-managed.html
