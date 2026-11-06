# Formula War

A small multiplayer equation artillery game. One Go process serves embedded HTML, CSS, and JavaScript, manages at most 100 in-memory rooms, and broadcasts snapshots over server-sent events. No database, accounts, frontend build, or third-party dependencies.

## Run

```sh
go run .
```

Open http://localhost:8080. Enter your callsign and a room name or code in Create / join room. Names match without case sensitivity and ignore leading/trailing spaces: an existing room is joined, otherwise a new room is created. Joining existing rooms works even when all 100 room slots are occupied. Set `ADDR` to change the listen address (`ADDR=:3000 go run .`). Friends need access to the same server; share the room's invite link. Use two browser tabs with separate room sessions to try both teams locally. A refresh resumes the tab's existing session. Usernames are unique within each room (ignoring case and surrounding spaces). Entering an existing username from any browser resumes that player rather than adding a duplicate, even if the room is full or a match is underway. This is a no-account identity model: anyone who knows the room and username can resume that player.

Build a single executable, including the frontend:

```sh
go build -o formula-war .
./formula-war
```

## Solo practice

Choose **Practice solo** for a browser-only training arena with three target dummies. No server room or second player is needed. You take every turn; switch between red and blue sides or generate new targets at any time. Shots animate by arc length with the same physics, range, domain checks, and no-preview behavior as multiplayer. Clear the targets or take 100 shots, then reset. Refreshing starts a fresh practice attempt.

## Rules

- The creator is the host. Everyone enters as a spectator and can choose red, blue, or watch in the lobby. Up to four players per team and 24 total room members. The host starts when both teams have players. Red or blue is chosen with equal probability to take the first turn, independently for every match and rematch.
- Only your own aiming coordinates are shown numerically; other players’ coordinate readouts are hidden. Grid axis labels remain visible.
- The seeded arena has 15 obstacles scattered randomly across the middle with spacing between them, without a row or column grid. Obstacles have varied radii from 1.1 to 2 world units, limited by available spacing. Players spawn in wider side zones (absolute x from 13 to 18, y up to ±10), with teammates spread vertically. Hit obstacles disappear, while stopping the current shot; future shots can pass through the gap.
- Each player has one unit. Red and blue alternate turns; living players rotate within each team. Red shoots right and blue shoots left. The active unit is ringed on the board.
- Enter an expression using the **arena x coordinates in your view**. Your unit is on the negative side and fires left to right. Only the vertical constant changes: `y = f(x) + c`, where `c = shooterY - f(shooterX)`. For example, `-x^2` from `(-16, 3)` becomes `-x^2 + 259`: it starts at the shooter, rises toward x = 0, then falls. Adding any explicit constant has no effect on the anchored path. Blue players see the entire arena mirrored, and their input is mapped to canonical world coordinates by substituting `-x` for every x node in the parsed expression. Each observer sees an opponent’s formula with the same substitution. Spectators use red’s coordinate view. Firing reveals the curve at 48 world units of arc length per second. There is no preview. The three most recent completed shot trails remain visible at 18%, 9%, and 4% opacity, newest to oldest. The active shot stays bright. Trails become fainter as newer shots arrive, rather than fading with time.
- Shots stop at the first obstacle, arena edge, undefined region, precision limit, or **600 world units of arc length**. The visible arena spans x = ±20 and y = ±12. Shots stop at the first edge of this rectangle, including its top and bottom; they cannot leave and re-enter. A steep `-x^2` shot may reach the top before x = 0; use a smaller coefficient, such as `-0.03x^2`, to keep the arc visible.
- Shots penetrate players and can eliminate multiple enemies in one turn. Teammates are unharmed. Each enemy is shown eliminated when the animated bullet reaches it. Eliminate the opposing team to win. Matches draw after 100 shots. The host can start a fresh match with a new arena. A team player's explicit departure ends the current match.
- Closing a tab preserves membership for reconnects. Use Leave or click the Formula War logo to return home and remove yourself; if the host leaves, the oldest remaining member becomes host. Disconnected players retain their turns; a stalled room expires naturally.

## Equation keyboard and mobile layout

Both desktop and mobile provide an equation keypad with digits, decimal point, x, pi, e, all operators, parentheses, sin/cos/tan/exp/ln/sqrt/abs, and a square shortcut. Keys insert at the current cursor or replace selected text. Function keys add parentheses and place the cursor inside; selecting existing text wraps it in the function. Cursor arrows, backspace, and clear are included. Normal typing still works on desktop; phones default to the on-screen math keys, with a device-keyboard toggle for native text entry. Controls pause while a shot animates.

Fire sits at the top-right of the keypad; the device-keyboard toggle is beside Clear at the bottom. History follows the equation keyboard in both multiplayer and practice. Rules appear below history in a collapsible reference. Team selection sits in a horizontal panel above the board on all screen sizes, leaving the arena at full width. During a match it becomes a compact team roster.

## Equations and numerical behavior

Supported: `x`, `pi`, `e`, numeric/scientific literals, `+ - * / ^`, parentheses, and `sin`, `cos`, `tan`, `exp`, `ln`, `sqrt`, `abs`. Multiplication can be explicit (`2*x`) or implicit (`3x`, `3x^2`, `3sin(5x)`, `(x+1)(x-1)`). Implicit multiplication has the same precedence as `*` and `/`, evaluated left to right; use parentheses to group a denominator (`1/(2x)`). Adjacent numeric literals (`2 3`) and unknown identifiers are rejected. Angles are radians. Exponentiation is right-associative; `-x^2` means `-(x^2)`. Functions require parentheses. Parsing does not use `eval` or dynamically generated JavaScript.

Calculations and canvas rendering run entirely in the browser. The tracer measures the length of short accepted segments, adapts its x step near steep curves, checks midpoint curvature, and bounds the function's variation with conservative interval arithmetic. Division intervals containing zero, tangent poles, negative square-root inputs, invalid powers, log-domain errors, and nonfinite/overflowing results stop traversal. A function undefined at the shooter’s arena x is rejected before submission. Equations that cannot produce any resolvable travel are also rejected without consuming a turn. Curves never resume on the other side of a gap. Removable singularities are also treated as gaps; `x/x` is undefined at zero, so traversal stops before crossing it.

Accepted segments are at most 0.1 world units with midpoint error below 0.002. The last segment is clipped to the remaining arc-length budget. There are at most 18 refinements per step and 24,000 steps per shot; difficult expressions can stop at a precision limit. These are bounded approximations using JavaScript floating point, not symbolic math or a formal arbitrary-precision solver. Conservative interval bounds may stop a valid but numerically difficult expression early. Tiny features below sampling precision cannot be guaranteed.

All clients receive a seeded arena, a frozen match roster, and ordered history, allowing refreshes and spectator joins to reconstruct the game entirely in the browser. Replay regenerates positions and obstacles from the seed, recalculates each shot in order, and applies recorded enemy eliminations and destroyed obstacle IDs. The server does not evaluate formulas, generate positions, trace paths, or detect collisions. The server enforces sessions, team capacity, the active shooter's identity, shot ordering, result identifiers, and victory from reported eliminations. It does **not** evaluate equations or verify collisions: the firing browser reports its hit result. This is a casual, trusted-client game; a modified client can cheat. Full prevention would require authoritative physics or a separate verification scheme.

## Room lifetime and memory

Rooms expire at **10 minutes since the last accepted action**, or **2 hours since creation**, whichever comes first. Create, join, team changes, start, fire, chat, and leave are activity. Room-list reads, reconnects, and SSE keepalives do not extend lifetime. Expired rooms are reclaimed on requests and by a 15-second cleanup timer; their event streams close. Restarting the process clears everything.

History is bounded to 256 entries; old chat is dropped before match shots. Matches cap at 100 shots; starting a rematch resets history. Slow event subscribers are disconnected and can reconnect to a full snapshot. Request sizes, names, equations, room members, and stream counts are bounded. Run a single process: replicas would have independent rooms.

## Checks

```sh
go test -race ./...
go vet ./...
node --test web/*.test.mjs
```

Go tests cover capacity, both expiration policies, sessions, match transitions, turn ordering, broadcasts, bounded history, and host transfer. JavaScript tests cover parsing, domain gaps, singularities, length limits, collisions, coordinate reflection for both teams, vertical anchoring, and deterministic arena generation.

## Untrusted input

Equations are parsed into a restricted math syntax tree. JavaScript statements, property access, indexing, string literals, assignments, and arbitrary function calls are rejected. Evaluation uses explicit numeric operations; it never invokes `eval`, `new Function`, a shell, or a remote code service. Incoming shot data cannot supply a syntax tree.

Names, room titles, chat, and recorded equations are displayed using text APIs or HTML escaping. The server sends a Content Security Policy that allows local script files and forbids inline scripts, dynamic code evaluation, plugins, external connections, and framing. MIME sniffing is disabled. Cross-site API requests are refused, and POSTs require JSON. Session tokens are randomly generated, never broadcast in snapshots, and grant room actions only to their owner. All frontend assets are embedded; the server does not expose project files or tests.

These controls protect the input-to-display and input-to-evaluation paths; they are separate from the trusted-client collision model described above. Numerical work is bounded, but this small server is not designed as an abuse-resistant public hosting platform.
