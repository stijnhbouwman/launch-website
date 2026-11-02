# Golden Hour Casino

A browser-based multiplayer casino lounge with live roulette, turn-based blackjack, username/password accounts, and complimentary play chips. No real money is used.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install` in this folder.
3. Run `npm start`.
4. Open http://localhost:3000 and create an account.

Usernames are 3–18 letters, numbers, or underscores. Passwords must be at least 10 characters. Passwords are stored as salted, scrypt-derived hashes. There is no password reset or email recovery, so players should keep their passwords safe.

## Deploy a public website on Render

This repository includes `render.yaml` for Render Blueprints:

1. Sign in to Render and choose **New → Blueprint**.
2. Connect this GitHub repository and approve access if prompted.
3. Confirm the settings from `render.yaml` and create the service.
4. When deployment finishes, share the public `https://…onrender.com` address with friends.

The included configuration uses Render’s free service plan. Free services can sleep when idle and their local files are not durable; player accounts and chip balances may be lost after a restart or redeploy. A persistent database or paid storage is needed for durable accounts.
