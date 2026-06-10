# Pass by Value / Pass by Reference — Junior

> **What?** When you call a method and pass an argument, the language has to decide what's actually transferred to the parameter. **Pass by value** copies the argument's value. **Pass by reference** gives the parameter direct access to the caller's variable. Java is **always pass by value** — but this is famously misunderstood because the "value" of a reference type is itself a reference.
> **How?** For primitives, the value is the number. For reference types, the value is the *reference* (a pointer-like handle). The reference is copied; both caller and callee see the same object, but reassigning the parameter doesn't affect the caller.

---

## 1. Java is pass by value — the simple story

```java
void inc(int x) { x = x + 1; }

int n = 5;
inc(n);
System.out.println(n);   // 5 — unchanged
```

`inc` receives a copy of `n`. Modifying `x` doesn't affect `n`. Classic pass by value.

---

## 2. The reference type version

```java
void mutate(List<String> list) { list.add("new"); }

var items = new ArrayList<>(List.of("a", "b"));
mutate(items);
System.out.println(items);   // [a, b, new]
```

The list was modified! Doesn't this look like pass by reference?

**Not quite.** Java passed the *value of the reference* — that is, a copy of the pointer. Both the caller's variable and the parameter point to the same `ArrayList`. So mutations through either are visible.

---

## 3. The proof — reassigning the parameter

```java
void replace(List<String> list) { list = new ArrayList<>(); }

var items = new ArrayList<>(List.of("a", "b"));
replace(items);
System.out.println(items);   // [a, b] — unchanged!
```

Reassigning `list` inside `replace` only affects the local copy of the reference. The caller's `items` still points to the original list.

If Java were truly pass by reference, the caller's variable would now point to the new list. It doesn't.

---

## 4. The mental model

Variables are like labeled boxes:

```
caller stack            heap
┌──────────┐           ┌──────────────┐
│ items ───┼──────────▶│ ArrayList    │
└──────────┘           │ [a, b]       │
                        └──────────────┘
```

When you call `replace(items)`:

```
caller stack            callee stack       heap
┌──────────┐           ┌─────────┐         ┌──────────────┐
│ items ───┼──────────▶│ list ───┼────────▶│ ArrayList    │
└──────────┘           └─────────┘         │ [a, b]       │
                                            └──────────────┘
```

Both `items` and `list` point to the same heap object. If you do `list.add(...)`, the heap object changes — visible from both.

If you do `list = new ArrayList<>()`, only the callee's `list` changes. Caller's `items` still points to the original.

---

## 5. Why this confuses people

Some languages (C++, C# with `ref`) have true pass by reference. Calls there look the same syntactically:

```csharp
void Replace(ref List<string> list) { list = new List<string>(); }   // C# — true ref
```

In C#, `Replace` would update the caller's variable. Java has no such feature.

Java *only* passes by value. It just so happens that for reference types, the value is a reference — which feels like reference semantics for mutations but not for reassignment.

---

## 6. The vocabulary fight

You'll hear:
- "Java is pass by reference for objects." (Wrong by strict definition.)
- "Java passes references by value." (Correct.)
- "Java is pass by value." (Correct, but needs clarification.)

The most accurate phrasing: **Java is always pass by value; for reference types, the value passed is a reference.**

---

## 7. Examples that clarify

**Mutating the object** (visible to caller):
```java
void clear(List<String> list) { list.clear(); }

var x = new ArrayList<>(List.of("a"));
clear(x);
System.out.println(x);   // []
```

**Reassigning the parameter** (NOT visible to caller):
```java
void replace(List<String> list) { list = new ArrayList<>(); }

var x = new ArrayList<>(List.of("a"));
replace(x);
System.out.println(x);   // [a]
```

**Mutating a primitive** (NOT visible to caller):
```java
void inc(int x) { x = x + 1; }

int n = 5;
inc(n);
System.out.println(n);   // 5
```

---

## 8. Returning to "modify"

Since Java doesn't have output parameters, you typically return modified values:

```java
int doubled(int x) { return x * 2; }

int n = 5;
n = doubled(n);   // n = 10
```

For multiple returns, use a record or a tuple:
```java
record Pair(int a, int b) { }
Pair compute(int x) { return new Pair(x, x*2); }

var p = compute(5);   // Pair(5, 10)
```

---

## 9. The `final` parameter

```java
void m(final int x) {
    x = 5;   // ERROR — x is final
}
```

`final` on a parameter just means you can't reassign it inside the method. Has no effect on the caller. (And no effect on whether you can mutate objects through the reference.)

---

## 10. Common newcomer mistakes

**Mistake 1: expecting Java to "swap" two variables**

```java
void swap(int a, int b) {
    int t = a; a = b; b = t;
}

int x = 1, y = 2;
swap(x, y);
System.out.println(x + ", " + y);   // 1, 2 — unchanged
```

Pass by value: caller's `x` and `y` are not affected.

**Fix:** return both:
```java
record Pair(int a, int b) { }
Pair swapped = new Pair(y, x);
```

**Mistake 2: thinking object reassignment escapes**

```java
void setName(User u, String name) {
    u = new User(name);   // ineffective
}
```

Reassigning `u` doesn't affect the caller. Use a setter or return a new object.

**Mistake 3: assuming arrays are special**

```java
void modify(int[] arr) {
    arr[0] = 99;          // visible — array contents change
    arr = new int[10];    // NOT visible — only local
}
```

Arrays are reference types. Same rules apply.

---

## 11. Quick reference

| Action                              | Visible to caller? |
|-------------------------------------|--------------------|
| Modify primitive parameter          | No                 |
| Modify object via parameter (mutate)| Yes                |
| Reassign parameter to new value      | No                 |
| Return new value                     | Yes (caller assigns) |

---

## 12. What's next

| Question                                  | File              |
|-------------------------------------------|-------------------|
| Argument evaluation order, edge cases      | `middle.md`        |
| JIT view, register allocation              | `senior.md`        |
| Bytecode of method calls                   | `professional.md`  |
| JLS rules                                  | `specification.md` |

---

**Memorize this**: Java is *always* pass by value. The "value" of a reference type is a reference. You can mutate the pointed-to object (visible) but not reassign the parameter to affect the caller. For "output," return values or use mutable wrapper types.
