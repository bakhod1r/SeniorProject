# Pass by Value / Pass by Reference — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of a misunderstanding of pass-by-value.

---

## Bug 1 — Trying to swap primitives

```java
void swap(int a, int b) { int t = a; a = b; b = t; }

int x = 1, y = 2;
swap(x, y);
System.out.println(x + ", " + y);   // 1, 2
```

**Why?** Pass by value. `a` and `b` are local copies; reassigning doesn't affect caller.

**Fix:** return a record:
```java
record Pair(int a, int b) {}
Pair swap(int a, int b) { return new Pair(b, a); }
```

---

## Bug 2 — Trying to "replace" an object

```java
void replace(List<String> list) { list = new ArrayList<>(); }

var x = new ArrayList<>(List.of("a"));
replace(x);
System.out.println(x);   // [a] — unchanged
```

**Why?** Reassigning the parameter only affects the local reference.

**Fix:** return:
```java
List<String> replace() { return new ArrayList<>(); }
x = replace();
```

---

## Bug 3 — Storing mutable input by reference

```java
public class Order {
    private final List<Item> items;
    public Order(List<Item> items) {
        this.items = items;    // alias
    }
}

var caller = new ArrayList<Item>();
var order = new Order(caller);
caller.add(item);    // visible in order.items
```

**Why?** Constructor stored the reference. Mutations to caller's list affect order's items.

**Fix:** defensive copy:
```java
this.items = List.copyOf(items);
```

---

## Bug 4 — Returning mutable internal collection

```java
public class TodoList {
    private final List<String> items = new ArrayList<>();
    public List<String> items() { return items; }   // !! caller can mutate
}
```

**Why?** Caller can `todoList.items().clear()` and silently empty the internal list.

**Fix:** return immutable view or copy:
```java
return List.copyOf(items);
// or
return Collections.unmodifiableList(items);
```

---

## Bug 5 — Lambda capture of mutable variable

```java
int counter = 0;
Runnable inc = () -> counter++;   // ERROR
```

**Why?** Lambda captures must be effectively final.

**Fix:** use an array or atomic:
```java
int[] counter = {0};
Runnable inc = () -> counter[0]++;
```

---

## Bug 6 — Misusing wrapper for "out parameter"

```java
class Result { int value; }

void compute(int input, Result out) {
    out.value = input * 2;
}

var r = new Result();
compute(5, r);
System.out.println(r.value);   // works, but awkward
```

**Why?** Functional, but Java idiom is to return:

**Fix:**
```java
record Result(int value) {}
Result compute(int input) { return new Result(input * 2); }
```

---

## Bug 7 — Modifying argument inside method

```java
public List<Item> filter(List<Item> items) {
    items.removeIf(Item::expired);   // mutates caller's list!
    return items;
}
```

**Why?** Surprises caller. Method takes input, modifies it, returns it. Subtle aliasing.

**Fix:** return a new list, don't mutate:
```java
public List<Item> filter(List<Item> items) {
    return items.stream().filter(i -> !i.expired()).toList();
}
```

---

## Bug 8 — Boxed integer comparison

```java
Integer a = 1000;
Integer b = 1000;
if (a == b) { ... }   // false — different Integer instances
```

**Why?** Boxing for values outside cache range allocates new instances. `==` compares references.

**Fix:** use `equals` or compare unboxed:
```java
if (a.equals(b)) { ... }
if (a.intValue() == b.intValue()) { ... }
```

---

## Bug 9 — Mutating array argument

```java
void initialize(int[] data) {
    for (int i = 0; i < data.length; i++) data[i] = i;
}

int[] arr = new int[10];
initialize(arr);
// arr is now {0, 1, 2, 3, ..., 9}
```

This works correctly — array is shared. The bug is when developers expect it *not* to work, or vice versa.

**Note:** if you want to *return* a new array, do that:
```java
int[] generate() { return new int[]{0, 1, 2, ...}; }
```

---

## Bug 10 — Lazy capture confusion

```java
String name = "Alice";
Supplier<String> sup = () -> name;
name = "Bob";   // ERROR — name not effectively final
```

**Why?** Capture requires effective finality.

**Fix:** introduce a final local:
```java
String name = "Alice";
final String captured = name;
Supplier<String> sup = () -> captured;
```

Or just keep `name` final.

---

## Bug 11 — Deep mutation surprise

```java
public final class User {
    private final List<Address> addresses;
    public User(List<Address> addresses) {
        this.addresses = List.copyOf(addresses);
    }
    public List<Address> addresses() { return addresses; }
}

var user = new User(List.of(new Address("123 Main")));
user.addresses().get(0).setStreet("456 Other");   // !! mutates the address
```

**Why?** `List.copyOf` is shallow — the list is immutable, but the elements aren't. If `Address` is mutable, callers can still corrupt user state.

**Fix:** make `Address` immutable (record):
```java
public record Address(String street) {}
```

---

## Bug 12 — Argument evaluation side effect

```java
void m(int a, int b) { System.out.println(a + ", " + b); }

int x = 0;
m(x++, ++x);   // m(0, 2); final x = 2
```

The bug is when developers expect right-to-left or simultaneous evaluation. JLS §15.7.4 mandates left-to-right.

**Fix:** if relying on evaluation order is brittle, extract:
```java
int first = x++;
int second = ++x;
m(first, second);
```

---

## Pattern recap

| Bug | Family                              | Cure                                |
|-----|-------------------------------------|-------------------------------------|
| 1   | Swap primitives                      | Return record                       |
| 2   | "Replace" via reassign                | Return new value                    |
| 3   | Storing mutable input                 | Defensive copy                      |
| 4   | Returning mutable collection          | Immutable view/copy                 |
| 5   | Mutable capture in lambda             | Array/atomic for state              |
| 6   | Wrapper as out param                   | Use record                          |
| 7   | Mutating input list                    | Return new list                     |
| 8   | Boxed integer ==                       | `equals`                            |
| 9   | Array mutation visible                 | Aware; clone if needed              |
| 10  | Lambda capture of mutable               | Final local                         |
| 11  | Deep mutation through immutable wrapper | Make components immutable           |
| 12  | Side effects in arguments              | Extract to locals                   |

---

**Memorize the shapes**: most pass-by-value bugs are about (a) trying to "modify" via parameter reassignment, (b) failing to defensively copy, or (c) deep mutability through "immutable" wrappers. Java is consistent: references are copied, objects are shared.
