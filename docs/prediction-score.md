# Prediction score

A game: predict where a coin's price will be after 30 minutes, 1 hour, 1 day or 1 year. Each prediction gets its own
score, and every resolved prediction feeds a profile score from 300 to 900 that can be compared between people.
The code is `web/js/score.js` (shared by the app and the data job); the checks are `tests/score.test.mjs`.

Predictions are a game, not advice. The app never publishes price calls: no money or prizes, and other people's
predictions stay hidden until they resolve.

## Making a prediction

- Pick a coin, a period and a price. Today's price (P₀) and the coin's daily volatility are recorded by the server.
- **One open prediction per coin per period.** A new one can be made once the last one has been scored.
- **It must be a real call:** at least a quarter of a typical move up or down from today's price, and no more than
  six typical moves (which catches typos).
- A prediction can't be edited or cancelled once made.

## Typical moves

Every distance is measured in typical moves for the coin and the period, so periods and coins compare fairly:

    typical move = daily volatility × √(days in the period)

Daily volatility is the standard deviation of the last 30 daily log returns, never treated as below 0.2%.

## 1. Prediction score: one prediction on its own

Depends only on the prediction, so **identical predictions always get the identical score.**

    miss       = |ln(predicted ÷ actual)| ÷ typical move
    closeness  = 100 × e^(−miss)                 exact = 100, one typical move off ≈ 37
    score      = closeness × period value

| Period | Value | Most points |
|---|---|---|
| 30 minutes | ×1 | 100 |
| 1 hour | ×1.5 | 150 |
| 1 day | ×3 | 300 |
| 1 year | ×4.5 | 450 |

Two more facts are recorded for the profile, without changing this score:
- **Skill:** how much closer the call was than guessing "no change" would have been, in typical moves.
- **Direction:** whether the price moved the way the call said.

Example: BTC at 82,000, daily volatility 2.5%, 1-day call of 84,000, ends at 83,500.
Miss 0.24 typical moves → closeness 78.8 → **236 points**. "No change" would have missed by 0.73, so skill is +0.49,
and the direction was right.

## 2. Profile score: the whole record (300 to 900)

Depends on everything that came before, so **the same new prediction can move two profiles by different amounts.**

### Per period

Each period is scored on its own from its resolved predictions:

| Part | Weight | How |
|---|---|---|
| Closeness | 40% | Average closeness |
| Consistency | 25% | 40% share scoring 50 or more · 30% tight spread (1 − gap between 25th and 75th percentile) · 30% average of the worst 20% |
| Skill | 20% | ½ + ½·tanh(average skill) |
| Direction | 10% | Hit rate on calls, starting from 2 hits in 4 |
| Breadth | 5% | Across the whole profile: coins (up to 5), periods played, months active (up to 6) |

Consistency needs at least 3 results in a period; until then it sits at 0.5.

### Fading

A result starts fading when it is **scored** (not when it was made), so a 1-year call is never penalised for waiting.

| Period | Counts half as much after |
|---|---|
| 30 min, 1 hour, 1 day | 90 days |
| 1 year | 1 year |

Fading only sets how results weigh against each other within a period. It never shrinks the amount of evidence, so
inactivity alone doesn't change a score.

### Longer periods count more

Periods blend by their share times their confidence, confidence = results ÷ (results + k):

| Period | Share | k |
|---|---|---|
| 30 minutes | 10% | 20 |
| 1 hour | 15% | 20 |
| 1 day | 30% | 10 |
| 1 year | 45% | 5 |

Example: 40 thirty-minute, 20 one-day and 2 one-year results blend 17% / 51% / 33%. Each 1-year result moves the
score about 40 times as much as each 30-minute one. Periods not played yet don't count.

### The 300 to 900 scale

The blended value is placed on a scale calibrated with simulated players on random-walk prices:

| Player (60 predictions) | Score |
|---|---|
| Perfect | about 850 |
| Sees 70% of the move | about 696 |
| Sees 40% of the move | about 603 |
| Random calls | 550 |
| Always the wrong way | about 431 |

With few results the score is pulled toward 550 (chance level): `550 + (score − 550) × n ÷ (n + 10)`. Every new
profile starts at 550, and the score shows as **Provisional** until 10 predictions have resolved.

| Band | Score |
|---|---|
| Exceptional | 800 to 900 |
| Very good | 700 to 799 |
| Good | 600 to 699 |
| Fair | 550 to 599 (about chance) |
| Building | 300 to 549 (worse than chance) |

### Same prediction, different profiles

Two profiles average the same closeness (70). One is steady at 70; the other alternates 100 and 40.

- Steady: 717 (Very good). Streaky: 672 (Good). Same average, but consistency is 0.91 vs 0.44.
- Both then make the identical 1-day prediction that misses (90 points for each).
  The steady profile drops 12 points, the streaky one 8: the miss breaks a steady record more.

## Settings

Every number above is a constant at the top of `web/js/score.js`. If the weights change, re-run `scripts/check.sh score`:
the calibration checks say whether `CAL` needs updating.

## Not built yet

The prediction sheet, the profile page, Firestore storage and rules, and the data-job step that resolves predictions
(from Kraken 1-minute candles at the exact target time) and writes scores.
