# Engineering references

These are decision aids, not blanket rules or evidence that the full books have
been read in a session. Consult the relevant primary material; distinguish the
author's argument from the project-specific application below. Verify a chapter
or quotation before attributing it. Do not invent page numbers across editions.

## TypeScript design

Josh Goldberg, *Learning TypeScript: Enhance Your Web Development Skills Using
Type-Safe JavaScript*, O'Reilly, 2022.
[Author's site](https://www.learningtypescript.com/) and
[publisher's contents and preview](https://www.oreilly.com/library/view/learning-typescript/9781098110321/ch09.html).

Relevant locations:

- Chapters 3, **Unions and Literals**, and 4, **Objects**: narrowing and
  discriminated unions for state/event alternatives.
- Chapter 7, **Interfaces**, particularly **Type Aliases Versus Interfaces**:
  understand object declarations and interface merging before choosing a form.
  [Publisher's chapter](https://www.oreilly.com/library/view/learning-typescript/9781098110321/ch07.html).
- Chapter 9, **Type Modifiers**: unknown, predicates, assertions, and readonly.
  An assertion does not check an HTTP response at runtime.

Project application: keep state transitions readable, validate transport data,
and use type declarations for an actual semantic need. The book does not prescribe
this project's file layout or require a switch for every conditional expression.

## Module and abstraction design

John Ousterhout, *A Philosophy of Software Design*, second edition, Yaknyam Press,
2021. [Author's book page and edition notes](https://web.stanford.edu/~ouster/cgi-bin/book.php).

The author's [CS 190 book discussion](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter21/lecture.php?topic=bookReview)
identifies deep versus shallow modules, information hiding, dependencies,
designing twice, and different abstractions at different layers. The second-edition
notes identify Chapter 6, **General-Purpose Modules are Deeper**, and the added
chapter **Decide What Matters**.

Project application: ask what knowledge a new module hides from its callers.
Compare alternatives for substantial changes and prefer interfaces that make the
common operation clear. A small file or pass-through wrapper is not automatically
a useful abstraction. Generality must serve the supported product scope; it does
not authorize a new topology or data model.

## Refactoring and test design

Martin Fowler, *Refactoring: Improving the Design of Existing Code*, second
edition, Addison-Wesley, 2018. Use the author's
[catalog](https://refactoring.com/catalog/) for specific transformations, including
Decompose Conditional, Inline Function, Remove Middle Man, and Remove Dead Code.
His [Refactoring Malapropism](https://martinfowler.com/bliki/RefactoringMalapropism.html)
distinguishes small behavior-preserving refactorings from broader restructuring.

Fowler's [Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html),
particularly **The Difference Between Mocks and Stubs** and **Coupling Tests to
Implementations**, explains test-double roles and state versus interaction
verification. He credits Gerard Meszaros for the double taxonomy. Do not rename
all doubles Mock or equate observable product behavior with mock verification.

Ham Vocke's [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html),
published on Fowler's site, is by Vocke, not Fowler. Its **Database Integration**,
**What to Test?**, and **Avoid Test Duplication** sections support choosing test
boundaries and avoiding repeated coverage. They do not establish a target count
of tests or a universal ratio.

Project application: preserve behavior during cleanup, prove database contracts
at their actual boundary, and justify each test by the regression it detects.
Use independent expected outcomes for scientific algorithms. Keep synchronization
in browser tests tied to meaningful product state.
