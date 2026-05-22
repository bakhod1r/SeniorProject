# Proxy — Interview

**Q1 (Junior):** What is the Proxy pattern?
A stand-in object that implements the same interface as a real object and controls access to it — for lazy creation, permission checks, caching, or logging. Callers can't tell the proxy from the real object.

**Q2 (Junior):** Name the main proxy variations.
Virtual (lazy creation), protection (access control), caching (reuse results), and remote/logging (forward or observe calls).

**Q3 (Junior):** In Go, what does a proxy need to be usable in place of the real object?
It must implement the exact same interface the real object does, so any code accepting that interface accepts the proxy.

**Q4 (Junior):** How is Proxy different from Decorator?
Both wrap a same-interface object. Proxy *controls access* (the call may not reach the real object); Decorator *adds behavior* (the call always reaches the real object, plus extra). Intent differs, structure is similar.

**Q5 (Middle):** Your caching proxy uses a `map`. What's the bug under concurrency?
A data race — concurrent reads/writes to a map panic or corrupt. Guard with a `sync.RWMutex` (or use `sync.Map` / a concurrent LRU).

**Q6 (Middle):** A caching proxy serves stale data after a delete. Why?
The mutating method didn't invalidate the cache. Every write (`Delete`, `Update`) must purge or refresh affected entries.

**Q7 (Middle):** When you stack Logging → Protection → Caching → Real, why does order matter?
Each layer sees only what the layers above pass down. Logging outermost logs cache hits too; protection above caching means denied calls never populate the cache. The order encodes behavior.

**Q8 (Middle):** Why can't you always use `sync.Once` for a virtual proxy?
`Once.Do` can't return an error. If lazy init can fail and you want retry, use a mutex-guarded getter that doesn't cache the failure. `sync.OnceValue` caches failure permanently.

**Q9 (Senior):** Show an idiomatic single-method proxy in Go.
A func-adapter, like `http.RoundTripperFunc`: a function type with a method satisfying the one-method interface, wrapped by a higher-order function (`WithCache(next) RoundTripper`). No boilerplate struct.

**Q10 (Senior):** 100 goroutines miss the cache for the same key simultaneously. What happens and how do you fix it?
A naive caching proxy makes 100 backend calls (thundering herd). Wrap the miss path in `golang.org/x/sync/singleflight` so one call serves all waiters.

**Q11 (Senior):** Why is embedding the subject interface dangerous in a protection proxy?
Embedding auto-forwards all methods. If the interface gains a method, the proxy forwards it *ungated*, silently bypassing the access control — a security hole. Use explicit forwarding for policy proxies.

**Q12 (Senior):** What latency failure mode does a virtual/remote proxy introduce?
A cheap-looking method call can trigger expensive lazy initialization or a network round trip on first use — a surprising cold-start spike. Warm it at startup and document the hidden cost.

**Q13 (Professional):** When would you NOT introduce a proxy?
When only one method needs the behavior (inline it), when the concern is really business logic for the real subject, when an existing library already provides it, or when the indirection obscures a frequently profiled hot path.

**Q14 (Professional):** What do you check when reviewing a caching proxy?
Concurrency safety, invalidation on writes, intentional (or absent) failure caching, a bounded size with a metric, singleflight on misses, context propagation, and that it isn't a god-object doing five concerns at once.

---

## Traps to avoid
- Calling any wrapper a "proxy" — if it adds behavior rather than controlling access, it's a decorator.
- Forgetting the concurrency story for added state.
- Caching errors by accident (or failing to cache them when you should).
- Using embedding for a proxy that enforces policy.

## How to defend the design choice
"I used a proxy to centralize authorization across the whole `Store` interface so no handler can forget the check, and so adding a method forces an explicit guard decision. It's transparent to callers, independently unit-testable with a fake store, and one concern only — caching and logging are separate proxies stacked around it."
