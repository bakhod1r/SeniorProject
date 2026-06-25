# Object Model & Layout — Senior Level

> **Focus:** Compressed oops, the mark word's lock/GC encoding and biased-locking history, vtable placement and virtual-dispatch mechanics, hot/cold field splitting, false sharing of hot fields, and the transition-tree machinery behind hidden-class deopts.

> **Topic:** [Object Model & Layout](README.md)

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **The encoding tricks and dispatch mechanics that a runtime engineer must reason about precisely — not as folklore, but bit by bit.**

By now the shape is clear: header, fields, padding; managed runtimes add per-object headers; dynamic languages use hidden classes to recover fixed offsets. This page is where those abstractions become *mechanisms you can reason about under pressure*.

We'll encode and decode **compressed oops** — the JVM trick that stores a 64-bit reference in 32 bits by exploiting object alignment, and why the heap size where it stops working (the "compressed-oops cliff") is a real production tuning knob. We'll read the **mark word as a state machine**: the bit patterns for unlocked, biased, thin-locked, and inflated states, what biased locking was, why it was disabled by default in JDK 15 and removed in JDK 18, and what replaced the displaced-hash dance. We'll lay out **vtables** precisely — where the vptr sits, what's in the table, how a virtual call resolves, and how single vs multiple inheritance changes the picture (this sets up the next topic, method dispatch). And we'll do the production layout moves: **hot/cold field splitting**, eliminating **false sharing of hot fields**, and reading **deopt traces** to find and kill shape pollution.

The senior distinction is precision. A mid-level engineer knows "objects have headers." A senior can tell you that turning off compressed oops above ~32 GB heap *doubles* every reference field's footprint, that a `@Contended` field burns 128 bytes to dodge a coherence storm, and that a megamorphic call site in V8 isn't just "slow" — it has bailed out of the optimizing tier and is interpreting.

---

## Prerequisites

- **Required:** The middle page: JVM/CPython/C++ headers, hidden classes, inline caches, monomorphic/polymorphic/megamorphic.
- **Required:** Binary/hex fluency, bit masking and shifting, two's complement.
- **Required:** A working model of cache lines, the MESI-family coherence protocol, and what a cache-line bounce costs.
- **Helpful:** Familiarity with a JIT's tiered compilation (interpreter → baseline → optimizing) and deoptimization.
- **Helpful:** Having read a `perf c2c` report or a JFR/async-profiler flame graph.

You do **not** need: production capacity-planning workflows or cross-language ABI negotiation at scale — that's `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **oop** | "Ordinary object pointer" — the JVM's term for a managed reference to a heap object. |
| **Compressed oops** | Storing a 64-bit oop as a 32-bit value by encoding it as `(heap_base) + (index << shift)`, exploiting 8-byte object alignment. |
| **Compressed class pointer** | The same trick applied to the klass pointer in the header (`UseCompressedClassPointers`). |
| **Mark word** | The 64-bit header slot whose bit layout depends on the object's lock/GC state. |
| **Biased locking** | A (now removed) optimization that "biased" an object's lock to one thread to avoid CAS on uncontended locks. |
| **Thin / lightweight lock** | A lock held via a CAS of a stack-allocated lock record pointer into the mark word. |
| **Inflated / heavyweight lock** | A lock backed by an OS monitor (`ObjectMonitor`), used under contention. |
| **Displaced mark word** | The original mark word value relocated into a lock record while the object is locked. |
| **vptr / vtable** | Per-object pointer to the per-class table of virtual function pointers. |
| **thunk / trampoline** | A small code stub a vtable slot may point to, e.g. for `this`-pointer adjustment under multiple inheritance. |
| **Hot/cold splitting** | Separating frequently accessed ("hot") fields from rarely accessed ("cold") ones into different cache lines or objects. |
| **False sharing** | Two unrelated hot fields on the same cache line, causing coherence traffic when different cores write them. |
| **`@Contended`** | A JVM annotation (JDK 8+) that pads a field onto its own cache line to prevent false sharing. |
| **Deoptimization (deopt)** | The JIT discarding optimized code and falling back to the interpreter when an assumption (e.g. shape) is violated. |
| **Transition tree** | The tree of hidden-class transitions an engine maintains as properties are added. |
| **NaN-boxing / pointer tagging** | Encoding small values or type tags inside pointer/double bit patterns (referenced in prose). |

---

## Core Concepts

### 1. Compressed Oops: 64-bit References in 32 Bits

A 64-bit pointer is 8 bytes. In a heap full of reference-heavy objects, *most of the heap can be pointers*. The JVM's **compressed oops** optimization stores references as **32-bit** values, halving the cost of every reference field and the klass pointer.

The trick exploits alignment. Objects are 8-byte aligned, so every real object address has its low 3 bits zero. A 32-bit "narrow oop" is therefore an **object index**, decoded as:

```
real_address = heap_base + (narrow_oop << 3)
```

With a 3-bit shift, 32 bits of index addresses `2^32 × 8 = 32 GB` of heap. This is the famous **compressed-oops cliff**: below ~32 GB heap (precisely, when the heap fits the encodable range, often up to ~32 GB), references are 4 bytes; cross it and the JVM disables compressed oops and **every reference field doubles to 8 bytes**. The result is the well-known paradox: a 31 GB heap can hold *more live data* than a 33 GB heap, because the 33 GB heap wastes the savings on fat pointers. Senior tuning lesson: **don't size a heap just over 32 GB** — either stay comfortably under, or go large enough that the extra raw size outweighs the lost compression. (`ObjectAlignmentInBytes` can be raised to push the cliff to 64 GB at the cost of more per-object padding.)

When `heap_base` can be zero (heap mapped low), decoding is just a shift — no add — which is why the JVM tries to reserve low virtual addresses.

### 2. The Mark Word as a State Machine

The mark word's 64 bits are interpreted by a tag in the low bits. The classic states (pre-JDK-15, with biased locking):

```
state          (low bits)   contents
-----------------------------------------------------------------
unlocked       01           identity hash (if computed) | age | 01
biased         101          thread ID | epoch | age | 101
thin-locked    00           pointer to lock record on a thread stack
inflated       10           pointer to the heavyweight ObjectMonitor
GC-marked      11           forwarding pointer (during GC)
```

Two senior-critical consequences:

- **The identity hash and locking compete for the same bits.** When a thread thin-locks an object, the original mark word (which may hold the hash) is **displaced** into a lock record on the stack; the mark word now points there. If you call `System.identityHashCode()` on a biased object, the JVM must *revoke the bias* (it has nowhere to put the hash otherwise). So a seemingly innocent hash request can trigger lock revocation — a real, measurable cost.
- **Lock inflation is a layout event.** A contended lock "inflates": the mark word stops encoding a stack pointer and instead points to a separately allocated `ObjectMonitor`. Inflated monitors are heavier and were a GC/memory concern; modern JDKs added monitor deflation to reclaim them.

### 3. Biased Locking: History and Removal

**Biased locking** assumed most locks are only ever taken by one thread. The first thread to lock an object "biases" it (writes its thread ID into the mark word); thereafter that thread re-enters the lock with *no atomic operation at all* — just a check that the bias still holds. Cheap when right.

But it was expensive when wrong: another thread touching a biased object forces **bias revocation**, a stop-the-world-ish operation. As workloads shifted (thread pools, lots of short-lived contention, modern hardware where uncontended CAS is cheap), the average case stopped favoring bias. **JDK 15 disabled biased locking by default (JEP 374); JDK 18 removed it.** The senior point isn't nostalgia — it's that *the mark word's encoding changed across JDK versions*, so any tool, agent, or off-heap trick that reads mark-word bits is version-fragile. Newer JDKs are also exploring a *compact* object header (Project Lilliput) that shrinks the header further, again rewriting these bit layouts.

### 4. vtable Placement and Virtual Dispatch

For a C++ class with virtual methods, the compiler:

1. Builds one **vtable** per class — a static array of function pointers, one slot per virtual method, in a fixed order, with derived-class overrides replacing base entries.
2. Stores a **vptr** in every object, conventionally at **offset 0** (so the base subobject's vptr is found first).

A virtual call `p->foo()` compiles to roughly:

```
load  vptr   <- [p + 0]          ; fetch the object's vtable pointer
load  fn     <- [vptr + slot*8]  ; fetch foo's entry (slot fixed at compile time)
call  fn     (p, args...)        ; indirect call, `this` = p
```

Two dependent loads then an indirect call. The indirect call is the part that hurts: it's hard to inline, mispredicts on the branch predictor when the target varies, and pollutes the I-cache when many targets are live. This is *exactly* what the next topic (method dispatch) and JITs work to optimize — via inline caches, devirtualization, and speculative inlining.

**Multiple inheritance** complicates layout: an object with two polymorphic bases has *two* vptrs (one per base subobject), and calling a method through the second base requires a **`this`-pointer adjustment** (a fixed offset, or a thunk in the vtable) so `this` points at the right subobject. Virtual inheritance adds vbase offsets. The senior takeaway: **the simple "vptr at offset 0" picture holds for single inheritance; multiple/virtual inheritance multiplies vptrs and inserts adjustment thunks** — a reason layout-sensitive code prefers single inheritance or composition.

### 5. Hot/Cold Field Splitting

A common production object is large but has a tiny **hot set** — a few fields touched in the inner loop — surrounded by **cold** fields (debug info, rarely read metadata, audit timestamps). If hot and cold fields share cache lines, every hot-loop access drags cold bytes into cache, and you fit fewer hot sets per line.

**Hot/cold splitting** separates them:

- *Within an object:* order so the hot fields cluster at the front (one cache line), cold fields after.
- *Across objects:* move cold fields into a separate "extension" object reached by a pointer, so the common object stays one or two cache lines.
- *Structurally:* the SoA move — keep a dense array of hot fields and a parallel array (or sidecar map) of cold ones.

The win is "useful bytes per cache line" in the hot loop, often a multiple-x speedup with zero algorithmic change. This is the same instinct as SoA, applied at field granularity.

### 6. False Sharing of Hot Fields

Two fields can be logically independent yet physically share a 64-byte cache line. If two cores each write *their own* field on the same line, the coherence protocol treats every write as a conflict: the line ping-pongs between cores, invalidating each other's copy. This **false sharing** can make a "perfectly parallel" per-thread counter array scale *negatively*.

The fixes are layout fixes:

- **Pad to a cache line.** `alignas(64)` in C++; `_ [56]byte` filler in Go; `@Contended` in Java (which actually pads with 128 bytes to defeat adjacent-line prefetch). Note the *real* unit is often **two** cache lines because of the hardware's adjacent-line prefetcher — hence 128, not 64.
- **Don't co-locate hot, independently-written fields.** Two atomics that different threads hammer should not be neighbors.
- **Per-thread / per-CPU sharding** so each writer owns its own line outright.

False sharing is a *correctness-silent* performance bug: the program is correct, just mysteriously slow, and it only appears under true parallelism. `perf c2c` (cache-to-cache) is the tool that pinpoints the offending line.

### 7. Hidden-Class Deopt, Mechanically

The middle page said "inconsistent shapes deoptimize." Here's the mechanism. The optimizing JIT compiles a hot function under **speculative assumptions** baked from observed behavior: "this argument is always shape C2, so I'll emit a fixed-offset load for `.x` guarded by a shape check." When a new shape arrives, the guard fails, triggering a **deopt**: the optimized frame is discarded, execution resumes in the interpreter, and the function may be recompiled — now polymorphic, with weaker assumptions and slower code. Enough shape variety and the site goes **megamorphic**: the engine stops specializing entirely and uses a generic, hashed lookup, and the optimizing compiler may refuse to optimize the function at all.

So a deopt is not a one-time hiccup. A site that keeps seeing new shapes can enter a deopt loop (compile → deopt → recompile) that's worse than never optimizing. The senior fix is the same shape discipline, but now *measured*: run under `--trace-deopt`/`--trace-ic`, find the exact site, and identify the construction path that forks the shape.

### 8. Tagged vs Boxed, and Where the Header Goes Away

A boxed small integer pays a full header. The escape is **tagged representation**: steal the low bits of a machine word for a type tag (pointer tagging) or hide a payload in the unused bits of a NaN double (NaN-boxing in JS engines). A "Smi" (small integer) in V8 is a tagged 31-bit int stored *inline in the pointer slot* — no heap object, no header. The senior connection to layout: **whether a field is tagged-inline or boxed-out-of-line changes the object's footprint and the cache behavior of every loop over it.** When you control representation (Rust enums with niche optimization, C unions with a discriminant, custom NaN-boxing), you're doing object-model engineering — covered in depth by the data-representation topic, but you must recognize it here because it determines whether a "field" costs 0 extra bytes or a pointer plus a header.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Compressed oops** | Numbering parking spots 1–N instead of writing full GPS coordinates; multiply the spot number by the lot's grid spacing to recover the real position. The scheme breaks once the lot is bigger than your numbering can address. |
| **Mark word states** | A single status light that means "free / reserved / in-use / being-towed" depending on a tiny color code — one fixture, four meanings. |
| **Biased locking** | Reserving a meeting room for one regular so they walk straight in — great until someone else needs it and you must formally un-reserve it (revocation). |
| **Displaced hash** | Temporarily moving the room's nameplate to a clipboard while it's occupied, then putting it back. |
| **vtable dispatch** | Calling the front desk (vptr) to get the right specialist's extension (vtable slot) before you can talk to them — two lookups before the actual call. |
| **`this`-adjustment thunk** | A receptionist who hands you a corrected room number because you walked in the wrong entrance (the second base). |
| **Hot/cold splitting** | Keeping the tools you use every minute on the bench and the once-a-year tools in the basement, so the bench stays uncluttered. |
| **False sharing** | Two clerks forced to share one ledger page: every time one writes, the other must wait for the page back, even though they track different columns. |
| **Deopt loop** | A factory line re-tooling for a new product on every single unit because the units keep arriving in unpredictable variants. |

---

## Mental Models

### The "Encoding Has a Range" Model

Every compaction trick — compressed oops, tagged pointers, NaN-boxing, packed mark words — buys density by *encoding* values into fewer bits, and every encoding has a **range** and a **cliff**. Compressed oops cliff at the addressable heap; Smis cliff at 31 bits; mark-word bits cliff when hash and lock both want them. The senior habit is to always ask "what's the range of this encoding, and what happens at the boundary?" The boundary is where production surprises live (the 32 GB heap, the int that overflows into a boxed bignum, the hash that forces lock revocation).

### The "Dependent Loads Cost" Model

Virtual dispatch, boxed-field access, and pointer-chasing all share a shape: **load a pointer, then load through it** (sometimes twice). Each dependent load is a potential cache miss that *can't* be overlapped with the previous one because you need the first result to issue the second. Model layout decisions as "how many dependent loads to reach the byte I want?" Inline field: zero hops. Boxed field: one hop + a header. Virtual call: vptr load + slot load. The fewer hops on the hot path, the faster — which is the whole argument for inline fields, flattening, and devirtualization.

### The "Coherence Is a Shared Resource" Model

A cache line is a unit of *ownership*, and writing it requires exclusive ownership across all cores. Two cores writing the same line — even different bytes — serialize on that ownership. So treat each hot, frequently-written field as needing its *own* line, and treat the cache line as a contended resource to be partitioned across threads, exactly like you'd partition a lock. This model turns "false sharing" from a mystery into an obvious consequence of two writers sharing a unit of exclusive ownership.

---

## Code Examples

### Java — Seeing the compressed-oops cliff

```bash
# Below the cliff: compressed oops on, references are 4 bytes.
java -Xmx30g -XX:+PrintFlagsFinal -version | grep UseCompressedOops   # true

# Above ~32g: the JVM turns it off; references become 8 bytes.
java -Xmx40g -XX:+PrintFlagsFinal -version | grep UseCompressedOops   # false

# Force the alignment knob to push the cliff out (costs more padding):
java -Xmx40g -XX:ObjectAlignmentInBytes=16 ...   # narrow oops now reach 64g
```

The practical rule: a heap a hair over 32 GB can hold *less* live data than one just under, because every reference field doubled. Size around the cliff deliberately.

### Java — Inspecting the mark word and forcing hash/lock interaction

```java
import org.openjdk.jol.info.ClassLayout;
import static org.openjdk.jol.vm.VM.current;

public class MarkWord {
    public static void main(String[] args) {
        Object o = new Object();
        // Fresh object: mark word shows the "unlocked, no hash" pattern.
        System.out.println(ClassLayout.parseInstance(o).toPrintable());

        o.hashCode();   // computes identity hash -> now stored in the mark word
        System.out.println(ClassLayout.parseInstance(o).toPrintable());

        synchronized (o) {
            // Locked: the mark word now holds a lock-record pointer;
            // the previously-stored hash is "displaced" into the lock record.
            System.out.println(ClassLayout.parseInstance(o).toPrintable());
        }
    }
}
```

JOL prints the raw header bytes at each step; you can literally watch the mark word change meaning as you compute a hash and then lock.

### Java — `@Contended` to kill false sharing

```java
// Requires -XX:-RestrictContended to use @Contended outside the JDK.
import jdk.internal.vm.annotation.Contended;

class Counters {
    @Contended volatile long a;   // padded onto its own (pair of) cache line(s)
    @Contended volatile long b;   // ...so two threads writing a and b don't collide
}
```

Without `@Contended`, `a` and `b` likely share a 64-byte line; two threads each writing one of them ping-pong the line. `@Contended` pads each to ~128 bytes of isolation.

### C++ — vtable layout under single vs multiple inheritance

```cpp
struct A { virtual void f(); int a; };          // vptr_A, a
struct B { virtual void g(); int b; };          // vptr_B, b
struct C : A, B { void f() override; void g() override; int c; };
// C's layout (typical Itanium ABI):
//   [vptr_A][a]   <- A subobject; vtable here has C::f
//   [vptr_B][b]   <- B subobject; vtable here has C::g + a `this`-adjusting thunk
//   [c]
// Calling g() through a B* must add the offset to reach the C from the B subobject.
```

### C++ — Hot/cold split

```cpp
// Before: one fat object; the hot loop touches only `pos`, but every line
// it fetches also carries `name`, `created_at`, `audit` -> wasted bandwidth.
struct Entity {
    Vec3 pos;                       // HOT: touched every frame
    Vec3 vel;                       // HOT
    std::string name;               // cold
    std::chrono::time_point created_at; // cold
    AuditLog audit;                 // cold
};

// After: hot fields in a dense array; cold fields in a sidecar keyed by index.
struct HotEntity { Vec3 pos, vel; };          // 24 bytes, tight -> >2 per line
std::vector<HotEntity> hot;                    // the inner loop streams this
std::vector<ColdEntity> cold;                  // touched rarely, off the hot path
```

### Go — Padding to prevent false sharing

```go
type PaddedCounter struct {
    v   uint64
    _   [56]byte   // pad to 64 bytes so neighbors don't share a line
}

var counters [NumCPU]PaddedCounter   // each core writes its own line
```

### Rust — niche optimization removes the tag

```rust
// Option<&T> is the same size as &T: the compiler uses the
// impossible null pointer as the `None` "niche" -- no extra tag byte, no padding.
assert_eq!(std::mem::size_of::<Option<&u8>>(), std::mem::size_of::<&u8>());
// This is layout-level tagged representation done for free by the compiler.
```

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| **Compressed oops** | Halves reference/klass-pointer footprint; more live data per GB; better cache density. | Hard cliff near 32 GB; a decode `(base + (n<<3))` on each deref (cheap, but nonzero). |
| **Packed mark word** | Hash + lock + GC metadata in one 64-bit slot; no separate allocation in the common case. | Hash and lock contend for bits; identityHashCode can force lock revocation; version-fragile encoding. |
| **vtable dispatch** | Uniform polymorphism, one indirection. | Dependent loads + unpredictable indirect call; blocks inlining; multiple inheritance adds vptrs/thunks. |
| **Hot/cold splitting** | Big cache-efficiency wins on hot loops; no algorithm change. | More objects/arrays to manage; indirection to reach cold data; complexity. |
| **`@Contended` / padding** | Eliminates false sharing; restores parallel scaling. | Burns ~128 bytes per isolated field; wasteful if applied where there's no contention. |
| **Tagged/niche representation** | Removes per-value header; inline small values; zero-cost `Option`. | Limited value range; encoding/decoding logic; harder to reason about and debug. |

---

## Use Cases

Apply senior-level layout reasoning when:

- **A JVM service is memory-bound near 32 GB.** The compressed-oops cliff may mean a *smaller* heap holds more — measure both sides.
- **A parallel workload scales sub-linearly or negatively.** Suspect false sharing of hot fields; confirm with `perf c2c`; fix with padding/`@Contended`/sharding.
- **A hot loop over large objects is cache-bound.** Hot/cold split or go SoA so the inner loop streams only what it needs.
- **A JS/TS hot path keeps deopting.** Trace it, find the shape-forking construction path, and enforce a single shape.
- **You're writing a runtime, allocator, serializer, or off-heap store** that reads or writes object headers — you must track the per-JDK mark-word/compressed-oop encoding.
- **You're designing a polymorphic-heavy C++ hot path.** Weigh the vtable indirection against templates/CRTP or `std::variant` + visitation for devirtualization.

Reasoning at this depth is overkill for small object counts, cold code, or anything not on a measured hot path.

---

## Coding Patterns

### Pattern 1: Cluster hot fields, exile cold ones

```cpp
struct Object {
    // hot first, packed into the leading cache line:
    uint64_t key; uint32_t flags; float score;
    // cold after (or behind a pointer):
    ColdExtras* extras;   // name, debug info, audit -> allocated lazily
};
```

### Pattern 2: Per-line isolation for contended counters

```java
@Contended long perThreadCounter;     // Java
```
```go
type C struct { v uint64; _ [56]byte } // Go
```
```cpp
struct alignas(64) Counter { std::atomic<uint64_t> v; };  // C++
```

### Pattern 3: Devirtualize hot polymorphism

```cpp
// Instead of a vtable call per element, use a closed set + std::variant:
using Shape = std::variant<Circle, Square, Triangle>;
for (auto& s : shapes)
    std::visit([](auto& shp){ shp.area(); }, s);   // compiler can inline each arm
```

### Pattern 4: Keep heap sizing off the cliff

```bash
# Prefer this...
-Xmx31g       # compressed oops ON, dense references
# ...over a heap a hair above 32g that silently fattens every pointer.
```

### Pattern 5: One shape per logical type (JS), enforced and tested

```js
class Vec3 { constructor(x,y,z){ this.x=x; this.y=y; this.z=z; } }
// Lint/test that no code path adds/deletes properties on Vec3 instances.
```

---

## Best Practices

- **Treat the 32 GB heap boundary as a real constraint.** Verify `UseCompressedOops` is on; size deliberately around the cliff or raise `ObjectAlignmentInBytes` knowingly.
- **Don't read raw mark-word bits without pinning a JDK version.** The encoding changed with biased-locking removal and will change again under compact-header projects.
- **Hunt false sharing with the right tool.** `perf c2c` (Linux), Intel VTune, or JFR; don't pad blindly — padding the wrong field just wastes memory.
- **Pad to 128 bytes, not 64,** when defeating false sharing, to account for adjacent-line prefetch.
- **Hot/cold split only measured-hot objects.** Profile first; the indirection to cold data is a cost you only want where the hot win pays for it.
- **Prefer composition or `variant`/CRTP over deep polymorphism** on hot paths to enable devirtualization and inlining.
- **Make shape discipline a tested invariant** in dynamic-language hot paths; trace deopts in CI-style perf runs, not just by eye.
- **Remember `identityHashCode` has side effects** under locking; avoid calling it on hot locked objects.

---

## Edge Cases & Pitfalls

- **The "bigger heap holds less" trap.** Bumping `-Xmx` from 31 GB to 34 GB can *reduce* effective capacity by disabling compressed oops. Always check the flag.
- **`identityHashCode` forcing revocation.** On JDKs with biased locking, hashing a biased object revokes the bias; in tight loops this surfaces as unexplained jitter.
- **Padding that the JIT/compiler removes.** A "padding" field with no uses can be elided; ensure the padding is real (e.g. `volatile`, or the language's contended annotation) or it won't survive optimization.
- **`@Contended` ignored.** It requires `-XX:-RestrictContended` (or being in the JDK) to take effect on user classes; silently does nothing otherwise.
- **Multiple inheritance vptr surprises.** `sizeof` jumps by *two* pointers, and a `static_cast` between base subobjects shifts `this` by a nonzero offset — pointer identity is not preserved across the cast.
- **Megamorphic deopt loops.** A site that keeps seeing new shapes can compile/deopt repeatedly, performing *worse* than the interpreter. The fix is to remove the shape variety, not to "warm it up more."
- **NaN-boxing and the float that isn't.** In NaN-boxed engines, certain bit patterns of a `double` are reserved for tags; naive bit-twiddling on doubles can collide with the tagging scheme.
- **Cross-version off-heap layout assumptions.** Code that mmaps objects or parses headers (agents, profilers, serializers) breaks when the runtime's header layout changes between releases.
- **False sharing inside arrays of small atomics.** `std::atomic<int> flags[64]` packs 16 atomics per line; threads hammering different indices still false-share. Pad each, or use one atomic with bit operations only if single-writer.

---

## Test Yourself

1. Encode the address `0x0000_0008_0000_0040` as a narrow oop given `heap_base = 0x0000_0008_0000_0000` and a 3-bit shift. Then decode it back. Show the arithmetic.
2. Explain precisely why a heap of 34 GB can hold less live data than one of 31 GB. What single flag changes, and what is its effect on every reference field?
3. Walk through what happens to an object's mark word when you (a) call `hashCode()`, then (b) enter a `synchronized` block on it. Where does the hash go?
4. Why was biased locking removed, and what does its removal mean for a tool that parses mark-word bits across JDK versions?
5. Lay out `struct C : A, B` where both `A` and `B` have virtual methods. How many vptrs does a `C` have, and why does calling a `B`-inherited virtual through a `C*` need a `this` adjustment?
6. You have a per-core counter array that scales *negatively* with core count. Name the bug, the tool to confirm it, and two fixes. Why pad to 128 bytes rather than 64?
7. Given a 96-byte object whose hot loop touches only two 4-byte fields, design a hot/cold split and estimate the change in useful-bytes-per-cache-line.
8. A V8 function deopts repeatedly. Describe the compile→deopt→megamorphic progression and the exact construction-time mistake most likely causing it.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            OBJECT MODEL & LAYOUT — SENIOR MECHANICS             │
├──────────────────────────────────────────────────────────────────┤
│ COMPRESSED OOPS:  real = base + (narrow << 3)                    │
│   8-byte align -> 32-bit index covers 32 GB heap                 │
│   CLIFF near 32 GB: cross it -> all refs become 8 bytes          │
│   ObjectAlignmentInBytes=16 -> reach 64 GB (more padding)        │
├──────────────────────────────────────────────────────────────────┤
│ MARK WORD STATES (low tag bits):                                 │
│   01 unlocked (hash|age)   00 thin-lock (lock-record ptr)        │
│   101 biased (gone >=JDK18) 10 inflated (ObjectMonitor ptr)      │
│   hash and lock share bits -> hashCode can revoke a bias         │
├──────────────────────────────────────────────────────────────────┤
│ VTABLE:  vptr@0 -> [slot]=fn ptr; call = 2 dependent loads+icall │
│   multiple inheritance -> N vptrs + this-adjusting thunks        │
├──────────────────────────────────────────────────────────────────┤
│ HOT/COLD SPLIT: cluster hot fields in front; exile cold behind   │
│   a pointer or into a sidecar -> more hot sets per cache line    │
├──────────────────────────────────────────────────────────────────┤
│ FALSE SHARING: independent hot fields on one line -> ping-pong   │
│   fix: pad to 128B (adj-line prefetch), @Contended, per-CPU      │
│   confirm with: perf c2c                                         │
├──────────────────────────────────────────────────────────────────┤
│ DEOPT: optimized code guards on shape; new shape -> discard+redo │
│   repeated -> megamorphic -> generic hash lookup / no opt        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Compressed oops** store 64-bit references in 32 bits via `real = base + (narrow << 3)`, exploiting 8-byte alignment to cover a ~32 GB heap; crossing that **cliff** fattens every reference to 8 bytes, so a slightly bigger heap can hold *less* data.
- The **mark word** is a state machine: unlocked (hash/age), thin-locked (lock-record pointer), inflated (monitor pointer), with hash and lock contending for the same bits — so `identityHashCode` can trigger bias revocation.
- **Biased locking** was a one-thread fast path, disabled in JDK 15 and removed in JDK 18; the mark-word encoding is therefore **version-dependent**, and compact-header work will change it again.
- **vtable dispatch** is a vptr load (offset 0) plus a slot load plus an indirect call — two dependent loads that block inlining; **multiple inheritance** gives an object several vptrs and inserts `this`-adjustment thunks.
- **Hot/cold splitting** clusters hot fields onto their own cache lines (or exiles cold fields behind a pointer/sidecar), raising useful-bytes-per-line in the inner loop with no algorithm change.
- **False sharing** of independent hot fields on one cache line serializes parallel writers; fix by padding to ~128 bytes (`@Contended`, `alignas`, filler) or per-CPU sharding, and confirm with `perf c2c`.
- **Hidden-class deopt** is mechanical: optimized code guards on a shape; a new shape forces a deopt back to the interpreter, and enough shape variety yields a **megamorphic** generic lookup or a deopt loop.
- **Tagged/niche representation** (Smis, NaN-boxing, Rust niches) removes per-value headers and is the layout-level lever that decides whether a field costs zero extra bytes or a pointer plus a header.

---

## What You Can Build

- **A compressed-oops cliff demonstrator.** A program that fills the heap with reference-heavy objects at `-Xmx31g` and `-Xmx34g` and reports how much live data fit in each — proving the paradox.
- **A mark-word watcher.** Using JOL, snapshot an object's header through fresh → hashed → locked → contended states and pretty-print the bit transitions.
- **A false-sharing benchmark + fix.** A per-core counter array that scales negatively, plus a padded version that scales linearly; include the `perf c2c` output.
- **A vtable layout dumper.** For a small class hierarchy (including multiple inheritance), print vptr offsets, vtable contents, and the `this`-adjustment thunks (e.g. via `-fdump-lang-class` or by reading disassembly).
- **A deopt-loop reproducer.** A JS function that you can flip between monomorphic and megamorphic, with `--trace-deopt` output annotated to show the compile/deopt cycle.

---

## Further Reading

- *JEP 374: Disable and Deprecate Biased Locking* — the rationale and the encoding change.
- *Project Lilliput* (compact object headers) — the future of the JVM header layout.
- OpenJDK *JOL* samples on mark words, compressed oops, and `@Contended`.
- *The Itanium C++ ABI* — the authoritative spec for vtable layout, vptr placement, and `this`-adjustment thunks.
- *What Every Programmer Should Know About Memory* — Drepper, on cache coherence and false sharing.
- *Memory-efficient Java* talks and the Aleksey Shipilëv blog (JOL author) — deep, precise JVM-layout material.
- V8 blog: *Slack tracking*, *Maps*, and the deoptimization design docs; Node `--trace-deopt`/`--trace-ic`.
- Intel/AMD optimization manuals on adjacent-line prefetch (why 128-byte padding).

---

## Related Topics

- This folder: `junior.md`, `middle.md`, `professional.md`, `interview.md`, `tasks.md`.
- The next runtime topic, **method dispatch**, builds directly on the vtable mechanics here — inline caches, devirtualization, and speculative inlining as ways to dodge the vtable indirection.
- **Data representation** owns the tagged-vs-boxed, NaN-boxing, and pointer-tagging material referenced here in prose.
- **Garbage collection** depends on the mark word's GC/age bits and the forwarding-pointer state, and on the compressed-oop encoding for heap walking.
- **Cache architecture and coherence** underpin false sharing, hot/cold splitting, and the cost of dependent loads.

---

## Diagrams & Visual Aids

### Compressed Oop Encode/Decode

```text
real address (8-byte aligned):   ...XXXX X000   (low 3 bits = 0)
                                          │ shift right 3
narrow oop (stored, 4 bytes):    ...XXXX X       (the "index")

decode:   real = heap_base + (narrow << 3)
range:    2^32 indices * 8 bytes = 32 GB  <-- the cliff
```

### Mark Word State Transitions

```text
   new object
       │
       ▼
 ┌───────────┐  hashCode()  ┌───────────────┐
 │ unlocked  │─────────────▶│ unlocked+hash │
 │  age|01   │              │  hash|age|01  │
 └─────┬─────┘              └───────┬───────┘
       │ synchronized               │ synchronized
       ▼                            ▼
 ┌───────────┐  contention   ┌───────────────┐
 │ thin-lock │──────────────▶│   inflated    │
 │ rec-ptr|00│               │ monitor-ptr|10│
 └───────────┘               └───────────────┘
   (hash, if any, is "displaced" into the lock record while locked)
```

### vtable Dispatch

```text
 object p                 vtable for p's class
┌──────────┐  load vptr  ┌────────────────────┐
│  vptr  ──┼────────────▶│ slot0: &Base::f     │
│  field a │             │ slot1: &Derived::g  │◀── load [vptr + slot*8]
│  field b │             │ slot2: &Base::h     │
└──────────┘             └────────────────────┘
   call site: 2 dependent loads, then an INDIRECT call (hard to inline)
```

### Hot/Cold Split and the Cache Line

```text
BEFORE (fat object, hot loop reads only `pos`):
 cache line: [ pos | vel | name-ptr | created_at | audit-ptr ... ]
              ^use   ^use   ^------- cold, dragged in for nothing -----^

AFTER (hot array):
 cache line: [ pos | vel | pos | vel | pos | vel ... ]
              ^---------------- all useful ----------------^
```

### False Sharing

```text
        one 64-byte cache line
       ┌───────────────┬───────────────┐
core 0 │  counterA     │               │  writes A
core 1 │               │  counterB     │  writes B
       └───────────────┴───────────────┘
   every write needs exclusive ownership of the WHOLE line
   -> line ping-pongs between cores even though A and B are unrelated
   fix: put counterA and counterB on separate lines (pad)
```
