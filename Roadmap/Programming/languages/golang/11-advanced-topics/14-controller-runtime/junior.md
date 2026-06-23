# controller-runtime — Junior

## 1. What is a Kubernetes operator?

Kubernetes is built on a simple idea: you tell it what you want, and a program somewhere makes it true. You write `replicas: 3` in a `Deployment`, and a controller makes sure three pods exist. If one dies, the controller spins up another.

An **operator** is that same idea applied to *your* concept. You define a custom resource — say, `Widget` — and write a controller that knows how to make a Widget real. The controller watches Widgets, sees changes, and acts.

The Go library [`sigs.k8s.io/controller-runtime`](https://pkg.go.dev/sigs.k8s.io/controller-runtime) gives you all the plumbing: how to watch the API server, how to call it back, how to update status, how to elect a leader. You write the *reconcile* function; it does the rest.

---

## 2. The reconcile loop in one sentence

> Observe the current state. Compare it to what the user asked for. Take one step toward closing the gap. Schedule yourself to run again if something changed.

That's the whole pattern. Run it forever. The cluster eventually converges.

Two consequences fall out:

1. **Idempotency matters.** Running the function twice on the same input must produce the same result. Otherwise repeated reconciles drift.
2. **You don't track "what changed".** You read everything every time and react to the world as it is right now. Don't keep state in memory between calls.

---

## 3. Anatomy of a controller program

```go
package main

import (
    ctrl "sigs.k8s.io/controller-runtime"
    "sigs.k8s.io/controller-runtime/pkg/client"
    "sigs.k8s.io/controller-runtime/pkg/log/zap"
    appsv1 "k8s.io/api/apps/v1"
)

func main() {
    ctrl.SetLogger(zap.New())

    mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{})
    if err != nil { panic(err) }

    err = ctrl.NewControllerManagedBy(mgr).
        For(&appsv1.Deployment{}).
        Complete(&DeploymentLogger{Client: mgr.GetClient()})
    if err != nil { panic(err) }

    if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
        panic(err)
    }
}
```

Three pieces:

| Piece | Job |
|-------|-----|
| `ctrl.NewManager` | Loads kubeconfig, starts a shared cache, exposes metrics and health |
| `NewControllerManagedBy(mgr).For(...).Complete(r)` | Tells the manager to watch a kind and call `r.Reconcile` |
| `mgr.Start(ctx)` | Blocks. Runs informers, controllers, webhooks, leader election |

`ctrl.GetConfigOrDie()` finds the kubeconfig automatically — `$KUBECONFIG`, `~/.kube/config`, or in-cluster token if running inside a pod.

---

## 4. Your first reconciler

```go
type DeploymentLogger struct{ client.Client }

func (r *DeploymentLogger) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    var dep appsv1.Deployment
    if err := r.Get(ctx, req.NamespacedName, &dep); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    log := ctrl.LoggerFrom(ctx)
    log.Info("saw deployment", "name", dep.Name, "replicas", *dep.Spec.Replicas)
    return ctrl.Result{}, nil
}
```

Things to notice:

- **`req` is just the namespace and name.** The controller hands you a coordinate; you fetch the object yourself.
- **`client.IgnoreNotFound`** turns "object was deleted before you got here" into a non-error. Very common — the deletion event arrives slightly before the cache update.
- **No return value besides `Result` and `error`.** You don't return the object; you write it back through the client.

---

## 5. The shape of `Result` and `error`

| Return | What happens next |
|--------|-------------------|
| `(ctrl.Result{}, nil)` | Done. The controller waits for the next watch event. |
| `(ctrl.Result{}, err)` | The work-queue re-queues this `Request` with exponential backoff. |
| `(ctrl.Result{Requeue: true}, nil)` | Re-queue immediately (still under backoff). |
| `(ctrl.Result{RequeueAfter: 30 * time.Second}, nil)` | Re-queue after 30 seconds. No backoff. |

`RequeueAfter` is the idiom for "I'm waiting for something external — check again in a bit."

---

## 6. Running locally

You don't need a real cluster to get started — but you do need *some* cluster, because the operator talks to a real Kubernetes API. Two options:

```bash
# kind: a local Kubernetes in a Docker container
kind create cluster

# minikube
minikube start
```

Then build and run:

```bash
go run ./cmd/operator
```

Your controller will use whatever `kubectl config current-context` points at. Watch logs while you `kubectl create deployment nginx --image=nginx` — your reconciler will fire.

To shut down cleanly, `Ctrl+C` triggers the signal handler returned by `ctrl.SetupSignalHandler()`. The manager cancels its context, controllers drain, and the program exits.

---

## 7. Reading vs. writing through the client

```go
// READ — comes from the in-memory cache, very fast
var pod corev1.Pod
err := r.Get(ctx, req.NamespacedName, &pod)

// WRITE — goes to the API server
pod.Annotations["seen"] = "yes"
err = r.Update(ctx, &pod)
```

The cache is filled by an *informer* that watches the API server. Reads are near-instant; writes go over the wire. When you write, the API server pushes the change back to your informer, which updates the cache, which triggers your reconciler again. **The system feeds itself events.**

That's why you must not write something on every reconcile — you'll loop forever. Only write when the cluster is missing something you want it to have.

---

## 8. Your first custom resource

A real operator manages a kind you defined. Define it as a Go struct:

```go
type Widget struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`

    Spec   WidgetSpec   `json:"spec,omitempty"`
    Status WidgetStatus `json:"status,omitempty"`
}

type WidgetSpec struct {
    Replicas int32 `json:"replicas"`
}

type WidgetStatus struct {
    AvailableReplicas int32 `json:"availableReplicas"`
}
```

You also need a CRD YAML so the API server learns the kind exists. `kubebuilder` or `operator-sdk` will scaffold both. For now, know that `Spec` is what the *user* writes and `Status` is what the *controller* writes back.

---

## 9. The cache is eventually consistent

The most surprising thing for newcomers:

```go
r.Create(ctx, &pod)
r.Get(ctx, key, &pod)   // may say "not found"
```

You just created the pod, but the local cache hasn't seen the watch event yet. The reconcile pattern handles this naturally — you'll be called again when the event arrives. **Don't add `time.Sleep`s to wait for visibility.** Trust the loop.

If you really need a fresh read (e.g., immediately before a status update), use `mgr.GetAPIReader()` — it goes straight to the API server and skips the cache.

---

## 10. Three rules to start with

1. **Never assume the world hasn't changed.** Always `Get` at the top of `Reconcile`.
2. **Write only what you need to.** Every write is a potential reconcile trigger.
3. **Return errors when you mean "retry me".** Return `nil` when you're satisfied with the current state.

Follow these and you can't write a bad operator. Break them and your controller starts a hot loop in production.

---

## 11. Summary

A Kubernetes operator is a Go program that watches custom resources and reconciles them with the desired state. The `controller-runtime` library provides a **manager** (boots everything), a **client** (cache-backed reads, API-server writes), and a **builder** (`NewControllerManagedBy`) that wires a kind to your `Reconcile` function. Your job is to write an idempotent function of the form `Reconcile(ctx, req) (Result, error)` — observe, diff, act, optionally requeue.

---

## Further reading
- controller-runtime godoc: https://pkg.go.dev/sigs.k8s.io/controller-runtime
- Kubebuilder book — "Quick Start": https://book.kubebuilder.io/quick-start.html
- Operator pattern: https://kubernetes.io/docs/concepts/extend-kubernetes/operator/
- Sample controller (client-go): https://github.com/kubernetes/sample-controller
