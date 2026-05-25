# controller-runtime — Optimize

## 1. Where operators spend their CPU and memory

Operators rarely have a CPU-bound *algorithm* — they have a CPU-bound *event rate*. The four cost centers, in roughly the order you'll hit them:

| Cost | Root cause |
|------|-----------|
| Cache memory | Watching many objects of large kinds (Pods, Secrets, ConfigMaps) |
| Reconcile CPU | High event rate × heavy work per reconcile |
| API server QPS | Live reads, conflict retries, status writes per reconcile |
| Workqueue starvation | One controller hogging concurrency, leaving others backlogged |

Every optimization in this file targets one of these. Measure before you tune — `controller_runtime_reconcile_*` and `workqueue_*` metrics tell you which knob to turn.

---

## 2. Scope the cache by namespace

The single biggest memory win for a namespace-scoped operator. Default mode watches every namespace.

```go
ctrl.NewManager(cfg, ctrl.Options{
    Cache: cache.Options{
        DefaultNamespaces: map[string]cache.Config{
            "production": {},
            "staging":    {},
        },
    },
})
```

A cluster with 200 namespaces × 50 Pods/namespace = 10k Pod objects in cache by default. Restricting to 2 namespaces cuts that to ~100. Memory follows linearly; informer event rate too.

---

## 3. Scope the cache by label selector

For kinds you can label at creation (Secrets, ConfigMaps managed by your operator):

```go
Cache: cache.Options{
    ByObject: map[client.Object]cache.ByObject{
        &corev1.Secret{}: {
            Label: labels.SelectorFromSet(labels.Set{"app.kubernetes.io/managed-by": "widget-operator"}),
        },
    },
},
```

The selector is passed in the `LIST`/`WATCH` request — the API server filters before sending. Your cache only sees what you care about.

**Caveat.** Reads via `client.Get` for an object that doesn't match the selector return `NotFound`, even if the object exists. This breaks code that lists by label but `Get`s by name without the label. Either label every object you might fetch, or use `mgr.GetAPIReader()` for non-matching reads.

---

## 4. Use `PartialObjectMetadata` for "labels only" watches

When you watch a kind only to track ownership labels or annotations, store only metadata:

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}).
    Watches(
        &metav1.PartialObjectMetadata{TypeMeta: metav1.TypeMeta{
            APIVersion: "v1", Kind: "ConfigMap",
        }},
        handler.EnqueueRequestsFromMapFunc(r.mapConfigMap),
    ).
    Complete(r)
```

The cache then stores `~1 KB` per object instead of `~10–50 KB`. For 100k ConfigMaps in a busy cluster, that's the difference between 1 GiB and 100 MiB resident.

When the reconciler needs the *full* object, it can `Get` with a typed receiver — the manager has both the metadata cache and the full-object client available.

---

## 5. Index for fast list

Every `List` with `MatchingFields` that is not backed by an indexer scans the whole cache.

```go
mgr.GetFieldIndexer().IndexField(ctx, &v1.Widget{}, ".spec.configRef",
    func(o client.Object) []string {
        return []string{o.(*v1.Widget).Spec.ConfigRef}
    })
```

Then list in O(1):

```go
var widgets v1.WidgetList
r.List(ctx, &widgets,
    client.InNamespace(req.Namespace),
    client.MatchingFields{".spec.configRef": cm.Name},
)
```

Rule of thumb: **any field used in a `MapFunc`** to enqueue requests on cross-resource events should be indexed. Without it, every event runs a linear scan — and the event rate is the same as for the *uncommon* field, so the cost is huge per useful reconcile.

---

## 6. `MaxConcurrentReconciles`

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}).
    WithOptions(controller.Options{MaxConcurrentReconciles: 10}).
    Complete(r)
```

The default is **1** — one reconcile at a time per controller. That's safe but bottlenecks a controller that reconciles many objects with non-trivial latency.

Pick the value by:

1. Measuring p50/p99 reconcile latency.
2. Measuring the API server's QPS headroom (your client-go `QPS` * concurrency must stay under what the API server will tolerate).
3. Multiplying: `concurrency ≈ targetThroughput × p50Latency`.

For 100 reconciles/s at p50 = 50 ms, you want about 5 concurrent reconciles. Going much higher is wasted unless latency rises.

The work-queue still serializes per-key, so concurrency only helps across different keys. Two reconciles for the same Widget can never run in parallel.

---

## 7. Predicates close to the source

Filtering at the predicate level kills events before they hit the queue. The cost of `GenerationChangedPredicate{}` is one int comparison per event; the cost of letting through and then early-returning is a queue enqueue, a reconcile pop, a `Get`, and a no-op.

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}, builder.WithPredicates(predicate.GenerationChangedPredicate{})).
    Owns(&appsv1.Deployment{},
        builder.WithPredicates(predicate.Or(
            predicate.LabelChangedPredicate{},
            statusReplicasChangedPredicate{},
        ))).
    Complete(r)
```

Custom predicates pay off when you watch a kind that updates frequently for reasons your controller doesn't care about. Filter aggressively; in doubt, write a predicate.

---

## 8. Don't write what hasn't changed

Status updates are the easiest hot loop to create. The pattern:

```go
desiredStatus := computeStatus(&w, &dep)
if equality.Semantic.DeepEqual(w.Status, desiredStatus) {
    return ctrl.Result{}, nil
}
w.Status = desiredStatus
return ctrl.Result{}, r.Status().Update(ctx, &w)
```

Cheap, always correct, prevents echo via `GenerationChangedPredicate` (status doesn't bump generation but does fire `Update` events). The `DeepEqual` runs once per reconcile and saves you the writes that would each cost an API round-trip and re-fire the watch.

For server-side apply, the API server itself drops no-op patches — but it still counts against your client-go QPS budget, so the local check still helps.

---

## 9. Status subresource patching

Two write modes for status:

| Mode | Latency | Conflict risk |
|------|---------|---------------|
| `r.Status().Update(ctx, obj)` | Full PUT, ~1 round-trip | Conflicts on stale `resourceVersion` |
| `r.Status().Patch(ctx, obj, client.MergeFrom(orig))` | Smaller PATCH, no version check unless used | None unless you opt in |

Prefer `Patch` for status. It's smaller on the wire, and a merge-patch doesn't fail on concurrent writes to *other* status fields.

```go
orig := w.DeepCopy()
w.Status.Phase = "Ready"
w.Status.AvailableReplicas = dep.Status.AvailableReplicas
return r.Status().Patch(ctx, &w, client.MergeFrom(orig))
```

For server-side apply on status:

```go
patch := &v1.Widget{
    TypeMeta:   metav1.TypeMeta{APIVersion: "apps.example.com/v1", Kind: "Widget"},
    ObjectMeta: metav1.ObjectMeta{Name: w.Name, Namespace: w.Namespace},
    Status:     desiredStatus,
}
r.Status().Patch(ctx, patch, client.Apply, client.FieldOwner("widget-controller"))
```

---

## 10. Batching: don't reconcile in chunks of one

Suppose your controller manages 10k Widgets and each owns 5 dependent resources. Naïvely, every cluster restart triggers 10k reconciles back-to-back, each making 5 API calls. That's 50k API requests in a burst.

Two tools:

1. **Tune the workqueue rate limiter** so that the burst spreads:

```go
WithOptions(controller.Options{
    RateLimiter: workqueue.NewMaxOfRateLimiter(
        workqueue.NewItemExponentialFailureRateLimiter(5*time.Millisecond, 1000*time.Second),
        &workqueue.BucketRateLimiter{Limiter: rate.NewLimiter(rate.Limit(50), 100)},
    ),
})
```

   Caps to 50 reconciles/s — predictable load profile.

2. **Within each reconcile, batch API calls** with `List` instead of `N × Get`. The cache makes the `List` free; the cost was always the Gets.

---

## 11. `Update` vs `Patch` vs `Apply`

| Operation | Wire size | Conflict risk | Field ownership |
|-----------|-----------|---------------|-----------------|
| `Update` | Whole object | High (409 on stale RV) | Whole object |
| `MergePatch` | Just the change | Low — merges into current | Whole object |
| `StrategicMergePatch` | Just the change, schema-aware | Low | Whole object |
| `Apply` (SSA) | Just the fields you set | None for distinct fields | Per-field |

Default to `Patch` for incremental writes (status, labels, annotations). Default to `Apply` for the *desired-state* writes that materialize child resources. Reserve `Update` for cases where you must control the full object (e.g., setting the entire `metadata.finalizers` list atomically).

---

## 12. Avoid the hot loop

Hot loops in operators have a small set of root causes. Audit each:

| Cause | Symptom | Fix |
|-------|---------|-----|
| Status write triggers reconcile, which writes status, which... | reconcile-rate metric is flat-pegged | Add `GenerationChangedPredicate` on `For`; compare status before writing |
| `RequeueAfter: 0` from logic bug | Same | Return `Result{}, nil` when done |
| `Update` flipping a field that another controller flips back | reconcile-rate climbs then plateaus | Use SSA with distinct field managers; or split ownership clearly |
| `CreateOrUpdate` mutator that doesn't reach a fixed point | Generations rise on every reconcile | The mutator must produce the same spec given the same inputs |

Detection: alert on `controller_runtime_reconcile_total` rate > some baseline × 10. Loops compound — what looks like 100 reconciles/s in dev is 100k/s in prod.

---

## 13. Pagination

`List` against the API server (live) returns all items by default. For large kinds, paginate:

```go
opts := &client.ListOptions{Limit: 500}
for {
    var list corev1.PodList
    if err := r.APIReader.List(ctx, &list, opts); err != nil {
        return err
    }
    for i := range list.Items {
        // process
    }
    if list.Continue == "" { break }
    opts.Continue = list.Continue
}
```

The **cache** lists are never paginated — they're in-memory iterations. The risk is only when you bypass the cache.

---

## 14. Periodic resync — when not to

```go
ctrl.Options{
    Cache: cache.Options{SyncPeriod: ptr.To(10 * time.Minute)},
}
```

Periodic resync re-runs every cached object through every controller's handlers — *all of them, all at once*. For a cache of 100k objects across 10 controllers, that's a million reconciles every `SyncPeriod`.

The default is **zero** (no resync). Don't change it unless you have a specific reason:

| Reason | Better alternative |
|--------|-------------------|
| "I want to recover from a missed event" | Watches are reliable; missed events are not the problem you think |
| "External state can change without an event" | Use `RequeueAfter` to poll *just the affected objects* |
| "I want a safety net for bugs" | Fix the bugs |

If you must, set it high (1h+) and accept the burst.

---

## 15. Profiling

```go
mux.HandleFunc("/debug/pprof/", pprof.Index)
mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
mux.HandleFunc("/debug/pprof/heap", pprof.Index)
go http.ListenAndServe("127.0.0.1:6060", mux)
```

Behind a sidecar or admin auth, not on a public port. Then:

```bash
# 30s CPU sample
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# heap snapshot
go tool pprof http://localhost:6060/debug/pprof/heap
```

The CPU profile usually shows:

- `encoding/json` if your reconcile reads/writes a lot of small fields.
- `runtime.mapiterinit` if you're iterating large maps per reconcile.
- `reflect.Value.*` if you're using `unstructured.Unstructured` for typed work.

The heap profile usually shows the cache itself — that's expected; scope it via § 2–4 if it's too big.

---

## 16. Summary

Operator performance is dominated by cache size, event rate, and API server QPS. Scope the cache by namespace and label, use `PartialObjectMetadata` where you only need labels, index every field you list by, and filter events with predicates before they hit the queue. Patch instead of update, only write when something changed, and prefer server-side apply for desired-state writes that may co-exist with other owners. Tune `MaxConcurrentReconciles` and the rate limiter against measured latency. The hottest loops in operators come from echoing your own writes — `GenerationChangedPredicate` plus a status diff guard cover most of those.

---

## Further reading
- Cache options: https://pkg.go.dev/sigs.k8s.io/controller-runtime/pkg/cache#Options
- Partial object metadata: https://book.kubebuilder.io/reference/watching-resources/operator-scope.html
- Workqueue tuning: https://pkg.go.dev/k8s.io/client-go/util/workqueue
- Server-side apply for controllers: https://kubernetes.io/docs/reference/using-api/server-side-apply/#using-server-side-apply-in-a-controller
