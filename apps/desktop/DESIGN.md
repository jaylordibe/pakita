---
name: Pakita Desktop
description: The operator's console for a worship service — dark, quiet, and lit by the brand only where it matters.
colors:
  brand-violet: '#7a4dff'
  brand-indigo: '#4d62ff'
  brand-cyan: '#22d3ee'
  bg: '#0b0a18'
  canvas: '#100f22'
  surface: '#17162e'
  surface-raised: '#1e1c3a'
  surface-hover: '#262448'
  field: '#0c0b1d'
  border: '#29274d'
  border-strong: '#3b3870'
  text: '#eeedff'
  text-muted: '#a6a3cc'
  text-faint: '#8582ad'
  accent: '#8b6cff'
  accent-hover: '#9d84ff'
  accent-soft: 'rgb(139 108 255 / 0.16)'
  accent-softer: 'rgb(139 108 255 / 0.08)'
  focus: '#a993ff'
  live: '#ff5a6e'
  live-solid: '#d92d45'
  live-soft: 'rgb(255 90 110 / 0.14)'
  success: '#3ddc97'
  success-soft: 'rgb(61 220 151 / 0.13)'
  warning: '#ffbe5c'
  warning-soft: 'rgb(255 190 92 / 0.13)'
  danger: '#ff7686'
  danger-soft: 'rgb(255 118 134 / 0.12)'
typography:
  wordmark:
    fontFamily: 'Nunito, Inter, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: '-0.01em'
  headline:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '-0.022em'
  title:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.3rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.018em'
  subtitle:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.95rem'
    fontWeight: 600
    letterSpacing: '-0.006em'
  body:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.78rem'
    fontWeight: 500
rounded:
  radius-sm: '6px'
  radius: '9px'
  radius-lg: '14px'
spacing:
  control-height: '2.25rem'
  gap: '0.5rem'
  list-gutter: '0.85rem'
  content-gutter: '2rem'
components:
  button:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.text}'
    rounded: '{rounded.radius}'
    height: '{spacing.control-height}'
    padding: '0 0.85rem'
  button-hover:
    backgroundColor: '{colors.surface-hover}'
  button-primary:
    backgroundColor: '{colors.brand-violet}'
    textColor: '#ffffff'
    rounded: '{rounded.radius}'
    height: '{spacing.control-height}'
  button-on-air:
    backgroundColor: '{colors.live-solid}'
    textColor: '#ffffff'
    rounded: '{rounded.radius}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.text-muted}'
  input:
    backgroundColor: '{colors.field}'
    textColor: '{colors.text}'
    rounded: '{rounded.radius}'
    height: '{spacing.control-height}'
    padding: '0 0.7rem'
  list-item-selected:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.text}'
    rounded: '{rounded.radius}'
    padding: '0.55rem 0.7rem'
  nav-item:
    textColor: '{colors.text-muted}'
    rounded: '{rounded.radius}'
    height: '2.5rem'
  badge:
    backgroundColor: '{colors.accent-soft}'
    textColor: '#c9bcff'
    rounded: '999px'
---

# Design System: Pakita Desktop

<!--
  The source of truth is src/renderer/src/style.css (its :root tokens and
  shared controls). The colours and radii above are checked against it by
  scripts/design-tokens.spec.ts, so a change to one without the other fails
  `pnpm test`. Change the CSS first, then this file.
-->

## Overview

**Creative North Star: "The Booth by Stage Light"**

Pakita's operator sits in a dim booth at the back of the sanctuary, beside a projector, during a live service. The interface is the dark booth: indigo-black surfaces, quiet text, nothing that glows for its own sake. The brand's stage light — the violet → indigo → cyan of the mark (`src/renderer/src/assets/pakita-mark.png`) — falls only on what the operator must act on: the current selection, the next action, and the on-air state.

The feel is calm and precise. Surfaces are flat and closely stepped; alignment is exact; density is that of a desktop tool, not a web page. One sans family carries the whole interface. The only expressive moments are the brand mark and wordmark, the stage-light glow behind the sign-in card, and the live dock when something is on screen.

The projector output is not part of this system: it is drawn by each church's theme (`src/shared/theme-look.ts`).

**Key Characteristics:**

- Dark-only, indigo-tinted neutrals; never neutral grey.
- Colour is spent on selection, the primary action and the live state — nothing else.
- A left sidebar for the four content areas, a list column, a detail area, and a live dock that is always present.
- Hand-drawn line icons on one 24-unit grid with a 1.75 stroke.
- State transitions of 120–240 ms on an exponential ease-out; no entrance choreography inside the app.

## Colors

Indigo-black surfaces stepped by small lightness changes, one violet accent family from the brand, and a separate red that means only "on air".

### Primary

- **Brand Violet** (`brand-violet`): the start of every filled action (Go live, Save, primary buttons), drawn as a gradient into Brand Indigo.
- **Brand Indigo** (`brand-indigo`): the end of the action gradient; keeps white label text at 4.5:1 or better across the whole button.
- **Stage Violet** (`accent`): the interactive accent on dark — focus borders, verse numbers, selection tints (`accent-soft`, `accent-softer`).
- **Brand Cyan** (`brand-cyan`): only the far end of the full brand gradient (avatar, empty-state mark, progress) and the update banner's icon. Never behind text.

### Secondary

- **On-Air Red** (`live` for marks and text, `live-solid` behind white text): the LIVE pill, the ring around the current slide, an active Blackout. It means "the congregation sees this now" and nothing else.

### Neutral

- **Booth Black** (`bg`): the window, the sidebar, the detail area.
- **Console** (`canvas`): list columns, the live dock, cards on the sign-in screens.
- **Panel** (`surface`) and **Raised Panel** (`surface-raised`): form sections, playlist entries, default buttons; `surface-hover` for hover.
- **Well** (`field`): the inside of every input — darker than its surroundings, so fields read as recessed.
- **Hairline** (`border`) and **Edge** (`border-strong`): 1px dividers and control outlines; Edge on hover.
- **Paper White** (`text`), **Hymnal Grey** (`text-muted`), **Faint** (`text-faint`, placeholders and slide numbers only).

### Status

- **success** / **warning** / **danger**, each with a `-soft` tint for its background. Warning marks a playlist entry that is not on this laptop; danger marks errors and destructive actions.

**The Stage Light Rule.** Brand colour lands on at most three things per screen: the current selection, the primary action, and (when live) the on-air state. Everything else stays in the neutrals.

**The One Red Rule.** Red is reserved for "on air". Errors and destructive actions use `danger` (a pinker red, always as text or a soft tint), never `live-solid`.

## Typography

**Interface Font:** Inter (bundled, 400/500/600/700; `src/renderer/src/ui-fonts.css`)
**Wordmark Font:** Nunito 800 (bundled)

**Character:** One neutral, well-hinted sans for every label, value and heading — the tool disappears into the task. Nunito's rounded heavy cut appears only in the "Pakita" wordmark, echoing the mark.

### Hierarchy

- **Headline** (`headline`): screen titles on the sign-in screens.
- **Title** (`title`): the selected item in a detail area — a song, a passage, a playlist, a theme.
- **Subtitle** (`subtitle`): form-section headings (Sections, Arrangements); list-column headings use 1.05rem.
- **Body** (`body`): everything else. Bible verses read at 1rem with 1.7 line height; prose stays under 65ch.
- **Label** (`label`): field labels in Hymnal Grey above their input.

**The Tabular Rule.** Slide numbers, verse numbers, positions and percentages use tabular numerals.

## Layout

A fixed desktop shell: sidebar (14.5rem) | list column (17.5rem) | detail area, with the live dock across the bottom. The detail area pads 1.6rem top and 2rem sides; list columns pad 0.85rem. Controls are 2.25rem tall (1.9rem small). Groups use 0.5rem gaps; sections separate by 1.25–1.5rem with a hairline under page toolbars.

Below 1100px the sidebar collapses to a 4.25rem icon rail (labels remain for assistive technology); below 1000px the live dock drops its large preview. The window's minimum is 900 × 600 (`src/main/index.ts`).

Slide previews are always 16:9. Song slides fill a grid with a 13rem minimum column; the live dock's strip scrolls sideways and keeps the current slide in view.

## Elevation & Depth

Depth is tonal first: each layer is a small lightness step up from Booth Black. Shadows are rare and always offset and soft — the sign-in card (`--shadow-lg`), the theme preview (`--shadow`), and a coloured under-glow on filled actions and the current slide. No zero-offset halos, no glass.

**The Recessed Field Rule.** Inputs are darker than the surface they sit on; panels are lighter. Never invert this.

## Shapes

Gently rounded and consistent: 6px for small controls and thumbnails, 9px for buttons, inputs, list rows and slide cards, 14px for form sections and the sync card, 18px for the sign-in card. Pills (999px) only for badges, the LIVE pill and arrangement chips. Borders are 1px; dashed borders mean "add something here".

## Components

### Buttons

- **Shape:** 9px radius, 2.25rem tall, 500 weight at 0.85rem, icon before label with a 0.45rem gap.
- **Default:** Raised Panel with a Hairline border; Edge border and `surface-hover` on hover; 1px press-down.
- **Primary / Go live:** the violet → indigo action gradient, white text, an inner top highlight and a soft violet under-glow; brightens on hover. Go live carries a filled play icon.
- **On air:** `live-solid` with white text — only Blackout while active.
- **Ghost:** transparent, Hymnal Grey, fills on hover — secondary actions and icon-only buttons.
- **Danger:** `danger` text; `danger-soft` fill on hover.
- **Focus:** a 2px `focus` outline offset 2px, everywhere.

### Inputs / Fields

- **Style:** Well background, Hairline border, 9px radius; custom chevron on drop-downs; native date and colour pickers follow the dark scheme.
- **Focus:** Stage Violet border plus a 3px violet ring.
- **Disabled:** 50% opacity.

### Lists

- **Rows** are full-width buttons: title plus a muted subline, transparent at rest, Panel on hover, `accent-soft` with a violet hairline when current.

### Reordering

- **Drag where the order is the task** — playlist entries and arrangement chips (`src/renderer/src/drag-reorder.ts`). Never on the slide grid: its order comes from the arrangement.
- A `grip` icon in `text-faint` marks what can be dragged (the row's grip; the whole chip). The dragged item dims to 45%; a 2px `accent` line in the gap shows where it will land, and only where the drop would change something.
- **The step buttons stay** (↑ ↓ on rows, ‹ › on chips) for keyboard and for anyone who cannot drag, shown only on the hovered or focused item. Focus follows the item it moved, and every move is announced.

### Navigation

- **Sidebar items:** icon and label, Hymnal Grey at rest; the current section is a filled violet → indigo pill with white text.

### Live dock (signature)

- Not live: one quiet line — a grey dot, "Not presenting", and the projector choice.
- Live: the current slide drawn in the presentation's theme with an On-Air Red ring; a LIVE pill and title; Previous, Next (primary), Blackout (B) and Stop; a strip of slides with the current one ringed in red.

### Empty states

- A brand-gradient tile holding the area's icon, then one sentence that says what to do.

## Do's and Don'ts

### Do:

- **Do** take every colour, radius and easing from the `:root` tokens in `style.css`.
- **Do** draw icons with `AppIcon` (24-unit grid, 1.75 stroke, round caps).
- **Do** give every icon-only button an accessible name.
- **Do** keep slide previews 16:9 and draw themed previews with `ThemePreview`, which shares the projector's drawing.

### Don't:

- **Don't** use Unicode glyphs or emoji as icons.
- **Don't** put white text on the cyan end of the brand gradient.
- **Don't** use red for anything that is not on air.
- **Don't** use gradient text, glass, or coloured left borders on rows or cards.
- **Don't** add a light theme without a design decision: the booth is dark.
