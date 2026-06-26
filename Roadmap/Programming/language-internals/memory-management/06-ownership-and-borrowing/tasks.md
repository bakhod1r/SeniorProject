# Ownership & Borrowing — Hands-On Tasks

> **Topic:** [Ownership & Borrowing](README.md)

A graded set of exercises to build real intuition for moves, borrows, lifetimes, and the escape hatches. Work in a scratch Rust project (`cargo new ownership-lab`) and let the compiler be your teacher — read every error message in full. Tasks progress from warm-up reflexes to a capstone that forces you to pick the right ownership strategy for a non-trivial data structure.

> Self-checks use `- [ ]` so you can track progress. Hints are deliberately short; solutions are sparse and only given where the *idea* (not the typing) is the lesson.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Predict the move error

Write a program that creates a `String`, assigns it to a second variable, then tries to print the first. Before compiling, predict the exact error. Then compile and confirm.

**Self-check:**

- [ ] I predicted "borrow of moved value" / "value used after move" before compiling.
- [ ] I can explain why `String` moves but `i32` would have copied.
- [ ] I fixed it three different ways: borrow, `.clone()`, and use-the-new-name.

<details><summary>Hint</summary>The difference is whether the type implements <code>Copy</code>. <code>String</code> owns a heap buffer, so it can't be trivially <code>Copy</code>.</details>

### Task 2 — Copy vs move by experiment

Make a 2-field struct of `i32`s and `derive(Copy, Clone)`. Move it into a function and use it after. Now remove the `Copy` derive and observe the change. Repeat with a struct containing a `String`.

**Self-check:**

- [ ] With `Copy`, the value is still usable after passing it to a function.
- [ ] Without `Copy`, the same code fails to compile.
- [ ] I can state the rule: a struct can be `Copy` only if all fields are `Copy` and it has no `Drop`.

### Task 3 — Borrow instead of move

Write `fn word_count(s: &str) -> usize`. Call it twice on the same `String` and print the string afterward. Confirm nothing was moved.

**Self-check:**

- [ ] The function signature takes `&str`, not `String`.
- [ ] I can call it repeatedly and still own the original.
- [ ] I understand why `&str` is preferable to `&String` as a parameter type.

### Task 4 — Observe `Drop`

Implement `Drop` for a struct that prints `"dropping {name}"`. Create several in different scopes and nested blocks. Predict the print order before running.

**Self-check:**

- [ ] I correctly predicted the drop order (reverse declaration order within a scope).
- [ ] Inner-scope values dropped before outer-scope values.
- [ ] I observed that drop runs even on early `return`.

---

## Core

### Task 5 — Trigger and fix a dangling-reference error

Write a function that tries to return a reference to a `String` created inside it. Read the compiler error. Then fix it two ways: (a) return the owned `String`, (b) restructure so the function borrows from a parameter and returns a borrow of that.

**Self-check:**

- [ ] I understand why returning `&` to a local is rejected (the local drops at the `}`).
- [ ] My borrow-from-parameter version compiles without an explicit lifetime (elision handled it).
- [ ] I can articulate "a borrow must not outlive its owner."

### Task 6 — The `longest` function (explicit lifetimes)

Write `fn longest<'a>(x: &'a str, y: &'a str) -> &'a str` returning the longer string. Then deliberately call it so that one input goes out of scope before you use the result, and read the lifetime error.

**Self-check:**

- [ ] I can explain why this function *needs* an explicit lifetime when single-reference functions don't (elision can't pick which input the output borrows from).
- [ ] I produced and understood the "does not live long enough" error.
- [ ] I can read `'a` as "the result is valid for the shorter of the two inputs' regions."

### Task 7 — Aliasing XOR mutability

Create a `Vec`, take two shared borrows and print them, then take a mutable borrow and push. Confirm it compiles. Now reorder so the mutable borrow overlaps a still-live shared borrow and read the error.

**Self-check:**

- [ ] The non-overlapping version compiles (NLL ended the shared borrows at last use).
- [ ] The overlapping version fails with "cannot borrow as mutable because also borrowed as immutable."
- [ ] I can explain how this same rule prevents iterator invalidation.

<details><summary>Hint</summary>Try mutating a <code>Vec</code> while iterating over a reference into it — that's iterator invalidation, blocked at compile time.</details>

### Task 8 — Struct holding a reference

Define `struct Excerpt<'a> { part: &'a str }`. Construct it from a slice of a `String`. Then try to drop the `String` while the `Excerpt` is still alive and read the error.

**Self-check:**

- [ ] The struct required a lifetime parameter and I understand why.
- [ ] I can explain that the `Excerpt` cannot outlive the `String` it points into.
- [ ] I tried (and failed) to return an `Excerpt` borrowing a function-local `String`.

### Task 9 — `Rc` shared ownership and refcount

Build a value shared by three `Rc` handles. Print `Rc::strong_count` after each clone and after dropping handles in inner scopes. Confirm the value is freed only when the last handle drops (use a `Drop` impl to observe it).

**Self-check:**

- [ ] `Rc::clone` bumped the count without deep-copying the data.
- [ ] The count dropped as handles went out of scope.
- [ ] The inner value's `Drop` ran exactly once, when the count hit zero.

### Task 10 — `RefCell` and the runtime panic

Wrap a `Vec` in `RefCell`, mutate it through `borrow_mut()`, and read it through `borrow()`. Then deliberately hold two `borrow_mut()`s at once and observe the runtime panic.

**Self-check:**

- [ ] I mutated through a shared (`&`) handle via interior mutability.
- [ ] The double-`borrow_mut` panicked at runtime, not at compile time.
- [ ] I can explain the trade: a compile-time guarantee was moved to a runtime check.

---

## Advanced

### Task 11 — Create and break an `Rc` cycle

Build two nodes that reference each other with `Rc<RefCell<Node>>`. Add a `Drop` print. Observe that *neither* drop fires (a leak). Then change one edge to `Weak`, use `upgrade()` to access it, and confirm both nodes now drop.

**Self-check:**

- [ ] I demonstrated an actual memory leak with a strong-strong cycle (no drops printed).
- [ ] Switching one edge to `Weak` restored deterministic dropping.
- [ ] I can explain why reference counting alone can't collect cycles.

<details><summary>Hint</summary><code>Weak</code> doesn't contribute to the strong count; call <code>.upgrade()</code> to get an <code>Option&lt;Rc&lt;T&gt;&gt;</code>.</details>

### Task 12 — Arena-based graph (no `Rc`)

Implement a small directed graph where nodes live in a `Vec<Node>` and edges are `usize` indices. Add nodes, connect them (including a cycle), and traverse. No `Rc`, no `RefCell`, no `unsafe`.

**Self-check:**

- [ ] The `Vec` owns every node; the borrow checker never fought me.
- [ ] I represented a cycle trivially with indices — no leak, no `Weak`.
- [ ] I can explain the trade-off vs `Rc<RefCell>`: I gave up pointer-level tracking but kept memory safety via bounds checks.

### Task 13 — A recursive type with `Box`

Define a cons-list enum `List { Cons(i32, Box<List>), Nil }`. Explain (in a comment) why removing the `Box` makes the type fail to compile. Build a 3-element list and sum it.

**Self-check:**

- [ ] Without `Box`, the compiler reports infinite size; with `Box` the size is known.
- [ ] I understand `Box` gives single heap ownership and a fixed pointer-sized footprint.
- [ ] My recursive sum borrows the list (`&List`) rather than consuming it.

### Task 14 — Trace a self-referential failure

Attempt to write a struct that stores both a `String` and a `&str` slice into that same `String`. Get the compiler to reject it. Write a paragraph explaining why moving such a struct would dangle the internal reference, and name the tool that solves it.

**Self-check:**

- [ ] I produced the borrow-checker rejection for a self-referential struct.
- [ ] My explanation correctly invokes "move copies bytes to a new address while the self-pointer aims at the old one."
- [ ] I named `Pin` and connected it to why `async` futures are polled through `Pin<&mut Self>`.

### Task 15 — Over-cloning audit

Take any earlier task where you used `.clone()` to silence an error. Replace each clone with a borrow where possible. For any clone you can't remove, write one sentence on why it's genuinely needed.

**Self-check:**

- [ ] I removed at least one unnecessary clone by borrowing instead.
- [ ] I can identify a clone as a real performance cost, not a free fix.
- [ ] I understand why "clone to silence the borrow checker" is a design smell.

---

## Capstone

### Task 16 — Design a small in-memory key-value store with subscribers

Build a single-threaded `Store` that maps `String` keys to `String` values **and** supports subscribers: callers register interest in a key and get notified (via a closure or a flag) when it changes. Subscribers should be able to reference the store, and the store references subscribers — a natural cyclic shape. You must:

1. Choose ownership for the store's data, the subscriber registry, and the store↔subscriber back-edges.
2. Justify every `Rc`, `Weak`, `RefCell`, or arena/index decision in comments.
3. Ensure no leak: prove (with `Drop` prints) that dropping the store and all subscribers frees everything.
4. Provide a clean *safe* API; no `unsafe`.
5. Write 3–4 sentences on how you'd change the design to make it thread-safe (`Arc`/`Mutex`) and what that would cost.

**Self-check:**

- [ ] I made a deliberate ownership decision for each relationship, not a reflexive `Rc<RefCell>` everywhere.
- [ ] The store→subscriber or subscriber→store back-edge uses `Weak` (or indices) to avoid a cycle leak.
- [ ] All `Drop`s fire on teardown — demonstrably no leak.
- [ ] My API surface is safe and ergonomic; interior mutability is contained, not pervasive.
- [ ] My thread-safety paragraph correctly trades `Rc`→`Arc`, `RefCell`→`Mutex`, and names the atomic/locking cost.

<details><summary>Solution sketch</summary>
A common clean design: <code>Store { data: RefCell&lt;HashMap&lt;String, String&gt;&gt;, subs: RefCell&lt;HashMap&lt;String, Vec&lt;Weak&lt;Subscriber&gt;&gt;&gt;&gt; }</code> held behind an <code>Rc&lt;Store&gt;</code>. Subscribers hold an <code>Rc&lt;Store&gt;</code> (strong, they keep the store alive) while the store holds <code>Weak&lt;Subscriber&gt;</code> back-edges (so notifying does not keep dead subscribers alive and no cycle leaks). On a <code>set</code>, the store upgrades each <code>Weak</code>, skipping those that return <code>None</code> (already dropped). An equally valid, often faster alternative replaces the subscriber <code>Rc/Weak</code> with a slotmap/arena of subscriber IDs, eliminating reference counting entirely. For thread safety: wrap shared state in <code>Arc&lt;Mutex&lt;...&gt;&gt;</code> (or <code>RwLock</code> for read-heavy access), swap <code>Rc</code>→<code>Arc</code> and <code>Weak</code>→<code>std::sync::Weak</code>; the cost is atomic refcount operations on every clone and lock acquisition on every access, plus the risk of deadlock you didn't have single-threaded.
</details>

---

## Self-Assessment

You've internalized ownership and borrowing when you can, without looking things up:

- [ ] Predict move vs copy from a type's definition, and read every "use after move" error as obvious in hindsight.
- [ ] Explain aliasing XOR mutability and connect it concretely to data-race freedom *and* iterator invalidation.
- [ ] Read a lifetime annotation as a constraint ("output borrows from this input") rather than a magic incantation, and know when elision means you can omit it.
- [ ] Reach for the *minimum* escape hatch a problem needs: `Box` → `Rc`/`Arc` → `RefCell`/`Mutex` → arena indices → `unsafe`, and justify each step.
- [ ] Diagnose an `Rc`/`Arc` cycle leak and fix it with `Weak`, or restructure to an arena.
- [ ] Explain why self-referential structs and `async` futures need `Pin`.
- [ ] Argue honestly when a GC language is the better choice for a given data shape and latency budget.

If most of these are checked, you understand ownership not as a set of rules to appease the compiler, but as a coherent model for deciding who is responsible for memory — and you can choose the right tool when the static model doesn't fit.
