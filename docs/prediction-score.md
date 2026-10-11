# Prediction score

A game: predict where a coin's price will be after 30 minutes, 1 hour, 1 day or 1 year. Each person has **one public
number, the profile score (300 to 900)**, comparable between everyone. Each prediction shows only how close it was.
The code is `web/js/score.js` (shared by the app and the data job); the checks are `tests/score.test.mjs`.

Predictions are a game, not advice. The app never publishes price calls: no money or prizes, and other people's
predictions stay hidden until they resolve.

## Making a prediction

- Pick a coin, a period and a price. Today's price and the coin's daily volatility are recorded by the server.
- **One open prediction per coin per period.** A new one can be made once the last one has been scored.
- **It must be a real call:** at least a quarter of a typical move up or down from today's price, and no more than
  six typical moves (which catches typos).
- A prediction can't be edited or cancelled once made.

## Typical moves

Every distance is measured in typical moves for the coin and the period, so periods and coins compare fairly:

    typical move = daily volatility × √(days in the period)

Daily volatility is the standard deviation of the last 30 daily log returns, never treated as below 0.2%.

## What people see for each prediction

How close it was, and nothing else: how far off in percent, and a label judged in typical moves.

    You said $84,000 · it was $83,500 · 0.6% above · Spot on

| Miss (typical moves) | Label |
|---|---|
| under 0.25 | Spot on |
| 0.25 to 0.5 | Very close |
| 0.5 to 1 | Close |
| 1 to 2 | Off |
| 2 or more | Far off |

The same percent can earn different labels: 3% off is "Far off" over 30 minutes but "Spot on" over a year.

## The trade score (internal, 0 to 100)

Never shown. It is the building block of the profile score, and depends only on the prediction itself, so
**identical predictions always get the identical trade score.**

    miss       = |ln(predicted ÷ actual)| ÷ typical move
    closeness  = e^(−miss)                              1 = exact, 0.37 = one typical move off
    skill      = (miss of "no change") − miss           > 0 when the call beat guessing today's price
    direction  = 1 if the price moved the way the call said, else 0

    trade score = 100 × (9/14 × closeness + 3/14 × direction + 1/7 × (½ + ½·tanh(skill)))

Example: BTC at 82,000, daily volatility 2.5%, 1-day call of 84,000, ends at 83,500.
Miss 0.24 typical moves → closeness 0.79; "no change" would have missed by 0.73, so skill is +0.49; direction right.
**Trade score 82.** The person sees "0.6% above · Spot on".

There's no period multiplier in the trade score: longer periods count more inside the profile score instead.

## The profile score (public, 300 to 900)

Built only from trade scores, so **the same trade score can move two profiles by different amounts.**

### 1. Per period: quality and consistency

| Part | Share | How |
|---|---|---|
| Quality | 70% | Average trade score |
| Consistency | 25% | From the trade scores: 40% share scoring 50 or more · 30% tight spread (1 − gap between 25th and 75th percentile) · 30% average of the worst 20% |
| Breadth | 5% | Across the whole profile: coins (up to 5), periods played, months active (up to 6) |

Consistency needs at least 3 results in a period; until then it sits at 0.5. Combined with the trade score's parts,
the overall mix is closeness 45%, consistency 25%, direction 15%, skill 10%, breadth 5%.

### 2. Fading

A result starts fading when it is **scored** (not when it was made), so a 1-year call is never penalised for waiting.

| Period | Counts half as much after |
|---|---|
| 30 min, 1 hour, 1 day | 90 days |
| 1 year | 1 year |

Fading only sets how results weigh against each other within a period, so inactivity alone doesn't change a score.

### 3. Longer periods count more

Periods blend by their share times their confidence, confidence = results ÷ (results + k):

| Period | Share | k |
|---|---|---|
| 30 minutes | 10% | 20 |
| 1 hour | 15% | 20 |
| 1 day | 30% | 10 |
| 1 year | 45% | 5 |

Example: 40 thirty-minute, 20 one-day and 2 one-year results blend 17% / 51% / 33%. Each 1-year result moves the
score about 40 times as much as each 30-minute one. Periods not played yet don't count.

### 4. The 300 to 900 scale

Calibrated with simulated players on random-walk prices:

| Player (60 predictions) | Score |
|---|---|
| Perfect | about 850 |
| Sees 70% of the move | about 691 |
| Sees 40% of the move | about 608 |
| Random calls | 550 |
| Always the wrong way | about 417 |

With few results the score is pulled toward 550 (chance level): `550 + (score − 550) × n ÷ (n + 10)`. Every new
profile starts at 550, and the score shows as **Provisional** until 10 predictions have been scored.

| Band | Score |
|---|---|
| Exceptional | 800 to 900 |
| Very good | 700 to 799 |
| Good | 600 to 699 |
| Fair | 550 to 599 (about chance) |
| Building | 300 to 549 (worse than chance) |

### Same trade score, different profiles

Two people with 20 one-day predictions each, both averaging a trade score of 58:

| | Record | Consistency | Profile |
|---|---|---|---|
| Steady | every trade about 58 | 0.87 | 647 (Good) |
| Swinging | alternates 95 and 21 | 0.34 | 586 (Fair) |

Then both make the identical prediction:

| Next prediction | Trade score | Steady | Swinging |
|---|---|---|---|
| A big miss ("Far off") | 10 | −13 | −10 |
| A great call ("Spot on") | 95 | +8 | +8 |

The miss costs the steady person more because it breaks a reliable record; the swinging person already has misses.

## Settings

Every number above is a constant at the top of `web/js/score.js`. If the weights change, re-run `scripts/check.sh score`:
the calibration checks say whether `CAL` needs updating.

## How it runs

**Making a prediction** (`web/js/pages.js`, `openPredictSheet`): the Predict chip on each coin's card opens a sheet
with the four periods, the price now, and the nearest prices that count as a real call. Periods that already have an
open prediction for that coin are greyed out.

**Settling** (`web/js/predict.js`, shared): the real start price is locked from Kraken's candles at the moment the
prediction was made, with the coin's daily volatility from the 30 full days before. If the price moved so much before
the lock that the call is no longer a real call, the prediction is voided and shown as "Not counted". A minute after
the target time, the end price is taken from the candle containing that exact moment: 1-minute candles while Kraken
still has them (12 hours), then 15-minute, hourly, 4-hourly or daily ones.

**Live accounts** (`pipeline/lib/predictions.mjs`, in the data job every 2 hours): locks, scores and moves each due
prediction from `accounts/{uid}/predictions/{TICKER}_{period}` to `accounts/{uid}/results/{id}`, then writes the
profile score to `accounts/{uid}.pscore`. `firestore.rules` lets the app only create an open prediction (one per coin
and period, as its id is fixed); nobody can change or cancel one, or write results or scores. A 30-minute prediction
is therefore scored within about 2 hours, still against the price at its exact minute.

**Demo mode**: the phone settles its own predictions the same way each time prices refresh, and works out the score.

**Shown**: one prediction score on the Profile tab (with how many predictions it's built on, and Provisional under
10), a list of open and scored predictions showing only how close each was, and a "How the score works" page.
The trade score is never shown. There is no leaderboard yet.
