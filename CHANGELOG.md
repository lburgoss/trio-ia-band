# Changelog

## 1.2.0 (2026-11-26)
- English by default; the band adapts to the user's language (Claude Code `language` setting, `LANG`, Windows culture). `language` option: `auto`, `en`, `es`.
- `/team-band` command (`/estado` kept as the Spanish alias).
- README in English, with `README.es.md` in Spanish.

## 1.1.0 (2026-11-26)
- **Turn** row and "Team status" block with the quota-aware split (Claude reserve, quota about to reset, weekly brake).
- One line per background subagent, with model, task and `(via …)` bridge to Gemini or Codex.
- The **Active** row no longer disappears with several subagents: when space runs out, it hides memory.

## 1.0.0
- Claude, Codex and Gemini band with 5-hour and weekly limits, 80 % / 95 % warnings and a toggle command.
