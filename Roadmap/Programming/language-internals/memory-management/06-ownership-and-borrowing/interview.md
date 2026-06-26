# Ownership & Borrowing — Interview Questions

> **Topic:** [Ownership & Borrowing](README.md)

A bank of interview questions on Rust's ownership and borrowing model, from first-principles concepts through tool-specific mechanics, classic traps, and design-level reasoning. Each answer is written to be said aloud in an interview: precise, honest about trade-offs, and grounded in how the model actually behaves.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**State the three rules of ownership.**

(1) Each value has exactly one owner. (2) When you assign or pass a value, ownership *moves*, and the moved-from variable becomes invalid — you can't use it. (3) When the owner goes out of scope, the value is dropped (its destructor runs and its memory is freed). These three rules let the compiler decide, at compile time, exactly when every value is freed — automatic reclamation with no garbage collector and no runtime cost.

## Question 2

**Why is ownership sometimes called "compile-time garbage collection"? What does Rust give up to get this?**

Like a GC, it frees memory automatically so you never call `free`. Unlike a GC, the *decision* of when to free is fixed at compile time — at scope exit — so there's no runtime collector, no background thread, no pauses, and no extra heap headroom. What Rust gives up is the GC's ability to collect *cycles* automatically and its low cognitive load: you have to design ownership explicitly, and cyclic or self-referential data is awkward. It trades flexibility and convenience for determinism and zero runtime cost.

## Question 3

**Explain the difference between `&T` and `&mut T` and the rule that governs them.**

`&T` is a shared, read-only borrow; you can have many at once. `&mut T` is an exclusive, read-write borrow; you can have exactly one, and no shared borrows may coexist with it. The governing rule is *aliasing XOR mutability*: at any point a value has either many readers or one writer, never both. This single rule prevents data races (a race needs two accesses with at least one write and no synchronization — impossible if writes are exclusive) and iterator invalidation, all at compile time.

## Question 4

**What is a lifetime? Is it a runtime thing?**

A lifetime is a compile-time region of the program over which a reference is valid — a set of program points, not a duration in seconds. It exists purely to let the borrow checker prove that a reference never outlives the value it points to. Lifetimes are erased before code generation; they have zero runtime representation.

## Question 5

**What's the difference between a move and a `Copy`?**

A move transfers ownership and invalidates the source — used for types that own a resource, like `String` or `Vec`. A `Copy` duplicates the bits so both variables are independently valid — used for small, plain types like integers, `bool`, `char`, and tuples of those. The difference is whether the type implements the `Copy` trait. `Copy` types are never "moved away"; non-`Copy` types are. A type can be `Copy` only if all its fields are `Copy` and it has no `Drop` impl.

## Question 6

**How does the ownership model prevent data races at compile time?**

A data race requires two threads accessing the same memory, at least one writing, without synchronization. Aliasing XOR mutability makes a `&mut` (the writer) exclusive — no other reference, on any thread, can coexist with it. Combined with the `Send`/`Sync` marker traits (which control what can cross thread boundaries or be shared between threads), the compiler refuses to even compile code that could race. You get data-race freedom as a *compile error*, not a runtime hope.

---

## Tool-Specific

## Question 7

**When do you need `Box<T>`, and what does it give you?**

`Box<T>` is single ownership of a heap allocation. You need it when (a) a type is recursive and would otherwise have infinite size — the `Box` gives it a known pointer-sized footprint (linked lists, ASTs); (b) you want a trait object, `Box<dyn Trait>`, whose size isn't known at compile time; or (c) you want to move a large value without copying its bytes around. It's the lightest escape hatch — still single ownership, still dropped deterministically.

## Question 8

**`Rc` vs `Arc` — when do you use which, and what do they cost?**

Both provide *shared* ownership via reference counting: the value is freed when the last handle drops. `Rc` uses a plain counter and is single-threaded only — the compiler won't let it cross threads because it isn't `Send`/`Sync`. `Arc` uses an *atomic* counter, so it's thread-safe but each clone/drop pays for an atomic operation. Use `Rc` within one thread; use `Arc` when sharing across threads. Both are effectively a localized garbage collector, and both *leak on cycles*.

## Question 9

**What problem does `Weak<T>` solve?**

Reference counting can't collect cycles: if two `Rc`s point at each other, their counts never reach zero and the memory leaks. `Weak<T>` is a non-owning handle that doesn't contribute to the strong count. You make the "back-edge" of a potential cycle a `Weak` — e.g., a child node's pointer to its parent — so the cycle can't keep the data alive. You call `upgrade()` on a `Weak` to get an `Option<Rc<T>>`, which is `None` if the value was already dropped.

## Question 10

**What is interior mutability, and how do `Cell`, `RefCell`, and `Mutex` provide it?**

Interior mutability is mutating data through a *shared* (`&`) reference, which the static rules normally forbid. These types make it safe by enforcing aliasing XOR mutability some other way. `Cell<T>` swaps the whole value in and out (`get`/`set`, `T: Copy`) with no references handed out — no runtime tracking, no panic. `RefCell<T>` hands out references and tracks borrows *at runtime*, panicking if you violate the rule. `Mutex<T>` does the same across threads, blocking instead of panicking. The common theme: they move the borrow check from compile time to run time, trading a compile error for a runtime cost or panic.

## Question 11

**What does `unsafe` actually do? Does it turn off the borrow checker?**

No — and this is the most common misconception. The borrow checker, lifetimes, and move semantics all still apply inside `unsafe`. `unsafe` grants five extra abilities, chiefly dereferencing raw pointers and calling `unsafe` functions. It's a statement: "the compiler can't verify safety here, so I'm asserting I have." You take on the obligations the compiler was discharging — no use-after-free, no data races, valid values, correct aliasing — and you're expected to wrap the `unsafe` core in a safe API that no caller can misuse into UB.

---

## Tricky / Trap

## Question 12

**Why does this fail to compile, and how do you fix it?**

```rust
let s1 = String::from("hi");
let s2 = s1;
println!("{s1}");
```

`String` is not `Copy`, so `let s2 = s1` *moves* ownership to `s2` and invalidates `s1`. Using `s1` afterward is "use after move." Fixes: borrow instead (`let s2 = &s1;`) if you only need to read it; or `s1.clone()` if you genuinely need two independent owned strings; or just use `s2`. The deeper point: allowing both to be owners would risk a double-free, which is exactly what the move prevents.

## Question 13

**This compiled under modern Rust but not under the old borrow checker. Why?**

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];
println!("{first}");
v.push(4);
```

Non-lexical lifetimes (NLL). The shared borrow `first` ends at its *last use* — the `println!` — not at the end of the enclosing block. By the time `v.push(4)` takes a `&mut`, the shared borrow is already dead, so there's no conflict. The old checker tied borrows to lexical scope and would have flagged a borrow conflict that didn't actually exist at runtime.

## Question 14

**Can this `RefCell` code panic? When?**

```rust
let cell = RefCell::new(0);
let a = cell.borrow_mut();
let b = cell.borrow_mut();
```

Yes — it panics at the second `borrow_mut()`, at runtime. `RefCell` enforces aliasing XOR mutability dynamically; two simultaneous mutable borrows violate it, so it panics with "already mutably borrowed." This is the core risk of interior mutability: you've moved a *compile-time guarantee* to a *runtime check*, so a borrow bug that the static checker would have caught can now ship and crash in production — possibly only on a rare code path.

## Question 15

**Why are doubly linked lists and self-referential structs hard in safe Rust?**

A doubly linked list needs each node to point both forward and back, so a single edge has effectively two owners — the single-owner rule can't express it with `Box`. You're pushed to `Rc<RefCell<Node>>` with `Weak` back-pointers, or to an arena where nodes live in a `Vec` and links are indices. Self-referential structs (a struct holding a reference into its own field) are worse: moving the struct copies the bytes to a new address while the internal pointer still aims at the old one — instant dangling pointer. The compiler forbids constructing such a type safely; the fix is `Pin`, which promises the value won't move. This is exactly why `async` futures are polled through `Pin<&mut Self>` — the compiler-generated state machine is self-referential across `.await` points.

## Question 16

**Where does Rust allow you to leak memory, and is leaking unsafe?**

Leaking is *safe* in Rust — it's not undefined behavior. You can leak via `Rc`/`Arc` cycles, via `mem::forget`, or via `Box::leak`. Crucially, this means `Drop` is *not guaranteed* to run, so you must never write `unsafe` code whose soundness depends on a destructor executing. The single most common accidental leak is an `Rc`/`Arc` cycle with no `Weak` to break it — the one way to "leak like a GC language" in otherwise-deterministic Rust.

---

## Design

## Question 17

**You're choosing between Rust and a GC language for a new service. How does the ownership model factor in?**

It comes down to *where you can afford to pay the safety bill*. Ownership front-loads cost onto design and compile time and gives you bounded, predictable latency, a tight memory footprint, and deterministic release of all resources (files, sockets, locks) via RAII — its most underrated win. A tracing GC front-loads nothing on the developer but spends CPU and pause time at runtime and collects cycles for free. So: latency-critical, memory-constrained, or graph-light domains (OS, embedded, trading, databases, browsers) favor ownership; graph-heavy domains where developer velocity dominates and pauses are tolerable favor GC. I'd also weigh team familiarity — the borrow checker has a real onboarding cost.

## Question 18

**How do you keep `unsafe` code maintainable and correct in a production crate?**

Treat the safe/unsafe boundary as an abstraction boundary, like the standard library does. Keep `unsafe` blocks as small as possible, confined to one module, behind a safe API that *no* caller can misuse into UB — if they can, the unsoundness is my bug, not theirs. Put a `// SAFETY:` comment on every `unsafe` block stating which invariant makes it sound, and gate merges on it. Run Miri in CI to catch aliasing UB and use-after-free that tests miss, add ThreadSanitizer for concurrency, and fuzz any parsing or FFI surface. The target is a small, audited, documented unsafe core under a large safe surface.

## Question 19

**Design the ownership for a tree where children know their parent. What do you reach for and why?**

The parent→child edges should be *owning* — `Rc<RefCell<Node>>` if I need shared mutable access single-threaded, or just `Box`/`Vec<Node>` if a node has exactly one owner. The child→parent back-edge must be `Weak<RefCell<Node>>`, never a strong `Rc`, otherwise parent and child reference-count each other into a cycle that never frees. For a performance-critical or large tree, I'd skip reference counting entirely and use an arena: store all nodes in a `Vec`, represent edges as indices, and let the `Vec` own everything. Indices sidestep the borrow checker while bounds-checking still preserves memory safety — this is how compilers and ECS game engines represent graphs.

## Question 20

**Across an FFI boundary, how do you handle ownership of a buffer Rust allocated and C must later free?**

The C ABI has no notion of ownership or `Drop`, and Rust's allocator isn't interchangeable with C's `malloc`/`free` — freeing across allocators is UB. So I keep the memory's lifecycle on the Rust side: `Box::into_raw` to leak the `Box` into a `*mut T` (relinquishing Rust's automatic drop) and hand that pointer to C; then expose an `extern "C"` free function that does `Box::from_raw` to reclaim ownership and drop it through the correct allocator. The pointer must round-trip back to Rust to be freed. I document the contract explicitly on both sides — who allocates, who frees, nullability, and the valid lifetime — because mismatched FFI ownership assumptions are among the most severe real-world memory bugs.
