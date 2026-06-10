# Pass by Value / Pass by Reference — Practice Tasks

Twelve exercises to verify your understanding of Java's pass-by-value semantics.

---

## Task 1 — Primitive immutability

```java
void inc(int x) { x = x + 1; }

int n = 5;
inc(n);
System.out.println(n);   // ?
```

Predict and verify.

---

## Task 2 — Object mutation visible

```java
void clear(List<String> list) { list.clear(); }

var x = new ArrayList<>(List.of("a", "b"));
clear(x);
System.out.println(x);   // ?
```

Predict.

---

## Task 3 — Parameter reassignment NOT visible

```java
void replace(List<String> list) { list = new ArrayList<>(); }

var x = new ArrayList<>(List.of("a"));
replace(x);
System.out.println(x);   // ?
```

Predict.

---

## Task 4 — Try to swap

Write a `swap(int a, int b)` method. After the call, do the original variables swap?

```java
int x = 1, y = 2;
swap(x, y);
System.out.println(x + ", " + y);   // ?
```

Why doesn't this work? How would you implement it?

---

## Task 5 — Reference swap?

Try the same with objects:
```java
void swap(Object a, Object b) { Object t = a; a = b; b = t; }

String s1 = "x", s2 = "y";
swap(s1, s2);
System.out.println(s1 + ", " + s2);   // ?
```

Same issue?

---

## Task 6 — Defensive copy

Implement `class Order { final List<Item> items; ... }` such that the caller's mutation of the input list doesn't affect the order's items.

Test:
```java
var input = new ArrayList<Item>();
var order = new Order(input);
input.add(item);
// order.items() should NOT contain item
```

---

## Task 7 — Lambda capture

```java
int x = 5;
Runnable r = () -> System.out.println(x);
x = 10;     // ERROR? or OK?
```

Predict. What's the rule?

---

## Task 8 — Mutable capture via array

```java
int[] counter = {0};
Runnable r = () -> counter[0]++;
r.run();
r.run();
System.out.println(counter[0]);   // ?
```

Why does this work, when reassigning a captured `int` doesn't?

---

## Task 9 — Output via record

Implement `compute(int input)` that returns both a result and an error string. Use a record.

---

## Task 10 — Out-parameter via wrapper

Implement `compute(int input, IntBox out)` that puts the result into `out.value`. Discuss why this is awkward in Java.

---

## Task 11 — Boxing in arguments

```java
void m(Integer x) { ... }

m(5);            // boxing: cached?
m(1000);         // boxing: allocated?
m(new Integer(5));  // wrapping: deprecated; allocates
```

Compare with `==` to see which calls share instances.

---

## Task 12 — Argument evaluation order

```java
void m(int a, int b, int c) { System.out.println(a + ", " + b + ", " + c); }

int x = 0;
m(x++, ++x, x++);   // ?
```

Trace each evaluation. What does `m` receive? What's the final `x`?

---

## Validation

| Task | How |
|------|-----|
| 1 | n = 5 (primitive unchanged) |
| 2 | x = [] (object mutation visible) |
| 3 | x = [a] (param reassignment local) |
| 4 | x=1, y=2 (swap doesn't work); fix: return record/pair |
| 5 | s1=x, s2=y (same issue); fix: return record/pair |
| 6 | After defensive copy, order.items unchanged by input.add |
| 7 | Compile error: `x` must be effectively final |
| 8 | counter[0] = 2 — mutating the array's element is visible |
| 9 | record CompResult(int value, String error) {} |
| 10 | Works but ugly; prefer record |
| 11 | m(5) returns cached; m(1000) allocates new |
| 12 | First arg is 0; x becomes 1. Second arg pre-increments to 2; x is 2. Third arg post-increments returning 2; x becomes 3. m receives (0, 2, 2); final x = 3 |

---

## Solutions sketch

**Task 6:**
```java
class Order {
    private final List<Item> items;
    public Order(List<Item> items) { this.items = List.copyOf(items); }
    public List<Item> items() { return items; }
}
```

**Task 9:**
```java
record CompResult(int value, String error) {}
CompResult compute(int input) {
    if (input < 0) return new CompResult(0, "negative");
    return new CompResult(input * 2, null);
}
```

**Task 12 trace:**
- `x++` evaluates: returns 0, x = 1
- `++x` evaluates: x = 2, returns 2
- `x++` evaluates: returns 2, x = 3
- m(0, 2, 2)
- final x = 3

---

**Memorize this**: Java is pass-by-value. Test the three cases (primitive, object mutation, param reassignment) until intuition is correct. Use return values, records, or defensive copies. Lambdas capture effectively-final values; for mutation, use an array or atomic.
