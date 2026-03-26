const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

// In-memory game state
const players = {}; // key: socket.id -> player
const lobbies = {}; // key: lobbyName -> Set<socket.id>
const gameModes = {}; // key: lobbyName -> 'ffa' | 'tdm'

// Enhanced weapon damage with headshot multiplier
const WEAPON_DAMAGE = {
  rifle: { damage: 25, headshotMultiplier: 4 },
  sniper: { damage: 70, headshotMultiplier: 2.5 },
  pistol: { damage: 15, headshotMultiplier: 3 }
};

function getLobbySet(lobby) {
  if (!lobbies[lobby]) {
    lobbies[lobby] = new Set();
    gameModes[lobby] = 'ffa'; // Default mode
  }
  return lobbies[lobby];
}

function assignTeam(lobby) {
  const lobbySet = getLobbySet(lobby);
  const playersInLobby = Array.from(lobbySet).map(id => players[id]).filter(Boolean);
  
  const teamA = [];
  const teamB = [];
  
  playersInLobby.forEach((player, index) => {
    if (index % 2 === 0) {
      player.team = 'teamA';
      teamA.push(player);
    } else {
      player.team = 'teamB';
      teamB.push(player);
    }
  });
  
  return { teamA, teamB };
}

function randomSpawn() {
  const spots = [
    { x: 0, y: 1.6, z: 0 },
    { x: 10, y: 1.6, z: 10 },
    { x: -10, y: 1.6, z: -10 },
    { x: 12, y: 1.6, z: -8 },
    { x: -12, y: 1.6, z: 8 }
  ];
  return spots[Math.floor(Math.random() * spots.length)];
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/maps', (req, res) => {
  const mapsDir = path.join(__dirname, 'public', 'maps');

  try {
    const maps = fs
      .readdirSync(mapsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(glb|gltf)$/i.test(name))
      .sort((a, b) => a.localeCompare(b));

    res.json({ maps });
  } catch (error) {
    console.error('Failed to list maps:', error);
    res.status(500).json({ maps: [], error: 'Failed to list maps.' });
  }
});

io.on('connection', socket => {
  console.log('Client connected', socket.id);

  socket.on('joinGame', data => {
    const username = (data && data.username ? data.username : 'Player').toString().slice(0, 18);
    const lobby = (data && data.lobby ? data.lobby : 'default').toString().toLowerCase();
    const gameMode = (data && data.gameMode ? data.gameMode : 'ffa').toString().toLowerCase();

    const lobbySet = getLobbySet(lobby);
    lobbySet.add(socket.id);
    socket.join(lobby);
    gameModes[lobby] = gameMode;

    const spawn = randomSpawn();

    const player = {
      id: socket.id,
      username,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rotation: 0,
      health: 100,
      score: 0,
      kills: 0,
      deaths: 0,
      lobby,
      team: null // Will be assigned if TDM
    };

    // Assign teams for TDM mode
    if (gameMode === 'tdm') {
      assignTeam(lobby);
    }

    players[socket.id] = player;

    const others = Array.from(lobbySet)
      .filter(id => id !== socket.id)
      .map(id => players[id])
      .filter(Boolean);

    socket.emit('currentPlayers', { me: player, others, gameMode });
    socket.to(lobby).emit('playerJoined', player);

    console.log(username + ' joined lobby ' + lobby + ' with mode ' + gameMode);
  });

  socket.on('playerMove', data => {
    const player = players[socket.id];
    if (!player || !data) return;

    player.x = data.x;
    player.y = data.y;
    player.z = data.z;
    player.rotation = data.rotation;

    socket.to(player.lobby).emit('playerMoved', {
      id: player.id,
      x: player.x,
      y: player.y,
      z: player.z,
      rotation: player.rotation
    });
  });

  socket.on('playerShot', data => {
    const shooter = players[socket.id];
    if (!shooter || !data || !data.targetId) return;

    const target = players[data.targetId];
    if (!target || target.lobby !== shooter.lobby) return;

    // Check for friendly fire in TDM
    const gameMode = gameModes[shooter.lobby];
    if (gameMode === 'tdm' && shooter.team === target.team) {
      return; // No friendly fire in TDM
    }

    const weaponKey = data.weaponKey || 'rifle';
    const weaponConfig = WEAPON_DAMAGE[weaponKey] || WEAPON_DAMAGE.rifle;
    
    // Calculate damage based on hit location
    let damage = weaponConfig.damage;
    const isHeadshot = data.hitLocation === 'head';
    
    if (isHeadshot) {
      damage = Math.floor(damage * weaponConfig.headshotMultiplier);
    }

    target.health = Math.max(0, target.health - damage);

    io.to(shooter.lobby).emit('playerHit', {
      shooterId: shooter.id,
      targetId: target.id,
      newHealth: target.health,
      damage: damage,
      weaponKey,
      isHeadshot,
      hitLocation: data.hitLocation
    });

    if (target.health <= 0) {
      shooter.kills = (shooter.kills || 0) + 1;
      target.deaths = (target.deaths || 0) + 1;
      shooter.score = shooter.kills;

      // Update team scores in TDM
      if (gameMode === 'tdm') {
        const lobbySet = getLobbySet(shooter.lobby);
        const teamScores = { teamA: 0, teamB: 0 };
        Array.from(lobbySet).forEach(id => {
          const player = players[id];
          if (player && player.team) {
            teamScores[player.team] = (teamScores[player.team] || 0) + (player.kills || 0);
          }
        });
      }

      io.to(shooter.lobby).emit('playerDied', {
        shooterId: shooter.id,
        targetId: target.id,
        shooterScore: shooter.score,
        shooterKills: shooter.kills,
        targetDeaths: target.deaths,
        isHeadshot,
        gameMode
      });

      // Respawn after delay
      setTimeout(() => {
        if (!players[target.id]) return;
        const spawn = randomSpawn();
        target.x = spawn.x;
        target.y = spawn.y;
        target.z = spawn.z;
        target.health = 100;

        io.to(target.id).emit('respawn', {
          x: target.x,
          y: target.y,
          z: target.z,
          health: target.health
        });

        io.to(target.lobby).emit('playerMoved', {
          id: target.id,
          x: target.x,
          y: target.y,
          z: target.z,
          rotation: target.rotation
        });
      }, 3000);
    }
  });

  socket.on('disconnect', () => {
    const player = players[socket.id];
    if (player) {
      const lobbySet = getLobbySet(player.lobby);
      lobbySet.delete(socket.id);
      if (lobbySet.size === 0) {
        delete lobbies[player.lobby];
      }
      delete players[socket.id];

      socket.to(player.lobby).emit('playerDisconnected', { id: socket.id });
    }
    console.log('Client disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

