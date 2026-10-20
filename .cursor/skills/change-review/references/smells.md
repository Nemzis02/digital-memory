# Smell baseline

Martin Fowler, _Refactoring_ (2nd ed.), chapter 3. Each entry is a heuristic: report it as "possible <smell>", quote the hunk, and propose the move. A rule in AGENTS.md or MEMORY.md that endorses the pattern wins.

- **Mysterious Name**: a function, variable or type whose name does not say what it does or holds. Rename it. If no honest name comes, the design is unclear.
- **Duplicated Code**: the same logic shape in more than one hunk or file. Extract it and call it from both places.
- **Feature Envy**: a function that reads another module's data more than its own. Move it next to the data.
- **Data Clumps**: the same few values travel together through several signatures. Give them one type.
- **Primitive Obsession**: a string or number standing in for a domain concept, such as a key, a MIME type or an epoch. Give it a small type or a parser at the boundary.
- **Repeated Switches**: the same `switch` or `if` cascade on one discriminant in several places. Use one map or one dispatcher both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files. Gather what changes together.
- **Divergent Change**: one file edited for several unrelated reasons in the same change. Split the module, or split the change into commits.
- **Speculative Generality**: parameters, hooks or abstractions for needs no spec has. Inline them until a real need appears.
- **Message Chains**: long `a.b().c().d()` walks the caller should not depend on. Hide the walk behind one function.
- **Middle Man**: a function that only forwards to another. Call the target directly.
- **Large File**: a file approaching 1000 lines grows further. Extract a module before adding more.
