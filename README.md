# makefun-csv-reader-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/enisaishere-hue/makefun-csv-reader-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/enisaishere-hue/makefun-csv-reader-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the
[make.fun bounty "Read broken CSV files faster"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
It answers every case exactly as csv-reader does — same columns, rows and
errors, including every broken shape (stray CRs, doubled quotes, characters
after a closing quote, quotes that never close, short and long rows) — and
does it in a single left-to-right sweep that slices plain fields out of the
text instead of building them a character at a time. Only the rare broken
shapes go through a careful character-by-character reader.

## Run

Node 22 only, standard library only, nothing to install:

```sh
node /bot/main.ts
```

The program reads every case from `/input/cases.json`, answers each one alone
with `run` from `solve.js`, and writes `/output/answers.json`.

## Layout

- `solve.js` — the fast reader: `run(input)` returns csv-reader's answer for
  one case's `{text, header}`.
- `main.ts` — the harness driver: reads the cases, answers each with `run`,
  writes the answers.
- `package.json` — marks the tree as an ES module tree.

## Speed

On the kit's practice set (6 cases, about 10 MB of CSV), the entry's parsing
runs about 4x faster than the house baseline's in steady state (median
~160 ms against ~675 ms for csv-reader 1.0.0 itself on this machine), and the
whole program about 1.5x faster end to end, answers byte-identical.
