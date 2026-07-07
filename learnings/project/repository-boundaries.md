# Repository Boundaries

ADL is built in:

```text
/home/vince/projects/personal/adl
```

MINIL lives at:

```text
/home/vince/projects/personal/minil
```

MINIL is prior art only. It can be inspected for concepts, examples, tests, terminology, and risk discovery, but ADL must remain a distinct codebase.

Do not:

- Create `/home/vince/projects/personal/minil/adl`
- Create a nested implementation at `/home/vince/projects/personal/adl/adl`
- Reuse MINIL's build system as ADL's build system
- Modify MINIL during ADL phases unless the user explicitly asks for that

Use root-relative ADL paths such as `src/model/resolved-model.ts`, `docs/adr/`, `docs/phases/`, and `learnings/`.
