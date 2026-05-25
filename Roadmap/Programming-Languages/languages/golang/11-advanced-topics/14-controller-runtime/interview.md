# controller-runtime — Interview

Twenty questions interviewers ask Go engineers building Kubernetes operators. Brief, opinionated answers in the style senior engineers actually use in conversation.

---

## Q1. What is an operator, and how is it different from a controller?

A **controller** is a control loop that reconciles a kind of resource. A **operator** is one or more controllers plus the CRDs they reconcile, packaged and deployed as an application that extends Kubernetes' API.

Said differently: every operator contains controllers; not every controller is part of an operator. The kubelet, the scheduler, and `kube-controller-manager` are all controllers but not operators.

---

## Q2. Describe the reconcile loop in one paragraph.

Reconcile receives a `Request{NamespacedName}` from the work-queue, fetches the current object from the cache, compares it to desired state (encoded in the spec), and takes one step toward closing the gap — typically creating, updating, or patching dependent resources. It returns a `Result` indicating whether to requeue and an `error` indicating whether to backoff. It must be idempotent: two reconciles with the same input must converge to the same state.

---

## Q3. What does `manager.Manager` actually do?

It owns the cache, the client, the work-queue infrastructure, leader election, the webhook server, metrics, and health endpoints. Controllers, runnables, and webhooks register with it; `mgr.Start(ctx)` boots them in dependency order and shuts them down on context cancellation.

Crucially, the manager owns **one cache shared by all controllers** — so two controllers watching the same kind cost one informer, not two.

---

## Q4. Cache client vs. API reader — when do you pick which?

The cache client (`mgr.GetClient()`) reads from the in-memory informer cache. Fast, free, eventually consistent. Use it everywhere in `Reconcile`.

The API reader (`mgr.GetAPIReader()`) reads straight from the API server. Slow, costs QPS, strongly consistent. Use it for:

- Verifying a write you just made.
- Webhook handlers (no cache available yet).
- Reading kinds not watched by the manager.
- Reading rare objects across many namespaces where caching would explode.

---

## Q5. What's the difference between `For`, `Owns`, and `Watches`?

| Builder method | Watches | Enqueues |
|----------------|---------|----------|
| `For(kind)` | kind | the changed object itself |
| `Owns(child)` | child | the **owner** found via `metadata.ownerReferences` |
| `Watches(src, handler)` | source | whatever `handler` returns |

`For` defines the primary kind. `Owns` is for children whose owner-ref points back at the primary. `Watches` is for anything else, including cross-namespace lookups via `EnqueueRequestsFromMapFunc`.

---

## Q6. Why must `Reconcile` be idempotent?

Because the work-queue can deliver the same `Request` more than once — on watch retries, on cache resync, on rate-limited requeue, on the controller's own writes triggering events. If two reconciles with identical input produce different outputs, the cluster oscillates.

Idempotency is what lets the system converge despite events being unreliable. Don't fight that — embrace it.

---

## Q7. What does `controllerutil.CreateOrUpdate` do internally?

It `Get`s the object by namespaced name. If `NotFound`: calls your mutator on the empty object, then `Create`s. If found: copies the existing object's state, calls your mutator on it, and if the mutator changed anything, `Update`s. Returns `OperationResultCreated`, `Updated`, or `Unchanged`.

The mutator must be a pure function of inputs — random values, timestamps, anything time-dependent will cause `Update` on every reconcile.

---

## Q8. Explain owner references and `SetControllerReference`.

`metadata.ownerReferences` is a list of pointers to other objects ("I belong to these"). Kubernetes' garbage collector deletes an object when its owners are deleted (with `BlockOwnerDeletion`).

`SetControllerReference` adds a special kind of owner ref — `controller: true`. There's only one controller owner per object. `Owns` uses this ref to find the parent and enqueue its reconcile. Without `SetControllerReference`, `Owns` doesn't fire.

---

## Q9. How do finalizers work?

A finalizer is a string in `metadata.finalizers`. While *any* finalizer is present, `kubectl delete` only sets `metadata.deletionTimestamp` — the object stays in the API. Kubernetes deletes the object only when the finalizers list is empty.

Controllers use this to ensure cleanup runs. Standard pattern: add the finalizer on first reconcile; on reconciles with non-zero `deletionTimestamp`, do cleanup, remove the finalizer, and `Update`. The next watch event arrives because the API server's deletion goes through, and `Reconcile` returns `NotFound` and exits via `client.IgnoreNotFound`.

---

## Q10. What is `GenerationChangedPredicate` and why is it almost always used?

`metadata.generation` is bumped by the API server whenever `.spec` (or a few similar fields) is changed. Status writes don't bump it.

`GenerationChangedPredicate` filters out events where generation didn't change — i.e., status-only or metadata-only updates. Using it on `For` cuts the echo from your own `Status().Update` calls, which is the #1 cause of operator hot loops.

It's not always right — if you depend on label or annotation changes, you need a different predicate — but it's the default for the primary kind.

---

## Q11. How is concurrency controlled in a controller?

`controller.Options.MaxConcurrentReconciles` (default 1) bounds the number of reconciles in flight for one controller. The work-queue ensures only one reconcile per **key** at any time — even if you raise concurrency, the same object is never reconciled twice in parallel.

So concurrency only helps across different objects. For a controller managing thousands of CRs with slow reconciles, raising to 5–20 helps; raising it for a single-object controller does nothing.

---

## Q12. What happens on a 409 Conflict from `Update`?

It means the local `resourceVersion` was stale — the API server saw a newer version. Default behavior: return the error from `Reconcile`, the work-queue re-queues with backoff, the next reconcile fetches the new version, the conflict resolves naturally.

Alternative: `retry.RetryOnConflict(...)` does a re-`Get` + retry within the same reconcile. Use it for operations that must succeed inline (setting a finalizer before destructive work). Most code should just return the error.

---

## Q13. How do you avoid the "I wrote it, but my next Get says NotFound" problem?

The cache lags behind the API server. After `Create` returns, the cache hasn't seen the new object yet.

Three approaches:

1. **Use the returned object.** `Create(ctx, obj)` populates `obj`'s UID and resourceVersion. Don't re-`Get`.
2. **Trust the loop.** The cache will see the watch event very soon; your reconciler will be called again.
3. **`APIReader`.** If you absolutely need a fresh read inline, use `mgr.GetAPIReader().Get(...)`.

The right answer is almost always #1 or #2.

---

## Q14. How do you cache only some objects of a kind?

Set a label selector in `cache.Options.ByObject`:

```go
ByObject: map[client.Object]cache.ByObject{
    &corev1.Secret{}: {Label: labels.SelectorFromSet(...)},
},
```

The selector is applied to the `LIST`/`WATCH` request — the API server filters server-side, and the cache only sees matching objects. Get/List for non-matching objects via the cache return NotFound; use the API reader for those.

For "labels-only" watches, also consider `PartialObjectMetadata` — it stores only `ObjectMeta`, often 90% smaller than the full object.

---

## Q15. What is a field indexer and when do you need one?

A field indexer adds a secondary index to the cache, keyed on a function of the object:

```go
mgr.GetFieldIndexer().IndexField(ctx, &v1.Widget{}, ".spec.configRef",
    func(o client.Object) []string { return []string{o.(*v1.Widget).Spec.ConfigRef} })
```

Then `List(ctx, &list, client.MatchingFields{".spec.configRef": "x"})` runs in O(1) instead of O(N).

You need one whenever a `Watches` `MapFunc` needs to list by a non-name field — without it, every event triggers a full-cache scan, and the operator melts under realistic load.

---

## Q16. Why use server-side apply in a controller?

Two reasons:

1. **Field-level coexistence.** Multiple controllers can co-own different fields of the same object. SSA tracks ownership per field via the field manager string.
2. **Declarative intent.** You patch only the fields you set; everything else is untouched. Eliminates the "I read the object, modified one field, and clobbered another controller's changes" problem.

Use `r.Patch(ctx, obj, client.Apply, client.FieldOwner("my-controller"))`. The patched object must have `TypeMeta` set.

---

## Q17. Explain leader election in controller-runtime.

When `LeaderElection: true`, every manager instance competes for a Lease in the API server. The winner runs leader-elected runnables (controllers); losers run non-leader-elected runnables only (webhook server, metrics).

The active leader renews its lease every `RenewDeadline`; if it fails for `LeaseDuration`, candidates can take over. With `ReleaseOnCancel: true`, a graceful shutdown releases the lease immediately.

Without leader election, two replicas both process events and race on writes — split-brain. Always enable it for `replicas >= 2`.

---

## Q18. How would you test a reconciler?

Three layers, lightest first:

1. **Unit test the pure logic.** Build a `WidgetReconciler` with a fake client (`fake.NewClientBuilder().WithObjects(...).Build()`), call `Reconcile`, assert on the resulting cluster state.
2. **Integration test with `envtest`.** Boots a real kube-apiserver + etcd in-process. CRDs, validation, RBAC — all real. The controller runs against it.
3. **End-to-end on a `kind` cluster.** Deploys the operator and a representative workload; asserts on observed behavior.

`envtest` is the sweet spot for controller logic; `kind` for webhooks, RBAC, and rollouts.

---

## Q19. What is the workqueue's rate limiter and why does it matter?

The default `workqueue.DefaultControllerRateLimiter()` combines:

- **Per-item exponential backoff**: `5ms × 2^n`, capped at 1000s. Each consecutive failure for an item delays it more.
- **Token bucket**: 10 qps with burst 100, shared across all items in the controller.

This prevents a broken reconciler from hammering the API server. A controller that fails 1000 reconciles in a second isn't a DDoS — the rate limiter spreads them out.

Tune it (`controller.Options.RateLimiter`) only when you have a specific reason; the defaults are good.

---

## Q20. What is the difference between `Update`, `Patch`, and `Apply`?

| Method | Sends | Conflict on stale RV | Field ownership |
|--------|-------|-----------------------|-----------------|
| `Update` | Full object | Yes — 409 | Whole-object |
| `Patch` (merge or strategic) | Only the change | Only if you use `WithOptimisticLock` | Whole-object |
| `Patch(..., client.Apply, FieldOwner)` (SSA) | Only the fields set | Field-level — only conflicts if another manager owns the same field | Per-field |

Default to `Patch` (merge) for status and small edits, `Apply` for declarative ownership of multiple fields, and `Update` only when you need the atomic-whole-object semantics (e.g., finalizers list).

---

## 21. Summary

The core controller-runtime interview probes the operator pattern (idempotent reconcile), the cache architecture (eventually consistent shared informers), the builder model (`For`, `Owns`, `Watches`), and the write semantics (Update vs. Patch vs. Apply, with conflicts). Production candidates are also expected to know leader election, finalizer protocol, predicate filtering for hot-loop prevention, and envtest for integration testing. The thread underneath all of it: **a reconciler is a function of cluster state, not a function of events**.

---

## Further reading
- Sample reconciler walkthrough: https://book.kubebuilder.io/cronjob-tutorial/controller-overview.html
- controller-runtime tests as examples: https://github.com/kubernetes-sigs/controller-runtime/tree/main/examples
- KEP-1623 (Server-side apply): https://github.com/kubernetes/enhancements/tree/master/keps/sig-api-machinery/555-server-side-apply
- Operator pattern docs: https://kubernetes.io/docs/concepts/extend-kubernetes/operator/
