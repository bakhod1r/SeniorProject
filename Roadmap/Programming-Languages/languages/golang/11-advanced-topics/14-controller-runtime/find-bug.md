# controller-runtime — Find the Bug

A collection of realistic operator bugs. Each entry: the symptom, the (subtle) cause, and the fix. These are mistakes that ship to production — recognizing them on sight is most of operator debugging.

---

## Bug 1: The reconciler that won't stop reconciling

```go
func (r *WidgetReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    var w v1.Widget
    if err := r.Get(ctx, req.NamespacedName, &w); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    w.Status.LastReconciledAt = metav1.Now()
    if err := r.Status().Update(ctx, &w); err != nil {
        return ctrl.Result{}, err
    }
    return ctrl.Result{}, nil
}
```

**Symptom.** `controller_runtime_reconcile_total` climbs at thousands/s for one Widget. The API server's metrics show writes to this resource pegging the throttle.

**Cause.** Two compounding problems:

1. Every status `Update` re-fires the watch on the Widget, which re-enqueues the request, which writes status again.
2. There's no predicate, so even the status-only update (which doesn't bump generation) is treated as a real change.

**Fix.** Two changes:

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}, builder.WithPredicates(predicate.GenerationChangedPredicate{})).
    Complete(r)
```

And don't write `LastReconciledAt` every time — it has no value as a status field and only feeds the loop. If you really want a heartbeat, store it as an annotation and only update on a real condition change.

---

## Bug 2: The owner reference that points to nothing

```go
dep := &appsv1.Deployment{
    ObjectMeta: metav1.ObjectMeta{
        Name:      w.Name,
        Namespace: w.Namespace,
        OwnerReferences: []metav1.OwnerReference{{
            APIVersion: "apps.example.com/v1",
            Kind:       "Widget",
            Name:       w.Name,
            UID:        w.UID,
        }},
    },
}
_ = r.Create(ctx, dep)
```

But the controller is registered with `Owns(&appsv1.Deployment{})` and events on the Deployment never seem to enqueue a reconcile of the Widget.

**Symptom.** Changing the Deployment's status doesn't trigger Widget reconciles. `Owns` appears broken.

**Cause.** `Owns` only enqueues when the *controller* owner ref is set. Plain `OwnerReferences` is "garbage-collected by this owner"; the controller ref also has `Controller: true`. Without it, `Owns` ignores the event.

**Fix.** Use the helper, always:

```go
controllerutil.SetControllerReference(&w, dep, r.Scheme)
```

It sets `Controller: true` and `BlockOwnerDeletion: true`. Never hand-build owner refs in operator code.

---

## Bug 3: The finalizer that never runs

```go
func (r *Reconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    var w v1.Widget
    if err := r.Get(ctx, req.NamespacedName, &w); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    if !w.DeletionTimestamp.IsZero() {
        // cleanup external resource
        if err := r.deleteExternalResource(&w); err != nil {
            return ctrl.Result{}, err
        }
        return ctrl.Result{}, nil
    }
    // ... reconcile normally
    return ctrl.Result{}, nil
}
```

**Symptom.** Users `kubectl delete widget foo`; the Widget vanishes immediately and the external resource is leaked. Logs show the cleanup block never executed.

**Cause.** No finalizer was added. Without a finalizer, the API server deletes the object the moment the user issues the delete — the controller never gets a chance to observe `DeletionTimestamp` non-zero.

**Fix.**

```go
const fin = "widgets.example.com/cleanup"

if w.DeletionTimestamp.IsZero() {
    if !controllerutil.ContainsFinalizer(&w, fin) {
        controllerutil.AddFinalizer(&w, fin)
        return ctrl.Result{}, r.Update(ctx, &w)
    }
} else {
    if controllerutil.ContainsFinalizer(&w, fin) {
        if err := r.deleteExternalResource(&w); err != nil {
            return ctrl.Result{}, err
        }
        controllerutil.RemoveFinalizer(&w, fin)
        return ctrl.Result{}, r.Update(ctx, &w)
    }
    return ctrl.Result{}, nil
}
```

The finalizer must exist *before* the user can request deletion — that's why you add it at the top of every reconcile, idempotently.

---

## Bug 4: The cache read that disagrees with reality

```go
if err := r.Create(ctx, dep); err != nil {
    return ctrl.Result{}, err
}
var fresh appsv1.Deployment
if err := r.Get(ctx, client.ObjectKeyFromObject(dep), &fresh); err != nil {
    return ctrl.Result{}, err   // NotFound!
}
```

**Symptom.** Right after `Create` returns success, the immediate `Get` says NotFound — and the reconciler errors and re-queues, which `Create`s *again*, which fails with `AlreadyExists`.

**Cause.** `Create` writes through to the API server, but the *cache* hasn't received the watch event yet. `r.Get` reads the cache.

**Fix.** Two options, in order of preference:

1. Don't re-`Get` — `Create` populates the object you passed in. Use that directly:

```go
if err := r.Create(ctx, dep); err != nil { return ctrl.Result{}, err }
// dep now has UID, ResourceVersion, etc. populated.
```

2. If you must re-read freshly, use the live reader:

```go
mgr.GetAPIReader().Get(ctx, key, &fresh)
```

But the right fix is almost always #1.

---

## Bug 5: The conflict error that wasn't retried

```go
var w v1.Widget
r.Get(ctx, req.NamespacedName, &w)
w.Status.Phase = "Ready"
return ctrl.Result{}, r.Status().Update(ctx, &w)
```

**Symptom.** Logs show a steady drumbeat of `Operation cannot be fulfilled on widgets "foo": the object has been modified; please apply your changes to the latest version`. The Widget never reaches `Ready`.

**Cause.** The cached object has stale `resourceVersion`. The user (or another controller) updates the spec; the API server bumps the version; the cache hasn't caught up; our `Update` sends the old version; conflict.

**Fix.** Two options:

1. **Return the error.** The next reconcile sees the new version. This works most of the time:

```go
if err := r.Status().Update(ctx, &w); err != nil {
    return ctrl.Result{}, err   // requeued; the next attempt sees fresh data
}
```

2. **Retry inline** when the work must succeed before the function returns:

```go
err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
    var fresh v1.Widget
    if err := r.Get(ctx, req.NamespacedName, &fresh); err != nil { return err }
    fresh.Status.Phase = "Ready"
    return r.Status().Update(ctx, &fresh)
})
```

The trap is doing *neither* — swallowing the error or `panic`ing on it.

---

## Bug 6: The watch predicate that swallowed real events

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}).
    WithEventFilter(predicate.GenerationChangedPredicate{}).
    Owns(&appsv1.Deployment{}).
    Complete(r)
```

**Symptom.** When a managed Deployment's pods restart, the Widget's status doesn't update. The user sees stale `AvailableReplicas`.

**Cause.** `WithEventFilter` applies the predicate to **every** source — including the `Owns` watch on Deployment. Deployment status changes don't bump *generation* (status never does). The predicate drops them. The reconciler never runs.

**Fix.** Use per-source predicates:

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1.Widget{}, builder.WithPredicates(predicate.GenerationChangedPredicate{})).
    Owns(&appsv1.Deployment{}).
    Complete(r)
```

`Owns` keeps its default predicate (changes in the underlying object). `For` filters out status-only echoes from the Widget itself.

---

## Bug 7: The status that lost itself

```go
var w v1.Widget
r.Get(ctx, req.NamespacedName, &w)
w.Spec.Replicas = &one
if err := r.Update(ctx, &w); err != nil { return ctrl.Result{}, err }

w.Status.Phase = "Scaling"
return ctrl.Result{}, r.Status().Update(ctx, &w)
```

**Symptom.** The Widget never enters `Scaling`. Inspection shows the status stays whatever it was before.

**Cause.** `r.Update(ctx, &w)` succeeded, but it updated the API server's `metadata.resourceVersion`. The local `w.ResourceVersion` is now stale. The follow-up `r.Status().Update` fails with a conflict — *but the code didn't return the error*, the test didn't catch it.

Actually it's worse: even if the second update succeeded, **on resources with the status subresource enabled, `Update` ignores `.status` and `Status().Update` ignores `.spec`**. They are written via different code paths.

**Fix.** Refetch between the two writes:

```go
r.Update(ctx, &w)
r.Get(ctx, req.NamespacedName, &w)        // get fresh resourceVersion
w.Status.Phase = "Scaling"
r.Status().Update(ctx, &w)
```

Or restructure so spec and status are written in opposite-order reconciles: write spec, return, next reconcile (triggered by your own write) sees the new spec and updates status.

---

## Bug 8: Two controllers fighting over the same field

A `WidgetController` sets `Deployment.Spec.Replicas` based on `Widget.Spec.Replicas`. A `HorizontalPodAutoscaler` also sets `Deployment.Spec.Replicas` based on load.

**Symptom.** The Deployment's replicas oscillate. Every few seconds it jumps between the Widget's desired count and the HPA's computed count.

**Cause.** Both controllers `Update` the Deployment with their preferred value, each overwriting the other.

**Fix.** Server-side apply with **distinct field managers**, and *don't* claim `replicas` from the Widget controller — let the HPA own it:

```go
desired := &appsv1.Deployment{
    TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
    ObjectMeta: metav1.ObjectMeta{Name: w.Name, Namespace: w.Namespace},
    Spec: appsv1.DeploymentSpec{
        // do NOT set Replicas here — leave the field unset
        Selector: labelSelector(&w),
        Template: podTemplate(&w),
    },
}
r.Patch(ctx, desired, client.Apply, client.FieldOwner("widget-controller"))
```

By not including `replicas`, the field manager doesn't claim it. The HPA's writes to `replicas` are untouched.

---

## Bug 9: The leader election split-brain

```go
mgr, _ := ctrl.NewManager(cfg, ctrl.Options{
    LeaderElection: false,
})
```

Deployed with `replicas: 3`.

**Symptom.** Two of the three operator pods write to the same Widgets in lockstep. Status flips between values. External API calls duplicate.

**Cause.** Without leader election, every replica thinks it's the leader. Three reconcilers, three writes per change.

**Fix.**

```go
LeaderElection:   true,
LeaderElectionID: "widget-operator.example.com",
```

And confirm in metrics: exactly one pod's `leader_election_master_status` should be 1.

---

## Bug 10: The `MapFunc` that scans the whole cluster

```go
.Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(
    func(ctx context.Context, obj client.Object) []ctrl.Request {
        var widgets v1.WidgetList
        r.List(ctx, &widgets)             // every namespace
        var out []ctrl.Request
        for _, w := range widgets.Items {
            if w.Spec.ConfigRef == obj.GetName() {
                out = append(out, ctrl.Request{NamespacedName: client.ObjectKeyFromObject(&w)})
            }
        }
        return out
    },
))
```

**Symptom.** ConfigMap-heavy clusters show 80% of operator CPU in this map function. The reconcile rate barely moves.

**Cause.** Every ConfigMap event lists every Widget in every namespace and linearly filters. With 10k Widgets and a ConfigMap update rate of 100/s, that's a million list iterations per second.

**Fix.** A field indexer plus a scoped list:

```go
mgr.GetFieldIndexer().IndexField(ctx, &v1.Widget{}, ".spec.configRef",
    func(o client.Object) []string { return []string{o.(*v1.Widget).Spec.ConfigRef} })

// in map fn:
r.List(ctx, &widgets,
    client.InNamespace(obj.GetNamespace()),
    client.MatchingFields{".spec.configRef": obj.GetName()},
)
```

O(1) lookup. Operator CPU drops to single-digit percent.

---

## Bug 11: The status that wasn't an error

```go
if err := r.callExternal(&w); err != nil {
    log.Error(err, "external API failed")
    return ctrl.Result{}, nil   // swallowed
}
```

**Symptom.** Transient failures don't recover. The Widget stays in some halfway state until something else triggers a reconcile.

**Cause.** Returning `(Result{}, nil)` tells the controller "I'm done, no need to re-queue". The error was logged but the work-queue thinks the operation succeeded.

**Fix.** Either return the error (causes a backoff requeue) or use `RequeueAfter` for "I'll try again in 30s":

```go
return ctrl.Result{}, err
// or:
return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
```

Use `RequeueAfter` when you've already classified the failure as "retry later"; let the error path handle the unknown.

---

## Bug 12: `CreateOrUpdate` that never converges

```go
controllerutil.CreateOrUpdate(ctx, r.Client, dep, func() error {
    dep.Spec.Template.Annotations = map[string]string{
        "reconciled-at": time.Now().Format(time.RFC3339),
    }
    return nil
})
```

**Symptom.** The Deployment is updated on every reconcile. The pods restart constantly because the template hash changes every iteration.

**Cause.** The mutator computes a fresh value each call. `CreateOrUpdate` correctly sees a change and writes. The write fires the watch, the watch enqueues the Widget (via `Owns`), the Widget reconciler runs, runs `CreateOrUpdate`, the mutator computes a different timestamp, write — forever.

**Fix.** The mutator must be **a pure function of the inputs** (the parent CR and any reference data). Time-of-day, random values, anything non-deterministic disqualifies a field from being included. If you must capture a timestamp, store it on the *parent's* status, not on the child's spec.

---

## Bug 13: The cache that ate all the memory

```go
mgr, _ := ctrl.NewManager(cfg, ctrl.Options{})
```

The controller watches `&v1.Widget{}` and `Owns(&corev1.Pod{})`.

**Symptom.** In a cluster with 200k Pods, operator pod RSS reaches 4 GiB and OOMKills.

**Cause.** The default cache watches all Pods across all namespaces. Even though the controller only cares about Pods owned by Widgets, the cache stores them all — the `Owns` filtering happens *after* the cache fills.

**Fix.** Label the Widget-owned Pods and watch only those:

```go
Cache: cache.Options{
    ByObject: map[client.Object]cache.ByObject{
        &corev1.Pod{}: {
            Label: labels.SelectorFromSet(labels.Set{"app.kubernetes.io/managed-by": "widget-operator"}),
        },
    },
},
```

Or — if pods are big and you only need labels — `PartialObjectMetadata`:

```go
.Watches(
    &metav1.PartialObjectMetadata{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Pod"}},
    handler.EnqueueRequestsForOwner(mgr.GetScheme(), mgr.GetRESTMapper(), &v1.Widget{}),
)
```

The cache footprint drops 10–50×.

---

## 14. Summary

Operator bugs cluster in a few areas: write-triggers-read echoes (hot loops), missing or wrong owner refs (`Owns` not firing), forgotten finalizers (silent leaks on delete), conflict handling (Update vs Patch vs Apply), cache vs live confusion (race after create), unbounded scopes (cache OOMs), and impure mutators (`CreateOrUpdate` non-convergence). Read each of the above twice; almost every operator incident is a case of one of them.

---

## Further reading
- Common controller pitfalls: https://github.com/cncf/tag-app-delivery/blob/main/operator-wg/whitepaper/operator-whitepaper_v1-0.md
- Server-side apply field tug-of-war: https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts
- Status subresource quirks: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#status-subresource
- Cache scoping: https://book.kubebuilder.io/reference/watching-resources/operator-scope.html
