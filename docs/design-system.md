# Sahay design system — "Warm Relief"

Transcribed from the approved reference mockup (2026-07-26). This file is the single
source of truth for the visual language of both clients. Web (`apps/web`) and mobile
(`apps/mobile`) implement these tokens exactly; when a screen is not covered here,
compose it from these primitives rather than inventing new ones.

Personality: friendly, calm, humanitarian. Rounded cards on a soft gray canvas,
colorful pastel category chips, pill badges, one confident blue. Never militaristic,
never gamified, no gradients-as-decoration.

## 1. Color tokens

Light theme (reference). Dark theme derives by swapping canvas/surface/text and
reducing tint saturation — keep existing dark-mode support working.

| Token | Hex | Use |
|---|---|---|
| `primary` | `#2563EB` | Primary buttons, active tab, links, Helping-now accent |
| `primary-strong` | `#1D4ED8` | Hover/pressed |
| `primary-tint` | `#EFF4FF` | Helping-now card bg, selected states, info chips |
| `success` | `#16A34A` | Confirm/send actions ("Send request" is a GREEN button), availability badges, my chat bubbles |
| `success-tint` | `#E8F7EE` | Green badge/chip backgrounds, location-sharing card |
| `warning` | `#D97706` | "Moderate need", notices |
| `warning-tint` | `#FEF3E2` | Notice banners (warm cream), moderate-need pills |
| `error` | `#DC2626` | "Critical need", destructive buttons, urgent chip |
| `error-tint` | `#FDECEC` | Critical/high-need pills, log-out button bg |
| `canvas` | `#F6F7F9` | App/page background |
| `surface` | `#FFFFFF` | Cards, sheets, tab bar |
| `border` | `#E5E9F0` | 1px card & input borders (cards are border+shadow-soft, not heavy shadow) |
| `text` | `#101828` | Headings, primary text (near-navy, not pure black) |
| `text-secondary` | `#667085` | Meta lines, captions, placeholders |
| `text-on-color` | `#FFFFFF` | Text on primary/success/error |

Category chip tints (icon sits in a 40–44px rounded-12 square, icon colored, bg pastel):

| Group | bg | icon |
|---|---|---|
| hydration | `#E3F1FD` | `#1D9BF0` |
| food | `#FEF3E2` | `#D97706` |
| shelter | `#EFE9FE` | `#7C5CE0` |
| hygiene | `#FDE8F0` | `#DB2777` |
| power | `#FEF9C3` | `#CA8A04` |
| clothing | `#E8F7EE` | `#16A34A` |
| first_aid | `#FDECEC` | `#DC2626` |
| misc | `#EEF1F5` | `#667085` |

Need/shortage pill mapping: `critical_shortage` error-tint/error text · `high_need`
error-tint/`#C2410C` · `moderate_need` warning-tint/warning · `adequate` success-tint/success ·
`possible_surplus` primary-tint/primary · `unknown` `#EEF1F5`/text-secondary.
Pills: 12/16 medium, padding 2px 10px, fully rounded, text + tint only (no borders).

## 2. Typography

Web: Inter (self-host via `@fontsource-variable/inter` or system-ui fallback stack).
Mobile: system font (SF/Roboto) — weights matter more than the family.

| Role | Size/line | Weight |
|---|---|---|
| H1 | 28/36 | 700 |
| H2 | 20/28 | 600 |
| H3 | 16/24 | 600 |
| Body | 14/20 | 400 |
| Body-medium | 14/20 | 500 (buttons, list titles) |
| Caption | 12/16 | 500 |

Numbers that matter (countdowns, stats) get 24–32/700 tabular-nums.

## 3. Shape, space, elevation

- Radius scale: 12 (inputs, buttons, chips) · 16 (cards, list rows) · 20 (large cards,
  sheets) · 24 (hero cards, modals). Pills/avatars fully rounded.
- Spacing: 4-pt grid; cards padded 16; page gutters 16 (mobile) / 24 (desktop);
  12 gap between stacked cards.
- Elevation: cards = surface + 1px border + `0 1px 2px rgb(16 24 40 / 4%)`. Sheets/
  modals = `0 8px 24px rgb(16 24 40 / 12%)`. Nothing floats aggressively.
- Buttons: height 48 (primary, full-width on mobile) / 40 (secondary/inline);
  radius 12; primary = primary bg, white 14/500 text; secondary = white bg, 1px
  primary-tinted border (`#BFD3F8`), primary text; ghost = primary text only;
  destructive = error bg white text; destructive-soft = error-tint bg error text
  (log out). Disabled: 40% opacity. Focus: 2px outline `#93B4F4` offset 2.

## 4. Signature patterns (replicate faithfully)

1. **Greeting header (Home):** "Good evening, {pseudonym} 👋" — H2 line with the
   pseudonym bolded on its own line, bell icon right. Time-of-day localized
   (morning/afternoon/evening keys).
2. **Event card:** H3 title + green "Active" pill top-right; meta rows with 16px
   icons (calendar dates, pin area); "View event page →" primary ghost link.
3. **Notice banner:** warning-tint card, warm icon left, body text, caption timestamp.
4. **Helping now card:** primary-tint bg (turns neutral surface when off), H3 +
   large switch top-right; when ON: caption metas "Approx. location shared (100 m)" /
   "Last updated {t} · Expires in {n} min"; full-width secondary button
   "Stop receiving requests".
5. **Quick action tiles:** two side-by-side surface cards, tinted icon square,
   Body-medium title + caption subtitle.
6. **Category list row:** tinted icon chip, Body-medium name, need pill + "{n} needed"
   caption, chevron right. Used by What-should-I-bring, dashboards, pickers.
7. **Availability badge:** success-tint pill "{n} available" on supply rows.
8. **Urgency segmented chips:** three rounded-12 chips; selected = tinted bg + colored
   1px border + colored text (standard→success, soon→warning, urgent→error);
   unselected = surface + border.
9. **Location consent card:** success-tint, pin icon right, Body-medium "Sharing
   approx. location (100 m)" + caption "You can change this in Settings".
10. **Match found moment:** centered celebratory screen — flat SVG vignette (lantern
    in a soft green circle, small confetti dots in palette colors), H1 "Match found!",
    body "{alias} can help you." + "They have {n} available and are nearby.", card
    with caption "Respond within" + 24–32/700 countdown + thin progress bar,
    primary "Start chat", ghost "Cancel request". (Helper's offer screen uses the same
    countdown card language.)
11. **Chat:** header = avatar + alias + "Online"/state caption; peer bubbles surface
    with border, left, avatar beside; my bubbles success bg white text, right; radius 16
    with 4px tail corner; caption timestamps below; quick-reply chips (surface, border,
    rounded-full) in a horizontal row above the input; rounded input + circular green
    send button.
12. **Profile:** 64px avatar circle (avatar color, initials 700), H2 pseudonym,
    caption "@{slug}" style line, badge row (success-tint "Phone verified", neutral
    "Member since {month}"), stat strip card of three columns (number 20/700 +
    caption label), then menu list rows (icon + label + chevron), destructive-soft
    log out.
13. **Bottom tab bar (mobile) / header nav (web):** Home, Events, Supplies, Profile;
    22px icons + 12/16 labels; active primary, inactive text-secondary; surface bg,
    top border.

## 5. Illustrations & icons

- Icons: consistent 1.5–1.75px stroke outline set (existing inline SVG set restyled to
  stroke style), 20–24px, colored by context.
- Illustrations: small flat inline-SVG vignettes ONLY at: onboarding (hands passing a
  parcel), join-event (balloons/celebration), match-found (lantern + confetti), and
  empty states (single object in a soft tinted circle). Palette colors only, no
  detailed faces (simple shapes), no stock-art look; each vignette < 60 SVG nodes.
- Emoji used sparingly as warmth accents (👋 greeting, 🎉 nowhere else).

## 6. Voice

Sentence case everywhere. Buttons say what happens ("Send request", "Start chat",
"Stop receiving requests"). Empty states invite action. All copy via i18n catalogs —
new strings require both `en` and `hi` entries.

## 7. Non-negotiables (unchanged by the facelift)

Functionality, routes, API usage, i18n coverage, RTL-safe layouts, 44px touch targets,
visible focus, aria labels/roles, reduced-motion respect, dark mode (web), honest
sync/offline states, and the privacy disclaimers (approximate/community-reported,
"not an emergency service") remain exactly as specified in the PRD. Accessible names
must not change (the e2e suite selects by them).
