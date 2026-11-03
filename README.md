# Golden Hour Casino

A browser-based multiplayer casino lounge with roulette, turn-based blackjack, slots, shared horse races, and multiplayer poker showdowns. Players choose their own usernames and use complimentary play chips. No account or password is required, and no real money is used.

## Games

- **Roulette:** Place bets on red, black, or a number and spin the shared wheel.
- **Blackjack:** Join the shared table, take turns, and play against the dealer.
- **Slots:** Spin three reels; pairs pay 2×, three of a kind 8×, and three sevens 20×.
- **Horse race:** Back one of four horses in a shared race; a winning bet pays 3×.
- **Poker:** Join a five-card showdown with friends. The best hand wins the pot, and ties split it. Each round is a single buy-in and showdown, not a full betting-round version of Texas Hold'em.

All game outcomes and chip changes are calculated by the server. Wagers can be any whole-number amount from 1 chip up to your available balance. Chips are for entertainment only and have no cash value.

## Private and global rooms

The room bar starts in the **Global game**, where anyone online can join. The first time you enter a global game each UTC day, you receive 3,000 global chips; private-room chips are not included. Select **Create private room** to move to a separate room, then copy and share its invite link. Friends who open that link join the private room; they can also enter its 12-character code in the room bar. **Join global game** returns to the public room.

In a private room, the host chooses the game for everyone; other members wait for the host's choice, and everyone is limited to that game, including slots. The host can kick players before or between rounds, but not during a running round. Each player starts with 1,000 private-room chips, and the room scoreboard shows everyone's balance. These chips are separate from global chips and reset to 1,000 when a player leaves or rejoins. Roulette, blackjack, horse races, and poker cannot start until every connected member with chips has placed a bet or joined the round, and only the host can start. When every connected player is out of chips and the round is settled, the room ends. Everyone can vote to play again; when all remaining players agree, the room restarts with 1,000 chips each and the host chooses a new game, or a player can leave for the global game. In the global game, players can switch between games freely and start shared games without waiting for every player to bet or join. Slots remain individual spins, with results visible only in the current room. Unstarted bets are refunded when a player changes rooms. A room change is blocked while a round is in progress. Private rooms are temporary and close when the server restarts, so share the current invite link with friends.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000) and choose a username.

The username and chip balance are saved on the same browser and device. A username must be 1–18 letters, numbers, or underscores and unique among players currently online. It is a display name only, not a verified identity; another player could use it when you are offline. Server-side chip balances are stored in `data/players.json` by default.

## Admin controls

The Admin button is shown only while using the username `stijn`. It lists connected players across rooms, their current-room chip balance, and controls to grant or remove 1–1,000,000 chips. Global balance changes are saved with player data; private-room balances follow the room's normal reset rules.

To link admin access to this browser on Render:

1. Open the site on the intended browser, choose the username `stijn`, and open **Admin**.
2. Copy the browser's player ID shown in the panel. In the Render service's **Environment** settings, set `ADMIN_PLAYER_ID` to that exact ID and set `ADMIN_PASSWORD` to a strong, private password.
3. Redeploy or restart the service. Reload the site, open **Admin**, and enter the password to unlock controls.

The password is verified by the server, never stored in the browser or committed to the repository, and the admin session ends when its WebSocket disconnects or the player changes their name. Keep the password private. The player ID links this browser profile; it is not hardware attestation, and someone who copies both the ID and password could use them elsewhere. Clearing this browser's saved site data changes its player ID, so update `ADMIN_PLAYER_ID` if that happens. Admin settings are declared in `render.yaml` with `sync: false` and must be configured privately in Render.

## Publish a public website on Render

1. Push this project to a GitHub repository. Keep `node_modules`, `.env` files, and `data` out of Git; `.gitignore` already excludes them.
2. Sign in to [Render](https://render.com), choose **New → Blueprint**, and connect that GitHub repository.
3. Confirm the settings from `render.yaml` and create the service.
4. Wait for the first deploy to finish. Render will show a public `https://…onrender.com` address; share that URL with your friends. Keep this single server instance running for the shared tables.

The included Render configuration uses the free service plan. The site and live multiplayer tables are available over the public internet, but free services can sleep when idle and their local files are not durable. Saved chip balances may be lost after a restart or redeploy. A persistent database or paid storage is needed for durable balances.
