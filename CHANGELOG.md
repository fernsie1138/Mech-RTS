# Changelog

## v30 — Assault Mech minimum range
- **Assault Mechs have a minimum range of 10.** They can't fire at anything closer, won't pick such targets, and don't walk toward an enemy that's too close.
- Ordered to attack an enemy that's too close, an Assault Mech backs off to just beyond 10, then fires.
- **Assault Mech splash radius 4** (was 3) on each missile.
- **Dev → Stats has a "Min range" row** for every armed unit and the turret and HQ (all 0 except the Assault Mech).
- Tests: `tests/units-unit.mjs` checks that it holds fire at a mech inside 10, backs off and fires when ordered to attack it, fires at one just beyond 10, and that other mechs have no minimum range.

## v29 — Repair fix; Assault Mech missiles
- **Fixed: an error when ordering a Builder to repair.** With Repair on, a finger that stayed down a moment or drifted a little while tapping the mech was taken as dragging out a wall line, and the game stopped with an error. Now it counts as a tap on the mech, and the Builder goes to repair it. (Reproduced in a headless test before fixing, and covered by `tests/builder.mjs` from now on.)
- **The Assault Mech fires a stream of small missiles.** Each salvo is 6 missiles, launched 0.12 s apart from its four arm-cannon barrels in turn. They fly in a low arc with thick little smoke trails and burst where they land, each digging a small crater. Fast mechs can still dodge them.
- **Assault Mech damage 75 a salvo** (was 110 a shell), shared between the 6 missiles. **Splash radius 3** (was 5) on each missile.
- Tests: `tests/units-unit.mjs` checks the salvo: 6 missiles, launched one after another, together carrying 75 damage, each with splash 3, from different barrels, landing on the target.

## v28 — Light and Assault Mech models, a bigger Heavy, manual repair
- **The Light Mech uses your model** (`assets/light-mech.gltf`). It is the same size as before (2.9 tall). Its backward-bending legs walk, the body and gun turn to aim, and shots come out of the gun. Its shins are in team colour.
- **The Assault Mech uses your model** (`assets/assault-mech.gltf`). It is the same size as before (5.8 tall). It walks, its torso, shoulders and arm cannons turn to aim, and shells come from the four cannon barrels, in turn.
- **The Heavy Mech is 60% bigger**: 6.6 tall (was 4.1), now the tallest mech. Its guns and health bar moved with it. Its footprint for moving round obstacles is unchanged, so it still fits through the same gaps. Being so tall, it can now fire over a Builder's wall (2.6 high) at mechs a little way behind it. Shorter mechs still can't. Tapping a mech now uses a slimmer target round tall mechs, so a tap beside a small mech standing next to a Heavy still picks the small one.
- **Builders no longer repair by themselves.** Select Builders, tap Repair, then the damaged mech, turret or HQ. The start screen help says so.
- Tests: `tests/models.mjs` now checks all four models: their size (the Heavy 60% bigger, the others as before), feet on the ground, shots from the guns with the torso turned, and legs moving. `tests/repair-unit.mjs` checks that idle Builders don't repair anything by themselves, but do when ordered.

## v27 — Your Heavy Mech and turret models
- **The Heavy Mech now uses your model** (`assets/heavy-mech.gltf`): body, rocket pod, both arms, hips, thighs, calves and feet.
  - It is the same size as before (4.1 tall).
  - Its legs walk with normal, forward-bending knees, and the feet stay flat.
  - The upper body (body, rocket pod, arms) turns on its own to aim.
  - It crouches in Defend.
  - Wrecks use the model too.
  - Shots come out of the forearm guns.
- **The auto turret now uses your model** (`assets/turret.gltf`): the tower stands still, and the head and both barrels turn to aim. Shots come out of the barrels. It still rises out of the ground while a Builder builds it.
- Like the Medium Mech, the models have no textures. Team colours, panel seams and grime are painted in code: the Heavy's body and thighs and the turret's head are in team colour, the rest in greys.
- The new `units/modelview.js` draws any glTF model with named parts, so later models can be added the same way.
- **Fixed: mechs could get stuck in a flooded crater.** A mech crawling out of a steep, flooded crater could be pushed back in by another mech pressing against it, again and again. Now a mech on much harder ground is barely pushed by others, so it can crawl out. (The simulated AI-vs-AI match found this.)
- Tests: new `tests/models.mjs` checks that both models load and are drawn, their sizes, that the legs move when walking, that shots leave from the barrels with the torso or head turned, and that wrecks use the model.

## v26 — Battle Value replaces the unit cap
- **Battle Value (BV)** replaces the old limit of 40 mechs a side. Every unit has a BV, and bigger, stronger units cost more of it: Turret 1, Light Mech 1, Medium Mech 2, Builder 3, Heavy Mech 4, Assault Mech 6.
- **Each side may field 30 BV at the start, plus 5 for each capture point it holds.** Mechs alive and in the build queue count, and so do turrets (standing, being built, or ordered). So nobody can build only Assault Mechs.
- **Losing a capture point lowers the limit but takes nothing away.** You just can't build more until you are back under it.
- The top bar shows **BV used / limit** (red when full). Each build button shows its BV, and is dimmed with its BV in red when it won't fit. Building over the limit shows "Battle Value limit (used/limit): take capture points to raise it". Ordering a turret over the limit is refused the same way.
- The enemy AI keeps to the same limit: when its pick doesn't fit, it builds something smaller.
- **Dev → Stats** has a Battle Value row for every unit and the turret, plus "Battle Value at the start" and "+ BV per capture point" (these replace "Mechs per side").
- Tests: `tests/match-unit.mjs` checks the limit, queued mechs and turrets counting, capture points raising it, and an AI-vs-AI match never going over it. `tests/builder-unit.mjs` checks that a turret over the limit is refused.

## v25 — Pause, save and load; rubble on the ground; longer fires
- **Pause button** (top right, or the P key). It stops the battle and opens a menu with **Resume**, **Save game** and **Load game**.
- **Save game** downloads the whole battle as one JSON file (about 0.5 MB). On the iPad, Safari offers to save it to Files (Downloads). The file holds:
  - the ground as it is now (craters, wear, scorch, trenches, flooded craters) and every crater and rubble picture;
  - the trees, and each building piece by piece (blast marks, holes, the rubble round it);
  - every mech, turret, HQ and wreck, the Builders' unfinished jobs, credits, build queues, capture points, the enemy AI, the ground you have explored, and the camera.
  - Not saved: fires and smoke burning at the moment, shells in flight, and each mech's exact route (moving mechs are sent to the same place again).
- **Load game** (in the pause menu, or on the start screen) opens a saved file and puts the battle back, paused, so you can look before you carry on. Reset still goes back to the map as it was at the start of the match.
- **Rubble heaps baked into the ground.** Your 12-heap picture was cut out (`tools/make-rubble.mjs`, giving `assets/rubble.png`; the overgrown green heap is left out). Heaps are stamped into the ground texture, at random, round the foot of damaged buildings as they are hit and where panels fall. They also gather round turrets and HQs when they are hit, and a ring of big heaps marks a destroyed HQ. Like craters, they stay for the rest of the match.
- **Fires burn longer:** about twice as long for buildings (14–24 s), rubble (10–18 s) and mech wrecks (20–32 s), and an HQ burns for 90 s.
- **Fire smoke lasts longer** (4–6.5 s per puff) and is drawn as **flat puffs that face the camera** (2 triangles each instead of 80), as is the low battle haze. The short smoke of explosions is still 3D.
- Tests: new `tests/savegame.mjs` (pause, save, load back through the file picker and compare everything, play on, refuse a file that isn't a save, rubble pictures, flat smoke).

## v24 — Sci-fi buildings that break panel by panel
- **New look for every building and the HQ.** There are no more pitched roofs and eaves. Each building is now a simple sci-fi structure with sloping armour walls, chamfered corners with trim ribs, buttress struts and flat sloped roof slabs. Panel seams and lines are painted on, with orange or teal lights, antennas and vents.
  - **Houses** are small habitats: an octagonal plan, a dark door with a light over it, and a raised roof cap.
  - **The factory** is a hangar: buttresses along both long walls, a big door, sloped roof halves round a lit ridge, and two exhaust stacks.
  - **The bunker** is an octagonal pillbox with a periscope.
  - **Builder walls** are sloped plinths topped with armour panels.
  - **The command centre (HQ)** is an octagonal fortress on a skirt, with buttresses and a tapered command tower carrying the gun turret, plus an antenna and a dish. Its armour is grey with bands in the team's colour.
- **Every wall panel, roof slab and stack is damaged on its own, in three stages:**
  1. **Blast marks:** sooty scorches appear where each hit lands (up to 4 per panel).
  2. **Half destroyed:** below half strength the panel gets a jagged hole with charred edges. You can see its girder framework and the dark inside of the building through it, and the hole shows in the panel's shadow too.
  3. **Blown away:** the panel is knocked off and tumbles down, as before.
- **Rubble builds up at the foot of the walls** as they take damage. Chips of the panel that was hit fall on the side it was hit from and pile higher where many land. Craters still clear them away.
- Bunker walls are a little weaker (420 hp, was 600), so a bunker takes about as many shells to flatten as before (about 19).
- Tests: `tests/buildings-unit.mjs` checks the new house layout and each panel's three stages (marks, hole, gone), and that chips pile up on the side that was hit.

## v23 — Fast flat shockwaves, faster shells, smoke trails
- **Shockwaves** now lie flat on the ground (they were tilted at random angles) and race outward far faster: about a sixth of a second (was nearly half a second), and a little wider.
- **Assault Mech shells fly faster** (speed 32, was 20). A running Light Mech can still often dodge them, but less easily.
- **Every round leaves a small smoke trail**: thin wisps behind machine-gun and autocannon fire, a bit more behind cannon rounds, and a longer trail behind Assault Mech shells. Trails drift away on the wind.
- Tests: `tests/effects.mjs` checks the shockwave is flat and quick, and that rounds leave trails.

## v22 — Spotting, stealthier Light Mechs, turret range, slimmer health bars
- **Light Mechs** now have a **75% detection factor**: enemies spot them only within three quarters of their sight range (a Heavy Mech, sight 36, sees them within 27).
- **Trenches hide units too:** a unit in a trench has its detection factor x0.8 on top of its own (a Light Mech in a trench: 60%).
- **No unit's detection factor goes below 40%** in total.
- **Spotting for each other:** a unit can now fire at any enemy within its weapon range that its side has spotted, even if it can't see that enemy itself (e.g. a Light Mech spotting for a Heavy Mech). Its own line of fire still has to be clear: hills and walls still block direct fire. Assault Mechs still lob shells over obstacles.
- **Turrets** now reach **35** (their own sight is still 30, so the last stretch needs a spotter).
- **Health bars are slimmer and float above each mech** instead of over it, including the big ones.
- Tests: detection, trench, 40% floor, spotter fire (and walls blocking it) and turret range in `tests/vision-unit.mjs`.

## v21 — Lingering battle haze, black smoke, detection factor
- **Explosion smoke lasts longer again (6-10 s) but is much more see-through** (it starts at 26% opacity).
- **Battle haze:** every big blast leaves a little low, very faint smoke that hangs over the battlefield for 35-60 seconds and drifts slowly downwind. Many blasts build up a light haze you can still see mechs through, which then clears within a minute.
- **Burning mechs and wrecks give off black smoke** (not grey), and a mech blowing up sends up a burst of it. Burning wreckage trails black smoke too.
- **New stat: Detection factor** (Dev -> Stats, "Detection (%)"), 100% for every unit for now. An enemy only spots a unit within its sight range x that factor: a 50% unit is spotted by a Light Mech (sight 46) only within 23. The enemy still clears the fog of war around it as normal, but can't see, tap or shoot at the unit until it is close enough. Ready for stealthy units.
- Units now only fire at enemies their side has actually spotted.
- Tests: stealth checks in `tests/vision-unit.mjs`; smoke and haze checks in `tests/effects.mjs`.

## v20 — New names, and the Medium Mech
- **Renamed:** Scout -> **Light Mech**, Assault -> **Heavy Mech**, Titan -> **Assault Mech**. The build buttons say Light, Medium, Heavy, Assault and Builder. (Stats you changed in Dev -> Stats are kept.)
- **New: the Medium Mech** (⚡160, 5.5 s to build), between the Light and the Heavy: 250 hp, 7.5 speed, sight 40, and an autocannon (15 damage twice a second, range 21, a little splash, small scorch marks). One on one it usually beats a Light Mech and loses to a Heavy. The enemy builds them too.
- **Its look comes from your model** (`assets/medium-mech.gltf`). Each part (body, gun, hip pods, shins, feet) moves on its own:
  - It walks on digitigrade legs: the hips swing, the knees fold backwards to lift each foot, and the feet stay level.
  - The body bobs, and the body and gun turn to aim while the legs keep walking.
  - It crouches low on Defend, and topples over as a dark wreck.
  - Its colours are painted in code: team colour on the armour, gunmetal gun, steel legs, dark feet, with panel lines and grime toward the feet.
  - The "Right_Thigh_Copy" part in the file duplicates the right hip pod, so it isn't used.
- The selection label wraps onto two lines when it's long; the build buttons are a little shorter on phones.
- Tests: Medium Mech checks in `tests/units-unit.mjs` (stats between Light and Heavy, duels, autocannon) and `tests/match.mjs` (built from the HQ and drawn with its model).

## v19 — Less smoke, fiery mech deaths
- **Explosion smoke clears much sooner** (3-5 s instead of 6-10 s), is thinner and see-through (it starts at 45% opacity instead of 80%), and is blown sideways by a stronger wind.
- **Smoke from fires, burning trees and wrecks** is lighter (24% opacity), thinner, comes off less often, and drifts sideways faster, so it no longer hides the battlefield.
- **Mechs blow up properly:** a big fireball and flash, two or three secondary blasts over the next second, a shower of sparks, and lots of wreckage (dark steel and the mech's own colour) flung out. Most pieces burn, leaving trails of flame and smoke, and keep burning for a while where they land. Bigger mechs make bigger blasts. Turrets go up the same way.
- Tests: `tests/effects.mjs` checks the smoke clears by 6 s and drifts, and that a destroyed Titan throws out burning wreckage with secondary blasts.

## v18 — Shallow craters with crater pictures, Builders repair
- **Shallower craters:** a Titan shell now digs about 0.8 deep (was 1.7), a cannon round 0.3 (was 0.7). Shelling the same spot again and again can never take the ground more than 1.5 below where it started (about trench depth). Shells erode ridges a little harder, so sustained artillery still wears hills down, and craters on a river bank still flood (with shallower water).
- **Crater pictures:** every cannon and shell crater paints one of the six crater pictures you sent into the ground, picked at random and turned at random, sized to the crater. They are baked into the ground texture and stay for the whole match, lit like the terrain. Machine-gun hits and blasts high on a building leave none. (The pictures were cut out of their white background by `tools/make-craters.mjs`; the original is kept in `assets/craters-source.png`.)
- **Builders repair:** select Builders, tap **Repair** in the Builder panel, then tap one of your mechs, turrets or the HQ. The Builders walk over and mend it (25 hp per second each, free). Idle Builders also repair damaged friendly units within 10 units by themselves. A new order takes them off the repair. The repair rate is in Dev -> Stats.
- On phones the Builder panel is now two buttons wide.
- After an ordered attack kills its target, mechs go back to guarding (taking on enemies close by) instead of holding still.
- Tests: `tests/repair-unit.mjs`; crater depth and picture checks in `tests/terrain.mjs`; Repair by touch in `tests/builder.mjs`.

## v17 — Health bars on every unit, Defend, turning walls and trenches
- **Health bars on every unit you can see** (not only selected or damaged ones), and they are now drawn on top of smoke, fire and explosions, so they never disappear in a battle.
- **Defend** button (next to Stop): the selected mechs crouch where they stand and keep firing. Defending mechs are much harder to hit (hit chance x0.55) and take less damage from blasts (x0.65). Any move or attack order stands them up again. Tap Defend again to stand them up where they are.
- **Trenches** now also protect against blasts (x0.6 splash damage), on top of making mechs harder to hit. It all stacks: an Assault that hits 80% in the open hits 44% in a trench, and 24% in a trench while defending.
- **Turning walls and trenches:** picking Wall or Trench and tapping (or dragging a line) now *plans* it, shown in green. Turn it with **⟲ 15°** / **15° ⟳**, tap somewhere else to move it, then **Build** (or **Cancel**). Turrets are still placed with a single tap.
- Tests: `tests/defend-unit.mjs`; `tests/builder.mjs` plans, turns and builds; `tests/mobile.mjs` checks the new buttons fit on phones.

## v16 — Mechs obey move orders
- **Tapping the ground is now a plain Move** by default. Mechs go where you send them even in the middle of a fight. They still shoot at enemies in range on the way (the torso turns), but they don't stop. The **A-Move** button switches taps to attack-move (stop and fight anything met), as before; it lights up when it is on.
- **After a move (or Stop) mechs hold their ground:** they shoot whatever comes into range but no longer wander off to chase enemies, so they don't drift back into the fight. Mechs fresh out of the HQ, and mechs that finish an A-Move, still guard their area as before.
- **Only a tap on an enemy's body is an attack order.** A tap on the ground right beside an enemy in a crowded fight is a move order.
- Tests: new checks in `tests/units-unit.mjs` (engaged mechs pull back when ordered, hold without chasing, still shoot what comes in range; an A-Move fight can be overridden) and `tests/combat.mjs` (default Move, a tap beside an enemy mid-fight, retreating home).

## v15 — Mobile Mode in the editor, brighter health bars, unit stats in Dev
- The **Mobile** button is now in the **top-left corner**, next to the credits, in both the game and the editor (it was off the edge of the screen on some phones). It also works on the start screen.
- **Mobile Mode in the editor:** smaller toolbars; the tool list scrolls if it doesn't fit; the brush and building panels sit clear of it; works held sideways or upright. The setting is shared with the game.
- **Health bars** are bigger, brighter and easier to read: solid green, yellow, then red on a black backing. They are never dimmed by the fog, and they grow when you zoom out.
- **Dev → Stats:** a table of every unit's stats that you can change while playing. For Scout, Assault, Titan, Builder, Turret and HQ: cost, build time, speed, strength (hp), damage, fire rate, range, sight, accuracy, splash radius, shot speed and turn speed. Also the Builder's wall and trench costs and times, and the economy (starting credits, income, income per capture point, mechs per side, queue length).
  - Changes apply at once, also to units already on the map (they keep the same share of their health).
  - They are remembered on the device until **Reset to defaults**. Changed values show in yellow.
  - **Copy** puts your changes on the clipboard, so you can paste them into a message.
- Tests: `tests/stats.mjs`; `tests/mobile.mjs` now also covers the editor and the Mobile button.

## v14 — Fog of war and line of sight
- **Fog of war** in a match. Ground nobody on your side has seen is black; ground you have seen before but can't see now is dimmed and grey; what your units can see right now is in full colour. It fades smoothly as your mechs move.
- **Line of sight:** you only see an enemy mech, turret or HQ while one of your units has a clear view of it within its sight range. Hills, ridges and standing walls block the view (and leave "shadows" behind them you can't see into); trees don't. Sight ranges: Scout 46, Assault 36, Titan 34, Builder 30, turret 30, HQ 40. Scouts are your eyes.
- Enemies you can't see aren't drawn, can't be tapped (a tap there is a move order) and aren't on the minimap. Enemy turrets and HQs stay marked where you last saw them. Titans can still only shell what your side sees.
- The minimap shows the fog too.
- **Fog** button under **Dev** to switch it off (or `index.html?fog=0`). The sandbox has no fog.
- The enemy AI doesn't use the fog yet (it still knows where your units are).
- The Dev toolbar now wraps onto two rows on the iPad instead of running under the minimap.
- Tests: `tests/vision-unit.mjs`, `tests/fog.mjs`.

## v13 — Mobile Mode for phones
- New **Mobile** button (top right) switches to a compact UI for playing on a phone: smaller buttons, resources bar, build buttons and minimap, so most of the screen is battlefield. The Builder panel moves to the right-hand side, and the start screen fits a phone.
- It turns itself on for phone-sized screens and off on an iPad; your choice is remembered on that device. Works best with the phone held sideways; held upright, the buttons stack down the right edge.
- Easier selecting on small screens: a tap just beside a mech selects it (a finger's width in Mobile Mode, a little less otherwise), and the camera starts a little closer.
- The editor is unchanged (still designed for the iPad).
- Tests: `tests/mobile.mjs` (landscape and portrait phones: everything on screen, nothing overlapping, the toggle remembered).

## v12 — Builders: walls, auto turrets and trenches
- New unit: **Builder** (⚡150, built at the HQ). Unarmed, a little slower than a Scout, with a work arm and a yellow roof. It still spots enemies for your Titans.
- Select a Builder and a **Builder** panel appears above the orders bar:
  - **Wall** (⚡60 each): a 10-unit stone wall. It blocks movement and line of sight and gives cover, and it can be shot down to rubble like any wall.
  - **Turret** (⚡180): an auto turret with twin machine guns (700 hp, range 22). It rises out of the ground as it is built, only shoots once finished, can be destroyed, and leaves a wreck.
  - **Trench** (⚡30 per 10 units): about 1.4 deep, with the dug earth banked up on the side facing the enemy. Mechs in it are harder to hit (half the hit chance) and stand lower behind the bank. All mechs can still cross it.
- Placing: pick one, then **tap** the ground to place one wall, turret or trench section (walls and trenches run across the screen), or **drag a line** to place a row. A green preview shows where it goes (red: can't build there, e.g. in water or on a building). You pay when you order.
- The Builder walks over and works; two Builders on the same job work twice as fast. New orders queue up behind the current ones. Unfinished sites stay marked in yellow: if the Builder is sent elsewhere or destroyed, select a Builder and tap the site to carry on.
- The enemy AI doesn't build yet.
- Tests: `tests/builder-unit.mjs`, `tests/builder.mjs`.

## v11 — Milestone 8: a complete match
- The game now opens a **match**: destroy the enemy HQ (north) before it destroys yours. A start screen explains the controls; a Victory or Defeat screen shows the time and losses, with **Play again**.
- **Economy:** credits (⚡) come in at +6/s, plus +3/s for each capture point you hold. Build Scouts (100), Assaults (220) and Titans (420) with the buttons on the left: tap to queue one (up to 8), press and hold to cancel one (refunded). They come out of your HQ and gather in front of it. Up to 40 mechs a side.
- **Capture points:** stand mechs in the ring (more mechs, faster, up to 3). It turns blue when it's yours, red when it's the enemy's; contested points don't change. Banners tell you when you take or lose one.
- **HQs:** have 8000 hit points and a twin-cannon roof turret that defends them. They block movement. Tap the enemy HQ to attack it. A destroyed HQ goes up in a chain of blasts and burns.
- **Enemy AI:** builds a mix of mechs (heavier later on), sends growing waves at the capture points and every third wave at your HQ, and defends its base.
- **Minimap** (bottom right): the live map, which darkens as it gets cratered and burnt, plus capture points, HQs, mechs and your view. Tap or drag on it to move the camera.
- **HUD:** credits, income, points held, army size and match clock (top left). **Stop** button. Test tools (+Squad, +Enemy, fire buttons, Barrage, Reset) are now behind **Dev**. `index.html?sandbox` opens the old combat sandbox.
- Fixed: a mech passing another could steer into a wall and jitter there; and a mech whose spot in a formation was taken kept trying to reach it. Both showed up as stuck mechs in long AI-vs-AI test matches.
- Fixed: the Editor button is no longer hidden behind the start screen.
- Tests: `tests/match-unit.mjs` (including a whole AI-vs-AI match on the sample map), `tests/match.mjs`.

## v10 — Milestone 7: mechs and combat
- Mechs from the prototype, rebuilt on the new terrain: **Scout** (fast, machine gun), **Assault** (twin cannons, small splash), **Titan** (slow, arcing shells with a big splash). Walking legs, and a torso that turns on its own so mechs fire on the move. All mech parts are one instanced mesh; health bars show once a mech is hurt.
- Every weapon damages the ground as it does to units: machine-gun fire scuffs it, cannons dig small craters, shells dig big ones, knock trees flat and set them alight. Misses land beside the target. Destroyed mechs explode and leave a burning wreck.
- Line of sight: hills and standing walls block direct fire (trees don't). Cover: mechs in forest, on rubble or behind a wall are harder to hit. High ground makes hits easier.
- Titans fire over hills, but only at enemies their side can see: any friendly mech that spots an enemy (within 40) lets the Titans shell it. Shells land where the target was, so a running Scout can dodge them.
- Titans flatten trees as they walk through forest.
- Controls: tap a mech to select it, **double-tap** to select all of that type on screen, **one-finger drag** to box-select (two fingers move the camera). Tap the ground to send them; **A-Move** (default: stop to fight anything on the way) toggles to **Move** (ignore enemies). Tap an enemy to attack it (they chase it and shoot only that). **+Enemy** brings an enemy squad for testing. Idle mechs guard where they stand.
- Pinch zoom now zooms around your fingers instead of the screen centre, so the ground stays under them.
- Tests: `tests/units-unit.mjs`, `tests/combat.mjs`.

## v9 — Bigger explosions, fires and drifting smoke; rotate and move buildings
- Explosions rebuilt as pooled particles (one instanced mesh per kind): a flash that lights up the ground, a rolling fireball, a shockwave ring, showers of sparks, tumbling and bouncing debris (some trailing smoke), dust thrown out along the ground, and a billowing smoke column that lingers 6-10 s and drifts sideways on the wind.
- Buildings that are hit catch fire for 6-12 s (flames and smoke; a fire goes out if its wall falls) and shed debris in their own colours; some rubble smoulders.
- Trees caught in a blast burn for a few seconds and are left charred (a few still catch properly and can spread, as before). Burning trees give off drifting smoke.
- Editor: a selected building shows its name and angle; turn it live with the **Angle** slider (or ⟲ / ⟳ 15°); **drag** it with one finger to move it. The angle also applies to the next building you place. All undoable.
- Tests: `tests/effects.mjs`.

## v8 — Milestone 6: nav grid and pathfinding
- Nav grid (1 cell per unit, 256 x 256) with a movement cost per unit size (Scout / Assault / Titan): slope (steep ground is a slow scramble, cliffs over 1.9 block everyone), deep water blocks, shallow water slows, intact road is faster, rubble slows, buildings block with clearance by size (Scouts fit through 3-unit gaps, Titans need 7), dense forest stops Assaults (Scouts squeeze through, Titans push through), bridge decks carry units over rivers until destroyed.
- Only cells touched by craters, rubble, flooding, falling / burnt trees and collapsing buildings are recomputed; incremental updates match a full rebuild exactly.
- A* paths (8-way, no corner cutting) smoothed without cutting across slower ground; unreachable goals go to the closest reachable point.
- Test units (placeholders until mechs arrive): follow paths at their class speed, re-plan when the ground on their route changes or they stop making progress, steer round each other, spread into a formation at the target, and always escape if a crater or rubble lands on them.
- Game: **Move** mode (default): tap the ground to send the selected units, tap a unit to select it, **All**, **+Squad**. **Nav** button tints ground the selected unit can't cross (red) or crosses slowly (yellow). Path lines show the route.
- Fixed: forest lookups near the map edge counted some trees twice.
- Tests: `tests/nav-unit.mjs`, `tests/nav.mjs`.

## v7 — Milestone 5: buildings, rubble and bridges
- Modular buildings: house, factory, bunker, wall, bridge. Each is made of pieces (wall tiles in rows, roof, floor, blocks, deck, pillars, rails) with their own hit points, drawn with 2 instanced meshes.
- Pieces rest on supports: knocking out a lower wall tile drops the one above (holes); the roof falls when half its walls are gone; a bridge deck falls when its pillars go. Buildings go intact -> damaged -> ruin -> rubble. Falling pieces tumble down.
- Rubble: fallen pieces raise a real rubble mound in the terrain (a collapsed house leaves a heap ~1.7 high), painted as rubble with loose chunks. It is cover and an obstacle, and shells dig into it.
- Bridges: placed automatically where roads cross rivers (import and older maps); walkable deck (`deckAt`) for units later; shelling the middle cuts the crossing.
- Weapons damage buildings (MG chips, cannon breaks tiles, shells wreck houses; a bunker takes ~17 shells). Tapping a building fires at the building itself; bursts above the ground don't crater it.
- Editor: House, Factory, Bunker, Wall, Bridge tools (tap to place on levelled ground, tap a building to select), rotate 15°, Delete, Fill lots (builds on the red building areas). All undoable.
- Map format v3 stores buildings (v2 maps get bridges at road crossings). Sample map: a town of houses, a bridge, bunkers by the HQs and a wall.
- Tests: `tests/buildings-unit.mjs`, `tests/buildings.mjs`.

## v6 — Fix: "map formatVersion 2 is newer than this game supports"
- Cause: Safari kept old cached copies of the game's modules (GitHub Pages lets browsers cache files for up to 10 minutes) while loading the new map, so old code met a new map file.
- Every module is now loaded through an import map with `?v=N` on every file, so a new version always fetches all-new code. `node tools/bump-version.mjs vN` updates the version, labels and import maps in one step.
- If old cached code still meets a newer map, the game / editor reloads itself once with a fresh URL instead of showing the error.
- Smoke test checks every module is versioned and simulates a stale cache.

## v5 — Milestone 4: water, trees and roads
- Rivers hold water: the level is worked out from the river layer and the bank heights, so rivers follow the land. Drawn with a chunked water surface, shaded by depth. Rivers are mostly deep (impassable for mechs later), shallow at the edges.
- Flooding: a crater beside water that dips below its level fills (water pours over low lips in the blast area). Floods stay local, so one shell can't drain a river over a whole plain; a chain of craters floods one crater at a time.
- Trees: instanced low-poly conifers and broadleaf trees placed in forest areas (475 on the sample map). Blasts shatter nearby trees to stumps, knock others flat away from the blast and can set them alight. Fires spread slowly to neighbours, burn out to stumps and scorch the ground. Hooks ready for Titans crushing trees and for forest cover.
- Map format v2 stores the tree list (v1 maps are upgraded by planting trees in their forest areas). Imported rivers are carved with steeper banks so they run nearly full.
- Editor tools: **River** (draw a channel that fills with water), **Road** (flatten and paint), **Forest** (spray trees), **Tree** (tap one, or drag a row), **Erase** (trees, water, roads). All undoable; tool panel is now two columns.
- Save / Test serialise faster (layers compressed in parallel, one serialisation for Test).
- Debug overlay shows water triangles and tree counts.
- Tests: `tests/world-unit.mjs`, `tests/world.mjs`.

## v4 — Milestone 3: map import and editor (part 1)
- Map files: one JSON per map (`maps/*.json`, listed in `maps/index.json`) with versioned format and gzipped height / ground / feature layers (~220 KB). Matches never modify the file.
- Image import (height map + feature map, see `maps/README.md`): rivers carve channels (and keep flowing under road crossings), roads flatten and paint, forests / building areas are recorded (shown as ground tints until trees and buildings arrive), capture points and HQs are found from coloured dots and squares, HQ pads are flattened.
- Sample map "River Crossing" built from `maps/sample-height.png` + `maps/sample-features.png`; the game now opens it by default (`?map=<id>` picks another).
- Map editor (`editor.html`): Raise / Lower / Flatten / Smooth brushes with size and strength; Player HQ / Enemy HQ / Capture point tools; undo / redo (also Ctrl/Cmd+Z); New, Open (built-in or from file), Import images, Save (download), rename; autosave; **Test ▶** opens the current map in the game and **◀ Editor** comes back.
- Editor touch: one finger paints, two fingers pan / pinch / rotate. Mouse: left paints, right or middle drag pans.
- Game: HQ and capture-point markers, an Editor button, the map name, a loading message and readable load errors. The map edge has an earth wall so hills at the border don't float.
- Tests: `tests/maps-unit.mjs`, `tests/editor-unit.mjs`, `tests/editor.mjs`.

## v3 — Milestone 2: deformable terrain
- Height grid terrain: 256 x 256 world units, 512 x 512 cells (0.5 units each), drawn as 64 chunks. Only chunks touched by damage are rebuilt, at most 4 per frame, reusing their buffers.
- Placeholder test landscape (until map import): rolling hills, a mountain (NE) with a snowy peak, a long ridge (NW), a dry riverbed and a road.
- Craters with a raised rim, sized per weapon (MG / Cannon / Shell). Repeated hits wear down peaks and ridges; material slides when a slope gets too steep; nothing digs below bedrock; the map edge can't be holed.
- Surface wear and a permanent damage map: grass churns to dirt, then torn earth; blasts leave scorch marks; craters break the road.
- Test-fire toolbar: tap the ground to fire the selected weapon, Barrage drops 24 shells around the view centre, Reset restores the map. Keys: 1/2/3 select, B barrage.
- Pooled explosion effects (flash, smoke, debris).
- Camera: two-finger twist rotates (Q/E on keyboard), follows the ground height, never dips into hills.
- Tests: `node tests/terrain-unit.mjs` (numerical crater/erosion/bedrock/slope/wear checks) and `node tests/terrain.mjs` (browser: chunk rebuilds, seams, tap-to-fire, buttons).

## v2 — Milestone 1: project setup
- New game entry `index.html` loading plain ES modules from `src/`; three.js r170 vendored in `lib/` (no CDN).
- Placeholder scene (flat ground, markers) with one shadow-casting sun whose shadow area follows the camera.
- RTS camera: one-finger drag pans (ground stays under the finger), pinch zooms; mouse drag/wheel and WASD/arrows/+/- on desktop.
- Debug overlay (fps, frame time, draw calls, triangles) toggled by the **FPS** button or the ` key.
- Version label bottom-right; turns red with a "stale cache" note if the page and the JS come from different builds.
- Add to Home Screen support: web app manifest, icons, full-screen meta tags. Page zoom, scroll and long-press callouts blocked.
- Errors during load are shown on screen.
- Test hook `window.__game` (pause, step, render, stats) and headless test harness: `node tests/smoke.mjs`.

## prototype v1
- Single-file three.js prototype (`prototype/index.html`): Scout/Assault/Titan mechs with walking legs and independent torso aiming, HQ production, 5 capture points, enemy AI waves, touch + mouse controls, minimap. Flat terrain only — reference for the real build described in CLAUDE.md.
