# controller-runtime — Middle

## 1. From "log it" to "make it real"

A junior reconciler reads an object and logs. A middle-level reconciler observes a custom resource, materializes the dependent resources the user implied (Deployments, Services, ConfigMaps), updates the status to say what's happening, and cleans up on delete.

The shape of every real controller fits one template:

```go
func (r *WidgetReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    log := ctrl.LoggerFrom(ctx)

    var w appsv1alpha1.Widget
    if err := r.Get(ctx, req.NamespacedName, &w); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 1. Finalizer / deletion
    if !w.DeletionTimestamp.IsZero() {
        return r.handleDelete(ctx, &w)
    }
    if err := r.ensureFinalizer(ctx, &w); err != nil {
        return ctrl.Result{}, err
    }

    // 2. Desired children
    if err := r.reconcileDeployment(ctx, &w); err != nil {
        return ctrl.Result{}, err
    }

    // 3. Status
    return ctrl.Result{}, r.updateStatus(ctx, &w)
}
```

Three phases — delete handling, desired-state reconciliation, status — in that order. Memorize this template.

---

## 2. `For`, `Owns`, `Watches`

```go
ctrl.NewControllerManagedBy(mgr).
    For(&appsv1alpha1.Widget{}).
    Owns(&appsv1.Deployment{}).
    Owns(&corev1.Service{}).
    Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(r.mapConfigMap)).
    Complete(r)
```

| Method | Triggers reconcile of... | When... |
|--------|--------------------------|---------|
| `For(&Widget{})` | the Widget itself | the Widget changes |
| `Owns(&Deployment{})` | the *owner* Widget | a Widget-owned Deployment changes |
| `Watches(cm, mapFn)` | whatever `mapFn` returns | the ConfigMap changes |

`Owns` is implemented via owner references: each child's `metadata.ownerReferences` points at the parent. `controllerutil.SetControllerReference` writes that field. Without it, `Owns` cannot find the parent.

---

## 3. Owner references — set them every time

```go
dep := &appsv1.Deployment{
    ObjectMeta: metav1.ObjectMeta{
        Name:      w.Name,
        Namespace: w.Namespace,
    },
    Spec: desiredSpec(&w),
}
if err := controllerutil.SetControllerReference(&w, dep, r.Scheme); err != nil {
    return err
}
```

Why this matters:

1. `Owns` uses the owner ref to map a child event back to the parent's `Request`.
2. Kubernetes garbage-collects the child when the parent is deleted — no cleanup code needed for these.
3. The owner ref encodes "this thing is *mine*" — another controller won't fight over it.

`SetControllerReference` returns an error if a *different* controller already claims this object. That's a feature, not a bug.

---

## 4. `CreateOrUpdate` — the idempotent upsert

```go
desired := &appsv1.Deployment{
    ObjectMeta: metav1.ObjectMeta{Name: w.Name, Namespace: w.Namespace},
}

_, err := controllerutil.CreateOrUpdate(ctx, r.Client, desired, func() error {
    desired.Spec.Replicas = &w.Spec.Replicas
    desired.Spec.Selector = labelSelector(&w)
    desired.Spec.Template = podTemplate(&w)
    return controllerutil.SetControllerReference(&w, desired, r.Scheme)
})
```

What happens inside:

1. `Get` the object from the cache.
2. If found: copy the existing object into `desired`, then call the mutator.
3. If not found: call the mutator on the empty `desired`, then `Create`.
4. If found and the mutator made changes: `Update`.

The function returns `controllerutil.OperationResultCreated`, `Updated`, or `Unchanged`. Useful for metrics.

**Pitfall.** The mutator must set every field you care about. `CreateOrUpdate` does not diff against a "previous desired" — it diffs against the current cluster state and writes whatever your mutator put on the object.

---

## 5. Status updates

Status lives on a separate subresource. A regular `Update` to the parent **does not** write status, and writing both at once with `Update` is forbidden by API-server policy on resources with the status subresource enabled.

```go
w.Status.AvailableReplicas = dep.Status.AvailableReplicas
w.Status.Phase = "Ready"
if err := r.Status().Update(ctx, &w); err != nil {
    return err
}
```

Two patterns to keep status sane:

1. **Patch instead of update** when you only change one field — avoids conflict storms.
2. **Only update if changed** — compare against the fetched object first. Otherwise every reconcile writes status, every status write fires the watch, every event re-runs reconcile → hot loop.

```go
if !equality.Semantic.DeepEqual(w.Status, original.Status) {
    return r.Status().Update(ctx, &w)
}
```

---

## 6. Finalizers — the full pattern

```go
const finalizer = "widgets.example.com/cleanup"

if w.DeletionTimestamp.IsZero() {
    if !controllerutil.ContainsFinalizer(&w, finalizer) {
        controllerutil.AddFinalizer(&w, finalizer)
        return ctrl.Result{}, r.Update(ctx, &w)
    }
} else {
    if controllerutil.ContainsFinalizer(&w, finalizer) {
        if err := r.cleanupExternalResource(ctx, &w); err != nil {
            return ctrl.Result{}, err
        }
        controllerutil.RemoveFinalizer(&w, finalizer)
        if err := r.Update(ctx, &w); err != nil {
            return ctrl.Result{}, err
        }
    }
    return ctrl.Result{}, nil
}
```

Rules:

- The finalizer string is **unique per controller**. Use your domain.
- Add it as the **first action** after fetching the object.
- On delete, the API server sets `deletionTimestamp` but keeps the object alive *as long as any finalizer is present*. Cleanup, then remove the finalizer.
- If you skip the finalizer, your cleanup never runs — Kubernetes deletes the object the instant the user issues `kubectl delete`.

---

## 7. Requeue patterns

```go
// Not ready yet — check in 10s
if !ready(&w) {
    return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
}

// Transient error — let the work-queue back off
if err := r.callExternal(); err != nil {
    return ctrl.Result{}, err
}

// Done; trust events to bring us back
return ctrl.Result{}, nil
```

| Situation | Use |
|-----------|-----|
| Waiting on an external resource | `RequeueAfter: someTime` |
| Polling a slow rollout | `RequeueAfter` with backoff |
| Transient API error | return the error |
| Steady state, no work to do | `Result{}, nil` |

Returning `Result{Requeue: true}` is rarely what you want — it's "re-queue immediately under backoff", which usually just delays the same outcome.

---

## 8. The four-tier RBAC marker set

For a controller that owns Widgets and creates Deployments:

```go
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=apps.example.com,resources=widgets/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=,resources=events,verbs=create;patch
```

| Marker | Why |
|--------|-----|
| `widgets` | Read and modify the CR itself |
| `widgets/status` | Status subresource is separate |
| `widgets/finalizers` | The API server checks this verb when you write `metadata.finalizers` |
| Owned kinds | Whatever you `Owns(...)` |
| `events` | If you emit Kubernetes events via the `EventRecorder` |

`make manifests` (in a Kubebuilder project) runs `controller-gen` on these markers and emits a `ClusterRole` YAML.

---

## 9. Event recorders

```go
r.Recorder.Event(&w, corev1.EventTypeNormal, "Reconciled", "Deployment is ready")
r.Recorder.Eventf(&w, corev1.EventTypeWarning, "FailedScale", "scale failed: %v", err)
```

Get a recorder from the manager:

```go
r.Recorder = mgr.GetEventRecorderFor("widget-controller")
```

Events show up in `kubectl describe widget` and in audit trails. Use them for human-readable lifecycle messages; use logs for debug.

---

## 10. Predicates — quieting the loop

Without filtering, status writes by your own controller re-fire the watch and re-trigger reconcile. Predicates filter at the source.

```go
ctrl.NewControllerManagedBy(mgr).
    For(&appsv1alpha1.Widget{}, builder.WithPredicates(predicate.GenerationChangedPredicate{})).
    Owns(&appsv1.Deployment{}).
    Complete(r)
```

| Predicate | Fires on |
|-----------|---------|
| `GenerationChangedPredicate{}` | `.spec` (or any other generation-tracked field) changes |
| `LabelChangedPredicate{}` | Labels change |
| `AnnotationChangedPredicate{}` | Annotations change |
| `predicate.Funcs{CreateFunc: ..., UpdateFunc: ...}` | Custom logic |

`GenerationChangedPredicate` is the single most useful one — it suppresses the status-write-fires-update echo by definition.

---

## 11. Multiple resources, one controller

`Watches` with a `MapFunc` lets you react to changes in *other* objects. Suppose every Widget references a ConfigMap by name:

```go
func (r *WidgetReconciler) mapConfigMap(ctx context.Context, obj client.Object) []ctrl.Request {
    var list appsv1alpha1.WidgetList
    _ = r.List(ctx, &list, client.InNamespace(obj.GetNamespace()))

    var out []ctrl.Request
    for _, w := range list.Items {
        if w.Spec.ConfigName == obj.GetName() {
            out = append(out, ctrl.Request{NamespacedName: client.ObjectKeyFromObject(&w)})
        }
    }
    return out
}
```

Builder wiring:

```go
.Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(r.mapConfigMap))
```

Whenever a ConfigMap changes, every Widget that references it gets re-queued. The cache makes the listing cheap.

---

## 12. Logging context

```go
log := ctrl.LoggerFrom(ctx).WithValues("widget", req.NamespacedName)
log.Info("reconciling")
```

`LoggerFrom(ctx)` returns the logger the manager injected into the context for this reconcile. It already carries `controller=widget-controller` and `name=...`. Add anything domain-specific with `WithValues`.

---

## 13. Common middle-level mistakes

| Mistake | Effect |
|---------|--------|
| Forgetting `SetControllerReference` | `Owns` doesn't fire on child events |
| Writing status on every reconcile | Hot loop with `predicate.GenerationChangedPredicate` not set |
| Using `Update` for status | Returns "the body of your request is invalid: must not modify status" |
| Skipping `client.IgnoreNotFound` | Deleted objects produce spurious errors and retries |
| Reading after writing in the same reconcile | Cache hasn't seen your write yet — use the returned object or refetch |
| Long-running work inside `Reconcile` | Blocks the work queue; chunk it and re-queue with `RequeueAfter` |
| Returning `Result{Requeue: true}` after success | Re-queues forever |

---

## 14. Summary

A middle-level reconciler is structured: handle deletion via finalizers first, materialize children with `CreateOrUpdate` plus `SetControllerReference`, then update status via the subresource client only when something changed. Filter the event firehose with predicates — `GenerationChangedPredicate` is the default for most controllers. Use `Owns` for kinds your controller authors, `Watches` with a `MapFunc` for everything else. RBAC markers live next to the reconciler and generate the role at build time.

---

## Further reading
- Kubebuilder book — Reconcile and Watches: https://book.kubebuilder.io/cronjob-tutorial/controller-overview.html
- Owner refs and garbage collection: https://kubernetes.io/docs/concepts/architecture/garbage-collection/
- Finalizers: https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/
- `controllerutil` godoc: https://pkg.go.dev/sigs.k8s.io/controller-runtime/pkg/controller/controllerutil
