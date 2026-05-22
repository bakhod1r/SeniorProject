# Proxy — Specification

> **Focus:** A precise reference for the Proxy pattern as applied in Go — definition, structure, the interface contract, variation semantics, and the standard-library realizations.
>
> **Sources:**
> - Gang of Four, *Design Patterns* (1994) — Proxy
> - Refactoring.Guru — https://refactoring.guru/design-patterns/proxy
> - Go `net/http` `RoundTripper` — https://pkg.go.dev/net/http#RoundTripper

---

## 1. Definition

> "Proxy is a structural design pattern that lets you provide a substitute or placeholder for another object. A proxy controls access to the original object, allowing you to perform something either before or after the request gets through to the original object." — Refactoring.Guru

In Go terms: a Proxy is a type that **implements the same interface** as a Real Subject and holds a reference to it (or the means to create it), interposing logic on the calls.

---

## 2. Participants

| Participant | Role | Go realization |
|-------------|------|----------------|
| **Subject** | The common interface | a Go `interface` |
| **RealSubject** | The actual implementation | a struct implementing the interface |
| **Proxy** | Same-interface stand-in controlling access | a struct (or func-adapter) implementing the interface, holding the RealSubject |
| **Client** | Uses the Subject interface | any code depending on the interface |

---

## 3. Structural contract

The defining invariant:

```
Proxy implements Subject   AND   Proxy holds a Subject (the RealSubject)
```

Because the Proxy *is a* `Subject` and *has a* `Subject`, it can be substituted anywhere the interface is expected and can be stacked with other proxies.

```go
type Subject interface {
    Request(ctx context.Context, in In) (Out, error)
}

type Proxy struct {
    real Subject // the RealSubject (or another proxy)
}

func (p Proxy) Request(ctx context.Context, in In) (Out, error) {
    // pre-processing (auth, cache check, log, lazy init)
    out, err := p.real.Request(ctx, in) // optional forward
    // post-processing (cache store, metrics)
    return out, err
}
```

---

## 4. Variation semantics

| Variation | Pre-call | Forwards? | Post-call |
|-----------|----------|-----------|-----------|
| **Virtual** | build RealSubject if absent | yes | — |
| **Protection** | check permission | only if allowed | — |
| **Caching** | lookup cache | only on miss | store result on success |
| **Logging/metrics** | record start | always | record end/duration |
| **Remote** | serialize request | over the network | deserialize response |

A single proxy SHOULD implement exactly one variation; combinations are achieved by stacking.

---

## 5. Behavioral rules

### 5.1 Interface fidelity
A Proxy MUST implement the Subject interface exactly. Adding or removing methods breaks substitutability.

### 5.2 Transparency
Clients MUST NOT need to know whether they hold a Proxy or the RealSubject for normal operation. Any required out-of-band control (e.g., cache flush) is a deviation that MUST be documented.

### 5.3 Forwarding fidelity
A Proxy MUST propagate `context.Context`, errors, and return values faithfully unless its variation explicitly transforms them (e.g., a protection proxy returning `ErrForbidden`).

### 5.4 Concurrency
If the RealSubject is safe for concurrent use, the Proxy MUST be too. Added state (cache, lazy slot, counters) MUST be synchronized.

### 5.5 Failure caching
A caching/lazy Proxy MUST decide explicitly whether to cache failures. Default: cache only successful results.

---

## 6. Proxy vs related patterns

| Pattern | Same interface? | Intent |
|---------|-----------------|--------|
| **Proxy** | yes | control access to one object |
| **Decorator** | yes | add behavior; always forwards |
| **Adapter** | no (converts interface) | make an incompatible interface usable |
| **Facade** | no (new, simpler interface) | simplify a subsystem |

Proxy and Decorator are structurally identical; intent distinguishes them (control access vs add behavior).

---

## 7. Standard-library realizations

| Stdlib element | Proxy role |
|----------------|------------|
| `http.RoundTripper` wrappers | caching/retry/auth proxies over HTTP transport |
| `io.LimitedReader` | a protection-ish proxy capping bytes read |
| `httptest.NewServer` + reverse proxy (`httputil.ReverseProxy`) | remote proxy |
| Lazily-opened `sql.DB` (connection established on first use) | virtual proxy behavior |

`httputil.ReverseProxy` is the textbook remote proxy: it implements `http.Handler` and forwards requests to an upstream.

---

## 8. Idiomatic Go forms

- **Struct proxy:** explicit forwarding, required for multi-method or policy-enforcing proxies.
- **Func-adapter:** for single-method interfaces (`RoundTripperFunc`-style) plus a `WithX(next) Subject` constructor.
- **Embedding:** auto-forwards; acceptable ONLY for pure observation, never for policy (new methods bypass control).

---

## 9. Compliance checklist
- [ ] Proxy implements the Subject interface exactly
- [ ] Holds the RealSubject (or a factory for it)
- [ ] Single variation per proxy; combinations via stacking
- [ ] `context`, errors, and values forwarded faithfully
- [ ] Added state is concurrency-safe
- [ ] Caching proxies invalidate on writes and bound their size
- [ ] Failure-caching behavior is explicit
- [ ] No embedding for policy-enforcing proxies
- [ ] Stack order documented at the composition root

---

## 10. Minimal reference implementation

```go
type Subject interface {
    Do(ctx context.Context, key string) (string, error)
}

type real struct{}
func (real) Do(_ context.Context, key string) (string, error) { return "value:" + key, nil }

type cachingProxy struct {
    real Subject
    mu   sync.RWMutex
    m    map[string]string
}

func NewCachingProxy(r Subject) *cachingProxy {
    return &cachingProxy{real: r, m: map[string]string{}}
}

func (p *cachingProxy) Do(ctx context.Context, key string) (string, error) {
    p.mu.RLock()
    if v, ok := p.m[key]; ok {
        p.mu.RUnlock()
        return v, nil
    }
    p.mu.RUnlock()

    v, err := p.real.Do(ctx, key)
    if err != nil {
        return "", err
    }
    p.mu.Lock()
    p.m[key] = v
    p.mu.Unlock()
    return v, nil
}

var _ Subject = (*cachingProxy)(nil) // compile-time interface check
```

---

## 11. Related references
- GoF *Design Patterns*, Proxy (structural)
- Refactoring.Guru — https://refactoring.guru/design-patterns/proxy
- `net/http` RoundTripper — https://pkg.go.dev/net/http#RoundTripper
- `net/http/httputil` ReverseProxy — https://pkg.go.dev/net/http/httputil#ReverseProxy
- `golang.org/x/sync/singleflight` — https://pkg.go.dev/golang.org/x/sync/singleflight
