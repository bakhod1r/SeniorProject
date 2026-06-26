# Manual Memory Management — Hands-On Tasks

> **Topic:** [Manual Memory Management](README.md)

These tasks build manual-memory intuition the only way it sticks: by writing code that breaks, watching the tools catch it, and then fixing it correctly. Work in **C** unless a task names C++ or Rust. Wherever possible, **verify with a sanitizer** — most tasks include an ASan or Valgrind self-check. Don't skip that step; "it ran without crashing" is not the same as "it's correct."

> Setup: `clang -fsanitize=address,undefined -fno-omit-frame-pointer -g -O1 file.c -o prog` then `./prog`. No Clang? Use `valgrind ./prog` on an ordinary build.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — The balanced ledger

Write a program that `malloc`s three different buffers, fills each, prints them, and frees each exactly once. Check every `malloc` for `NULL`. Then deliberately comment out one `free` and run under ASan/LSan.

**Self-check:**
- [ ] Every `malloc` return value is checked against `NULL` before use.
- [ ] With all frees present, ASan/LSan reports no leaks.
- [ ] With one `free` removed, LeakSanitizer reports exactly one leak, with the allocation stack trace.

<details><summary>Hint</summary>Compile with `-fsanitize=address`; on Linux LeakSanitizer runs automatically at exit and prints "detected memory leaks".</details>

### Task 2 — `malloc` vs `calloc`

Allocate an array of 8 `int`s with `malloc` and print all 8 *without writing them first*. Then do the same with `calloc`. Run both under MemorySanitizer (`-fsanitize=memory`) if available, otherwise observe the garbage values.

**Self-check:**
- [ ] You can articulate why the `malloc` version is an *uninitialized read* bug.
- [ ] The `calloc` version prints all zeros, guaranteed.
- [ ] You understand `calloc` also guards against multiplication overflow in the size.

### Task 3 — The `realloc` reassignment trap

Write a growing buffer: start at 4 ints, then `realloc` to 16. First write the buggy `p = realloc(p, ...)` form, then rewrite it using a temporary pointer that handles a `NULL` return without leaking.

**Self-check:**
- [ ] Your correct version never overwrites `p` until `realloc` succeeds.
- [ ] You always read from `realloc`'s return value (the block may have moved).
- [ ] You can explain why the naive form leaks on failure.

---

## Core

### Task 4 — Reproduce and catch a use-after-free

Allocate a buffer, write to it, `free` it, then read it. Run under ASan and read the report. Then fix it, and add the defensive `p = NULL;` after `free`.

**Self-check:**
- [ ] ASan reports `heap-use-after-free` with three traces: allocation, free, and the bad read.
- [ ] You can point to all three locations in your source from the report.
- [ ] After setting `p = NULL`, an accidental reuse dereferences `NULL` and crashes immediately instead of silently.

<details><summary>Hint</summary>The three stack traces are labeled "allocated by", "freed by", and the top "READ/WRITE of size N". Match each to a line number.</details>

### Task 5 — Reproduce a buffer overflow

`malloc(10 * sizeof(int))` and write to index `10` (one past the end). Run under ASan. Then explain, in a comment, *what* you corrupted and why it's worse than corrupting your own data.

**Self-check:**
- [ ] ASan reports `heap-buffer-overflow` and shows the redzone it caught you in.
- [ ] Your comment explains that you may overwrite the *next chunk's allocator header*, corrupting bookkeeping for unrelated allocations.
- [ ] You fixed the loop bound to `< 10`.

### Task 6 — A documented ownership API

Write `char *str_repeat(const char *s, int times)` that returns a newly allocated string of `s` repeated `times` times. Document the ownership contract in a comment above it ("CALLER must free; returns NULL on allocation failure"). Write a caller that honors it. Verify clean under ASan.

**Self-check:**
- [ ] The comment states explicitly who frees and the failure behavior.
- [ ] The function returns `NULL` (without leaking) if any allocation fails.
- [ ] No leaks or overflows under ASan; size math accounts for the trailing `'\0'`.

### Task 7 — The `goto`-cleanup ladder

Write a function that acquires three resources in sequence (open a file, `malloc` a buffer, `malloc` a second buffer), where any step can fail. Use the single-exit `goto done;` pattern so every error path runs the same cleanup. Initialize all pointers to `NULL`/`fp = NULL` up front and rely on `free(NULL)` being safe.

**Self-check:**
- [ ] Every failure path jumps to one cleanup block; there's no duplicated cleanup code.
- [ ] On success, ownership of the kept resources is transferred and you null the local so the ladder doesn't free them.
- [ ] No leak occurs on *any* failure path (test by forcing each failure).

<details><summary>Hint</summary>Force failures by temporarily replacing a `malloc` with `NULL` or opening a nonexistent file, and run LSan on each variant.</details>

---

## Advanced

### Task 8 — Build an arena allocator

Implement `Arena` with `arena_init`, `arena_alloc` (bump pointer, 16-byte aligned, returns `NULL` when full), and `arena_reset`. Use it to build a linked list of 1000 nodes, then reset the arena once to free everything. Confirm no leaks.

**Self-check:**
- [ ] `arena_alloc` correctly aligns each returned pointer to 16 bytes.
- [ ] You never call `free` on individual nodes — only `arena_reset` (and one `free` of the backing block at the end).
- [ ] ASan/LSan reports no leaks after final teardown.
- [ ] You can explain why use-after-free *within* the arena can't happen (nothing is individually freed) — but *can* happen across a reset.

<details><summary>Hint</summary>Alignment: `n = (n + 15) & ~(size_t)15;`. To make ASan see overflows inside arena blocks you'd need `ASAN_POISON_MEMORY_REGION` — note this as a limitation of custom allocators.</details>

### Task 9 — Generational handles instead of pointers

Build a small slot-based store: a fixed array of `{ generation, value }` slots plus a free list. `store_insert` returns a `Handle { index, generation }`; `store_remove` bumps the slot's generation; `store_get(handle)` returns the value only if `handle.generation == slot.generation`, else signals "stale". Demonstrate that a handle to a removed-then-reused slot is detected as stale.

**Self-check:**
- [ ] A handle obtained before removal returns "stale" after the slot is reused.
- [ ] No raw pointers escape the store; callers hold only handles.
- [ ] You can explain how this converts a would-be use-after-free into a *detectable, non-UB* error.

### Task 10 — C++ RAII conversion (C++)

Take a C-style function that does raw `new`/`delete` with an early-return error path (and an exception that could leak). Rewrite it using `std::unique_ptr` / `std::make_unique` so it follows the **Rule of Zero** — no destructor, no manual `delete`. Throw an exception in the middle and confirm (under ASan) that nothing leaks.

**Self-check:**
- [ ] The class/function defines none of the special member functions (Rule of Zero).
- [ ] An exception thrown mid-function leaks nothing — the `unique_ptr` destructor runs during unwinding.
- [ ] You used `make_unique`, not raw `new`, and there is no `delete` anywhere.

### Task 11 — Break (and fix) a `shared_ptr` cycle (C++)

Create `Parent` holding `shared_ptr<Child>` and `Child` holding `shared_ptr<Parent>`. Confirm with logging (or LSan) that destructors never run — the cycle leaks. Then change the back-reference to `weak_ptr` and confirm both destruct.

**Self-check:**
- [ ] With two `shared_ptr`s, neither destructor runs even after all external references drop.
- [ ] Switching the child→parent link to `weak_ptr` lets both objects destruct.
- [ ] You can explain why refcounting can't reclaim cycles (it's not tracing GC).

### Task 12 — Rust catches it at compile time (Rust)

Write Rust that (a) uses a value after moving it, and (b) returns a reference to a local. Observe that *both* are **compile errors**, not runtime crashes. Read the borrow-checker messages. Then write the correct versions (clone or return owned data; restructure lifetimes).

**Self-check:**
- [ ] The use-after-move fails to compile with a "value used after move" error.
- [ ] The dangling-reference version fails with a lifetime/borrow error.
- [ ] You can articulate how Rust moved the safety proof to compile time versus C's runtime UB.

---

## Capstone

### Task 13 — A leak-free, fuzz-clean parser

Write a small parser in C for a simple line-based format (e.g. `key=value` pairs into a dynamically grown array of structs, each owning a heap-allocated key and value string). It must:

- Check every allocation and clean up fully on *any* failure path (use the cleanup-ladder discipline).
- Provide a `config_free` that releases the whole structure, with a clearly documented ownership contract.
- Handle malformed input without leaking or overflowing.

Then write a **libFuzzer harness** (`int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)`) that feeds arbitrary bytes to your parser, and run it under ASan for at least a couple of minutes. Fix every crash and leak it finds.

**Self-check:**
- [ ] `config_free` releases every allocation (keys, values, the array, the struct) with no double-frees.
- [ ] Every parse error path frees what it allocated so far — verified by LSan.
- [ ] The fuzzer runs clean (no ASan aborts, no leaks) for the full duration.
- [ ] The ownership contract for the returned config and for `config_free` is documented at the API boundary.
- [ ] You added at least one targeted unit test for a malformed input the fuzzer discovered.

<details><summary>Hint</summary>Build the fuzzer with `clang -fsanitize=address,fuzzer -g -O1 parser.c fuzz.c -o fuzzer && ./fuzzer -max_total_time=180`. Common findings: missing length checks (overflow), leaking the partially-built config on a mid-parse error, and not NUL-terminating a copied substring.</details>

<details><summary>Solution sketch</summary>Grow the entry array with the safe `realloc`-into-temporary idiom. For each line, `strndup`/`malloc`+`memcpy` the key and value (always account for the trailing `'\0'`). On *any* failure mid-line, free that line's partial allocations *and* call `config_free` on the entries built so far before returning `NULL`. `config_free` iterates entries freeing key then value, then frees the array, then the container. The fuzzer will quickly surface (1) inputs with no `=` (don't deref a `NULL` separator), (2) huge inputs (check your size arithmetic with `calloc`-style overflow guarding), and (3) the partial-failure leak. Each fix is small; the discipline is exercising the error paths the fuzzer reaches.</details>

---

## Self-Assessment

You've internalized manual memory management when you can:

- [ ] Explain why `free` needs no size, and why a one-byte overflow corrupts the *allocator*, not just your data.
- [ ] Use `malloc`/`calloc`/`realloc`/`free` correctly, including the safe `realloc` idiom and `calloc` for overflow-safe sizing.
- [ ] Reproduce and *read the sanitizer report* for use-after-free, buffer overflow, and leaks — and fix each.
- [ ] State and document an ownership contract at any API boundary (caller frees vs. callee frees vs. opaque handle).
- [ ] Apply the `goto`-cleanup ladder so every error path frees correctly.
- [ ] Implement an arena allocator and generational handles, and explain the bug classes each eliminates.
- [ ] Convert raw C++ `new`/`delete` to RAII with `unique_ptr` and the Rule of Zero, and break a `shared_ptr` cycle with `weak_ptr`.
- [ ] Show how Rust turns use-after-move and dangling references into compile errors.
- [ ] Wire ASan + a fuzz harness into a build and drive a parser to fuzz-clean.

If you can do all of these, you understand manual memory not as a set of rules to memorize but as a contract whose every clause has a mechanical reason — and you know which tools enforce it when discipline alone isn't enough.
