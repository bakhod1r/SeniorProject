# Array -- Language Specifications and Official Documentation

This document summarizes how arrays are formally specified in Go, Java, and Python, with references to official documentation and key implementation details.

## Table of Contents

- [Go: Arrays and Slices](#go-arrays-and-slices)
  - [Go Arrays](#go-arrays)
  - [Go Slices](#go-slices)
  - [Slice Internals](#slice-internals)
  - [Key Functions and Builtins](#key-functions-and-builtins)
- [Java: Arrays and ArrayList](#java-arrays-and-arraylist)
  - [Java Primitive Arrays](#java-primitive-arrays)
  - [java.util.Arrays Utility Class](#javautilarrays-utility-class)
  - [java.util.ArrayList](#javautilarraylist)
  - [Key ArrayList Methods](#key-arraylist-methods)
- [Python: list](#python-list)
  - [List Type Specification](#list-type-specification)
  - [Key list Methods](#key-list-methods)
  - [CPython Implementation Details](#cpython-implementation-details)
- [Cross-Language Comparison Table](#cross-language-comparison-table)

---

## Go: Arrays and Slices

**Official documentation:**
- Go specification -- Arrays: https://go.dev/ref/spec#Array_types
- Go specification -- Slices: https://go.dev/ref/spec#Slice_types
- Go Blog -- Slices: https://go.dev/blog/slices-intro
- Go Blog -- Slice Internals: https://go.dev/blog/slices

### Go Arrays

An array type in Go is `[n]T` where `n` is a compile-time constant and `T` is the element type.

```
ArrayType   = "[" ArrayLength "]" ElementType .
ArrayLength = Expression .
ElementType = Type .
```

Properties:
- **Value type**: assigning an array copies all elements
- **Fixed size**: the size is part of the type; `[3]int` and `[4]int` are different types
- **Comparable**: arrays are comparable with `==` if the element type is comparable
- **Zero value**: all elements initialized to the zero value of `T`

```go
var a [5]int          // [0, 0, 0, 0, 0]
b := [3]int{1, 2, 3}
c := [...]int{1, 2}  // compiler infers size: [2]int
len(a)                // 5 (compile-time constant)
```

### Go Slices

A slice type is `[]T`. It is a dynamically-sized, flexible view into an array.

```
SliceType = "[" "]" ElementType .
```

Properties:
- **Reference type**: a slice header contains a pointer, length, and capacity
- **Not comparable**: slices cannot be compared with `==` (except to nil)
- **Nil value**: a nil slice has length 0, capacity 0, and no underlying array
- **Growable**: the `append` built-in returns a new slice with the element(s) added

### Slice Internals

A slice is represented by a struct (from `reflect.SliceHeader`):

```go
type SliceHeader struct {
    Data uintptr  // pointer to the underlying array
    Len  int      // number of elements
    Cap  int      // capacity of the underlying array
}
```

When `append` exceeds capacity, Go allocates a new array. The growth policy (as of Go 1.18+):
- For small slices (< 256): double the capacity
- For larger slices: grow by ~25% + 192 (smoothed transition)

### Key Functions and Builtins

| Function / Builtin       | Signature                                          | Description                        |
| ------------------------ | -------------------------------------------------- | ---------------------------------- |
| `len(s)`                 | `func len(s []T) int`                              | Number of elements                 |
| `cap(s)`                 | `func cap(s []T) int`                              | Capacity of underlying array       |
| `append(s, elems...)`    | `func append(s []T, elems ...T) []T`               | Append elements, may reallocate    |
| `copy(dst, src)`         | `func copy(dst, src []T) int`                      | Copy elements, returns count       |
| `make([]T, len, cap)`    | `func make([]T, len int, cap ...int) []T`          | Allocate slice with given len/cap  |
| `clear(s)`               | `func clear(s []T)` (Go 1.21+)                    | Set all elements to zero value     |
| `slices.Sort(s)`         | `func Sort[S ~[]E, E cmp.Ordered](x S)`           | Sort a slice (Go 1.21+)           |
| `slices.Contains(s, v)`  | `func Contains[S ~[]E, E comparable](s S, v E) bool` | Check if slice contains value   |

---

## Java: Arrays and ArrayList

**Official documentation:**
- Java Language Specification -- Arrays: https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html
- java.util.Arrays: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Arrays.html
- java.util.ArrayList: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html

### Java Primitive Arrays

An array in Java is an object with a fixed number of elements of the same type.

Properties:
- **Fixed size**: determined at creation, accessible via `.length` field
- **Object type**: arrays are objects that extend `Object` and implement `Cloneable` and `Serializable`
- **Covariant**: `String[]` is a subtype of `Object[]` (can cause `ArrayStoreException`)
- **Zero-initialized**: numeric arrays to 0, boolean to false, references to null
- **Bounds-checked**: accessing out-of-range indices throws `ArrayIndexOutOfBoundsException`

```java
int[] a = new int[5];             // [0, 0, 0, 0, 0]
int[] b = {1, 2, 3};             // literal syntax
int[][] matrix = new int[3][4];  // 2D array (array of arrays)
a.length;                         // 5 (final field, not a method)
```

### java.util.Arrays Utility Class

Static utility methods for array operations:

| Method                              | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `Arrays.sort(a)`                    | Sort array (dual-pivot quicksort)        |
| `Arrays.sort(a, comparator)`        | Sort with custom comparator              |
| `Arrays.binarySearch(a, key)`       | Binary search (array must be sorted)     |
| `Arrays.equals(a, b)`              | Compare arrays element-by-element        |
| `Arrays.deepEquals(a, b)`          | Compare nested/multi-dimensional arrays  |
| `Arrays.fill(a, val)`              | Fill all elements with a value           |
| `Arrays.copyOf(a, newLength)`      | Copy with new length (truncate or pad)   |
| `Arrays.copyOfRange(a, from, to)`  | Copy a range                             |
| `Arrays.toString(a)`               | String representation: "[1, 2, 3]"       |
| `Arrays.stream(a)`                 | Create an IntStream/Stream from array    |
| `Arrays.asList(a)`                 | Wrap array as fixed-size List            |

### java.util.ArrayList

`ArrayList<E>` is a resizable-array implementation of the `List<E>` interface.

Properties:
- **Generic**: holds objects only (autoboxing for primitives)
- **Growth policy**: new capacity = old capacity + (old capacity >> 1), approximately 1.5x
- **Default initial capacity**: 10 (when first element is added)
- **Not synchronized**: use `Collections.synchronizedList()` or `CopyOnWriteArrayList` for thread safety
- **Permits null**: can store null elements
- **Fail-fast iterators**: concurrent modification during iteration throws `ConcurrentModificationException`

### Key ArrayList Methods

| Method                        | Time     | Description                              |
| ----------------------------- | -------- | ---------------------------------------- |
| `add(E e)`                    | O(1)*    | Append to end (amortized)                |
| `add(int index, E e)`         | O(n)     | Insert at index, shift right             |
| `get(int index)`              | O(1)     | Access by index                          |
| `set(int index, E e)`         | O(1)     | Replace element at index                 |
| `remove(int index)`           | O(n)     | Remove at index, shift left              |
| `remove(Object o)`            | O(n)     | Remove first occurrence of value         |
| `contains(Object o)`          | O(n)     | Linear search                            |
| `indexOf(Object o)`           | O(n)     | First index of value, or -1              |
| `size()`                      | O(1)     | Number of elements                       |
| `isEmpty()`                   | O(1)     | Check if empty                           |
| `clear()`                     | O(n)     | Remove all elements                      |
| `toArray()`                   | O(n)     | Convert to Object[]                      |
| `trimToSize()`                | O(n)     | Reduce capacity to current size          |
| `ensureCapacity(int)`         | O(n)     | Pre-allocate capacity                    |
| `sort(Comparator)`            | O(n log n)| Sort using TimSort                      |
| `subList(int from, int to)`   | O(1)     | View (not copy) of a range               |

---

## Python: list

**Official documentation:**
- Python Data Model -- Sequences: https://docs.python.org/3/reference/datamodel.html#sequences
- Python Library -- list: https://docs.python.org/3/library/stdtypes.html#list
- Python Tutorial -- Lists: https://docs.python.org/3/tutorial/datastructures.html
- CPython listobject.c: https://github.com/python/cpython/blob/main/Objects/listobject.c

### List Type Specification

Python's `list` is a mutable sequence type that can hold objects of any type.

Properties:
- **Dynamic**: grows and shrinks as needed
- **Heterogeneous**: can mix types (`[1, "hello", True, None]`)
- **Reference-based**: stores pointers to objects, not objects themselves
- **Ordered**: maintains insertion order
- **Supports slicing**: `a[1:3]`, `a[::-1]`, `a[::2]`
- **Hashable**: lists are NOT hashable (cannot be dict keys or set elements)

```python
a = []                      # empty list
b = [1, 2, 3]               # literal
c = list(range(10))          # from iterable
d = [0] * 5                  # [0, 0, 0, 0, 0]
e = [x**2 for x in range(5)] # list comprehension
```

### Key list Methods

| Method                  | Time     | Description                              |
| ----------------------- | -------- | ---------------------------------------- |
| `append(x)`             | O(1)*    | Add to end (amortized)                   |
| `extend(iterable)`      | O(k)     | Append all items from iterable           |
| `insert(i, x)`          | O(n)     | Insert at position, shift right          |
| `pop()`                 | O(1)     | Remove and return last element           |
| `pop(i)`                | O(n)     | Remove and return element at index i     |
| `remove(x)`             | O(n)     | Remove first occurrence of value         |
| `clear()`               | O(n)     | Remove all elements                      |
| `index(x)`              | O(n)     | First index of value                     |
| `count(x)`              | O(n)     | Count occurrences                        |
| `sort()`                | O(n log n)| Sort in-place (TimSort)                 |
| `reverse()`             | O(n)     | Reverse in-place                         |
| `copy()`                | O(n)     | Shallow copy                             |
| `len(list)`             | O(1)     | Number of elements                       |
| `x in list`             | O(n)     | Membership test                          |
| `list[i]`               | O(1)     | Access by index                          |
| `list[i] = x`           | O(1)     | Assignment by index                      |
| `list[i:j]`             | O(j-i)   | Slice (creates new list)                 |
| `del list[i]`           | O(n)     | Delete by index                          |

### CPython Implementation Details

In CPython, a list object is defined as:

```c
typedef struct {
    PyObject_VAR_HEAD
    PyObject **ob_item;    // pointer to array of PyObject pointers
    Py_ssize_t allocated;  // capacity (number of slots allocated)
} PyListObject;
```

- `ob_size` (from VAR_HEAD): current number of elements (what `len()` returns)
- `allocated`: total capacity
- `ob_item`: pointer to the C array of `PyObject*`

**Growth formula** (from `listobject.c`):

```c
new_allocated = ((size_t)newsize + (newsize >> 3) + 6) & ~(size_t)3;
// Approximately: newsize + newsize/8 + 6, rounded to multiple of 4
// Growth sequence: 0, 4, 8, 16, 24, 32, 40, 52, 64, 76, ...
```

This gives roughly 12.5% over-allocation, which is more conservative than Go (100%) or Java (50%).

---

## Cross-Language Comparison Table

| Feature                  | Go (slice)              | Java (ArrayList)       | Python (list)            |
| ------------------------ | ----------------------- | ---------------------- | ------------------------ |
| Type                     | `[]T`                   | `ArrayList<E>`         | `list`                   |
| Element types            | Homogeneous             | Homogeneous (boxed)    | Heterogeneous            |
| Default capacity         | 0                       | 0 (10 on first add)    | 0                        |
| Growth factor            | ~2x (small), ~1.25x (large) | ~1.5x             | ~1.125x                  |
| Access by index          | `s[i]`                  | `list.get(i)`          | `lst[i]`                 |
| Append                   | `s = append(s, v)`      | `list.add(v)`          | `lst.append(v)`          |
| Insert at index          | Manual (copy + shift)   | `list.add(i, v)`       | `lst.insert(i, v)`       |
| Delete at index          | Manual (append slices)  | `list.remove(i)`       | `del lst[i]` / `lst.pop(i)` |
| Length                   | `len(s)`                | `list.size()`          | `len(lst)`               |
| Capacity                 | `cap(s)`                | Reflection only        | Not directly exposed     |
| Slicing                  | `s[a:b]` (shared memory)| `list.subList(a, b)` (view) | `lst[a:b]` (copy)   |
| Sort                     | `slices.Sort(s)`        | `list.sort(cmp)`       | `lst.sort()`             |
| Thread-safe variant      | Manual (sync.Mutex)     | `CopyOnWriteArrayList` | Manual (threading.Lock)  |
| Null/nil element         | Zero value only         | Yes (null)             | Yes (None)               |
| Equality comparison      | Not with `==`           | `.equals()`            | `==` (by value)          |
| Bounds checking          | Runtime panic           | `ArrayIndexOutOfBoundsException` | `IndexError`    |
| Memory layout            | Contiguous values       | Contiguous references  | Contiguous references    |

---

## References

1. **Go Specification**: https://go.dev/ref/spec
2. **Java Language Specification (JLS 21)**: https://docs.oracle.com/javase/specs/jls/se21/html/
3. **Python Language Reference**: https://docs.python.org/3/reference/
4. **CPython Source (listobject.c)**: https://github.com/python/cpython/blob/main/Objects/listobject.c
5. **Go Slice Growth (runtime/slice.go)**: https://github.com/golang/go/blob/master/src/runtime/slice.go
6. **OpenJDK ArrayList Source**: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/ArrayList.java
