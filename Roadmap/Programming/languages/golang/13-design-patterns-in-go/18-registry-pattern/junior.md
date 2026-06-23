# Registry — Junior

## 1. What is the Registry pattern?

A **Registry** is a global lookup table: a name maps to an implementation. Code that needs a thing-by-name asks the registry. Code that provides a thing-by-name puts itself into the registry.

The classic Go shape is `database/sql`:

```go
import _ "github.com/lib/pq" // postgres driver registers itself

db, _ := sql.Open("postgres", dsn)
```

The import has no name (`_`), so you can't reference anything from it. But the import still *runs* the package — including its `init()` function, which calls `sql.Register("postgres", &Driver{})`. From then on, the string `"postgres"` resolves to the driver.

The shape is small: a package-level map, an `init()` in each implementer, a name on the consumer's side. Three pieces, used in every major Go codebase.

---

## 2. Prerequisites
- Package `init()` functions and their ordering.
- The blank import `import _ "..."`.
- `map[string]T` and how it's typically guarded by a mutex.
- Interfaces — the registry usually stores an interface, not a concrete type.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Registry** | The map of name → implementation |
| **Register** | A function that adds an entry |
| **Lookup** / **Get** | Resolve a name |
| **`init()` registration** | Implementer's `init()` calls Register |
| **Blank import** | `import _ "pkg"` — only run `init`, don't reference anything |

---

## 4. The minimal Go registry

```go
package codec

type Codec interface {
    Encode(any) ([]byte, error)
    Decode([]byte) (any, error)
}

var (
    mu      sync.Mutex
    codecs  = map[string]Codec{}
)

func Register(name string, c Codec) {
    mu.Lock()
    defer mu.Unlock()
    if _, dup := codecs[name]; dup {
        panic("codec: duplicate registration: " + name)
    }
    codecs[name] = c
}

func Get(name string) (Codec, bool) {
    mu.Lock()
    defer mu.Unlock()
    c, ok := codecs[name]
    return c, ok
}
```

Implementer:

```go
// in codecjson/codec.go
package codecjson

import "myapp/codec"

func init() {
    codec.Register("json", jsonCodec{})
}

type jsonCodec struct{}
func (jsonCodec) Encode(v any) ([]byte, error) { return json.Marshal(v) }
func (jsonCodec) Decode(b []byte) (any, error) { var v any; return v, json.Unmarshal(b, &v) }
```

Consumer:

```go
import _ "myapp/codecjson" // registers itself

c, ok := codec.Get("json")
if !ok { /* unknown codec */ }
b, _ := c.Encode(payload)
```

---

## 5. Why duplicate-panic is the standard

You'll notice the `Register` panics if the name is already taken. This is the convention. Two implementations claiming the same name would silently overwrite each other; a panic at startup is much louder than a "why is my JSON now CBOR?" bug at 3am.

If your use case allows duplicates (test fixtures, plugin replacement), you'll write a separate `OverrideRegister` — but make it the rare path, not the default.

---

## 6. The blank import idiom

The line `import _ "github.com/lib/pq"` is *deliberately* not naming anything. The whole point is:

- The package gets compiled in.
- Its `init()` runs (which calls `sql.Register`).
- No symbols from the package leak into your code.

That's the registry-pattern trade you're making: implementations are wired up *by import*, not by direct reference. Removing a driver = removing the import line.

---

## 7. Real-world analogy

A hotel concierge desk. Hotels send their business cards to the concierge. Guests ask "what hotels are in town?" without knowing how to find any individual hotel. The concierge looks the name up in their drawer.

---

## 8. Where you'll see it in Go

- `database/sql.Register` — DB drivers.
- `image.RegisterFormat` — image decoders (PNG, JPEG, GIF).
- `encoding/gob.Register` — gob types.
- `crypto.RegisterHash` — hash algorithms.
- `expvar.Publish` — exported metrics.
- `prometheus.Register` — Prometheus collectors.
- HTTP routers — `mux.HandleFunc("/path", handler)` is a registry.

---

## 9. Common mistakes

- **No mutex.** `init()` is called sequentially by the runtime, *but* if anything mutates the registry at runtime (test setup, plugin reload), you need locks.
- **Duplicate registration without a panic.** Silent overwrites are nasty.
- **Forgetting the blank import.** Without `import _ "..."`, the implementer's `init()` never runs and Lookup fails.
- **Storing concrete types instead of interfaces.** Now every consumer needs to import the implementer's package — defeats the purpose.
- **Registry mutated after startup.** Goroutines reading the registry at the same time someone is writing it = race.

---

## 10. Summary

A Registry is a package-level `map[string]Interface` with `Register` and `Get`. Implementers call `Register` in their `init()`; consumers use blank imports to wire them in and `Get` to look them up by string name. The pattern decouples consumer code from implementer code: adding a driver is one import line away.

---

## Further reading
- `database/sql` package — canonical Go Registry usage
- `image.RegisterFormat` source
- "How sql.Register works" — Go blog
- `prometheus/client_golang` — registry of metric collectors
