# sync.Map — Specification

## Table of Contents
1. [Scope](#scope)
2. [Type Definition](#type-definition)
3. [Method Contracts](#method-contracts)
4. [Memory Model Guarantees](#memory-model-guarantees)
5. [Constraints on Keys and Values](#constraints-on-keys-and-values)
6. [Behaviour of Range](#behaviour-of-range)
7. [Forbidden Operations](#forbidden-operations)
8. [Panics](#panics)
9. [Compatibility and Versioning](#compatibility-and-versioning)
10. [References](#references)

---

## Scope

This document records the public contract of `sync.Map` as it stands in Go 1.22. It restates the spec in implementer- and reviewer-oriented prose. Anything not stated here is unspecified and may change.

---

## Type Definition

```go
package sync

type Map struct {
    // unexported fields
}
```

`Map` is a struct. Its zero value is a usable empty map; no constructor is required.

`Map` must not be copied after first use. A copy is undefined behaviour and detectable by `go vet`'s `copylocks` analyzer.

---

## Method Contracts

### `Load(key any) (value any, ok bool)`

Returns the value stored for `key` and `true`, or the zero value of `any` and `false` if `key` is not present.

Concurrency: safe to call from multiple goroutines.

Side effects: may increment an internal misses counter and, after enough misses, trigger an internal map promotion. Observable only through performance.

### `Store(key, value any)`

Sets the value for `key` to `value`, overwriting any prior value.

Concurrency: safe to call from multiple goroutines.

Memory model: a `Store(k, v)` synchronises with any later `Load(k)` that observes `v` (or any later operation that, via the synchronisation order, follows that Load).

### `LoadOrStore(key, value any) (actual any, loaded bool)`

If `key` is present, returns `(currentValue, true)` without modifying the map. Otherwise stores `value` and returns `(value, false)`.

The check and the store are atomic with respect to other operations on the same `Map`.

Concurrency: safe to call from multiple goroutines. If multiple goroutines call `LoadOrStore` concurrently with the same absent key, exactly one wins (returns `loaded == false`) and all others observe its value.

### `LoadAndDelete(key any) (value any, loaded bool)`

If `key` is present, removes it and returns `(currentValue, true)`. Otherwise returns `(nil, false)`.

The load and the delete are atomic.

Concurrency: safe to call from multiple goroutines. If multiple goroutines call `LoadAndDelete` for the same key, exactly one observes `loaded == true`.

### `Delete(key any)`

Removes `key` if present. No return value.

Equivalent in effect to `LoadAndDelete(key)` with the return values discarded.

### `Range(f func(key, value any) bool)`

Calls `f` sequentially for each key-value pair currently in the map.

- No key is visited more than once during a single `Range` call.
- If `f` returns `false`, `Range` stops.
- The order of visits is unspecified.
- If a key-value pair is stored or deleted concurrently (including by `f` itself), `Range` may reflect any value for that key from any point during the call, including the new value, the old value, or no entry at all.
- A key inserted after `Range` begins may or may not be visited.

`Range` does not provide a consistent snapshot. It is not transactional. It does not lock the map for its duration.

`Range` is O(n) in the number of entries visited.

### `Swap(key, value any) (previous any, loaded bool)` (Go 1.20+)

Sets the value for `key` to `value`, returning the previous value and `true` if the key was present, or `(nil, false)` otherwise.

Atomic with respect to other operations on the same key.

### `CompareAndSwap(key, old, new any) (swapped bool)` (Go 1.20+)

If the value stored for `key` is equal to `old` (using `==`), replaces it with `new` and returns `true`. Otherwise returns `false`.

Returns `false` if the key is absent.

The comparison and the store are atomic.

### `CompareAndDelete(key, old any) (deleted bool)` (Go 1.20+)

If the value stored for `key` is equal to `old`, deletes the entry and returns `true`. Otherwise returns `false`.

Returns `false` if the key is absent.

The comparison and the delete are atomic.

---

## Memory Model Guarantees

`sync.Map` operations are synchronising operations as defined by the Go memory model.

Specifically:

- A `Store(k, v)` synchronises before any operation that observes the stored value via `Load(k)` or `Range`.
- A successful `LoadOrStore` that inserts a value provides the same synchronisation as `Store`.
- A successful `LoadAndDelete` synchronises with the next operation on the same key that observes the absence.
- A successful `CompareAndSwap` provides the same synchronisation as `Store`.
- The callback invoked by `Range` for a given key-value pair sees writes to that value that happened before the corresponding `Store`.

The synchronisation is per-key. Two stores to different keys may be observed in either order by different goroutines.

There is no guarantee of any global ordering across the map. A `Range` does not synchronise with all prior stores.

---

## Constraints on Keys and Values

### Keys

- Keys must be comparable in the sense of the Go specification (work with `==`).
- Non-comparable key types (functions, slices, maps, channels via certain operations) cause a runtime panic during the underlying hash operation.
- The compiler does *not* enforce key comparability because the API uses `any`. Misuse is a runtime error.
- Two keys are considered equal iff `==` returns `true`. This includes the usual Go quirks: NaN is not equal to itself, so storing under a NaN key is permitted but the key can never be retrieved.

### Values

- Values may be any type, including `nil`.
- A stored `nil` value is distinguishable from a missing key only via the `ok`/`loaded` return value.
- For `CompareAndSwap` and `CompareAndDelete`, the value type must be comparable; non-comparable values cause a runtime panic during the comparison.
- Storing typed nils (e.g., a `nil` of type `*Foo`) stores the typed nil; `Load` returns the typed nil with `ok == true`.

---

## Behaviour of Range

The `Range` method has the most subtle contract in the package. Its semantics:

- **Visits**: each key present in the map at some point during the call is visited at most once. Visits do not repeat.
- **Concurrency**: `Range` does not lock the map. Other goroutines may store, delete, swap, and otherwise modify entries during the call.
- **Observed values**: for a visited key, the value passed to `f` may be any value that was stored under that key at some point during the `Range` call. It is not guaranteed to be the most recent.
- **Insertions**: a key inserted after `Range` began may or may not be visited.
- **Deletions**: a key deleted after `Range` began may or may not be visited; if it is visited, the value observed may or may not be the deleted value.
- **Termination**: returning `false` from `f` stops iteration immediately.
- **Re-entrancy**: calling map methods from inside `f` is permitted but their interaction with the in-progress iteration is implementation-defined.

`Range` should not be used to obtain an atomic snapshot of the map. If a snapshot is required, use a different data structure protected by a `RWMutex`.

---

## Forbidden Operations

The following are unsupported and lead to undefined behaviour:

1. **Copying a `Map` after first use.** Pass by pointer.
2. **Wrapping a `Map` in another struct that gets copied.** Same problem.
3. **Storing a `Map` value (not pointer) in another `sync.Map`.** Each copy is undefined.
4. **Concurrent access from another `sync.Map` instance treated as the same.** They are independent.
5. **Calling methods on a `Map` value that has been `*m = sync.Map{}` reassigned.** Reset by replacing the entire variable atomically if needed, or using a fresh instance.

There is no `Reset` or `Clear` method. To clear, replace the `Map` instance (e.g., `m = &sync.Map{}` if behind a pointer) or call `Range` and `Delete` each key — the latter is racy if writers are active.

---

## Panics

The following invocations panic at runtime:

- `Store(k, _)`, `Load(k)`, etc. with a non-comparable `k`. Panic message: `runtime error: hash of unhashable type ...`.
- `CompareAndSwap(_, old, _)` or `CompareAndDelete(_, old)` where the stored value or `old` is non-comparable. Panic message: `runtime error: comparing uncomparable type ...`.

There are *no* documented panics from the `sync.Map` itself for correct usage. The `concurrent map writes` panic from the built-in map is not applicable to `sync.Map`.

---

## Compatibility and Versioning

- **Go 1.9**: `sync.Map` introduced with `Load`, `Store`, `LoadOrStore`, `Delete`, `Range`.
- **Go 1.15**: `LoadAndDelete` added.
- **Go 1.20**: `Swap`, `CompareAndSwap`, `CompareAndDelete` added.

The API follows Go 1's compatibility promise: methods added in later versions are additive and do not break existing usage. Pre-1.9 code does not have `sync.Map` at all.

No generic version (`sync.Map[K, V]`) exists in the standard library as of Go 1.22. A proposal is open but not accepted.

---

## References

- Go source: `src/sync/map.go`: <https://github.com/golang/go/blob/master/src/sync/map.go>
- `sync.Map` documentation: <https://pkg.go.dev/sync#Map>
- Go memory model: <https://go.dev/ref/mem>
- Go 1.20 release notes — sync: <https://go.dev/doc/go1.20#sync>
- Go 1.15 release notes — sync: <https://go.dev/doc/go1.15#sync>
- Go 1.9 release notes — new types: <https://go.dev/doc/go1.9#sync>
- Issue 18177 — original proposal for `sync.Map`: <https://github.com/golang/go/issues/18177>
- Issue 47657 — generic Map proposal: <https://github.com/golang/go/issues/47657>
