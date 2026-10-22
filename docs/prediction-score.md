# Prediction score

**Last updated: 23 Oct 2026, 00:05 IST** (score v2, live from 1.4.0)

A game: say where a coin's price will be after 30 minutes, 1 hour, 1 day or 1 year. Each person has one public number,
the score (300 to 900); each call shows only how close it was. Calls are a game, not advice: no money or prizes, and
open calls are never shown to anyone.

The scoring method is Pulse's own. The app explains it only in general terms ("About your score"); this page covers the
rules a call follows and what a scored call shows. The score's code is `pipeline/lib/score2.mjs` (run by the data jobs
only; the app never computes a score) and is due to move to a private repository (see the backlog).

## Making a call

- Pick a coin and a period, then **Higher**, **Lower** or **No change**. Higher and Lower take any size up to six
  typical moves (which catches typos); No change is the price shown, exactly.
- **One open call per coin per period.** A new one can be made once the last one has been scored.
- A call can't be edited or cancelled once made (only "how sure" and "based on" can be added within 15 minutes; they
  are never used in the score).
- The server locks the start price: the open of the first full candle after the call was made, a price nobody could
  see when calling. A call keeps the direction that was chosen even if the price passed it before the lock. A call far
  outside what the coin can do in that time (over 9 typical moves) is voided.
- The end price is taken at the exact target time from Kraken's candles.

## Typical moves

Every distance is measured in typical moves for the coin and the period, so periods and coins compare fairly:

    typical move = daily volatility × √(days in the period)

Daily volatility is the standard deviation of the last 30 daily log returns before the call's day, never below 0.2%.

## What a scored call shows

How far off it was in percent, and a label judged in typical moves:

| Label | Off by |
|---|---|
| Spot on | under ¼ typical move |
| Very close | ¼ to ½ |
| Close | ½ to 1 |
| Off | 1 to 2 |
| Far off | 2 or more |

A call that went the wrong way is never better than "Off", and the app shows it as **Wrong way**. A No change call is
Spot on when the price ends within ¼ of a typical move, and otherwise never better than "Off".

## The score, in general terms

- Calling the right direction matters. Getting close to the real price matters too.
- One call can be luck: the score shows skill over many calls. It's provisional until 10 calls are scored, and says
  most after about 30.
- Everyone starts at 550, about what guessing scores. Bands: **Below guessing** (under 550), **Building** (550–649),
  **Proven** (650 and up).
- The score is worked out by the data job (every 15 minutes for new results, every 2 hours for everyone) and stored on
  the account; nobody can write their own.

## Group challenges

Each pick earns points by its label (Spot on 5, Very close 3, Close 2, Off 1, Far off 0) plus 1 for the right
direction; a voided pick earns nothing. Results never show anyone's price call.
