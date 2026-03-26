# Multiplayer FPS Browser Game

Fast-paced multiplayer FPS in the browser, inspired by Deadshot.io.  
Built with **Node.js**, **Express**, **Socket.IO**, and **Three.js**.

## Features

- **Multiplayer networking** with Socket.IO
- **Matchmaking by lobby code** (players with the same code join the same room)
- **3D FPS gameplay** using Three.js
- **Pointer lock controls**, WASD movement, jumping, basic collision
- **Multiple weapons**: pistol, rifle, shotgun, machine gun, marksman
- **Health, hits, kills, respawns, and scoreboard**
- **Fallback models** if `gun.glb` or `player.glb` are missing

## Project Structure

- `package.json` – dependencies and scripts  
- `server.js` – Express + Socket.IO game server  
- `public/index.html` – main HTML page  
- `public/style.css` – dark, minimal FPS UI  
- `public/game.js` – Three.js engine, controls, and networking  
- `public/ui.js` – lobby, HUD, scoreboard logic  
- `public/assets/` – place `gun.glb` and `player.glb` here

## Setup

```bash
cd multiplayer-fps
npm install
npm start
```

Then open your browser at:

`http://localhost:3000`

### Testing Multiplayer

- Open **multiple browser tabs** or windows pointing to `http://localhost:3000`.
- Enter the **same lobby code** on all clients to join the same room.
- Move with **WASD**, look around with the mouse, and **left click** to fire.
- Use number keys **1–5** to switch weapons.

## Deployment

The server listens on `process.env.PORT` or falls back to `3000`, making it suitable for common hosting platforms.

### Deploy on Render

1. Push this project to a Git repository (GitHub, GitLab, etc.).
2. In Render, create a new **Web Service**.
3. Select your repo and use:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Render will set `PORT` automatically; no extra config is needed.
5. Once deployed, open the Render-provided URL in your browser.

### Deploy on Railway

1. Push this project to a Git repository.
2. Go to Railway and create a new project from your repo.
3. Railway will detect Node.js automatically; if needed, set:
   - **Install Command**: `npm install`
   - **Start Command**: `npm start`
4. Railway will inject the `PORT` environment variable.
5. After deployment finishes, open the generated Railway URL.

## Assets

Place your models in:

- `public/assets/gun.glb`
- `public/assets/player.glb`

If these files are not present, the client falls back to simple box-based placeholder models so the game still runs.

## Notes

- This project is a **reference implementation / starter kit** for a browser FPS.
- For production, consider adding:
  - Authentication and persistent profiles
  - Dedicated authoritative hit validation, anti-cheat
  - More detailed maps and art
  - Audio (shots, hits, ambient)

