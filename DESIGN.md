# DESIGN.md — Darts Arena Pro (Raycast × Linear Edition)

> Derived from `.agents/skills/awesome-design-md-main/design-md/raycast/DESIGN.md` and `linear.app/DESIGN.md`.

## 1. Visual Theme & Atmosphere
- **Obsidian Precision Instrument**: Built on a near-black carbon-obsidian canvas (`#07080a`) where hierarchy comes from luminance stepping (`#07080a` → `#0f1012` → `#141517` → `#1b1c1e`) and whisper-thin semi-transparent white borders (`rgba(255, 255, 255, 0.07)`), completely eliminating muddy navy/blue backgrounds.
- **macOS Physical Keycap Tactility (Raycast)**: Every keypad button (`1–20`, `S-BULL`, `D-BULL`, `MISS`) uses Raycast's physical keycap gradient (`#18191b` → `#101113`) paired with multi-layer inset highlights (`inset 0 1px 0 rgba(255, 255, 255, 0.1)`) and bottom dark edges (`inset 0 -1px 0 rgba(0, 0, 0, 0.45)`).
- **Surgical Color Restraint**: 90% of the interface is achromatic obsidian, graphite, and silver-white (`#f7f8f8`). Chromatic accents are reserved strictly for semantic states:
  - **Raycast Red (`#ff6363`)**: D-Bull (Inner Bull), Bust alert, brand punctuation
  - **Raycast Yellow (`#ffbc33`)**: S-Bull (Outer Bull), Personal Best (PB), Awards
  - **Raycast Green (`#5fc992`)**: Cricket closed state, 3-dart Ready Confirm CTA, positive delta
  - **Raycast Blue (`#55b3ff`)**: Double (`×2`) modifier & keyboard focus ring
  - **Linear Violet (`#7170ff`)**: Triple (`×3`) modifier & telemetry trend line

## 2. Color Tokens
| Token | Value | Role |
|---|---|---|
| `--bg-void` | `#07080a` | Primary page canvas |
| `--bg-panel` | `#0f1012` | Topbar, slots bar, recessed containers |
| `--bg-surface` | `#141517` | Scoreboard & analytics cards |
| `--bg-elevated` | `#1b1c1e` | Badges, chips, active slots |
| `--text-primary` | `#f7f8f8` | Primary headings & giant score numerals |
| `--text-secondary` | `#cecece` | Secondary UI labels & descriptions |
| `--text-muted` | `#8a8f98` | Subdued captions & metadata |
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Default hairline containment |
| `--border-mid` | `rgba(255, 255, 255, 0.09)` | Card & keycap border |
| `--border-strong` | `rgba(255, 255, 255, 0.18)` | Hover & active containment |

## 3. Typography Rules
- **UI & Display**: `Inter`, `Noto Sans TC`, system-ui with OpenType `"cv01", "ss03"` enabled globally.
- **Telemetry & Numerals**: `JetBrains Mono` / `Inter` with `font-variant-numeric: tabular-nums` and compressed negative tracking (`-0.04em`) on giant scoreboard numerals for zero-jitter readability at 2 meters.

