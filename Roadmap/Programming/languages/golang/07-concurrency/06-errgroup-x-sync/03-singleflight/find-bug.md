# singleflight — Find the Bug

Each section presents a piece of code with a bug. Read it carefully. Think about what happens under concurrency, what the loader's identity is, and how cleanup works. Then read the diagnosis.

## Table of Contents
1. [Bug 1: The Disappearing Cache](#bug-1-the-disappearing-cache)
2. [Bug 2: The Mutated Result](#bug-2-the-mutated-result)
3. [Bug 3: The Tenant Leak](#bug-3-the-tenant-leak)
4. [Bug 4: The Forgotten Forget](#bug-4-the-forgotten-forget)
5. [Bug 5: The Captured Request](#bug-5-the-captured-request)
6. [Bug 6: The Sticky Error](#bug-6-the-sticky-error)
7. [Bug 7: The Lock Across Do](#bug-7-the-lock-across-do)
8. [Bug 8: The Loop Variable](#bug-8-the-loop-variable)
9. [Bug 9: The Panicking Loader](#bug-9-the-panicking-loader)
10. [Bug 10: The Timestamped Key](#bug-10-the-timestamped-key)
11. [Bug 11: The Type-Assert Crash](#bug-11-the-type-assert-crash)
12. [Bug 12: The Zero-Value Return](#bug-12-the-zero-value-return)
13. [Bug 13: The Copied Group](#bug-13-the-copied-group)
14. [Bug 14: The Self-Calling Loader](#bug-14-the-self-calling-loader)

---

## Bug 1: The Disappearing Cache

```go
var g singleflight.Group

func GetUser(id int) (*User, error) {
    v, err, _ := g.Do(strconv.Itoa(id), func() (interface{}, error) {
        return db.QueryUser(id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

What is wrong?

### Diagnosis

This code "uses singleflight." It does not cache. Every sequential call to `GetUser(42)` runs `db.QueryUser(42)`. Singleflight only helps when many callers are *simultaneously* missing — it does not remember the result for the next caller.

The naming of `GetUser` suggests caching; the code does no caching. Combine with a TTL cache to get the intended behaviour.

### Fix

```go
var (
    cache = map[string]*User{}
    cmu   sync.RWMutex
    g     singleflight.Group
)

func GetUser(id int) (*User, error) {
    key := strconv.Itoa(id)
    cmu.RLock()
    if u, ok := cache[key]; ok {
        cmu.RUnlock()
        return u, nil
    }
    cmu.RUnlock()
    v, err, _ := g.Do(key, func() (interface{}, error) {
        u, err := db.QueryUser(id)
        if err == nil {
            cmu.Lock()
            cache[key] = u
            cmu.Unlock()
        }
        return u, err
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

---

## Bug 2: The Mutated Result

```go
v, _, _ := g.Do(key, loader)
u := v.(*User)
u.LastSeenAt = time.Now()
log.Audit(u)
```

What is wrong?

### Diagnosis

`v` is the same pointer for every waiter in this round. Mutating `u.LastSeenAt` is visible to every other waiter. If two waiters both mutate, they race. The audit log records the mutation, but the next time someone reads `u.LastSeenAt` they will see a value set by someone else.

### Fix

Treat the result as immutable. Clone before mutating.

```go
u := *v.(*User) // copy the value
u.LastSeenAt = time.Now()
log.Audit(&u)
```

Or have the loader return immutable values. Or — better — separate read paths from write paths, so the audit happens against a per-caller copy.

---

## Bug 3: The Tenant Leak

```go
var g singleflight.Group

func GetConfig(tenant, name string) (*Config, error) {
    v, err, _ := g.Do(name, func() (interface{}, error) {
        return db.LoadConfig(tenant, name)
    })
    if err != nil {
        return nil, err
    }
    return v.(*Config), nil
}
```

What is wrong?

### Diagnosis

The key is `name` — not `(tenant, name)`. Two concurrent calls `GetConfig("alpha", "settings")` and `GetConfig("beta", "settings")` will coalesce. Whichever runs first does its load; the other receives that result.

If `Alpha` calls first, `Beta` receives Alpha's config. This is a cross-tenant data leak. Catastrophic in a multi-tenant SaaS.

### Fix

Include the tenant in the key.

```go
key := tenant + ":" + name
v, err, _ := g.Do(key, func() (interface{}, error) {
    return db.LoadConfig(tenant, name)
})
```

Better: separate `Group` per tenant, or per resource type.

---

## Bug 4: The Forgotten Forget

```go
func InvalidateUser(id int) {
    cmu.Lock()
    delete(cache, strconv.Itoa(id))
    cmu.Unlock()
}
```

What is wrong?

### Diagnosis

If a load for user `id` is in flight when `InvalidateUser(id)` is called, the loader will finish and write the (now stale) value into the cache. The cache then contains stale data, defeating the invalidation.

### Fix

Forget the in-flight call too.

```go
func InvalidateUser(id int) {
    key := strconv.Itoa(id)
    cmu.Lock()
    delete(cache, key)
    cmu.Unlock()
    g.Forget(key)
}
```

Even better: use a generation counter so the loader can detect that its result is stale and refuse to write.

---

## Bug 5: The Captured Request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    v, err, _ := g.Do(id, func() (interface{}, error) {
        return loadFor(r) // r is the first caller's request
    })
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    json.NewEncoder(w).Encode(v)
}
```

What is wrong?

### Diagnosis

Late arrivals receive a result computed from the *first* caller's `*http.Request`. If `loadFor(r)` uses `r.Header.Get("Authorization")`, late arrivals get a result loaded under the first caller's authorization. If `loadFor(r)` uses `r.Context()`, late arrivals depend on a context that may already be cancelled.

This is a cross-request data leak.

### Fix

The loader must not depend on per-caller state. Pass only key-derived inputs:

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    return loadByID(id) // pure, key-derived
})
```

Authorization should be checked *outside* the loader.

---

## Bug 6: The Sticky Error

```go
var (
    cache = map[string]Entry{}
    g     singleflight.Group
)

type Entry struct {
    Val *User
    Err error
}

func GetUser(id int) (*User, error) {
    key := strconv.Itoa(id)
    if e, ok := cache[key]; ok {
        return e.Val, e.Err
    }
    v, err, _ := g.Do(key, func() (interface{}, error) {
        return db.QueryUser(id)
    })
    cache[key] = Entry{Val: nil, Err: err}
    if v != nil {
        cache[key] = Entry{Val: v.(*User), Err: nil}
    }
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

What is wrong?

### Diagnosis

Two problems.

First: a single race condition — the cache is read and written without a mutex. Easy fix.

Second, and the real bug: transient errors (timeouts, connection resets) are cached. Once an error is cached, every subsequent call returns the cached error. The next chance to retry never comes. This is a *sticky error*: a transient hiccup becomes permanent.

### Fix

Cache successes; only cache errors if you can classify them as permanent. Add the mutex.

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    return db.QueryUser(id)
})
if err == nil {
    mu.Lock()
    cache[key] = Entry{Val: v.(*User)}
    mu.Unlock()
}
// transient errors are not cached
```

---

## Bug 7: The Lock Across Do

```go
mu.Lock()
defer mu.Unlock()
if u, ok := cache[id]; ok {
    return u, nil
}
v, err, _ := g.Do(id, func() (interface{}, error) {
    return db.QueryUser(id)
})
if err == nil {
    cache[id] = v.(*User)
}
return v.(*User), err
```

What is wrong?

### Diagnosis

The mutex is held across the singleflight call, which is held across the database query. If `db.QueryUser` takes 200ms, the mutex is held for 200ms — and no other request, *for any user*, can proceed.

The mutex protects the cache. It should be released before the loader runs.

### Fix

Drop the mutex before calling `Do`. Re-acquire to write the result.

```go
mu.RLock()
if u, ok := cache[id]; ok {
    mu.RUnlock()
    return u, nil
}
mu.RUnlock()
v, err, _ := g.Do(id, func() (interface{}, error) {
    u, err := db.QueryUser(id)
    if err == nil {
        mu.Lock()
        cache[id] = u
        mu.Unlock()
    }
    return u, err
})
```

---

## Bug 8: The Loop Variable

```go
ids := []string{"a", "b", "c"}
for _, id := range ids {
    go func() {
        v, _, _ := g.Do(id, func() (interface{}, error) {
            return loadByID(id)
        })
        process(v)
    }()
}
```

What is wrong?

### Diagnosis

Before Go 1.22, the loop variable `id` is shared across iterations. By the time the goroutine runs, `id` is likely "c" — for all three goroutines. They all load "c", three times.

In Go 1.22+, the loop variable is per-iteration by default. The bug is fixed by the language. But not all codebases are on 1.22+.

### Fix

Capture per iteration:

```go
for _, id := range ids {
    id := id // shadow
    go func() {
        v, _, _ := g.Do(id, func() (interface{}, error) {
            return loadByID(id)
        })
        process(v)
    }()
}
```

Or pass as argument:

```go
for _, id := range ids {
    go func(id string) {
        v, _, _ := g.Do(id, func() (interface{}, error) {
            return loadByID(id)
        })
        process(v)
    }(id)
}
```

---

## Bug 9: The Panicking Loader

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    u := db.QueryUser(id) // returns (nil, err) sometimes
    return u.Name, nil    // nil deref when u is nil
})
```

What is wrong?

### Diagnosis

If `db.QueryUser` returns `(nil, err)` and we ignore the error, dereferencing `u.Name` panics. The panic propagates to every waiter on this call. Ten concurrent callers, ten panicking goroutines.

In production, this looks like ten "panic: runtime error: invalid memory address" lines in your logs at the same instant, all with the same stack.

### Fix

Check the error from the inner call. Also recover defensively.

```go
v, err, _ := g.Do(id, func() (v interface{}, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("loader panic: %v", r)
        }
    }()
    u, e := db.QueryUser(id)
    if e != nil {
        return nil, e
    }
    return u.Name, nil
})
```

---

## Bug 10: The Timestamped Key

```go
key := fmt.Sprintf("%s:%d", id, time.Now().Unix())
v, _, _ := g.Do(key, loader)
```

What is wrong?

### Diagnosis

The key includes the current second. Calls one second apart have different keys and do not coalesce.

If the intent was "limit to one call per second per key," singleflight is the wrong tool — a rate limiter is what you want. If the intent was just "coalesce concurrent callers," remove the timestamp.

### Fix

```go
key := id
v, _, _ := g.Do(key, loader)
```

---

## Bug 11: The Type-Assert Crash

```go
v, _, _ := g.Do(id, func() (interface{}, error) {
    return User{ID: id}, nil // value, not pointer
})
u := v.(*User) // panics
```

What is wrong?

### Diagnosis

The loader returns a `User` value, but the caller asserts to `*User`. Type assertion panics. Worse, this might work in development if some other path inserts `*User` first; the bug surfaces only under specific call orders.

### Fix

Be consistent. Pick pointer or value, document it, and write a test that asserts the type.

```go
v, _, _ := g.Do(id, func() (interface{}, error) {
    return &User{ID: id}, nil
})
u := v.(*User)
```

---

## Bug 12: The Zero-Value Return

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    u, err := db.QueryUser(id)
    return u, err // returns nil, err on error
})
u := v.(*User) // panics if v is nil
```

What is wrong?

### Diagnosis

When `err != nil`, the loader returns `(nil, err)`. Asserting `v.(*User)` panics if `v` is nil — `interface{}(nil).(*User)` is *not* a type-assert miss, it is a nil-interface assertion that *succeeds* and yields `*User(nil)`. So actually no panic on the assertion. But the next line that dereferences `u` panics.

The deeper bug: the caller did not check `err` first.

### Fix

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    return db.QueryUser(id)
})
if err != nil {
    return nil, err
}
u := v.(*User)
```

Or change the loader to return a zero value on error so the caller cannot use it accidentally:

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    u, err := db.QueryUser(id)
    if err != nil {
        return nil, err
    }
    return u, nil
})
```

---

## Bug 13: The Copied Group

```go
type Service struct {
    g singleflight.Group
}

func clone(s Service) Service {
    return s // copies the Group
}
```

What is wrong?

### Diagnosis

`singleflight.Group` contains a `sync.Mutex` and a `map`. Copying produces a Group with a *different* mutex but a shared map (the map header is copied; both Groups point at the same underlying data). The synchronisation is broken: two Groups operating on the same map with two different mutexes.

`go vet` will warn about copying the mutex.

### Fix

Pass `*Service` (and therefore `*singleflight.Group` indirectly). Never copy a `Group` value.

```go
func clone(s *Service) *Service {
    return s
}
```

---

## Bug 14: The Self-Calling Loader

```go
var g singleflight.Group

func loadFoo(id string) (interface{}, error) {
    if id[0] == 'a' {
        return g.Do("base", loadFoo)
    }
    return slowLoad(id)
}

g.Do("a1", func() (interface{}, error) {
    return loadFoo("a1")
})
```

What is wrong?

### Diagnosis

`loadFoo("a1")` is running inside the `g.Do("a1", ...)` call. Inside, it calls `g.Do("base", loadFoo)`. That returns to the outer call... wait, "base" is a different key from "a1", so that should be fine.

Trace more carefully. The call to `g.Do("base", loadFoo)` invokes the loader with no arguments, but `loadFoo` requires `id`. The signature doesn't match. This won't even compile.

If we fix the signature, the real bug shows up when the inner `g.Do` uses the *same* key as the outer. For example:

```go
g.Do(id, func() (interface{}, error) {
    // accidentally call back into Do for the same id
    return g.Do(id, sameLoader)
})
```

Now the inner `Do` finds the active call's record (it is itself!) and calls `wg.Wait` on it. The outer is waiting for itself. Deadlock.

### Fix

Never call `g.Do(K, ...)` from within a loader for `K`. If you need recursive loading, use a different key or a different group.

---
