# Reviewed character image fallbacks

Character thumbnails normally come from the Handbook's predictable URL based
on `unit_code`. The browser always tries that canonical URL first, including a
bounded cache-busting retry, so newly published source images need no code
change.

Use a local fallback only when a character is already present in valid PvP data
but the source image and metadata still return 404. Before adding one:

1. Verify the character and exact unit codes against an official announcement.
2. Add one bounded PNG here and map only those codes in `docs/assets/app.js`.
3. Keep the canonical URL first so the exact source thumbnail replaces the
   fallback automatically when it becomes available.
4. Never make image availability a collection or publication quality gate.

The two Sally forms must remain distinct:

- `crab-sally-hyper-fallback.jpg` is only for `u1630h-sally` (超進化).
- `crab-sally-ultimate-fallback.jpg` is only for `u1631e-sally` (究極進化).

They are temporary promotional fallbacks, not replacements for the source
thumbnails. Each unit's own canonical image still takes priority and replaces
its fallback automatically when the source recovers.
