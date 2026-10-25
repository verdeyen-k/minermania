# Miner Mania

A real-time digging race for 2 to 4 players, each on their own device (you can also start alone to practice).
Everyone starts at the top of a side-view mine. First to reach the ruby at the bottom wins.

- **Dig** with ◀ ▼ ▶ on screen, or the arrow keys / A S D. Moving into dirt or stone digs it; moving into an open space walks.
- **Dirt** breaks in 1 hit, **stone** in 3. **Bedrock** can't be dug: go around it. Some bedrock sits right over the ruby's column, so you can't just dig straight down the middle.
- If there's nothing under you, you **fall**, including into other miners' tunnels.
- The mine is new every race and mirrored left to right. Miners who start farther from the middle start deeper, in a shaft
  that's already dug, so everyone is the same number of digs from the ruby. Every start can always reach the ruby.
- The depth meter on the right shows how close everyone is.
- The race clock at the top counts up from DIG! and stops when someone reaches the ruby; the results show the winning time.

## Files

- `index.html`: screens and styles.
- `miner.js`: the mine, digging, drawing, sounds, and the online rooms (Firebase Realtime Database,
  `minermania/rooms/<CODE>` in the `kvgames` project). The room has `meta` (players, phase, the mine's seed, winner) and
  `live` (everyone's position and the dug cells), so fast position updates don't resend everything.
  Every device builds the same mine from the seed.

To run it locally, serve the folder with any static file server, for example `python3 -m http.server`.
