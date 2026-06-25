# Evaluation Strategies (call-by-x) — Junior Level

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)
> **Focus:** When you call a function and pass it an argument, what *exactly* does the function receive — a copy, the original, or something in between? Getting this one idea right kills a whole category of "why did my variable change?" bugs.

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
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does a function actually receive when you pass it an argument?**

Every time you write `f(x)`, the language has to answer a question you almost never think about: *how* does the value of `x` get into `f`? Does the language hand `f` a fresh copy of `x`'s value, so anything `f` does cannot touch your `x`? Or does it hand `f` a way to reach back and modify your original `x`? Or something subtler — a copy of a *pointer* to the same object?

The set of rules a language uses to answer that question is called its **evaluation strategy**, or more specifically its **parameter-passing strategy** (the "call-by-x" family: call-by-value, call-by-reference, call-by-sharing, and a few exotic ones). It is one of the most under-taught topics in programming, and it is responsible for an enormous number of beginner bugs that sound like: *"I passed my list into a function, the function changed it, and now my original list is different — but when I passed an integer the same way, nothing changed. Why?"*

In one sentence: **the evaluation strategy is the contract that decides whether a function can reach back and modify the caller's variables.** Almost every confusing "spooky action at a distance" bug a junior hits is really a misunderstanding of this contract.

> 🎓 **Why this matters for a junior:** The number one source of "I have no idea why this changed" bugs in your first year is mutation through a parameter. Once you can say, for *your* language, "primitives are copied, objects share, and assigning to the parameter never touches the caller," you will stop being surprised. That single sentence is worth a hundred print-statement debugging sessions.

This page covers the three strategies you will meet every day — **call-by-value**, **call-by-reference**, and **call-by-sharing** (the one Python, Java, and JavaScript actually use for objects) — plus a first look at *why immutable values make the whole question disappear*. The `middle.md` page adds call-by-name, thunks, and laziness; `senior.md` connects all of this to lambda calculus and move semantics; `professional.md` goes into performance and API design.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and call a function with arguments in at least one language (Python, Java, JavaScript, Go, C, or similar).
- **Required:** What a variable is, and what "assigning" to a variable means (`x = 5`).
- **Required:** The difference between a number/string and a collection like a list, array, or object.
- **Helpful but not required:** A vague idea of what "memory" is — that a value lives *somewhere* and a variable is a *name* for that place.
- **Helpful but not required:** Having been bitten once by "I changed it inside the function and the outside changed too." That confusion is exactly what this page resolves.

You do **not** need to know:

- Lambda calculus, reduction order, or strict vs non-strict evaluation (that is `middle.md` and `senior.md`).
- Thunks, laziness, or call-by-need (`middle.md`).
- Move semantics, rvalue references, or Rust ownership (`senior.md`).
- Anything about compilers or CPU registers.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Argument** | The actual value you pass at the call site: in `f(3)`, the argument is `3`. |
| **Parameter** | The named placeholder inside the function definition that receives the argument: in `def f(x):`, the parameter is `x`. |
| **Evaluation strategy** | The rules a language uses to evaluate arguments and bind them to parameters. The "call-by-x" family. |
| **Call-by-value** | The function receives a **copy** of the argument's value. Changes to the parameter never affect the caller. |
| **Call-by-reference** | The function receives an **alias** for the caller's variable. Assigning to the parameter changes the caller's variable. |
| **Call-by-sharing** | The function receives a **copy of a reference** to the same object. It can *mutate* the object, but cannot *reassign* the caller's variable. (Python, Java, JS, Ruby work this way for objects.) |
| **Reference / pointer** | A value that "points at" where another value lives in memory. Following it gets you the actual object. |
| **Alias** | Two different names that refer to the same underlying object or storage. |
| **Mutate** | Change the *contents* of an existing object (e.g. `list.append(4)`), without creating a new object. |
| **Reassign / rebind** | Point a variable at a *different* object (e.g. `x = newList`). The old object is untouched. |
| **Immutable** | A value that cannot be changed after creation (numbers, strings, tuples, frozen sets). |
| **Mutable** | A value whose contents can change in place (lists, dicts, arrays, most objects). |
| **Primitive** | A simple built-in value like an `int`, `float`, `bool`, or `char`. Usually copied. |
| **Side effect** | Any change a function makes that outlives the call: modifying an argument, writing a global, printing. |

---

## Core Concepts

### 1. The Question Every Function Call Answers

When you write:

```python
x = 10
f(x)
```

the language must decide what `f` gets. There are really only three everyday answers:

1. **A copy of the value** (`10`). `f` can do anything with it; your `x` stays `10`. This is **call-by-value**.
2. **A handle to your variable itself.** If `f` writes `x = 99`, *your* `x` becomes `99`. This is **call-by-reference** — relatively rare as a built-in (C++, Pascal, C#'s `ref`).
3. **A copy of a reference to the same object.** `f` cannot change which object your variable points to, but if the object is mutable, `f` can change its *contents*. This is **call-by-sharing**, and it is what Python, Java, JavaScript, Ruby, and C# (for class types) actually do.

Almost every junior bug comes from confusing #1 and #3.

### 2. Call-by-Value: The Function Gets a Copy

In a pure call-by-value language, the argument is copied into the parameter. The parameter is a brand-new variable that happens to start with the same value.

```c
void addOne(int n) {
    n = n + 1;      // changes the LOCAL copy only
}

int main() {
    int x = 5;
    addOne(x);
    // x is STILL 5. The function changed its own copy.
}
```

C passes everything by value. Even a struct is *copied* into the function. The mental rule: **assigning to a parameter in a call-by-value language never affects the caller.** Full stop.

### 3. Call-by-Reference: The Function Gets Your Variable

In a true call-by-reference language, the parameter is an *alias* for the caller's variable. There is no copy — both names refer to the same storage.

```cpp
void addOne(int& n) {   // C++: the & makes it call-by-reference
    n = n + 1;          // changes the CALLER's variable
}

int main() {
    int x = 5;
    addOne(x);
    // x is now 6. The function reached back and changed it.
}
```

The single `&` is the whole difference. This is powerful and occasionally exactly what you want (e.g. a function that returns two values by writing into two parameters), but it makes functions harder to reason about: you cannot tell from the call site `addOne(x)` whether `x` will survive unchanged.

### 4. Call-by-Sharing: The Confusing One (Python / Java / JS)

Here is the part that trips up everyone. Languages like Python, Java, and JavaScript do **not** give you call-by-reference for objects, and they do **not** give you a deep copy either. They give you a **copy of the reference**. Both the caller's variable and the parameter point at *the same object*.

```python
def mutate(lst):
    lst.append(99)      # changes the SHARED object — caller sees it
    lst = [1, 2, 3]     # REBINDS the local name only — caller does NOT see it

original = [1, 2]
mutate(original)
print(original)         # [1, 2, 99]  — the append leaked out; the rebind did not
```

Read that twice. Two operations look similar but behave completely differently:

- `lst.append(99)` **mutates the shared object** → visible to the caller.
- `lst = [1, 2, 3]` **rebinds the local parameter** to a new object → invisible to the caller.

The crisp way to say it: **Python passes the reference *by value*.** You get a copy of the arrow, not a copy of the box, and not the caller's variable slot itself.

### 5. Why Integers "Feel" Like Call-by-Value in Python

If you do:

```python
def addOne(n):
    n = n + 1
    print(n)      # 6

x = 5
addOne(x)
print(x)          # 5 — unchanged!
```

This looks like call-by-value, but it is the *same* call-by-sharing rule. `n = n + 1` is a **rebind**: `n + 1` makes a brand-new integer object, and `n` is pointed at it. Integers are **immutable** in Python — there is no `n.increment_in_place()` — so the only thing you *can* do is rebind, and rebinds never reach the caller. Mutability, not a different passing rule, is why numbers behave one way and lists another.

### 6. The Unifying Insight: It's All About What You Can and Can't Do

| Operation | Call-by-value | Call-by-reference | Call-by-sharing |
|-----------|---------------|-------------------|-----------------|
| Rebind the parameter (`p = other`) | local only | **affects caller** | local only |
| Mutate the object (`p.field = ...`) | local only (it's a copy) | affects caller | **affects caller** |

Notice call-by-sharing sits in between. You can't rebind the caller's variable, but you *can* reach into the shared object and change it. That single row is the source of nearly every "why did my list change?" bug.

---

## Real-World Analogies

**Call-by-value — photocopying a document.** You hand someone a photocopy of your notes. They scribble all over it, tear it up, set it on fire. Your original is untouched in your drawer. Whatever they do to their copy stays with their copy.

**Call-by-reference — handing over your only notebook.** You give someone your actual notebook. If they cross out a page or write on it, your notebook is changed, because there is only one notebook and you both have it.

**Call-by-sharing — texting someone the address of a shared warehouse.** You don't send the warehouse (too big to copy), and you don't give up *your* slip of paper. You send a *copy of the address*. Now you both have a slip pointing to the same warehouse.
- If your friend goes to the warehouse and rearranges the boxes (`mutate`), you see the change when you visit — same warehouse.
- If your friend scribbles a *different* address on *their* slip (`rebind`), your slip still points at the original warehouse. Their change is to their paper, not to your paper or to the building.

That warehouse analogy *is* Python/Java/JS object passing, exactly.

**Immutability — a printed, laminated reference card.** If the warehouse were sealed and read-only (immutable, like a Python `tuple` or `str`), it would not matter that you share the address — nobody can change anything, so sharing is perfectly safe and the whole call-by-value-vs-sharing distinction stops mattering.

---

## Mental Models

**Model 1: "Variables are names, objects are boxes, references are arrows."**
A variable is a *name* with an *arrow* pointing at a box. Passing an argument copies the *arrow*, not the box. Rebinding (`x = ...`) re-points your arrow. Mutating (`x.field = ...`) reaches along the arrow and changes the box. Once you see arrows and boxes, every behavior becomes predictable.

**Model 2: "Two questions, two answers."**
For any function call in your language, answer:
1. *Can the function rebind my variable to point at something else?* (Almost always **no**, unless you have true call-by-reference.)
2. *Can the function change the contents of the object I passed?* (**Yes**, if the object is mutable and shared.)
Memorize the two answers for your language and you are done.

**Model 3: "Copy of the value — but for objects, the value *is* the reference."**
Python, Java, and JS are honestly described as "call-by-value, where the value of an object expression is a reference." That sounds like a lawyer's trick, but it perfectly predicts behavior: the *value* (the arrow) is copied; the arrow points at a shared box.

**Model 4: "Immutability is the off-switch for the whole problem."**
If a value can't change, it doesn't matter how it's passed. Numbers, strings, and tuples in Python are immutable, so they *feel* like call-by-value even though the mechanism is call-by-sharing. When in doubt, prefer immutable arguments and the confusion evaporates.

---

## Code Examples

### Example 1: The Same Code, Three Languages, Watch the Difference

```python
# Python — call-by-sharing
def f(lst):
    lst.append(4)     # mutates shared object → leaks out

a = [1, 2, 3]
f(a)
print(a)              # [1, 2, 3, 4]
```

```java
// Java — call-by-sharing (same as Python for objects)
void f(List<Integer> lst) {
    lst.add(4);       // mutates shared object → leaks out
}
List<Integer> a = new ArrayList<>(List.of(1, 2, 3));
f(a);
// a is now [1, 2, 3, 4]
```

```c
// C — call-by-value, the struct is COPIED
struct Vec { int data[3]; };
void f(struct Vec v) {
    v.data[0] = 99;   // changes the COPY only
}
struct Vec a = {{1, 2, 3}};
f(a);
// a.data[0] is STILL 1 — C copied the whole struct
```

### Example 2: Rebinding vs Mutating in Python

```python
def rebind(lst):
    lst = [9, 9, 9]       # local rebind, caller unaffected

def mutate(lst):
    lst[0] = 9            # mutation, caller affected

a = [1, 2, 3]
rebind(a)
print(a)                  # [1, 2, 3]   — rebind didn't leak

b = [1, 2, 3]
mutate(b)
print(b)                  # [9, 2, 3]   — mutation leaked
```

### Example 3: How C "Fakes" Call-by-Reference With a Pointer

C only has call-by-value. To let a function change the caller's variable, you pass the *address* of the variable (a pointer). The pointer itself is copied (by value!), but following it reaches the original.

```c
void addOne(int* n) {     // pass a pointer
    *n = *n + 1;          // follow the pointer, change the original
}

int main() {
    int x = 5;
    addOne(&x);           // pass the ADDRESS of x
    // x is now 6
}
```

This is the universal trick: **"pass by reference" in C is just call-by-value where the value happens to be a pointer.** You manually take the address with `&` and manually follow it with `*`.

### Example 4: The Swap That Doesn't Swap

The classic beginner bug. This swap works in C++ (true reference) but silently fails in a copy-only setting:

```python
# Python — looks like a swap, does nothing to the caller
def broken_swap(a, b):
    a, b = b, a           # only rebinds the LOCAL parameters

x, y = 1, 2
broken_swap(x, y)
print(x, y)               # 1 2 — unchanged!
```

```cpp
// C++ — works, because & gives true call-by-reference
void swap(int& a, int& b) {
    int t = a; a = b; b = t;
}
int x = 1, y = 2;
swap(x, y);               // x == 2, y == 1
```

Same idea, opposite result, because of the passing strategy.

---

## Pros & Cons

### Call-by-value

**Pros**
- Simple to reason about: a function cannot secretly change your variables.
- No "spooky action at a distance" — fewer surprise bugs.
- Safe to pass the same value to many functions.

**Cons**
- Copying a large object (a million-element array, a big struct) is slow and wastes memory.
- You can't easily return multiple results by writing into parameters.

### Call-by-reference

**Pros**
- No copy, even for huge objects — cheap.
- A function can return results by writing into the caller's variables.

**Cons**
- Hard to read: `f(x)` might silently change `x` and you can't tell from the call site.
- Easy to introduce aliasing bugs.

### Call-by-sharing (the everyday default)

**Pros**
- Cheap: only a reference (an arrow) is copied, never the whole object.
- Lets you intentionally mutate big shared structures.

**Cons**
- The #1 source of beginner confusion: mutation leaks but rebinding doesn't.
- Accidental mutation of a passed-in list/dict is a classic, hard-to-spot bug.

---

## Use Cases

- **Call-by-value** is the right default for small values (numbers, small structs) and whenever you want a guarantee that a function can't change your data. C, Go (for non-pointer types), and Pascal default to it.
- **Call-by-reference** is used deliberately when you want a function to update the caller's variable, e.g. `bool tryParse(string s, int& out)` style "out parameters" in C++ and C#.
- **Call-by-sharing** is how you pass objects, lists, and maps in Python/Java/JS. You use it constantly without naming it — every time you pass a list to a function, you are sharing it.
- **Immutable arguments** are the use case when you want call-by-sharing's cheapness *and* call-by-value's safety: pass a tuple, a frozen collection, or a `const` reference.

---

## Coding Patterns

**Pattern: Defensive copy at the boundary.** If a function should not change the caller's list, copy it on the way in.

```python
def process(items):
    items = list(items)      # make a private copy first
    items.sort()             # safe to mutate now — it's ours
    return items
```

**Pattern: Return a new value instead of mutating.** Prefer functions that *return* results over functions that mutate arguments. It removes the whole class of "did this leak?" questions.

```python
# Prefer this (pure)
def with_appended(lst, x):
    return lst + [x]         # new list, caller's list untouched

# Over this (mutating)
def append_in_place(lst, x):
    lst.append(x)            # changes the caller's list
```

**Pattern: Document mutation in the name.** If a function *does* mutate its argument, say so: `sort_in_place(items)`, `fill_buffer(buf)`. The name is the contract.

**Pattern: Use immutables for shared data.** Pass tuples instead of lists, `frozenset` instead of `set`, when the receiver has no business changing them.

---

## Best Practices

1. **Know your language's one rule.** For Python/Java/JS: "reference passed by value — mutation leaks, rebinding doesn't." For C/Go (non-pointer): "everything is copied." Say it out loud.
2. **Don't mutate arguments unless that's the explicit job.** A function named `calculate_total(items)` should not reorder `items`. Surprise mutation is rude and bug-prone.
3. **If you must mutate, name the function so callers know.** `clear()`, `sort()`, `_in_place` suffixes.
4. **Prefer returning new values over mutating.** Pure functions are easier to test and reason about.
5. **Reach for immutable types** (tuples, strings, frozensets) when you want sharing without risk.
6. **When you genuinely need to change the caller's variable, be explicit:** pointers in C/Go, `ref`/`out` in C#, references in C++ — and prefer returning a value when you can.

---

## Edge Cases & Pitfalls

**Pitfall 1: "I passed a list and it changed."** You shared the object. The function mutated it. This is call-by-sharing working as designed, not a bug in the language. Fix: copy at the boundary or don't mutate.

**Pitfall 2: The non-working swap.** `def swap(a, b): a, b = b, a` does nothing to the caller in Python/Java because it only rebinds local parameters. There is no built-in call-by-reference to make it work.

**Pitfall 3: Mutable default arguments (Python's most famous trap).**

```python
def add_item(item, bucket=[]):   # DANGER: one shared list
    bucket.append(item)
    return bucket

add_item(1)     # [1]
add_item(2)     # [1, 2]  — the SAME list persisted across calls!
```

The default `[]` is created *once* and shared across all calls. Fix:

```python
def add_item(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
```

**Pitfall 4: Thinking integers are passed differently from lists.** They aren't. The passing rule is identical (call-by-sharing). Integers just *look* like call-by-value because they're immutable, so rebinding is all you can do.

**Pitfall 5: A copy that isn't deep.** `new_list = list(old)` copies the *outer* list but the inner objects are still shared. Mutating an inner object leaks. (That is "shallow copy"; a "deep copy" recursively copies.)

---

## Common Mistakes

- **Saying "Python is pass-by-reference."** It isn't. It's call-by-sharing (pass-the-reference-by-value). The give-away test: the broken swap. If Python were pass-by-reference, the swap would work — it doesn't.
- **Saying "Python is pass-by-value."** Also wrong: then mutating a passed list couldn't leak — but it does.
- **Assuming a function won't touch your data.** In call-by-sharing languages, always assume a function *could* mutate a mutable argument unless you know otherwise.
- **Forgetting that copying a list is shallow.** Inner objects are still shared after a shallow copy.
- **Reusing a mutable default argument.** The mutable-default trap above.

---

## Test Yourself

1. In one sentence, what does call-by-value give the function?
2. What is the one-line difference between mutating a parameter and rebinding a parameter in Python?
3. Why does the integer example look like call-by-value even though Python uses call-by-sharing?
4. Why does the broken swap fail in Python but work in C++?
5. How does C "fake" call-by-reference if it only has call-by-value?
6. Why is the mutable-default-argument trap a consequence of call-by-sharing?

<details>
<summary>Answers</summary>

1. A fresh **copy** of the argument's value; changes to the parameter never reach the caller.
2. **Mutating** (`p.field = ...` / `p.append(...)`) changes the shared object and **leaks** to the caller; **rebinding** (`p = other`) re-points the local name only and does **not** leak.
3. Integers are immutable, so the only thing you can do to the parameter is **rebind** it, and rebinding never affects the caller — which is exactly what call-by-value would also produce.
4. Python only rebinds local parameters (no built-in call-by-reference), so the swap touches only locals. C++ `int&` is true call-by-reference — the parameters *are* the caller's variables.
5. You pass a **pointer** (the address) by value; the pointer is copied, but following it (`*p`) reaches the caller's original storage.
6. The default value is created **once** and the *same* object is **shared** across every call that omits the argument — call-by-sharing of a single mutable object.

</details>

---

## Cheat Sheet

```text
CALL-BY-VALUE        → function gets a COPY. Caller never changes.       (C, Go non-pointer, Pascal default)
CALL-BY-REFERENCE    → function gets your VARIABLE. Reassigning leaks.   (C++ &, C# ref, Pascal var)
CALL-BY-SHARING      → function gets a COPY OF THE REFERENCE.            (Python, Java, JS, Ruby objects)
                       mutation LEAKS · rebinding DOESN'T

THE TWO QUESTIONS for any language:
  1. Can the function REBIND my variable?   (usually NO)
  2. Can it MUTATE the shared object?        (YES if mutable + shared)

IMMUTABLE arg  → passing strategy stops mattering (nothing can change)
C "by reference" = call-by-value of a POINTER:  f(&x) ... *p = ...
BROKEN SWAP test → if swap(a,b) doesn't swap, you're NOT call-by-reference
```

---

## Summary

- The **evaluation strategy** decides what a function receives when you pass an argument.
- **Call-by-value** copies the value; the caller is safe. **Call-by-reference** aliases the caller's variable; reassigning leaks. **Call-by-sharing** copies the *reference*; mutation leaks but rebinding doesn't.
- Python, Java, and JavaScript use **call-by-sharing** for objects — "pass the reference by value." This is the source of nearly every beginner "why did my list change?" bug.
- Integers *feel* like call-by-value because they are **immutable**, not because they're passed differently.
- C only has call-by-value; it **fakes** call-by-reference with pointers.
- The fix for confusion is almost always: **don't mutate arguments**, **return new values**, or **use immutable types**.

---

## Further Reading

- Your language's official documentation on "argument passing" or "function calls" — read the precise wording.
- The CPython data-model docs on objects, identity, and mutability.
- Any clear write-up titled "Is Python pass-by-value or pass-by-reference?" — the answer is "neither, it's call-by-sharing."
- The `middle.md` page in this topic, for call-by-name, thunks, and lazy evaluation.
