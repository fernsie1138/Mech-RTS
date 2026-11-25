# Maps

Each map is one `.json` file in this folder, listed in `index.json`.

| File | What it is |
|---|---|
| `index.json` | List of built-in maps shown in the editor's **Open** dialog |
| `sample.json` | The sample map ("River Crossing") |
| `sample-height.png`, `sample-features.png` | The two images `sample.json` was imported from. Copy them as a starting point for your own maps. |

## Making a map

1. Paint a **height map** and a **feature map** (same size, 512 × 512 recommended; the top of the image is north, the enemy side).
   - Height map: greyscale. Black = lowest, white = highest, mid-grey (128) = flat ground.
   - Feature map: flat colours only (turn off anti-aliasing / soft brushes):

     | Colour | Hex | Meaning |
     |---|---|---|
     | Blue | `#0000FF` | River / water |
     | Dark green | `#006400` | Dense forest |
     | Light green | `#00FF00` | Scattered trees |
     | Grey | `#808080` | Road |
     | Red | `#FF0000` | Building area |
     | Yellow dot | `#FFFF00` | Capture point (one dot each) |
     | White square | `#FFFFFF` | Player HQ |
     | Black square | `#000000` | Enemy HQ |
     | Anything else | e.g. tan `#D2B48C` | Open ground |

     Roads drawn across a river become crossings: the river keeps flowing under them.
2. In the editor, tap **Import images**, choose both images and tap **Import**.
3. Refine it: Raise / Lower / Flatten / Smooth the ground; draw rivers and roads with **River** and **Road**; add trees with **Forest** (spray) or **Tree** (one at a time); rub out trees, water and roads with **Erase**; place or move HQs and capture points. Add buildings with **House / Factory / Bunker / Wall** (tap to place, tap a building to select it, then drag it to move, turn it with the Angle slider or ⟲ ⟳, or Delete), **Bridge** (tap a river), or **Fill lots** to build on all the red building areas. Bridges are added automatically where roads cross rivers. Tap **Test ▶** to try it in the game.
4. Tap **Save** to download the `.json` file.

## Adding a saved map to the game

Upload the `.json` file into this `maps/` folder on GitHub, then add a line for it to `index.json`, e.g.

```json
{ "id": "my-map", "name": "My Map" }
```

where `id` is the file name without `.json`. It then appears in the editor's **Open** list, and the game can open it at `index.html?map=my-map`.

The sample map is regenerated with `node tools/make-sample-map.mjs`.
