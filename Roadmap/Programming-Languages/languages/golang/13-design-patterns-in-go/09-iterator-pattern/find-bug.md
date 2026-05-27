# Iterator Pattern — Find the Bug

## 1. How to use this file

Fifteen scenarios with subtle iterator bugs. Read the code, find the bug, expand for the answer.

---

## Bug 1 — Missing `rows.Close()`

```go
func ListUsers(db *sql.DB) []User {
    rows, _ := db.Query("SELECT id, name FROM users")
    var users []User
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name)
        users = append(users, u)
    }
    return users
}
```

<details><summary>Answer</summary>

**Bug:** No `defer rows.Close()`. The connection isn't returned to the pool. Under load, the pool exhausts.

**Spot in review:** Any `db.Query()` without immediate `defer rows.Close()`.

**Fix:**

```go
rows, err := db.Query(...)
if err != nil { return nil, err }
defer rows.Close()
```

**Why common:** Junior developers focus on the iteration logic and miss the resource lifecycle.
</details>

---

## Bug 2 — Missing `rows.Err()` check

```go
for rows.Next() {
    var u User
    rows.Scan(&u.ID, &u.Name)
    users = append(users, u)
}
return users, nil
```

<details><summary>Answer</summary>

**Bug:** `rows.Next()` returns false at end-of-data *and* on error. Without `rows.Err()`, iteration errors are silently swallowed.

**Fix:**

```go
for rows.Next() { /* ... */ }
if err := rows.Err(); err != nil { return nil, err }
return users, nil
```
</details>

---

## Bug 3 — Channel iterator goroutine leak

```go
func produceNumbers(max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            out <- i
        }
    }()
    return out
}

for n := range produceNumbers(1000) {
    if n == 5 { break }
    fmt.Println(n)
}
```

<details><summary>Answer</summary>

**Bug:** The producer goroutine blocks on `out <- i` after the consumer breaks. The goroutine leaks.

**Fix:**

```go
func produceNumbers(ctx context.Context, max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            select {
            case out <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

Caller uses `ctx, cancel := context.WithCancel(...)` and `defer cancel()`.
</details>

---

## Bug 4 — Mutating slice while ranging

```go
items := []int{1, 2, 3, 4, 5}
for i, v := range items {
    if v == 3 {
        items = append(items, 99)  // mutate
    }
    fmt.Println(i, v)
}
```

<details><summary>Answer</summary>

**Bug:** `range` captures the slice header at loop start. The original loop iterates 1, 2, 3, 4, 5 (5 iterations) regardless of the append. The appended 99 is never seen.

If this surprises the author, the code is wrong. If intentional, document it.

**Spot:** modification of the ranged slice inside the loop.
</details>

---

## Bug 5 — Forgotten `iter.Pull` stop

```go
next, _ := iter.Pull(seq)
for {
    v, ok := next()
    if !ok { break }
    use(v)
}
```

<details><summary>Answer</summary>

**Bug:** `stop` (second return value of `iter.Pull`) is ignored. The underlying coroutine (or goroutine in older implementations) leaks.

**Fix:**

```go
next, stop := iter.Pull(seq)
defer stop()
```

**Why common:** New API; `stop` looks unimportant.
</details>

---

## Bug 6 — `iter.Seq` not checking `!yield`

```go
func Numbers(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            yield(i)  // ignore return value
        }
    }
}

for v := range Numbers(1000) {
    if v == 5 { break }
}
```

<details><summary>Answer</summary>

**Bug:** When the caller breaks, `yield` returns false. The iterator doesn't check, so it continues calling `yield` for all 1000 iterations.

`break` doesn't stop the iterator — wasted work.

**Fix:**

```go
for i := 0; i < n; i++ {
    if !yield(i) { return }
}
```

Always check the return of `yield`.
</details>

---

## Bug 7 — Re-using a single-pass iterator

```go
rows, _ := db.Query("SELECT id FROM users")
defer rows.Close()

count := 0
for rows.Next() { count++ }

// Now rebuild
for rows.Next() {  // already exhausted
    var id int
    rows.Scan(&id)
    /* never executes */
}
```

<details><summary>Answer</summary>

**Bug:** `sql.Rows` is single-pass. After the first loop exhausts it, the second loop sees zero rows.

**Fix:** Run the query twice, or collect into a slice and iterate.

**Why common:** Database `Rows` look like generic iterators; some are restartable, most aren't.
</details>

---

## Bug 8 — `bufio.Scanner` buffer overrun

```go
scanner := bufio.NewScanner(file)
for scanner.Scan() {
    line := scanner.Text()
    process(line)
}
```

<details><summary>Answer</summary>

**Bug:** `bufio.Scanner` has a default token size limit (64KB). Lines longer than that cause `Scan` to return false. Without checking `Err()`, you'd think the file ended.

**Fix:**

```go
scanner := bufio.NewScanner(file)
scanner.Buffer(make([]byte, 1024*1024), 1024*1024*10)  // 10MB max
for scanner.Scan() { /* ... */ }
if err := scanner.Err(); err != nil { return err }
```

For very long lines, use `bufio.Reader.ReadString('\n')` instead — no size limit.
</details>

---

## Bug 9 — Loop variable captured by closure (pre-Go-1.22)

```go
funcs := []func(){}
for _, v := range []int{1, 2, 3} {
    funcs = append(funcs, func() { fmt.Println(v) })
}
for _, f := range funcs { f() }
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22, the loop variable `v` is shared across iterations. All three closures capture the *same* `v`, which is 3 by the end. Output: 3, 3, 3.

Go 1.22+ fixed this: each iteration gets a fresh variable. Output: 1, 2, 3.

**Fix for old Go:** `v := v` inside the loop.

**Why common:** Pre-1.22 codebases have this bug throughout. Go 1.22 eliminates the bug class.
</details>

---

## Bug 10 — Returning pointer to loop variable

```go
results := []*User{}
for rows.Next() {
    var u User
    rows.Scan(&u.ID, &u.Name)
    results = append(results, &u)  // !
}
```

<details><summary>Answer</summary>

**Bug:** Each iteration scans into the *same* `u` variable (stack-allocated, then moved to heap). After the loop, all `*User` pointers in `results` point to the same `u`, which holds the last row.

**Fix:**

```go
for rows.Next() {
    u := &User{}  // new instance each iteration
    rows.Scan(&u.ID, &u.Name)
    results = append(results, u)
}
```

**Why common:** Looks correct because each iteration "creates" a new `u`. But in pre-Go-1.22, the variable is reused.

Go 1.22+ creates a new `u` per iteration even with `var u User`. But the pointer-and-append idiom is still safer with explicit `&User{}`.
</details>

---

## Bug 11 — Infinite iteration on empty pagination

```go
func ListUsers(client *API) iter.Seq[*User] {
    return func(yield func(*User) bool) {
        cursor := ""
        for {
            page, _ := client.Page(cursor)
            for _, u := range page.Users {
                if !yield(u) { return }
            }
            cursor = page.NextCursor
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** Loop never terminates. When the API returns an empty page with no NextCursor, the loop should stop. As written, it loops forever requesting the same cursor.

**Fix:**

```go
if page.NextCursor == "" { return }
cursor = page.NextCursor
```

Or: terminate when the page is empty *and* there's no NextCursor.
</details>

---

## Bug 12 — Modifying map during iteration

```go
m := map[int]int{1: 10, 2: 20, 3: 30}
for k, v := range m {
    if v > 15 {
        delete(m, k)
    }
}
```

<details><summary>Answer</summary>

**Bug:** Modifying a map during iteration has *undefined behavior* in Go. Spec says: "The iteration order over maps is not specified and is not guaranteed to be the same from one iteration to the next. If map entries that have not yet been reached are removed during iteration, the corresponding iteration values will not be produced. If map entries are created during iteration, that entry may be produced during the iteration or may be skipped."

So this *might* work — but it's undefined.

**Fix:** Two passes: collect keys to delete, then delete.

```go
var toDelete []int
for k, v := range m {
    if v > 15 { toDelete = append(toDelete, k) }
}
for _, k := range toDelete { delete(m, k) }
```
</details>

---

## Bug 13 — iter.Seq mid-iteration mutation of source

```go
items := []int{1, 2, 3}
seq := slices.Values(items)
for v := range seq {
    items = append(items, v*10)
}
```

<details><summary>Answer</summary>

**Bug:** `slices.Values` returns an iterator that captures the slice. The iteration sees the original three elements (1, 2, 3) regardless of appends. New elements (10, 20, 30) are not iterated.

Equivalent to mutating a slice while ranging — see Bug 4.

**Fix:** Decide intent. If you want to iterate growing items, use an index-based loop with `len(items)` re-evaluated.
</details>

---

## Bug 14 — iter.Seq2 with K/V swapped

```go
for v, k := range maps.All(myMap) {  // swapped!
    use(k, v)
}
```

<details><summary>Answer</summary>

**Bug:** `maps.All[K, V]` returns `iter.Seq2[K, V]` — the first value is the *key*, the second is the *value*. The variable names `v, k` are reversed from convention. `use(k, v)` is called with the value first, then the key.

The compiler can't catch this — both are the right types if K and V are similar (e.g., both `string`).

**Fix:** `for k, v := range maps.All(myMap) { use(k, v) }`. Match conventional naming.
</details>

---

## Bug 15 — Yielding a pointer to a per-iteration struct

```go
func Items() iter.Seq[*Item] {
    return func(yield func(*Item) bool) {
        var item Item  // ! reused
        for i := 0; i < 10; i++ {
            item.ID = i
            if !yield(&item) { return }
        }
    }
}

// Caller:
var items []*Item
for it := range Items() {
    items = append(items, it)
}
// items all point to the same Item (with ID=9)
```

<details><summary>Answer</summary>

**Bug:** Yielding the same pointer across iterations. The caller's slice ends up with N copies of the same pointer.

**Fix:**

```go
for i := 0; i < 10; i++ {
    item := &Item{ID: i}  // fresh per iteration
    if !yield(item) { return }
}
```

Or yield by value (`iter.Seq[Item]`) and let the caller take the address if needed.

**Why common:** Reusing a buffer for performance — but the caller doesn't know it's a buffer.
</details>

---

## Summary

These bugs fall into three families:

**Resource lifecycle (1, 2, 5, 8):** forgot to close, forgot to check error, forgot to stop.

**Mutation during iteration (4, 12, 13):** modifying the source while iterating.

**Yield semantics (3, 6, 11, 15):** misunderstanding push-style iteration — when yield returns false, when termination conditions apply, what gets yielded.

Review checklist for any iterator code:

- [ ] `defer Close()` on every resource-holding iterator?
- [ ] `Err()` check after `Next()`-style loops?
- [ ] `defer stop()` on `iter.Pull` calls?
- [ ] `!yield(v) { return }` in custom `iter.Seq` implementations?
- [ ] No modification of the source during iteration?
- [ ] Goroutine-spawning iterators have cancellation paths?
- [ ] Yielding fresh values (not reusing per-iteration buffers without documentation)?
