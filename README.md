# Golden Hour Casino

A browser-based multiplayer casino lounge with live roulette, turn-based blackjack, player-chosen usernames, and complimentary play chips. No account or password is required, and no real money is used.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000) and choose a username.

The username and chip balance are saved on the same browser and device. A username must be 1–18 letters, numbers, or underscores and unique among players currently online. It is a display name only, not a verified identity; another player could use it when you are offline. Server-side chip balances are stored in `data/players.json` by default.

## Publish a public website on Render

1. Push this project to a GitHub repository. Keep `node_modules`, `.env` files, and `data` out of Git; `.gitignore` already excludes them.
2. Sign in to [Render](https://render.com), choose **New → Blueprint**, and connect that GitHub repository.
3. Confirm the settings from `render.yaml` and create the service.
4. Wait for the first deploy to finish. Render will show a public `https://…onrender.com` address; share that URL with your friends. Keep this single server instance running for the shared tables.

The included Render configuration uses the free service plan. The site and live multiplayer tables are available over the public internet, but free services can sleep when idle and their local files are not durable. Saved chip balances may be lost after a restart or redeploy. A persistent database or paid storage is needed for durable balances.
