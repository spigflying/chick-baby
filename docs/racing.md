# 賽車模式（原型）

The idea comes from SNES-era behind-the-car racers (Top Gear 2 style): a pseudo-3D road, a championship that tours different countries, garage upgrades, three nitro boosts per race, damage that has to be repaired, and weather. **All art, names, cars, tracks, text and code are original.** No assets, music, names or sprites from any commercial game are used.

- Route: `/race` (nav link「賽車」). The pet does **not** appear in racing.
- Screen: 120×100 canvas in the 4-green palette (`#0f380f #306230 #8bac0f #9bbc0f`), scaled with `image-rendering: pixelated`.
- Logic lives in `packages/engine/src/racing.ts` (pure and deterministic). The server runs it authoritatively; the web client only renders and sends inputs.

## Rules
- Up to 6 cars per race. A lobby collects up to 4 humans per track for about 6 s, then AI fills the empty slots.
- Each race has a 3 s countdown, then 2–3 laps depending on the track.
- **Nitro: exactly 3 per race** (`NITRO_PER_RACE`). Each one lasts 3 s, doubles acceleration and raises top speed by the nitro part's boost (×1.22–1.46).
- **Off-road** (|x| > 1) caps speed at 45%.
- **Roadside objects** (|x| > 1.55) cause a crash: damage rises by `9 × (0.3 + speed/70) × (1 − armor)` and speed drops to 35%.
- **Rear-ending** another car damages both cars (the hitter takes more) and slows the hitter.
- **Damage** runs 0–100% and lowers top speed by up to 40%. It carries over between races until repaired. At 100% the car is wrecked and cannot enter a race until it is repaired.
- **Curves** push the car outward. Higher tire grip resists the push. Rain uses the **wet-tire** grip; snow uses wet grip × 0.85; night only reduces visibility.
- **Finishing order:** cars that finish come first (by finish tick); unfinished cars are ranked by distance. The race ends when every human has finished, or after a 6-minute cap.
- **Prize money:** 1st place gets the full track prize, then 60% / 40% / 25% / 15% / 10%. Only cars that finish earn prize money.
- **Championship points:** 10 / 6 / 4 / 3 / 2 / 1.
- **Unlocks:** finishing in the top 3 unlocks the next track in the championship.

### Currency
Racing uses its own **race cash ($)**, stored in `race_profiles.cash`. New players start with $3,000. It is **not** connected to pet coins (`coin_ledger`). That keeps the pet economy and the `coin_ledger.reason` CHECK constraint untouched. Exchanging between the two currencies is an open question (see below).

## Garage (parts; upgrade one tier at a time)
| Part | Tier 0 (stock) | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Effect per tier |
|---|---|---|---|---|---|---|
| Engine 引擎 | 原廠1.6L | 強化進氣 $6,000 | 雙凸輪2.0L $15,000 | 渦輪增壓 $32,000 | 賽道規格V6 $60,000 | Top speed +7 m/s; accel +1.5 |
| Gearbox 變速箱 | 4速手排 | 5速 $5,000 | 6速近齒比 $14,000 | 7速序列式 $30,000 | – | Accel +3 |
| Dry tires 乾地胎 | 街胎 | 運動胎 $4,000 | 半熱熔 $11,000 | 光頭胎 $24,000 | – | Grip +0.16 |
| Wet tires 雨胎 | 沒有 | 溝紋 $5,000 | 深溝 $13,000 | 全天候 $26,000 | – | Rain grip 0.62 → +0.15 |
| Nitro 氮氣 | 小鋼瓶 | 雙鋼瓶 $7,000 | 高壓噴射 $18,000 | 直噴 $36,000 | – | Boost +8% |
| Body/armor 車身裝甲 | 原廠 | 防滾籠 $6,000 | 碳纖維 $16,000 | 裝甲護板 $34,000 | – | Damage taken −17% |

**Repair:** costs `damage × (60 + 8 × total part tiers)` (better-equipped cars cost more to fix). If the player can't afford a full repair, the car is repaired as far as the money allows.

**Cars** (original pixel designs seen from behind; each AI slot gets a different livery):
| Car | Price | Character |
|---|---|---|
| 隼 GT (falcon) | free | Balanced, big rear wing |
| 箭 RS (arrow) | $25,000 | Light wedge, quick off the line, less tough |
| 犀 4WD (rhino) | $40,000 | Tall 4WD, more grip, tough, spare wheel on the back |
| 彗星 Z (comet) | $90,000 | Wide supercar, highest top speed |

## Tracks (championship order)
| # | Track | Country | Scenery | Weather | Laps | 1st-place prize |
|---|---|---|---|---|---|---|
| 1 | 河濱大道 | 台灣 | city | clear | 2 | $4,000 |
| 2 | 山道夜行 | 日本 | forest | night | 2 | $6,000 |
| 3 | 沙漠直線 | 美國 | desert | clear | 2 | $8,000 |
| 4 | 雨中莊園 | 英國 | farm | rain | 2 | $10,000 |
| 5 | 海岸線 | 巴西 | coast | clear | 3 | $13,000 |
| 6 | 黑森林 | 德國 | forest | rain | 3 | $16,000 |
| 7 | 冰原公路 | 冰島 | snow | snow | 3 | $20,000 |
| 8 | 霓虹港灣 | 香港 | city | night | 3 | $26,000 |

- Each track is a list of pieces `[segments, curve, hill]`, with 20 m per segment. Curves ease in and out, hills accumulate, and the loop closes back to its start height.
- AI difficulty (`ai`) rises from 0.8 to 1.03 along the championship.

## HUD
- Top-left: position (large digit) out of the field size.
- Top-right: lap.
- Bottom-left: km/h.
- Bottom-right: 3 nitro canisters and a damage bar.
- Right edge: a vertical progress strip with one dot per car (yours is the block).
- Flash messages: CRASH! / NITRO! / OFF ROAD / FINISH!
- Rain draws streaks, snow draws flakes, and night darkens the palette and fogs distant road.

## Controls
- **Touch:** ◀ ▶ N2O 煞車 油門. Buttons use pointerdown/up/leave/cancel and never call `stopPropagation`, so `idle.ts` still sees pointerdown.
- **Keyboard:** ←/→ or A/D steer; ↑, Z or W accelerate; ↓, X or S brake; Space or N fires nitro.

## Multiplayer flow (WebSocket)
| Direction | Message |
|---|---|
| client → server | `race.join {track}` · `race.input {seq, gas, brake, left, right, nitro}` (35/s input rate bucket) · `race.leave` |
| server → client | `race.lobby {race_id, track, starts_at, players}` · `race.started {race_id, seed, cars, laps, len, tick_rate}` · `race.snap {tick, countdown, cars:[[id,z,x,speed,damage,nitro,nitroT,finishedTick,hit]]}` (~10 Hz) · `race.ended {ranking, me:{rank, prize, time_ms, damage, unlocked, cash, new_unlock}}` |

- The server simulates at 20 Hz (`startRaceLoop`). Joining fails with `TRACK_LOCKED`, `CAR_WRECKED` or `ALREADY_IN_MATCH`.
- When a player leaves or disconnects mid-race, their car keeps rolling with no input, and the player is still settled (prize, damage) when the race ends.
- SIGTERM sends `race.ended {aborted:true}` and no settlement happens.
- The client sets `live.inMatch = true` from lobby through the end of the race, so the connection is never idle-paused or proactively reconnected. It interpolates snapshots with a 100 ms delay.

**REST (logged in):**
- `GET /api/race/profile` returns `{catalog, profile}`.
- `POST /api/race/buy` takes `{kind, tier}` or `{car}`; it also switches to a car the player already owns.
- `POST /api/race/repair`
- `GET /api/race/leaderboard/:track` returns the best time per player and the championship points table.

## DB (migration `0008_racing`)
- `race_profiles` (user_id PK → users)
  - `cash` int ≥ 0, default 3000
  - `parts` jsonb
  - `car` text
  - `cars` text[]
  - `damage` real 0–100
  - `unlocked` int, default 1
  - `points`, `races`, `wins`
  - `updated_at`
- `race_results`
  - `id`, `race_id`, `track`, `user_id`, `rank`, `time_ms` (null = did not finish), `prize`, `damage`, `humans`, `created_at`
  - Indexes: `(track, time_ms)` and `(user_id, created_at)`.
- Purchases and repairs write `audit_log` (`race.buy_part`, `race.buy_car`, `race.repair`).

## Prototype limitations / not done yet
- **Single-instance rooms:** lobbies live in memory on one Cloud Run instance, so players on different instances won't meet. Making this multi-instance should follow the mstairs authority/bus pattern.
- **No client-side prediction:** steering shows about 100–150 ms of latency.
- **No sound.** Music and SFX would need to be original.
- **Lap times are not anti-cheat-hardened** beyond the server being authoritative; inputs are only booleans.
- **Rooms aren't tied to the game's open hours:** a race that is running at closing time simply finishes.
