# How TuneForge computes a tune

TuneForge does not guess numbers from a lookup table per quad. It starts from a reference tune
(the Betaflight defaults, which the firmware team built for a typical 5"), scales it with a small
physics model of the craft, applies the flight style, links the PID side to the rates the pilot
picked, and then moves everything with three intent sliders. Every step adds a plain-language
reason that the app shows under **Why these numbers?**.

Source: `src/core/` (firmware-agnostic). Firmware adapters only translate the result.

## 1. Rates (`core/rates`)

The canonical rate description is Betaflight **Actual** rates, because each number is physical:

| Number | Meaning |
|---|---|
| `center` | slope of the curve at stick center, deg/s per full stick |
| `max` | rate at full stick, deg/s |
| `expo` | 0–1, how late the curve bends from the center slope to the max |

Style presets (5"): freestyle 100 / 850 / 0.50, cinematic 50 / 450 / 0.15, racing 250 / 700 / 0.10
(yaw slightly lower). Props above 5.5" scale rates by `(5.5 / D)^0.3`. The rate-feel sliders
multiply max and center (`exp(k·s)`) and trade center slope against expo for the curve shape.

All five Betaflight rate formulas and INAV's are ported from the firmware
(`fc/rc.c` `applyBetaflightRates` … `applyQuickRates`, INAV `rcLookup` + `pidRcCommandToRate`),
including integer storage, `RC_RATE_INCREMENTAL = 14.54`, the 1998 °/s setpoint limit and INAV's
integer stick lookup. Compiling rates for a firmware is a fit: the integer parameters of the target
model whose curve is closest to the design (coarse grid + integer pattern search, weighted toward
the center and full stick). That is also how "start from my current rates" works in reverse, and how
the app can export the same feel as Betaflight, KISS, RaceFlight or Quick rates.

## 2. Physics estimate (`core/craft/physics.ts`)

For geometrically similar quads, roll inertia `J ∝ m·L²` and the torque available
`τ ∝ T_max·L`, so the angular acceleration per unit of motor command, the "plant gain" the PID
loop sees, is `τ / J ∝ TWR / L`. Bigger props also spin up more slowly (motor time constant
roughly `∝ L`), which caps the usable loop bandwidth by the same factor. The two effects cancel
for P: **the gain needed for the same feel follows 1 / TWR**, while the **D-to-P balance grows
with prop size**. Weight enters through thrust-to-weight, which is why the wizard asks for it.

Thrust per motor comes from a table of typical builds per prop size (31 mm whoop 26 g … 5" 1.7 kg
… 10" 3.9 kg), adjusted by `(KV·cells / typical)^1.6` when the KV is known, by `(cells /
typical)^0.25` when it is not, and ×1.1 for ducts. Hover throttle is `√(1/TWR)` (thrust ∝
throttle²); the motor frequency at hover is shown because that is where the RPM filter works.

## 3. PID gains (`core/tuning/pid.ts`)

Starting from the reference gains (roll P45 I80 D30→40 FF120, pitch P47 I84 D34→46 FF125, yaw
P45 I80 FF120):

| Factor | Formula | Why |
|---|---|---|
| Authority | `(15.6 / TWR)^0.5` on every term | low thrust-to-weight needs more gain |
| Very big props | `(7 / D)^1.2` above 7" | slow props cannot carry full gains |
| Ducts | P ×0.80, D ×0.96, I ×0.68, FF ×0.68 | duct damping, turbulent propwash, extra static thrust |
| D balance | `(D / 5.5)^0.7`, 1…1.35 | slower motors need more damping per unit of P |
| Big-prop I | `(5.5 / D)^0.6` above 5.5" | avoids slow I-term bounce-back |
| Style | freestyle P1.05 FF1.1 · cinematic P0.95 I0.85 D1.1 FF0.45 · racing P0.95 I1.1 D0.85 FF1.25 | character of the tune |
| D boost range | freestyle 1.25, cinematic 1.1, racing 1.55 (D max / D min), ±15 % with max rate, halved for ducts | snappy flips need more D at the end of the move |
| Noise | D ×1.05 / 1 / 1 / 0.92 / 0.85 by build condition, ×0.9 without RPM filter | D amplifies noise into motor heat |
| Sliders | response: FF `e^(0.35s)`, P `e^(0.08s)` · hold: P `e^(0.12s)`, I `e^(0.25s)` · propwash: D `e^(0.22s)` | pilot intent |

The exponent 0.5 and the reference TWR 15.6 were calibrated against professional Betaflight 4.5
presets from the official firmware-presets repository (UAV Tech, Karate, SupaflyFPV, AOS,
ctzsnooze, Minchan), evaluated through the firmware's own slider formula:

| Craft (style) | Est. TWR | TuneForge roll P / I / D / D max / FF | Professional presets, roll |
|---|---|---|---|
| Tinywhoop 31 mm, 1S, 28 g (freestyle) | 4.1 | 74 / 106 / 56 / 63 / 175 | P 40–76 · D 25–72 · FF 111–239 |
| Cinewhoop 3", 6S, 450 g (cinematic) | 5.4 | 58 / 79 / 54 / 56 / 62 | P 40–72 · D 30–67 · FF 0–192 |
| Micro 3" open, 4S, 160 g (freestyle) | 12.5 | 53 / 89 / 34 / 42 / 147 | P 54–67 · D 36–50 · FF 117–195 |
| 5" race, 6S 1950 KV, 500 g (racing) | 15.4 | 43 / 88 / 26 / 39 / 151 | P 38–49 · D 20–37 · FF 120–156 |
| 5" freestyle, 6S, 650 g (freestyle) | 10.7 | 57 / 97 / 36 / 46 / 160 | P 51–79 · D 36–53 · FF 117–249 |
| 7" long range, 6S, 1000 g (freestyle) | 9.4 | 61 / 89 / 46 / 57 / 170 | P 49–61 · D 30–62 · FF 140–206 |
| 10", 6S, 2200 g (cinematic) | 7.1 | 41 / 46 / 43 / 47 / 52 | P 36 · D 30–40 |

The model lands inside (or at the edge of) the spread of real tunes for every class, on the
conservative side for 5". `src/core/tuning/engine.test.ts` keeps it there.

## 4. The rest of the PID profile (`core/tuning/dynamics.ts`)

This is where the "hybrid" profile is linked to the rates:

- **Feedforward**: averaging, smoothing, jitter reduction and boost by style (racing OFF/20/5/18,
  freestyle 2-point/45/7/15, cinematic 3-point/70/12/5 with a 30 % center transition); radio links
  below 250 Hz get more averaging. `feedforward_max_rate_limit` is 85 % above 1000 °/s, 90 %
  normally, 100 % below 550 °/s, to stop overshoot at the end of flips.
- **I-term relax** cutoff: racing 30, freestyle 15, cinematic 10 Hz, × `(5.5/D)^1.2` for big props,
  × `(800/max rate)^0.3` (fast flips bounce back more), × the hold slider.
- **Anti-gravity** 80/90/100 by style, +20 above 6", +10 ducted. **TPA** 65 % @1350 (70 % @1250 for
  racing, 75 % @1250 above 6"). **thrust_linear** 25 on whoops, 20–25 on micros, 15 for cinematic 5".
- **Dynamic idle** keeps the same prop tip speed at idle: `150 / D` hundreds of RPM (whoop ≈ 12 300,
  5" ≈ 2 900, 7" ≈ 2 100 RPM). Needs bidirectional DShot.
- **RC smoothing** auto factor 25/30/45, **battery sag compensation** on whoops, ducted and race quads,
  **throttle mid** at the estimated hover point with 25 % expo for cinematic.

## 5. Filters (`core/tuning/filters.ts`)

Anchored on the official Betaflight *basic* filter presets (5 noise levels × with/without RPM
filter, presets/4.5/filters/basic_*.txt). Between levels, cutoffs are interpolated in log space.

- With RPM filter: gyro lowpass 1 off, lowpass 2 at 1000/875/500/250/125 Hz, D-term ×1.10…0.80,
  1–2 dynamic notches, RPM Q 750…350.
- Without: dynamic gyro lowpass 400…125 Hz (×2 max), 4–5 notches, D-term ×1.0…0.6.
- The propwash slider moves the effective level by up to one step; ducted frames count half a level
  noisier; props above 5.5" lower gyro (`(5.5/D)^0.5`) and D-term (`^0.4`) cutoffs; notch range
  `100·(5/D)^0.6 … 600·(5/D)^0.3` Hz; RPM filter minimum `100·(5/D)^0.5` Hz; 12-pole whoop motors
  filter two harmonics instead of three.
- Motor heat risk is a logistic score of the propwash slider, build noise, missing RPM filter and the
  style's D, with advice on what to check after the first flight.

## Limits

These are starting points from a model, not a blackbox analysis. Frames with unusual inertia
(heavy cameras far from the center), damaged motors or extreme props can need more. Fly a short
hover first, check motor temperature, then refine with the sliders or in expert mode.
