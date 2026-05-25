# controller-runtime — Tasks

Thirteen hands-on tasks. Each lists the goal, a starting hint, and acceptance criteria. Work them top to bottom; later tasks build on earlier ones. A `kind` cluster (or `minikube`) is sufficient throughout — no production cluster needed.

---

## Task 1. Scaffold a manager that prints every Deployment change

**Goal.** Write `main.go` that boots a `manager.Manager`, registers one controller for `appsv1.Deployment`, and logs the name on every reconcile.

**Hint.** `ctrl.NewManager`, `ctrl.NewControllerManagedBy(mgr).For(&appsv1.Deployment{}).Complete(...)`, `ctrl.SetupSignalHandler()`.

**Acceptance.**
- `go run .` against a local cluster prints "reconcile {namespace}/{name}" when you `kubectl scale deployment X --replicas=2`.
- The program shuts down cleanly on `Ctrl+C`.
- The reconciler handles `NotFound` via `client.IgnoreNotFound`.

---

## Task 2. Define a `Widget` CRD and reconcile it

**Goal.** Define a CRD `widgets.apps.example.com/v1` with `spec.replicas` and `status.availableReplicas`. Write a reconciler that does nothing yet but reads the Widget and logs its replicas.

**Hint.** Use `kubebuilder init` + `kubebuilder create api --group apps.example.com --version v1 --kind Widget` to scaffold the types and CRD YAML. Or hand-write the types if you prefer.

**Acceptance.**
- `kubectl apply -f config/crd/bases/*.yaml` succeeds.
- `kubectl get widgets` shows your resource.
- The reconciler logs `spec.replicas` when you create or update a Widget.

---

## Task 3. Create a child Deployment from the Widget

**Goal.** When a Widget exists, ensure a matching Deployment exists in the same namespace with `spec.replicas = widget.spec.replicas`.

**Hint.** `controllerutil.CreateOrUpdate` with `controllerutil.SetControllerReference`. Don't `Update` directly.

**Acceptance.**
- Creating a Widget creates a Deployment named after it.
- Editing `widget.spec.replicas` changes the Deployment's replicas within a reconcile cycle.
- The Deployment has an owner reference back to the Widget (verify with `kubectl get deployment X -o yaml | grep -A5 ownerReferences`).

---

## Task 4. Watch the child Deployment via `Owns`

**Goal.** When the Deployment's status changes (e.g., a Pod comes up), reconcile the Widget.

**Hint.** Add `Owns(&appsv1.Deployment{})` to the builder. Verify that deleting a Deployment-owned Pod triggers reconcile.

**Acceptance.**
- Logs show reconcile triggered after `kubectl delete pod {pod}` for a Widget-owned pod.
- Without `Owns`, the same action does not trigger reconcile.

---

## Task 5. Status updates with a diff guard

**Goal.** Write `widget.status.availableReplicas` based on `deployment.status.availableReplicas`. Only call `Status().Update` if the value changed.

**Hint.** `equality.Semantic.DeepEqual`. Use `r.Status().Update(ctx, &w)` — not `r.Update`.

**Acceptance.**
- `kubectl get widget X -o yaml` shows correct `status.availableReplicas`.
- The reconcile rate is bounded — log lines stop appearing once the cluster is in steady state.

---

## Task 6. Add a `GenerationChangedPredicate` and confirm the loop dies

**Goal.** Without the predicate, watch the reconcile-rate metric (or just the log) hot-loop. Add the predicate; watch it stop.

**Hint.** `For(&v1.Widget{}, builder.WithPredicates(predicate.GenerationChangedPredicate{}))`. Confirm with `controller_runtime_reconcile_total` if you've wired metrics.

**Acceptance.**
- Before: reconciles fire constantly even with no user input.
- After: reconciles fire only on real spec changes or child events.
- A separate fix: ensure status writes are diff-guarded (Task 5).

---

## Task 7. Implement a finalizer for external cleanup

**Goal.** Simulate an "external resource" — for example, create a sibling ConfigMap in another namespace when a Widget is created. On Widget delete, ensure the ConfigMap is deleted *before* the Widget is removed.

**Hint.** Use `controllerutil.AddFinalizer` / `RemoveFinalizer`. Standard finalizer pattern; see middle.md §6.

**Acceptance.**
- `kubectl delete widget X` does not remove the Widget immediately — `kubectl get widget X` shows a `deletionTimestamp`.
- The associated ConfigMap is deleted.
- After cleanup, the Widget vanishes.
- If cleanup fails, the Widget stays around (verify by injecting a failure).

---

## Task 8. Add RBAC markers and generate the role

**Goal.** Annotate `Reconcile` with `// +kubebuilder:rbac:...` markers for every resource and verb you use. Run `controller-gen` to emit the role YAML. Apply it.

**Hint.** `make manifests` in a Kubebuilder project. Otherwise `controller-gen rbac:roleName=manager-role paths="./..." output:dir=config/rbac`.

**Acceptance.**
- `kubectl auth can-i list deployments --as=system:serviceaccount:default:manager` returns `yes`.
- Generated `role.yaml` includes `widgets`, `widgets/status`, `widgets/finalizers`, `deployments`, and `configmaps`.

---

## Task 9. Multi-resource watch with a `MapFunc`

**Goal.** Add a `spec.configRef` field to the Widget. Watch ConfigMaps; when a referenced ConfigMap changes, reconcile each Widget that references it.

**Hint.** `Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(r.mapConfig))`. Add a field indexer on `.spec.configRef` so the lookup is O(1).

**Acceptance.**
- Editing a ConfigMap triggers reconcile of every Widget with `spec.configRef = cm.Name`.
- The mapping function is implemented with `client.MatchingFields`, not a linear scan.
- The indexer is registered before `mgr.Start`.

---

## Task 10. Enable leader election and verify with metrics

**Goal.** Deploy the operator with `replicas: 2`. Verify exactly one pod is the leader; on its deletion, the other takes over within ~15s.

**Hint.** `LeaderElection: true`, `LeaderElectionID`, scrape `leader_election_master_status` from each pod's metrics endpoint.

**Acceptance.**
- `kubectl get leases -n widget-system` shows one Lease object with one holder.
- Killing the leader pod (`kubectl delete pod <leader>`) results in the other pod becoming the leader within 15–30 seconds.
- Reconciles do not duplicate during the changeover.

---

## Task 11. Write an `envtest` test for the reconciler

**Goal.** Write a Go test that starts `envtest`, applies the CRD, creates a Widget, and asserts a Deployment is created within 5 seconds.

**Hint.**
```go
testEnv := &envtest.Environment{CRDDirectoryPaths: []string{"../config/crd/bases"}}
cfg, _ := testEnv.Start()
defer testEnv.Stop()
```
Use `Eventually(func() bool { ... })` from `gomega` to poll for the result.

**Acceptance.**
- `go test ./...` boots etcd + kube-apiserver and runs the full reconcile loop.
- The test fails clearly if the Deployment isn't created in time.
- Cleanup runs even when the test fails (use `t.Cleanup` or `defer`).

---

## Task 12. Add a validating webhook

**Goal.** Reject Widgets with `spec.replicas < 0` or `> 100`. Implement an admission webhook; deploy it; verify rejections happen at `kubectl apply` time.

**Hint.** Implement `admission.CustomValidator`. Register with `ctrl.NewWebhookManagedBy(mgr).For(&v1.Widget{}).WithValidator(...).Complete()`. You'll need a TLS certificate — `cert-manager` is the standard option in real clusters; for local dev, scripted self-signed cert + a `ValidatingWebhookConfiguration` with the CA bundle.

**Acceptance.**
- `kubectl apply` with `spec.replicas: -1` is rejected with your validator's message.
- Valid replicas (0–100) are accepted.
- The webhook is registered with `failurePolicy: Fail`.

---

## Task 13. Optimize the cache and re-measure

**Goal.** The controller from Task 9 watches all ConfigMaps cluster-wide. Restrict the cache to a label selector (e.g., `app.kubernetes.io/managed-by: widget-operator`). Measure memory before and after with a load of 10k unrelated ConfigMaps.

**Hint.** `cache.Options.ByObject` with a label selector. Generate 10k ConfigMaps with a quick `kubectl create` loop.

**Acceptance.**
- Before: operator RSS grows roughly linearly with total ConfigMap count.
- After: operator RSS is roughly independent of the unrelated ConfigMaps.
- The controller still reconciles correctly when a *relevant* (correctly labeled) ConfigMap changes.

---

## 14. Summary

Working these tasks end-to-end gives you a controller with: a custom resource, owned child resources via `CreateOrUpdate` + `SetControllerReference`, a diff-guarded status update, a finalizer for cleanup, RBAC and leader election for safety, a cross-resource watch backed by an indexer, an envtest test suite, an admission webhook for validation, and a tuned cache. That is the full skeleton of a real operator — what production projects like cert-manager and ArgoCD do, scaled up.

---

## Further reading
- Kubebuilder book: https://book.kubebuilder.io
- Operator SDK Go tutorial: https://sdk.operatorframework.io/docs/building-operators/golang/tutorial/
- envtest: https://book.kubebuilder.io/reference/envtest.html
- cert-manager source as a real example: https://github.com/cert-manager/cert-manager
