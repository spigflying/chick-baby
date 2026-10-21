# Top Gear 2 (SNES, 1993): original mechanics, and how we diverge

Research notes for the racing mode. We copy **mechanics only**. All names, art, music, tracks and code stay original (no Kemco/Gremlin assets).

## Sources
- [S1] Wikipedia, *Top Gear 2*: https://en.wikipedia.org/wiki/Top_Gear_2
- [S2] MobyGames, *Top Gear 2 (1993)*: https://www.mobygames.com/game/15505/top-gear-2/
- [S3] Sega Retro, *Top Gear 2*: https://segaretro.org/Top_Gear_2
- [S4] GameFAQs, *Top Gear 2 FAQ* by cnick (v0.70): https://gamefaqs.gamespot.com/snes/588804-top-gear-2/faqs/7418
- [S5] SNES manual (scan): https://evercade.info/wp-content/uploads/2020/08/Top_Gear_2_-_SNES_-_Manual.pdf
- [S6] Speedrun.com, *100% Guide*: https://www.speedrun.com/top_gear_2/guides/i9e41

Items marked *(unverified)* came from only one source or were inferred.

## Original mechanics
| Topic | Top Gear 2 (SNES) | Src |
|---|---|---|
| Structure | 16 countries × 4 races = 64 tracks, starting in Australasia and ending in the USA. Each country is a 4-race mini-championship. | S1 S2 |
| Field | 20 cars (player + 19 CPU). The player **starts every race at the back** of the grid. | S2 S3 |
| Qualifying | You must finish **top 10 in every race** to continue, otherwise you redo the country. | S1 S3 S4 |
| Points | Top 6 score **10-6-4-3-2-1**. | S2 S5 |
| Prize money | Matches the points in thousands: **$10k / $6k / $4k / $3k / $2k / $1k** (a Game Genie code "1st gives $50 instead of $10,000" confirms $10k for 1st). | S2 S4 |
| Country win | Winning the country championship gives the next **password**. Passwords encode progress, money and parts. | S1 S2 S4 |
| Laps | Varies by track, from short 6–7-lap circuits to long 2–3-lap tracks. A pre-race info screen shows country, city, circuit length, laps, weather and start time. | S4 S5 |
| Car | **One car model only** (fictional). Paint is free in 8 colours: red, gray, green, light blue, blue, yellow, black, purple. | S3 S4 |
| Transmission | Manual or automatic, chosen before each race. Shift with L/R. | S3 S4 |
| Nitro | **6 per race** at the start. They strongly boost speed for a short time. The Nitro upgrade raises boost strength and top speed (and maybe duration). | S1 S4 |
| Pickups | **$** = +$1,000, **N** = +1 nitro, **S** = instant boost that respawns every lap. $ and N can be collected once per race. | S1 |
| Hazards | Puddles, barriers, roadside signs, tumbleweeds, and logs or ramps that cause jumps. | S2 S3 S4 |
| Damage | Hitting obstacles and cars damages three armour zones: **front, side, rear** (green → yellow → red → destroyed). Damage slows the car. A **destroyed zone means further hits there spin you out**, and very heavy crashes can retire the car. | S1 S3 S5 |
| Repairs | **Damage is repaired automatically after each race.** There is no repair shop or cost. | S3 |
| Fuel | SNES version only: a fuel gauge, no pit stops. Running dry disqualifies you. Gearbox upgrades improve fuel economy. | S1 S3 |
| Weather | Clear, rain, fog, snow and night. Wet versus dry tyres matter, and snow turns poorly even with the best tyres. | S3 S4 |
| AI | CPU cars at the front of the pack have better equipment, and form looks random from race to race. The standard strategy is to nitro to the front early. | S2 S4 |
| Difficulty | Amateur, Professional, Championship. | S3 S4 |
| Modes | 1P, or 2P **split-screen** (always split, even in 1P; the bottom half shows the CPU rival or player 2). | S3 *(1P split: unverified wording)* |
| HUD | Tachometer, speedometer, gear, fuel, nitros, stopwatch, track diagram (with your position and the leader's), damage diagram, place, lap. | S5 |

### Shop (all prices from S4; "no saving when upgrading": you pay the full price of each tier)
| Part | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Effect |
|---|---|---|---|---|---|
| Engine | free | $30,000 | $50,000 | $80,000 | Acceleration, small top-speed gain, easier to reach higher gears |
| Gearbox | 4-speed (free) | 5-speed $10,000 | 6-speed $30,000 | 7-speed $50,000 | Top speed, fuel economy; needs a strong engine |
| Dry tyres | free | $1,000 | $2,000 | $4,000 | Grip and turning in the dry |
| Wet tyres | free | $1,000 | $2,000 | $3,000 | Grip in rain |
| Nitro | free | $5,000 | $15,000 | $30,000 | Boost strength, nitro top speed |
| Front armour | free | $5,000 | $10,000 | $20,000 | Front zone durability |
| Side armour | free | $5,000 | $10,000 | $20,000 | Side zone durability |
| Rear armour | free | $5,000 | $10,000 | $20,000 | Rear zone durability |
| Paint | free (8 colours) | | | | Cosmetic |

## Diff: current prototype (2867efd) → planned
User decisions (2026-10-21) override TG2 where they conflict:
1. Race cash and pet coins can be exchanged.
2. No new races near closing time.
3. Private rooms and friend invites.
4. **Car damage resets every race.** This happens to match TG2.
5. Seasons that reset.

| Mechanic | TG2 | Prototype now | Plan |
|---|---|---|---|
| Field size | 20 | 6 | **20** (humans + AI fill). Server cost is fine (pure math). Needs the LOD sprites in this commit |
| Grid | Player starts last | AI in front, humans at back | Same, humans at back (shuffled among themselves) |
| Championship | 16 countries × 4 races, top-10 qualify | 8 single tracks, top-3 unlock | **Countries of 4 races each.** Prototype: 4 countries × 4 = 16 tracks first, expandable to 16 countries. Top 10 in each race to continue; country champion unlocks the next |
| Points | 10-6-4-3-2-1 | same | keep |
| Prize | $10k/6k/4k/3k/2k/1k, the same on every track | track purse × share | **Flat TG2 table** ($10k…$1k for places 1–6, $0 for 7+) |
| Laps | 2–7 depending on track | 2–3 | 2–7 depending on track length |
| Cars | 1 model, 8 free paints | 4 models for sale | Decision needed: keep 4 original models (user asked for "several models") **and** add free paint (4 liveries in the green palette). Recommend keeping models, but make them cosmetic or near-equal so the TG2 one-car balance holds |
| Transmission | Auto/manual | none | **Auto default + optional manual** (shift buttons on mobile are crowded: keyboard Q/E only at first) |
| Nitro | 6/race, pickups N | exactly 3 | Decision needed: TG2 says 6. The original brief said 3. Recommend **6 (TG2)** with shorter bursts. Ask the user |
| Pickups | $, N, S | none | Add $ (+$1,000), N (+1 nitro), S (instant boost, respawns per lap) |
| Hazards | puddles, barriers, signs, logs/ramps | roadside props only | Add puddles (rain grip loss), barriers, and ramps/jumps (airborne, no steering) |
| Damage | Front/side/rear zones; destroyed zone → spin-outs; heavy crash may retire | one 0–100 bar, slows car | **3 zones** (rear-end hit = front, side swipe/roadside = side, being hit = rear), slowdown, spin-out when a zone is destroyed |
| Repair | Auto after each race (free) | paid repair, damage persists | **Auto reset each race** (decision 4). Remove the repair shop and cost |
| Shop tiers/prices | see above (engine $30/50/80k…) | 6 parts, my own prices | **Match TG2 structure and prices**: engine 3 tiers $30k/50k/80k; gearbox $10k/30k/50k; dry $1k/2k/4k; wet $1k/2k/3k; nitro $5k/15k/30k; armour front/side/rear $5k/10k/20k each. Original part names stay |
| Fuel | SNES gauge, gearbox = economy | none | Add a fuel gauge on long races (gearbox improves economy), or skip if it hurts mobile fun. Ask the user |
| Weather | clear/rain/fog/snow/night | clear/rain/night/snow | **Add fog** |
| Difficulty | 3 levels | single | 3 levels (AI pace multiplier and random form per race) |
| AI | front-runners stronger, random form | fixed skill per track | Per-race random form; grid order ≈ strength (strong cars start near the front) |
| Passwords | after each country | server profile | Not needed (server save). Optional "progress code" for nostalgia: skip |
| 2P | split screen | online rooms | Online rooms + **private rooms/invites** (decision 3). Split-screen-style HUD strip showing the nearest rival |
| HUD | tach, speed, gear, fuel, nitro, time, map, damage diagram, place, lap | place, lap, speed, nitro, damage bar, progress strip | Add gear, race timer, track mini-map (replacing the strip), 3-zone damage diagram, fuel if adopted |
| Pre-race info | country/city/length/laps/weather/time | track list | Info card before each race |
| Currency | $ only | separate race $ | Separate race $ **plus exchange** (decision 1). Proposed: **1 pet coin → $500; $1,000 → 1 coin**. The 2:1 spread stops arbitrage. Daily cap of 50 coins each way. Exchange goes through coin_ledger with new reasons `race_exchange_in/out` (migration widens the CHECK) |
| Closing time | n/a | races may run past close | **Block new lobbies within 8 min of closing** (max race length + lobby); running races finish |
| Seasons | n/a | lifetime points | **Seasons** (decision 5): proposed 4 weeks. Points table and unlocks reset; cash and parts carry over (needs confirming); past season podium kept in `race_seasons` |

## Open questions for the user
1. Nitro count: TG2's 6, or the earlier "exactly 3"?
2. Fuel gauge: copy the SNES fuel mechanic or skip it?
3. Car models: keep 4 original models (cosmetic or near-equal), or one car plus paint like TG2?
4. Exchange rate (1 coin → $500, $1,000 → 1 coin, 50/day): OK?
5. Season length (4 weeks?) and what resets: unlocks and points only, or cash and parts too?
6. 20-car field on a 120-px screen is busy but works with the new LOD sprites. Keep 20?
