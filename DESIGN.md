# DESIGN.md — AI Keychain UI/UX Standard

This is the contract the UI is audited against (see the Quality Inspector Gate in AGENTS.md). Any UI change must keep every row true.

## 1. Design principles

1. **Trustworthy, precise, compact** — a security tool first: calm surfaces, tabular numerals, no decoration that isn't information.
2. **Show the data, say what matters** — raw metrics always visible; insights are additive and every card explains itself.
3. **Reflow, never shrink** — compact/normal/expanded layouts restructure the grid; nothing drops below readable size.
4. **Honest states** — every async surface has loading, empty, limited-data and error states; unknown data renders "—"/"Cost unavailable", never zero.
5. **Never color alone** — status carries text + shape/glyph + color.

## 2. Design tokens (src/ui/styles.css `:root`)

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` / `--bg-raised` / `--bg-inset` | `#0d1117` / `#161b26` / `#10151f` | Surfaces: page / cards / inputs & wells |
| `--border` | `#232b3b` | All card & control borders |
| `--text` / `--text-dim` / `--text-faint` | `#e6edf3` / `#8b96a8` / `#5c6678` | Primary / secondary / meta |
| `--accent` | `#4f8ef7` | Selection, focus, primary action |
| `--ok` / `--warn` / `--bad` | `#2ea36c` / `#d29922` / `#e5534b` | Status (+ soft variants) |
| Radius | 10px cards / 7px controls | |
| Type | System sans; mono for keys/ids; 13px base; tabular numerals for metrics | |

Contrast requirements: body text ≥ 7:1, secondary ≥ 4.5:1 (WCAG AA), meta text only for non-essential hints. Status pairs (text on soft background) must meet AA for their size.

## 3. Layout system

- Popup: 400×600 max; Expanded tab: centered max-width 1100px, two-pane.
- Modes via `useLayout`: compact (<340w ∨ <420h), normal, expanded (≥700w ∧ ≥560h).
- Grid reflow: metrics 2/3/6 columns; charts 1/2/4 columns; tester becomes a side pane when expanded.
- Spacing rhythm: 8px base; card padding 10–12px; section gap 10px.

## 4. Interaction & feedback

- Every click yields feedback within 100ms: state change, spinner, or toast.
- Async buttons show inline spinners + disabled state; never double-submit.
- Errors: visible toast (global) or inline `role="alert"` (forms); never color-only, never sr-only-only.
- Destructive actions (delete credential, wipe data) require confirmation.
- Focus: visible `:focus-visible` outline everywhere; modal traps focus, Escape closes, focus returns to the opener.
- Hit targets ≥ 24×24px for icon controls (≥ 44px where touch is plausible).

## 5. Accessibility

- Semantic buttons/inputs/selects; icon-only controls carry `aria-label` + `title`.
- Charts: `role="img"` + `aria-label` summary + visible text summary beneath.
- Status: pills with words; deltas carry an SR-only "versus previous period".
- `prefers-reduced-motion` disables all animation; motion is otherwise subtle (≤150ms opacity/transform).
- Screen-reader announcements via `role="status"` for toasts.

## 6. Content & voice

- Sentence case; no jargon without explanation; security promises stated plainly ("stored encrypted, never sent anywhere except the provider").
- Estimates always labeled "estimate"; unknown data "—" or "Cost unavailable".
- Errors say what happened and what to do next; never raw internals.

## 7. States matrix

| Surface | Loading | Empty | Limited data | Error |
| --- | --- | --- | --- | --- |
| Dashboard | Boot card | Welcome + how-to | Charts show text summaries, no empty charts | Toast + last good data |
| Charts | — (render with snapshot) | Text summary | Fewer buckets noted | — |
| Tester | Spinner on button | "Add a credential first" | — | Inline sanitized error |
| Insights | — | Explanation text | — | — |
| Forms | Busy label | — | — | Inline `role="alert"` |
