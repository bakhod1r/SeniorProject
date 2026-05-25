# Proxy — Junior

## 1. What is the Proxy pattern?

A **proxy** is a stand-in object that implements the *same interface* as a real object and controls access to it. Callers talk to the proxy as if it were the real thing; the proxy decides what to do before, after, or instead of forwarding the call to the real object.

The four classic uses:
- **Virtual proxy** — delay creating an expensive object until it's actually needed (lazy loading).
- **Protection proxy** — check permissions before allowing a call.
- **Caching proxy** — remember results so repeated calls are cheap.
- **Logging/remote proxy** — record calls, or forward them to an object on another machine.

In Go, a proxy is just a struct that satisfies an interface and holds (a reference to) the real implementation.

---

## 2. Prerequisites
- Interfaces in Go and how a type satisfies one implicitly.
- Struct embedding (helpful but not required).
- Basic understanding of `sync.Once` / `sync.Mutex` for the lazy and concurrent cases.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Subject** | The interface both the real object and the proxy implement |
| **Real Subject** | The actual object doing the work |
| **Proxy** | The stand-in that controls access to the real subject |
| **Virtual proxy** | Defers creation of the real subject until first use |
| **Protection proxy** | Gates access based on permissions |
| **Caching proxy** | Stores and reuses results |

---

## 4. The core idea in code

Start with the interface (the *subject*):

```go
type ImageLoader interface {
    Load(path string) ([]byte, error)
}
```

The real implementation reads from disk:

```go
type DiskLoader struct{}

func (DiskLoader) Load(path string) ([]byte, error) {
    return os.ReadFile(path)
}
```

A **caching proxy** implements the same interface and adds memory:

```go
type CachingLoader struct {
    real  ImageLoader
    cache map[string][]byte
}

func NewCachingLoader(real ImageLoader) *CachingLoader {
    return &CachingLoader{real: real, cache: map[string][]byte{}}
}

func (c *CachingLoader) Load(path string) ([]byte, error) {
    if data, ok := c.cache[path]; ok {
        return data, nil // served from cache
    }
    data, err := c.real.Load(path)
    if err != nil {
        return nil, err
    }
    c.cache[path] = data
    return data, nil
}
```

Callers don't change at all — they accept an `ImageLoader`:

```go
func render(loader ImageLoader, path string) {
    data, _ := loader.Load(path)
    fmt.Println("rendered", len(data), "bytes")
}

func main() {
    loader := NewCachingLoader(DiskLoader{})
    render(loader, "logo.png") // reads disk
    render(loader, "logo.png") // served from cache
}
```

The proxy is invisible to `render`; it just sees an `ImageLoader`.

---

## 5. A virtual (lazy) proxy

Defer building an expensive object until the first real call:

```go
type LazyLoader struct {
    once sync.Once
    real ImageLoader
    init func() ImageLoader
}

func (l *LazyLoader) Load(path string) ([]byte, error) {
    l.once.Do(func() { l.real = l.init() }) // build exactly once
    return l.real.Load(path)
}
```

If nobody ever calls `Load`, the expensive `init` never runs.

---

## 6. Real-world analogies

| Concept | Analogy |
|---------|---------|
| Proxy | A receptionist who screens calls before passing them to the boss |
| Virtual proxy | A "tap to load" thumbnail that fetches the full image only when clicked |
| Protection proxy | A bouncer checking IDs before letting you into the club |
| Caching proxy | A vending machine remembering your last choice |

---

## 7. When you'll see it
- An HTTP client wrapper that adds caching or retries.
- A repository wrapper that checks the caller's role before a query.
- A database connection that's opened lazily on first use.
- Middleware-like wrappers around a service interface.

---

## 8. Proxy vs Decorator (quick contrast)
Both wrap an object behind the same interface. The intent differs:
- **Proxy** *controls access* (whether/when the call reaches the real object).
- **Decorator** *adds behavior* (the call always reaches the real object, plus extra).

The code looks similar; the purpose is the distinguishing factor.

---

## 9. Common mistakes
- Forgetting that the proxy must implement the *exact* interface — otherwise callers can't use it interchangeably.
- A caching proxy with a `map` accessed from multiple goroutines without a mutex — a data race.
- Building the real object eagerly in the constructor, defeating a virtual proxy's purpose.

---

## 10. Summary
A proxy is a same-interface stand-in that controls access to a real object — for caching, lazy creation, permission checks, or logging. In Go it's a struct that satisfies the subject interface and holds the real implementation. Callers never know the difference, which is exactly the point.

---

## Further reading
- Refactoring.Guru — Proxy: https://refactoring.guru/design-patterns/proxy
- `net/http` `RoundTripper` wrappers (real-world proxies)
