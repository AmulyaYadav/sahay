# Reliability model

Implemented as pure functions in `packages/shared/src/reliability.ts` so the exact same
math runs on the server and in unit tests. Counters live in `reliability_stats`
(one row per user), updated **exactly once per match** via `matches.reliability_applied`.

Design goals, verbatim from the source: *no five-star score, smoothing so new users
aren't punished, declines are free, abandonment costs, old failures decay.*

## Counters

```ts
interface ReliabilityCounters {
  accepted; completed;            // completed includes partial completions
  requesterConfirmed;
  cancelledPreMeeting; cancelledPostMeeting;
  timeouts;                       // accepted then went silent
  noShows;                        // confirmed no-shows
  disputes;
  offersReceived30d; offersResponded30d;  // accept OR decline both count as responsive
}
```

## Completion score

Laplace-smoothed success rate in [0, 1]:

```
bad    = cancelledPostMeeting + timeouts + noShows
trials = completed + 0.25 · cancelledPreMeeting + bad

completionScore = (completed + 2) / (trials + 4)
```

Properties:

- **Prior of 2 successes / 4 trials**: a brand-new helper scores exactly **0.5** and
  cannot be ranked to the floor.
- **Declines are absent** from the formula entirely — saying no is free.
- **Pre-meeting cancellations cost 25%** of a trial: backing out early is mildly
  discouraged but nothing like abandonment.
- **Post-meeting cancellations, timeouts, and no-shows** are full-weight failures.
- **Disputes do not appear** — a quantity mismatch imposes no public or scored penalty
  on either party (moderation reviews instead).
- Decay: the 30-day windows (`offersReceived30d`/`offersResponded30d`) roll naturally;
  lifetime failure counters are diluted by continued completions.

Examples: new helper (0,0,…) → 2/4 = 0.50. Ten completions, no failures →
12/14 ≈ 0.86. Ten completions, two no-shows → 12/16 = 0.75.

## Responsiveness

```
responsiveness = offersReceived30d < 3 ? 0.7            // unknown → neutral
               : offersResponded30d / offersReceived30d
```

Accepting **and declining both count as responding**. Only ignoring offers lowers this —
and its sole consequence is receiving offers less often (it feeds ranking, below). It is
never displayed.

## Labels (`reliabilityLabel`)

| Label | Condition |
|---|---|
| `new_helper` | `completed < 3` |
| `highly_reliable_helper` | `completed ≥ 20` **and** `completionScore ≥ 0.85` |
| `reliable_helper` | `completed ≥ 8` **and** `completionScore ≥ 0.75` |
| `active_helper` | otherwise (≥3 completions, thresholds not met) |

Checked top-down in that order.

## Ranking composite

```
rankingReliability = 0.7 · completionScore + 0.3 · responsiveness
```

Used **only** inside the matching ranker ([matching.md](matching.md)) alongside distance
bucket, fairness penalty, and random jitter. Never displayed to anyone, including the
user it belongs to.

## What peers see — and don't

A matched peer sees (`zPeerProfile`): the match-scoped **alias**, generated avatar,
`reliabilityLabel`, `completedAssists` count, member-since **month**, and "Phone
verified". That is the exhaustive list. No numeric scores, no ratings, no history, no
decline/timeout counts, nothing cross-match — aliases rotate per match precisely so
reliability display can't become a tracking handle.

## Anti-gaming measures

- **Smoothing bounds extremes**: one bad event can't destroy a record; a handful of
  self-dealt successes can't manufacture `highly_reliable_helper` (needs 20 real
  completions at ≥0.85).
- **Completion requires the counterparty**: both-confirm (or single-confirm plus a
  moderatable grace close) — you cannot confirm yourself.
- **Phone-OTP accounts** (ADR-0006) make farm accounts cost real numbers; per-account
  caps (2 active matches, 3 active requests) bound throughput of any farm.
- **Random jitter + bucketed distance** in ranking make the ranker non-deterministic and
  unprofitable to probe.
- **Declines free / ignores soft**: there is no incentive to accept-and-abandon to
  protect a streak — abandonment is the expensive path.
- Known residual: collusion rings at small scale can still inflate counters — an
  accepted limitation at launch scale, monitored via moderation stats
  ([known-limitations.md](known-limitations.md)).

## Appeals

Reliability consequences of moderation (e.g. a recorded no-show) trace to a
`moderation_actions` row, and every such action is appealable
(`appeals` table, `GET/POST /admin/appeals*`). An overturned action reverses the counter
adjustment. Organic counters (your own timeouts) are not appealable, but disputes never
score against you in the first place. See
[moderation-handbook.md](moderation-handbook.md).
