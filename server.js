const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomBytes, randomInt, timingSafeEqual } = require("node:crypto");
const WebSocket = require("ws");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const playersFile = path.join(dataDirectory, "players.json");
const bansFile = path.join(dataDirectory, "bans.json");
const gameBansFile = path.join(dataDirectory, "game-bans.json");
const adminLogFile = path.join(dataDirectory, "admin-log.json");
const playerHistoryFile = path.join(dataDirectory, "player-history.json");
const playerHistory = new Map(Object.entries(fs.existsSync(playerHistoryFile) ? JSON.parse(fs.readFileSync(playerHistoryFile, "utf8")) : {}));
let adminLog = fs.existsSync(adminLogFile) ? JSON.parse(fs.readFileSync(adminLogFile, "utf8")) : [];
let gamesPaused = false;
const bannedPlayers = new Map(Object.entries(fs.existsSync(bansFile) ? JSON.parse(fs.readFileSync(bansFile, "utf8")) : {}));
const gameBans = new Map(Object.entries(fs.existsSync(gameBansFile) ? JSON.parse(fs.readFileSync(gameBansFile, "utf8")) : {}));
const players = new Map();
const savedPlayers = fs.existsSync(playersFile)
  ? JSON.parse(fs.readFileSync(playersFile, "utf8"))
  : {};

const slotSymbols = ["✦", "♣", "♦", "♠", "7"];
const horseNames = ["Comet", "Clover", "Sundown", "Goldrush"];
const allowedAvatars = new Set(["🦊", "🐼", "🐸", "🦉", "🐯", "🐙", "🦄", "🐲", "🐧", "🐻", "🐱", "🐵"]);
const allowedAvatarColors = new Set(["#d6b46a", "#78a99a", "#8b9dc3", "#c58b9b", "#a58ac7", "#b9a27b"]);
const rooms = new Map();
const gameActionCooldowns = new Map();
function gameCooldownRemaining(player, game, durationMs = 5000) {
  const key = player.id + ":" + game;
  const now = Date.now();
  const nextAllowedAt = gameActionCooldowns.get(key) || 0;
  if (nextAllowedAt > now) return nextAllowedAt - now;
  gameActionCooldowns.set(key, now + durationMs);
  return 0;
}

function createRoom(code, isPrivate, ownerId = null) {
  return {
    code,
    isPrivate,
    ownerId,
    selectedGame: null,
    gameParticipants: new Set(),
    bankrolls: new Map(),
    ended: false,
    replayVotes: new Set(),
    eliminated: [],
    rankings: [],
    chat: [],
    roulette: { bets: [], lastResult: null, spinningResult: null, history: [], spinning: false },
    slots: { history: [] },
    horseRace: { phase: "waiting", bets: [], winner: null, history: [] },
    blackjack: { phase: "waiting", players: [], dealer: [], deck: [], turnIndex: 0 },
    poker: { phase: "waiting", players: [], lastResult: null },
    wheelFortune: { history: [] },
    plinko: { history: [] },
  };
}

rooms.set("global", createRoom("global", false));

function connectedRoomPlayers(roomCode) {
  return [...players.values()].filter((player) => player.connected && player.roomCode === roomCode);
}

function chipsFor(room, player) {
  return room.isPrivate ? room.bankrolls.get(player.id) ?? 1000 : player.chips;
}

function setChips(room, player, amount) {
  if (room.isPrivate) room.bankrolls.set(player.id, amount);
  else player.chips = amount;
}

function addChips(room, player, amount) {
  setChips(room, player, chipsFor(room, player) + amount);
}

function claimDailyGlobalBonus(player) {
  const today = new Date().toISOString().slice(0, 10);
  if (player.lastGlobalRewardDate === today) return false;
  player.lastGlobalRewardDate = today;
  player.chips += 3000;
  return true;
}

function allRoomPlayersReady(roomCode, readyIds) {
  const room = rooms.get(roomCode);
  const members = connectedRoomPlayers(roomCode);
  const playersWithChips = room
    ? members.filter((player) => chipsFor(room, player) > 0 || readyIds.has(player.id))
    : members;
  return playersWithChips.length > 0 && playersWithChips.every((player) => readyIds.has(player.id));
}

function roomHasRunningGame(room) {
  return room.roulette.spinning ||
    room.horseRace.phase === "racing" ||
    room.blackjack.phase === "playing" ||
    room.poker.phase === "playing";
}

function endRoomIfBroke(room) {
  if (
    !room.isPrivate ||
    room.ended ||
    roomHasRunningGame(room) ||
    room.roulette.bets.length > 0 ||
    room.horseRace.bets.length > 0 ||
    (room.blackjack.phase !== "done" && room.blackjack.players.length > 0) ||
    (room.poker.phase !== "done" && room.poker.players.length > 0)
  ) return false;
  const rankedIds = new Set(room.eliminated.map((entry) => entry.playerId));
  for (const [playerId, balance] of room.bankrolls) {
    if (balance <= 0 && !rankedIds.has(playerId)) {
      const eliminatedPlayer = players.get(playerId);
      room.eliminated.push({ playerId, name: eliminatedPlayer?.name || "Player", reason: "Out of chips" });
    }
  }
  const active = [...room.bankrolls.entries()].filter(([, balance]) => balance > 0);
  if (room.bankrolls.size + room.eliminated.length >= 2 && active.length === 1) {
    const [winnerId] = active[0];
    const winner = players.get(winnerId);
    room.rankings = [
      { playerId: winnerId, name: winner?.name || "Player", place: 1, reason: "Winner" },
      ...room.eliminated.slice().reverse().map((entry, index) => ({ ...entry, place: index + 2 })),
    ];
    room.ended = true;
    room.replayVotes.clear();
    return true;
  }
  const balances = [...room.bankrolls.values()];
  if (balances.length === 0 || balances.some((balance) => balance > 0)) return false;
  room.rankings = room.eliminated.slice().reverse().map((entry, index) => ({ ...entry, place: index + 1 }));
  room.ended = true;
  room.replayVotes.clear();
  return true;
}

function replayPrivateRoom(room) {
  const nextRoom = createRoom(room.code, true, room.ownerId);
  for (const player of connectedRoomPlayers(room.code)) {
    nextRoom.bankrolls.set(player.id, 1000);
    player.currentGame = null;
  }
  rooms.set(room.code, nextRoom);
}

function refundRoomEntries(player, room) {
  const refund = (amount) => {
    if (Number.isSafeInteger(amount) && amount > 0) addChips(room, player, amount);
  };
  for (const bet of room.roulette.bets.filter((item) => item.playerId === player.id)) {
    refund(bet.amount);
  }
  room.roulette.bets = room.roulette.bets.filter((item) => item.playerId !== player.id);
  for (const bet of room.horseRace.bets.filter((item) => item.playerId === player.id)) {
    refund(bet.amount);
  }
  room.horseRace.bets = room.horseRace.bets.filter((item) => item.playerId !== player.id);
  const blackjackSeat = room.blackjack.players.find((seat) => seat.id === player.id);
  if (blackjackSeat && room.blackjack.phase === "waiting") {
    refund(blackjackSeat.bet);
    room.blackjack.players = room.blackjack.players.filter((seat) => seat.id !== player.id);
  }
  const pokerSeat = room.poker.players.find((seat) => seat.id === player.id);
  if (pokerSeat && room.poker.phase === "waiting") {
    refund(pokerSeat.bet);
    room.poker.players = room.poker.players.filter((seat) => seat.id !== player.id);
  }
}

function savePlayerHistory() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = `${playerHistoryFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(Object.fromEntries(playerHistory), null, 2));
  fs.renameSync(temporaryFile, playerHistoryFile);
}

function recordPlayerGame(player, game, room, wager, payout, outcome, details = "") {
  const entries = playerHistory.get(player.id) || [];
  entries.push({ id: randomBytes(8).toString("hex"), timestamp: Date.now(), game, roomCode: room.code, wager, payout, net: payout - wager, outcome, details });
  playerHistory.set(player.id, entries.slice(-100));
  savePlayerHistory();
}

function saveAdminLog() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = `${adminLogFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(adminLog.slice(-500), null, 2));
  fs.renameSync(temporaryFile, adminLogFile);
}

function recordAdminAction(admin, action, target = null, details = "", undo = null) {
  const entry = { id: randomBytes(8).toString("hex"), timestamp: Date.now(), admin: admin.name, action, targetId: target?.id || null, targetName: target?.name || null, details, undone: false, undo };
  adminLog.push(entry);
  adminLog = adminLog.slice(-500);
  saveAdminLog();
  return entry;
}

function saveBans() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = `${bansFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(Object.fromEntries(bannedPlayers), null, 2));
  fs.renameSync(temporaryFile, bansFile);
}

function saveGameBans() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const active = Object.fromEntries([...gameBans].filter(([, ban]) => ban.expiresAt > Date.now()));
  const temporaryFile = `${gameBansFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(active, null, 2));
  fs.renameSync(temporaryFile, gameBansFile);
}

function activeGameBan(playerId, game) {
  const ban = gameBans.get(`${playerId}:${game}`);
  if (!ban) return null;
  if (ban.expiresAt <= Date.now()) { gameBans.delete(`${playerId}:${game}`); saveGameBans(); return null; }
  return ban;
}

function savePlayers() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const player of players.values()) {
    savedPlayers[player.id] = {
      name: player.name,
      avatar: player.avatar || "🦊",
      avatarColor: player.avatarColor || "#d6b46a",
      chips: player.chips,
      lastGlobalRewardDate: player.lastGlobalRewardDate,
    };
  }
  const temporaryFile = `${playersFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(savedPlayers, null, 2));
  fs.renameSync(temporaryFile, playersFile);
}

function safeName(value) {
  if (typeof value !== "string") return "Guest";
  const name = value.trim().slice(0, 18);
  return /^[a-zA-Z0-9_]{1,18}$/.test(name) ? name : null;
}

function safeAvatar(value, fallback = "🦊") {
  return typeof value === "string" && allowedAvatars.has(value) ? value : fallback;
}

function safeAvatarColor(value, fallback = "#d6b46a") {
  return typeof value === "string" && allowedAvatarColors.has(value) ? value : fallback;
}

function score(hand) {
  let total = hand.reduce((sum, card) => sum + card.value, 0);
  let aces = hand.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function makeDeck(deckCount = 1) {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    ["A", 11], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6],
    ["7", 7], ["8", 8], ["9", 9], ["10", 10], ["J", 10], ["Q", 10], ["K", 10],
  ];
  const deck = Array.from({ length: deckCount }, () =>
    suits.flatMap((suit) => ranks.map(([rank, value]) => ({ rank, suit, value })))
  ).flat();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function evaluatePokerHand(hand) {
  const ranks = hand.map((card) =>
    card.rank === "A" ? 14 : card.rank === "K" ? 13 : card.rank === "Q" ? 12 :
      card.rank === "J" ? 11 : Number(card.rank)
  ).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = hand.every((card) => card.suit === hand[0].suit);
  const uniqueRanks = [...new Set(ranks)];
  const straightHigh = uniqueRanks.length === 5 &&
    (uniqueRanks[0] - uniqueRanks[4] === 4 ? uniqueRanks[0] :
      uniqueRanks.join(",") === "14,5,4,3,2" ? 5 : 0);

  if (flush && straightHigh) return { rank: [8, straightHigh], name: "Straight flush" };
  if (groups[0][1] === 4) {
    return { rank: [7, groups[0][0], groups[1][0]], name: "Four of a kind" };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { rank: [6, groups[0][0], groups[1][0]], name: "Full house" };
  }
  if (flush) return { rank: [5, ...ranks], name: "Flush" };
  if (straightHigh) return { rank: [4, straightHigh], name: "Straight" };
  if (groups[0][1] === 3) {
    return { rank: [3, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)], name: "Three of a kind" };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return {
      rank: [2, groups[0][0], groups[1][0], groups[2][0]],
      name: "Two pair",
    };
  }
  if (groups[0][1] === 2) {
    return {
      rank: [1, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)],
      name: "Pair",
    };
  }
  return { rank: [0, ...ranks], name: "High card" };
}

function comparePokerHands(first, second) {
  for (let index = 0; index < Math.max(first.rank.length, second.rank.length); index += 1) {
    const difference = (first.rank[index] || 0) - (second.rank[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function currentTurn(room) {
  return room.blackjack.players[room.blackjack.turnIndex];
}

function advanceBlackjack(room) {
  const blackjack = room.blackjack;
  while (blackjack.turnIndex < blackjack.players.length) {
    const player = players.get(blackjack.players[blackjack.turnIndex].id);
    const seat = blackjack.players[blackjack.turnIndex];
    if (seat.status === "playing" && player && player.connected) {
      if (score(seat.hand) === 21) {
        seat.status = "stood";
        blackjack.turnIndex += 1;
        continue;
      }
      return;
    }
    seat.status = seat.status === "playing" ? "stood" : seat.status;
    blackjack.turnIndex += 1;
  }
  finishBlackjack(room);
}

function finishBlackjack(room) {
  const blackjack = room.blackjack;
  while (score(blackjack.dealer) < 17 && blackjack.deck.length > 0) {
    blackjack.dealer.push(blackjack.deck.pop());
  }
  const dealerScore = score(blackjack.dealer);
  const dealerBust = dealerScore > 21;
  const dealerNatural =
    blackjack.dealer.length === 2 && dealerScore === 21;

  for (const seat of blackjack.players) {
    const player = players.get(seat.id);
    if (!player) continue;
    const balanceBeforePayout = chipsFor(room, player);
    const playerScore = score(seat.hand);
    const natural = seat.hand.length === 2 && playerScore === 21;
    if (playerScore > 21) {
      seat.result = "Bust";
      seat.status = "bust";
    } else if (natural && !dealerNatural) {
      addChips(room, player, Math.floor(seat.bet * 2.5));
      seat.result = "Blackjack!";
      seat.status = "done";
    } else if (dealerNatural && natural) {
      addChips(room, player, seat.bet);
      seat.result = "Push";
      seat.status = "done";
    } else if (dealerNatural) {
      seat.result = "Dealer blackjack";
      seat.status = "done";
    } else if (dealerBust || playerScore > dealerScore) {
      addChips(room, player, seat.bet * 2);
      seat.result = "Win";
      seat.status = "done";
    } else if (playerScore === dealerScore) {
      addChips(room, player, seat.bet);
      seat.result = "Push";
      seat.status = "done";
    } else {
      seat.result = "Dealer wins";
      seat.status = "done";
    }
    const payout = chipsFor(room, player) - balanceBeforePayout;
    recordPlayerGame(player, "blackjack", room, seat.bet, payout, seat.result || "Loss", "Player " + playerScore + " · dealer " + dealerScore);
  }
  blackjack.phase = "done";
  blackjack.turnIndex = -1;
  savePlayers();
  endRoomIfBroke(room);
}

function snapshot(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const { roulette, blackjack, slots, horseRace, poker } = room;
  const dealer = blackjack.dealer.map((card, index) => {
    if (blackjack.phase === "playing" && index === 1) return { hidden: true };
    return card;
  });
  return {
    players: [...players.values()]
      .filter((player) => player.connected && player.roomCode === roomCode)
      .map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar || "🦊",
        avatarColor: player.avatarColor || "#d6b46a",
        chips: chipsFor(room, player),
        currentGame: player.currentGame || null,
      })),
    room: {
      code: room.code,
      isPrivate: room.isPrivate,
      ownerId: room.ownerId,
      selectedGame: room.selectedGame,
      gameParticipants: [...room.gameParticipants],
      ended: room.ended,
      replayVotes: [...room.replayVotes],
      rankings: room.rankings,
      chat: room.chat,
      members: connectedRoomPlayers(roomCode).map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar || "🦊",
        avatarColor: player.avatarColor || "#d6b46a",
        chips: chipsFor(room, player),
      })),
    },
    roulette: {
      bets: roulette.bets.map(({ playerId, name, selection, amount }) => ({
        playerId, name, selection, amount,
      })),
      lastResult: roulette.lastResult,
      spinningResult: roulette.spinningResult,
      history: roulette.history,
      spinning: roulette.spinning,
      readyIds: roulette.bets.map((bet) => bet.playerId),
    },
    blackjack: {
      phase: blackjack.phase,
      players: blackjack.players.map((seat) => ({
        id: seat.id,
        name: seat.name,
        bet: seat.bet,
        hand: seat.hand,
        status: seat.status,
        result: seat.result,
      })),
      dealer,
      dealerScore: blackjack.phase === "playing" ? null : score(blackjack.dealer),
      turnId: blackjack.phase === "playing" ? currentTurn(room)?.id ?? null : null,
      readyIds: blackjack.players.map((seat) => seat.id),
    },
    slots: { history: slots.history },
    horseRace: {
      phase: horseRace.phase,
      bets: horseRace.bets.map(({ playerId, name, horse, amount }) => ({
        playerId, name, horse, amount,
      })),
      winner: horseRace.winner,
      history: horseRace.history,
      readyIds: horseRace.bets.map((bet) => bet.playerId),
    },
    wheelFortune: { history: room.wheelFortune.history },
    plinko: { history: room.plinko.history },
    poker: {
      phase: poker.phase,
      players: poker.players.map(({ id, name, bet, hand, result }) => ({
        id,
        name,
        bet,
        hand: poker.phase === "done" ? hand : hand.map(() => ({ hidden: true })),
        result,
      })),
      lastResult: poker.lastResult,
      readyIds: poker.players.map((seat) => seat.id),
    },
  };
}

function simulatePlinkoDrop() {
  // Server-authoritative Galton-board physics. Coordinates are normalized to
  // the board, so the same recorded path can be replayed at any screen size.
  const radius = 0.014, halfWidth = 0.48, gravity = 2.8, restitution = 0.72;
  const pegs = [];
  for (let row = 0; row < 10; row++) {
    const count = row + 1, span = (row + 1) / 10 * 0.82;
    for (let col = 0; col < count; col++) {
      pegs.push({x: count === 1 ? 0 : -span / 2 + span * col / (count - 1), y: 0.13 + row * 0.071, r: 0.022 + radius});
    }
  }
  let x = 0, y = 0.015, vx = (Math.random() - 0.5) * 0.62, vy = 0.12;
  const path = [];
  const dt = 1 / 120;
  for (let frame = 0; frame < 720 && y < 1; frame++) {
    vx *= 0.999;
    vy += gravity * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < -halfWidth + radius || x > halfWidth - radius) {
      x = Math.max(-halfWidth + radius, Math.min(halfWidth - radius, x));
      vx *= -0.72;
    }
    for (const peg of pegs) {
      const dx = x - peg.x, dy = y - peg.y, distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < peg.r) {
        const nx = dx / distance, ny = dy / distance;
        x = peg.x + nx * peg.r;
        y = peg.y + ny * peg.r;
        const normal = vx * nx + vy * ny;
        if (normal < 0) {
          vx -= (1 + restitution) * normal * nx;
          vy -= (1 + restitution) * normal * ny;
          vx += (Math.random() - 0.5) * 0.18;
        }
      }
    }
    // The bottom tray is divided into 11 real pockets. Once the ball enters
    // the tray, the divider walls contain it instead of assigning a slot by RNG.
    if (y >= 0.86) {
      const width = halfWidth * 2 / 11;
      const pocket = Math.max(0, Math.min(10, Math.floor((x + halfWidth) / width)));
      const left = -halfWidth + pocket * width + radius;
      const right = -halfWidth + (pocket + 1) * width - radius;
      if (x < left) { x = left; vx = Math.abs(vx) * 0.45; }
      if (x > right) { x = right; vx = -Math.abs(vx) * 0.45; }
    }
    if (frame % 2 === 0) path.push([Number(x.toFixed(4)), Number(Math.min(y, 1).toFixed(4))]);
  }
  const slot = Math.max(0, Math.min(10, Math.floor((x + halfWidth) / (halfWidth * 2) * 11)));
  path.push([Number(x.toFixed(4)), 1]);
  return { slot, path };
}

const sockets = new Set();
function broadcast() {
  const states = new Map();
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN && socket.playerId) {
      const player = players.get(socket.playerId);
      if (!player) continue;
      if (!states.has(player.roomCode)) {
        states.set(player.roomCode, JSON.stringify({
          type: "state",
          state: snapshot(player.roomCode),
        }));
      }
      socket.send(states.get(player.roomCode));
      if (socket.adminAuthorized) sendAdminState(socket);
    }
  }
}

function sendAdminState(socket) {
  const adminPlayer = players.get(socket.playerId);
  if (!socket.adminAuthorized || !isAdminDisplayName(adminPlayer) || socket.readyState !== WebSocket.OPEN) return;
  const onlinePlayers = [...players.values()]
    .filter((player) => player.connected)
    .map((player) => {
      const room = rooms.get(player.roomCode);
      const activeGame = player.currentGame || (room?.gameParticipants.has(player.id) ? room.selectedGame : (room?.roulette.bets.some((bet) => bet.playerId === player.id) ? "roulette" : room?.blackjack.players.some((seat) => seat.id === player.id) ? "blackjack" : room?.horseRace.bets.some((bet) => bet.playerId === player.id) ? "horses" : room?.poker.players.some((seat) => seat.id === player.id) ? "poker" : "lobby"));
      return { id: player.id, name: player.name, chips: room ? chipsFor(room, player) : player.chips, roomCode: player.roomCode, isPrivate: Boolean(room && room.isPrivate), game: activeGame, muted: Boolean(player.muted) };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
  const privateRooms = [...rooms.values()].filter((room) => room.isPrivate).map((room) => ({
    code: room.code,
    players: connectedRoomPlayers(room.code).length,
    game: room.selectedGame || "lobby",
    owner: players.get(room.ownerId)?.name || "Unknown",
    running: roomHasRunningGame(room),
  })).sort((a, b) => a.code.localeCompare(b.code));
  socket.send(JSON.stringify({
    type: "admin-state",
    players: onlinePlayers,
    bans: [...bannedPlayers.values()],
    gameBans: [...gameBans.values()].filter((ban) => ban.expiresAt > Date.now()).sort((a, b) => a.expiresAt - b.expiresAt),
    rooms: privateRooms,
    gameRooms: [...rooms.values()].flatMap((room) => {
      const activeGames = room.isPrivate
        ? [room.selectedGame].filter(Boolean)
        : [...new Set(connectedRoomPlayers(room.code).map((member) => member.currentGame).filter(Boolean))];
      return activeGames.map((game) => ({ code: room.code, game, isPrivate: room.isPrivate, state: snapshot(room.code) }));
    }),
    onlineCount: onlinePlayers.length,
    chats: [...rooms.values()].map((room) => ({ code: room.code, isPrivate: room.isPrivate, messages: room.chat })),
    adminLog: adminLog.slice(-100).reverse(),
    playerHistory: [...playerHistory.entries()].map(([id, entries]) => ({ id, entries: entries.slice(-50).reverse() })),
    gamesPaused,
  }));
}

function isAdminDisplayName(player) {
  return typeof player?.name === "string" && player.name.trim().toLocaleLowerCase() === "stijn";
}

function checkAdminUsername(username) {
  return typeof username === "string" && username.trim().toLocaleLowerCase() === "stijn";
}

function checkAdminPassword(password) {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (typeof password !== "string" || !configuredPassword) return false;
  const provided = Buffer.from(password);
  const expected = Buffer.from(configuredPassword);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
}

function validAmount(amount) {
  return Number.isSafeInteger(amount) && amount >= 1;
}

function resetBlackjack(room) {
  const blackjack = room.blackjack;
  blackjack.phase = "waiting";
  blackjack.players = [];
  blackjack.dealer = [];
  blackjack.deck = [];
  blackjack.turnIndex = 0;
}

function handleMessage(socket, message) {
  if (message.type === "register") {
    if (
      typeof message.id !== "string" ||
      !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(message.id)
    ) {
      sendError(socket, "This player session is invalid. Refresh to try again.");
      return;
    }
    if (bannedPlayers.has(message.id)) {
      sendError(socket, "This player account is banned from the casino.");
      return;
    }
    const name = safeName(message.name);
    if (!name) {
      sendError(socket, "Choose a username with 1–18 letters, numbers, or underscores.");
      return;
    }
    let requestedRoom = typeof message.roomCode === "string" && message.roomCode
      ? message.roomCode.toUpperCase()
      : "global";
    if (requestedRoom === "GLOBAL") requestedRoom = "global";
    if (!rooms.has(requestedRoom)) {
      requestedRoom = "global";
    }
    if (
      rooms.get(requestedRoom).ended &&
      players.get(message.id)?.roomCode !== requestedRoom
    ) {
      sendError(socket, "That private room has ended. Ask the host to start a new game.");
      return;
    }
    const nameTaken = [...players.values()].some(
      (candidate) =>
        candidate.id !== message.id &&
        candidate.connected &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (nameTaken) {
      sendError(socket, "That username is already in use. Choose another.");
      return;
    }
    let player = players.get(message.id);
    const saved = savedPlayers[message.id];
    const avatar = safeAvatar(message.avatar, player?.avatar || saved?.avatar || "🦊");
    const avatarColor = safeAvatarColor(message.avatarColor, player?.avatarColor || saved?.avatarColor || "#d6b46a");
    if (!player) {
      player = {
        id: message.id,
        name,
        avatar,
        avatarColor,
        chips: saved && Number.isSafeInteger(saved.chips) && saved.chips >= 0
          ? saved.chips
          : 1000,
        lastGlobalRewardDate: typeof saved?.lastGlobalRewardDate === "string"
          ? saved.lastGlobalRewardDate
          : null,
        roomCode: requestedRoom,
        currentGame: null,
        muted: false,
        connected: false,
        sockets: new Set(),
      };
      players.set(message.id, player);
    }
    const previousRoomCode = player.roomCode;
    if (previousRoomCode && previousRoomCode !== requestedRoom) {
      const previousRoom = rooms.get(previousRoomCode);
      if (previousRoom && roomHasRunningGame(previousRoom)) {
        sendError(socket, "Finish the current round before changing rooms.");
        return;
      }
      if (previousRoom) {
        refundRoomEntries(player, previousRoom);
        if (previousRoom.isPrivate) { previousRoom.bankrolls.delete(player.id); previousRoom.gameParticipants.delete(player.id); }
      }
    }
    if (previousRoomCode && previousRoomCode !== requestedRoom) player.currentGame = null;
    player.roomCode = requestedRoom;
    player.name = name;
    player.avatar = avatar;
    player.avatarColor = avatarColor;
    player.connected = true;
    player.sockets.add(socket);
    const registeredRoom = rooms.get(requestedRoom);
    const earnedDailyBonus =
      !registeredRoom.isPrivate && claimDailyGlobalBonus(player);
    if (registeredRoom.isPrivate && !registeredRoom.bankrolls.has(player.id)) {
      registeredRoom.bankrolls.set(player.id, 1000);
    }
    if (registeredRoom.isPrivate && registeredRoom.selectedGame) { registeredRoom.gameParticipants.add(player.id); player.currentGame = registeredRoom.selectedGame; }
    socket.playerId = player.id;
    savePlayers();
    if (previousRoomCode && previousRoomCode !== requestedRoom) {
      const previousRoom = rooms.get(previousRoomCode);
      if (previousRoom) {
        previousRoom.replayVotes.delete(player.id);
        if (previousRoom.ownerId === player.id) {
          previousRoom.ownerId = connectedRoomPlayers(previousRoomCode)
            .find((member) => member.id !== player.id)?.id ?? null;
        }
        const remainingMembers = connectedRoomPlayers(previousRoomCode);
        if (
          previousRoom.ended &&
          remainingMembers.length > 0 &&
          remainingMembers.every((member) => previousRoom.replayVotes.has(member.id))
        ) {
          replayPrivateRoom(previousRoom);
        }
      }
    }
    broadcast();
    if (earnedDailyBonus && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "daily-global-bonus", amount: 3000 }));
    }
    return;
  }

  const player = players.get(socket.playerId);
  if (!player || !player.sockets.has(socket)) return;

  if (message.type === "chat-message") {
    const room = rooms.get(player.roomCode);
    if (!room || room.ended) return sendError(socket, "Chat is unavailable in this room.");
    const text = typeof message.text === "string" ? message.text.trim().slice(0, 240) : "";
    if (!text) return;
    if (player.muted) return sendError(socket, "You are muted and cannot send chat messages.");
    if (Date.now() - (socket.lastChatAt || 0) < 650) {
      return sendError(socket, "Please wait before sending another message.");
    }
    socket.lastChatAt = Date.now();
    room.chat.push({
      id: randomBytes(8).toString("hex"),
      playerId: player.id,
      name: player.name,
      text,
      timestamp: Date.now(),
    });
    room.chat = room.chat.slice(-80);
    broadcast();
    return;
  }

  if (message.type === "admin-logout") {
    socket.adminAuthorized = false;
    socket.send(JSON.stringify({ type: "admin-logged-out", message: "Admin access locked." }));
    return;
  }

  if (message.type === "admin-login") {
    if (!isAdminDisplayName(player)) {
      socket.adminAuthorized = false;
      socket.send(JSON.stringify({ type: "admin-auth", success: false, message: "Admin access is only available when your display name is stijn." }));
      return;
    }
    if (!checkAdminUsername(message.username)) {
      socket.adminAuthorized = false;
      socket.send(JSON.stringify({ type: "admin-auth", success: false, message: "The admin username is incorrect." }));
      return;
    }
    if (!process.env.ADMIN_PASSWORD) {
      socket.adminAuthorized = false;
      socket.send(JSON.stringify({ type: "admin-auth", success: false, message: "Admin access is not configured on the server." }));
      return;
    }
    if (!checkAdminPassword(message.password)) {
      socket.adminAuthorized = false;
      socket.send(JSON.stringify({ type: "admin-auth", success: false, message: "The admin password is incorrect." }));
      return;
    }
    socket.adminAuthorized = true;
    socket.send(JSON.stringify({ type: "admin-auth", success: true }));
    sendAdminState(socket);
    return;
  }

  if (message.type === "admin-undo-action") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const entry = adminLog.find((item) => item.id === message.logId);
    if (!entry || entry.undone || !entry.undo) return sendError(socket, "This action cannot be undone or was already reversed.");
    const undo = entry.undo;
    if (undo.type === "balance-reset") {
      const target = players.get(undo.targetId); if (!target) return sendError(socket, "Player record unavailable.");
      target.chips = undo.playerChips;
      for (const item of undo.bankrolls) { const room = rooms.get(item.roomCode); if (room) room.bankrolls.set(undo.targetId, item.balance); }
      savePlayers();
    } else if (undo.type === "chips") {
      const target = players.get(undo.targetId); const targetRoom = rooms.get(undo.roomCode);
      if (!target || !targetRoom) return sendError(socket, "The player or original room is no longer available; this change cannot be reversed.");
      setChips(targetRoom, target, undo.balance);
      if (!targetRoom.isPrivate) savePlayers();
    } else if (undo.type === "mute") {
      const target = players.get(undo.targetId); if (!target) return sendError(socket, "Player record unavailable."); target.muted = undo.muted;
    } else if (undo.type === "ban") {
      if (undo.wasBanned) bannedPlayers.set(undo.targetId, undo.previousBan); else bannedPlayers.delete(undo.targetId); saveBans();
    } else if (undo.type === "game-ban") { if (undo.previous) gameBans.set(undo.key, undo.previous); else gameBans.delete(undo.key); saveGameBans(); }
    else if (undo.type === "pause") { gamesPaused = undo.wasPaused; }
    else if (undo.type === "chat-delete") {
      const targetRoom = rooms.get(undo.roomCode); if (!targetRoom) return sendError(socket, "Original chat room no longer exists.");
      targetRoom.chat.push(undo.message); targetRoom.chat = targetRoom.chat.slice(-80);
    }
    entry.undone = true; entry.undoneAt = Date.now(); entry.undo = null; saveAdminLog();
    recordAdminAction(player, "Reversed: " + entry.action, null, "Reversed admin action " + entry.id);
    broadcast(); return;
  }

  if (message.type === "admin-delete-chat-message") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const targetRoom = rooms.get(message.roomCode); if (!targetRoom || typeof message.messageId !== "string") return sendError(socket, "Choose a valid chat message.");
    const index = targetRoom.chat.findIndex((item) => item.id === message.messageId); if (index < 0) return sendError(socket, "That message is no longer available.");
    const [removed] = targetRoom.chat.splice(index, 1);
    recordAdminAction(player, "Deleted chat message", {id: removed.playerId, name: removed.name}, "Room " + targetRoom.code + ": " + removed.text, {type:"chat-delete",roomCode:targetRoom.code,message:removed});
    broadcast(); return;
  }

  if (message.type === "admin-set-games-paused") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.paused !== "boolean") return sendError(socket, "Choose pause or resume.");
    const previous = gamesPaused; gamesPaused = message.paused;
    recordAdminAction(player, gamesPaused ? "Paused new game rounds" : "Resumed new game rounds", null, "", {type:"pause",wasPaused:previous});
    broadcast(); return;
  }

  if (message.type === "admin-kick-player") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin access is only available to the stijn display name.");
    if (typeof message.targetId !== "string" || message.targetId === player.id) return sendError(socket, "Choose another player.");
    const target = players.get(message.targetId);
    const targetRoom = target && rooms.get(target.roomCode);
    if (!target || !target.connected || !targetRoom) return sendError(socket, "That player is no longer online.");
    if (roomHasRunningGame(targetRoom)) return sendError(socket, "Wait until the player's current round is over before moving them.");
    if (targetRoom.isPrivate) {
      refundRoomEntries(target, targetRoom);
      targetRoom.bankrolls.delete(target.id);
      targetRoom.replayVotes.delete(target.id);
      targetRoom.gameParticipants.delete(target.id);
      target.currentGame = null;
    }
    recordAdminAction(player, "Moved player to global room", target, "From " + targetRoom.code);
    target.roomCode = "global";
    for (const targetSocket of target.sockets) if (targetSocket.readyState === WebSocket.OPEN) targetSocket.send(JSON.stringify({ type: "room-kicked" }));
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "admin-ban-player") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.targetId !== "string" || message.targetId === player.id) return sendError(socket, "You cannot ban your own admin account.");
    const target = players.get(message.targetId);
    if (!target) return sendError(socket, "Player not found.");
    const previousBan = bannedPlayers.get(target.id) || null;
    bannedPlayers.set(target.id, { id: target.id, name: target.name, bannedAt: Date.now() });
    recordAdminAction(player, "Banned player", target, "", {type:"ban",targetId:target.id,wasBanned:Boolean(previousBan),previousBan});
    saveBans();
    for (const targetSocket of target.sockets) {
      if (targetSocket.readyState === WebSocket.OPEN) targetSocket.close(4003, "Banned by administrator");
    }
    console.info("Admin " + player.name + " banned " + target.name + " (" + target.id + ").");
    broadcast();
    sendAdminState(socket);
    return;
  }

  if (message.type === "admin-unban-player") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.targetId !== "string" || !bannedPlayers.has(message.targetId)) return sendError(socket, "That ban was not found.");
    const banned = bannedPlayers.get(message.targetId);
    bannedPlayers.delete(message.targetId);
    recordAdminAction(player, "Unbanned player", banned, "", {type:"ban",targetId:message.targetId,wasBanned:true,previousBan:banned});
    saveBans();
    console.info("Admin " + player.name + " unbanned " + banned.name + " (" + banned.id + ").");
    sendAdminState(socket);
    return;
  }

  if (message.type === "admin-game-ban") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const target = players.get(message.targetId);
    const allowedGames = ["roulette", "slots", "horses", "blackjack", "poker", "wheel", "plinko"];
    const durationMinutes = Number(message.durationMinutes);
    if (!target || !target.connected || target.id === player.id) return sendError(socket, "Choose another online player.");
    if (!allowedGames.includes(message.game)) return sendError(socket, "Choose a valid game.");
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) return sendError(socket, "Choose a duration from 1 minute up to 30 days.");
    const key = target.id + ":" + message.game;
    const previous = gameBans.get(key) || null;
    const ban = { id: randomBytes(8).toString("hex"), playerId: target.id, name: target.name, game: message.game, createdAt: Date.now(), expiresAt: Date.now() + durationMinutes * 60000, admin: player.name };
    gameBans.set(key, ban);
    recordAdminAction(player, "Temporarily banned from " + message.game, target, durationMinutes + " minutes", { type: "game-ban", key, previous });
    saveGameBans();
    sendAdminState(socket);
    broadcast();
    return;
  }

  if (message.type === "admin-remove-game-ban") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const match = [...gameBans.entries()].find(([, ban]) => ban.id === message.banId);
    if (!match) return sendError(socket, "That game ban is no longer active.");
    const [key, ban] = match;
    gameBans.delete(key);
    recordAdminAction(player, "Removed game ban for " + ban.game, { id: ban.playerId, name: ban.name }, "", { type: "game-ban", key, previous: ban });
    saveGameBans();
    sendAdminState(socket);
    return;
  }

  if (message.type === "admin-reset-balance") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.targetId !== "string" || message.targetId === player.id) return sendError(socket, "Choose another player.");
    const target = players.get(message.targetId);
    if (!target || !target.connected) return sendError(socket, "That player is no longer online.");
    const oldBalance = target.chips;
    const oldBankrolls = [...rooms.values()].filter((room) => room.isPrivate && room.bankrolls.has(target.id)).map((room) => ({roomCode:room.code,balance:room.bankrolls.get(target.id)}));
    target.chips = 1000;
    const targetRoom = rooms.get(target.roomCode);
    if (targetRoom?.isPrivate) targetRoom.bankrolls.set(target.id, 1000);
    for (const room of rooms.values()) {
      if (room.isPrivate && room.bankrolls.has(target.id)) room.bankrolls.set(target.id, 1000);
    }
    savePlayers();
    recordAdminAction(player, "Reset player balance", target, "1000 chips", {type:"balance-reset",targetId:target.id,playerChips:oldBalance,bankrolls:oldBankrolls});
    console.info("Admin " + player.name + " reset " + target.name + "'s balance.");
    broadcast();
    return;
  }

  if (message.type === "admin-disconnect-player") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.targetId !== "string" || message.targetId === player.id) return sendError(socket, "You cannot disconnect your admin account.");
    const target = players.get(message.targetId);
    if (!target || !target.connected) return sendError(socket, "That player is no longer online.");
    recordAdminAction(player, "Disconnected player", target, "Player may reconnect.");
    for (const targetSocket of target.sockets) {
      if (targetSocket.readyState === WebSocket.OPEN) targetSocket.close(4002, "Disconnected by administrator");
    }
    console.info("Admin " + player.name + " disconnected " + target.name + " (" + target.id + ").");
    return;
  }

  if (message.type === "admin-room-announcement") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const targetRoom = rooms.get(message.roomCode);
    const announcement = typeof message.text === "string" ? message.text.trim().slice(0, 180) : "";
    if (!targetRoom?.isPrivate) return sendError(socket, "Choose an existing private room.");
    if (!announcement) return sendError(socket, "Write a room message first.");
    const recipients = connectedRoomPlayers(targetRoom.code);
    for (const member of recipients) {
      for (const targetSocket of member.sockets) {
        if (targetSocket.readyState === WebSocket.OPEN) targetSocket.send(JSON.stringify({ type: "announcement", text: announcement }));
      }
    }
    recordAdminAction(player, "Sent private room announcement", null, targetRoom.code + ": " + announcement);
    broadcast();
    return;
  }

  if (message.type === "admin-close-empty-rooms") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    const emptyRooms = [...rooms.values()].filter((room) => room.isPrivate && connectedRoomPlayers(room.code).length === 0 && !roomHasRunningGame(room));
    for (const targetRoom of emptyRooms) rooms.delete(targetRoom.code);
    if (emptyRooms.length) {
      recordAdminAction(player, "Closed empty private rooms", null, emptyRooms.length + " room(s): " + emptyRooms.map((room) => room.code).join(", "));
      savePlayers();
    }
    broadcast();
    socket.send(JSON.stringify({ type: "admin-room-cleanup-result", count: emptyRooms.length }));
    return;
  }

  if (message.type === "admin-close-room") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin authorization required.");
    if (typeof message.roomCode !== "string") return sendError(socket, "Choose a private room.");
    const targetRoom = rooms.get(message.roomCode);
    if (!targetRoom?.isPrivate) return sendError(socket, "That private room no longer exists.");
    if (roomHasRunningGame(targetRoom)) return sendError(socket, "Finish the active round before closing this room.");
    for (const member of connectedRoomPlayers(targetRoom.code)) {
      refundRoomEntries(member, targetRoom);
      targetRoom.bankrolls.delete(member.id);
      targetRoom.gameParticipants.delete(member.id);
      targetRoom.replayVotes.delete(member.id);
      member.currentGame = null;
      member.roomCode = "global";
      for (const targetSocket of member.sockets) {
        if (targetSocket.readyState === WebSocket.OPEN) targetSocket.send(JSON.stringify({ type: "room-kicked" }));
      }
    }
    rooms.delete(targetRoom.code);
    recordAdminAction(player, "Closed private room", null, targetRoom.code);
    console.info("Admin " + player.name + " closed private room " + targetRoom.code + ".");
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "admin-set-mute") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin access is only available to the stijn display name.");
    if (typeof message.targetId !== "string" || typeof message.muted !== "boolean" || message.targetId === player.id) return sendError(socket, "Choose another player.");
    const target = players.get(message.targetId);
    if (!target || !target.connected) return sendError(socket, "That player is no longer online.");
    const previousMuted = Boolean(target.muted);
    target.muted = message.muted;
    recordAdminAction(player, target.muted ? "Muted player" : "Unmuted player", target, "", {type:"mute",targetId:target.id,muted:previousMuted});
    console.info("Admin " + player.name + (target.muted ? " muted " : " unmuted ") + target.name + " (" + target.id + ").");
    broadcast();
    return;
  }

  if (message.type === "admin-clear-chat") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin access is only available to the stijn display name.");
    const previousChats = [...rooms.values()].map((room) => ({roomCode:room.code,messages:room.chat.slice()}));
    for (const room of rooms.values()) room.chat = [];
    recordAdminAction(player, "Cleared all room chats", null, "", {type:"chat-restore-all",rooms:previousChats});
    console.info("Admin " + player.name + " cleared chat history in all rooms.");
    broadcast();
    return;
  }

  if (message.type === "admin-announcement") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) return sendError(socket, "Admin access is only available to the stijn display name.");
    const announcement = typeof message.text === "string" ? message.text.trim().slice(0, 180) : "";
    if (!announcement) return sendError(socket, "Write an announcement first.");
    recordAdminAction(player, "Sent announcement", null, announcement);
    for (const targetSocket of sockets) {
      if (targetSocket.readyState === WebSocket.OPEN && targetSocket.playerId) targetSocket.send(JSON.stringify({ type: "announcement", text: announcement }));
    }
    broadcast();
    return;
  }

  if (message.type === "admin-adjust-chips") {
    if (!socket.adminAuthorized || !isAdminDisplayName(player)) {
      return sendError(socket, "Admin access is only available to the stijn display name.");
    }
    const amount = message.amount;
    if (typeof message.targetId !== "string" || !["grant", "take"].includes(message.action) || !Number.isSafeInteger(amount) || amount < 1 || amount > Number.MAX_SAFE_INTEGER) {
      return sendError(socket, "Enter a valid whole-chip amount.");
    }
    const target = players.get(message.targetId);
    if (!target || !target.connected) return sendError(socket, "That player is no longer online. Refresh the list and try again.");
    const targetRoom = rooms.get(target.roomCode);
    if (!targetRoom) return sendError(socket, "That player's room is unavailable. Try again.");
    const balance = chipsFor(targetRoom, target);
    if (message.action === "take" && amount > balance) return sendError(socket, "You cannot take more chips than that player has.");
    if (message.action === "grant" && !Number.isSafeInteger(balance + amount)) return sendError(socket, "That grant would exceed the maximum chip balance.");
    setChips(targetRoom, target, message.action === "grant" ? balance + amount : balance - amount);
    recordAdminAction(player, message.action === "grant" ? "Granted chips" : "Took chips", target, amount.toLocaleString() + " chips", {type:"chips",targetId:target.id,roomCode:targetRoom.code,balance});
    if (!targetRoom.isPrivate) savePlayers();
    else endRoomIfBroke(targetRoom);
    console.info("Admin " + player.name + " " + (message.action === "grant" ? "granted" : "removed") + " " + amount + " chips " + (message.action === "grant" ? "to " : "from ") + target.name + " (" + target.id + ").");
    broadcast();
    return;
  }

  if (gamesPaused && ["roulette-bet","roulette-spin","slots-spin","horse-bet","horse-start","update-poker-bet","join-poker","start-poker","update-blackjack-bet","join-blackjack","start-blackjack","wheel-fortune-spin","plinko-drop"].includes(message.type)) return sendError(socket, "Casino games are paused by the administrator. Existing rounds can finish, but no new game actions are allowed.");

  if (message.type === "leave-room") {
    if (!room.isPrivate) return sendError(socket, "You are already in the global room.");
    const oldBalance = chipsFor(room, player);
    if (oldBalance > 0 && room.bankrolls.size > 1) room.eliminated.push({ playerId: player.id, name: player.name, reason: "Left the room" });
    if (room.ownerId === player.id) room.ownerId = connectedRoomPlayers(room.code).find((member) => member.id !== player.id)?.id ?? null;
    const blackjack = room.blackjack;
    const blackjackIndex = blackjack.players.findIndex((seat) => seat.id === player.id);
    if (blackjackIndex >= 0) {
      const [seat] = blackjack.players.splice(blackjackIndex, 1);
      addChips(room, player, seat.bet);
      if (blackjack.phase === "playing") {
        if (blackjackIndex < blackjack.turnIndex) blackjack.turnIndex -= 1;
        else if (blackjackIndex === blackjack.turnIndex) advanceBlackjack(room);
        if (blackjack.players.length === 0 && blackjack.phase === "playing") finishBlackjack(room);
      }
    }
    const poker = room.poker;
    const pokerIndex = poker.players.findIndex((seat) => seat.id === player.id);
    if (pokerIndex >= 0) {
      const [seat] = poker.players.splice(pokerIndex, 1);
      addChips(room, player, seat.bet);
      if (poker.phase === "playing" && poker.players.length === 0) poker.phase = "done";
    }
    refundRoomEntries(player, room);
    room.bankrolls.delete(player.id);
    room.replayVotes.delete(player.id);
    room.gameParticipants.delete(player.id);
    player.currentGame = null;
    player.roomCode = "global";
    endRoomIfBroke(room);
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "create-room" || message.type === "join-room") {
    let targetCode;
    const currentRoom = rooms.get(player.roomCode);
    if (!currentRoom || roomHasRunningGame(currentRoom)) {
      return sendError(socket, "Finish the current round before changing rooms.");
    }
    if (message.type === "create-room") {
      do {
        targetCode = randomBytes(6).toString("hex").toUpperCase();
      } while (rooms.has(targetCode));
      rooms.set(targetCode, createRoom(targetCode, true, player.id));
    } else {
      targetCode = typeof message.roomCode === "string"
        ? message.roomCode.trim().toUpperCase()
        : "";
      if (targetCode !== "GLOBAL" && !/^[A-F0-9]{12}$/.test(targetCode)) {
        return sendError(socket, "Enter a valid 12-character private room code.");
      }
      if (targetCode === "GLOBAL") targetCode = "global";
      if (!rooms.has(targetCode)) {
        return sendError(socket, "That private room does not exist. Check the code.");
      }
      if (rooms.get(targetCode).ended && targetCode !== player.roomCode) {
        return sendError(socket, "That private room has ended. Ask the host to start a new game.");
      }
    }
    let earnedDailyBonus = false;
    if (currentRoom.code !== targetCode) {
      refundRoomEntries(player, currentRoom);
      if (currentRoom.isPrivate) { currentRoom.bankrolls.delete(player.id); currentRoom.gameParticipants.delete(player.id); }
      if (currentRoom.ownerId === player.id) {
        currentRoom.ownerId = connectedRoomPlayers(currentRoom.code)
          .find((member) => member.id !== player.id)?.id ?? null;
      }
      currentRoom.replayVotes.delete(player.id);
      player.roomCode = targetCode;
      player.currentGame = null;
      const targetRoom = rooms.get(targetCode);
      earnedDailyBonus =
        !targetRoom.isPrivate && claimDailyGlobalBonus(player);
      if (targetRoom.isPrivate && !targetRoom.ownerId) targetRoom.ownerId = player.id;
      if (targetRoom.isPrivate && !targetRoom.bankrolls.has(player.id)) {
        targetRoom.bankrolls.set(player.id, 1000);
      }
      if (targetRoom.isPrivate && targetRoom.selectedGame) { targetRoom.gameParticipants.add(player.id); player.currentGame = targetRoom.selectedGame; }
      const remainingMembers = connectedRoomPlayers(currentRoom.code);
      if (
        currentRoom.ended &&
        remainingMembers.length > 0 &&
        remainingMembers.every((member) => currentRoom.replayVotes.has(member.id))
      ) {
        replayPrivateRoom(currentRoom);
      }
      savePlayers();
    }
    broadcast();
    if (earnedDailyBonus && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "daily-global-bonus", amount: 3000 }));
    }
    return;
  }

  const room = rooms.get(player.roomCode);
  if (!room) {
    sendError(socket, "Your game room is unavailable. Rejoin the global room.");
    return;
  }

  if (message.type === "kick-player") {
    if (!room.isPrivate) {
      return sendError(socket, "Players can only be kicked from a private room.");
    }
    if (room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can kick players.");
    }
    if (typeof message.playerId !== "string" || message.playerId === player.id) {
      return sendError(socket, "Choose another player in the room to kick.");
    }
    const target = players.get(message.playerId);
    if (!target || !target.connected || target.roomCode !== room.code) {
      return sendError(socket, "That player is no longer in this room.");
    }
    if (roomHasRunningGame(room)) {
      return sendError(socket, "Wait until the current round is over before kicking a player.");
    }
    refundRoomEntries(target, room);
    room.bankrolls.delete(target.id);
    room.replayVotes.delete(target.id);
    room.gameParticipants.delete(target.id);
    target.currentGame = null;
    target.roomCode = "global";
    for (const targetSocket of target.sockets) {
      if (targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify({ type: "room-kicked" }));
      }
    }
    savePlayers();
    const remainingMembers = connectedRoomPlayers(room.code);
    if (
      room.ended &&
      remainingMembers.length > 0 &&
      remainingMembers.every((member) => room.replayVotes.has(member.id))
    ) {
      replayPrivateRoom(room);
    }
    broadcast();
    return;
  }

  if (message.type === "replay-room") {
    if (!room.isPrivate || !room.ended) {
      return sendError(socket, "This private room has not ended.");
    }
    room.replayVotes.add(player.id);
    const members = connectedRoomPlayers(room.code);
    if (members.length > 0 && members.every((member) => room.replayVotes.has(member.id))) {
      replayPrivateRoom(room);
    }
    broadcast();
    return;
  }

  if (room.ended && message.type !== "set-name") {
    return sendError(socket, "This private room has ended. Choose play again or leave the room.");
  }

  if (message.type === "quit-game") {
    const game = room.selectedGame || message.game;
    const validGames = ["roulette", "blackjack", "slots", "horses", "poker", "wheel", "plinko"];
    if (!validGames.includes(game)) return sendError(socket, "There is no active game to quit.");
    if (
      (game === "roulette" && room.roulette.spinning) ||
      (game === "horses" && room.horseRace.phase === "racing") ||
      (game === "blackjack" && room.blackjack.phase === "playing") ||
      (game === "poker" && room.poker.phase === "playing")
    ) return sendError(socket, "Finish the current round before quitting this game.");
    const refund = (amount) => {
      if (Number.isSafeInteger(amount) && amount > 0) addChips(room, player, amount);
    };
    if (game === "roulette") {
      for (const bet of room.roulette.bets.filter((item) => item.playerId === player.id)) refund(bet.amount);
      room.roulette.bets = room.roulette.bets.filter((item) => item.playerId !== player.id);
    } else if (game === "horses") {
      for (const bet of room.horseRace.bets.filter((item) => item.playerId === player.id)) refund(bet.amount);
      room.horseRace.bets = room.horseRace.bets.filter((item) => item.playerId !== player.id);
    } else if (game === "blackjack") {
      const seat = room.blackjack.players.find((item) => item.id === player.id);
      if (seat && room.blackjack.phase === "waiting") refund(seat.bet);
      room.blackjack.players = room.blackjack.players.filter((item) => item.id !== player.id);
      if (room.blackjack.players.length === 0) resetBlackjack(room);
    } else if (game === "poker") {
      const seat = room.poker.players.find((item) => item.id === player.id);
      if (seat && room.poker.phase === "waiting") refund(seat.bet);
      room.poker.players = room.poker.players.filter((item) => item.id !== player.id);
      if (room.poker.players.length === 0) room.poker = { phase: "waiting", players: [], lastResult: null };
    }
    player.currentGame = null;
    if (room.isPrivate) {
      room.gameParticipants.delete(player.id);
      const remaining = connectedRoomPlayers(room.code).filter((member) => room.gameParticipants.has(member.id));
      if (remaining.length === 0) {
        room.selectedGame = null;
        room.gameParticipants.clear();
        if (game === "roulette") room.roulette.bets = [];
        if (game === "horses") room.horseRace = { phase: "waiting", bets: [], winner: null, history: room.horseRace.history };
        if (game === "blackjack") resetBlackjack(room);
        if (game === "poker") room.poker = { phase: "waiting", players: [], lastResult: null };
      }
    }
    savePlayers();
    endRoomIfBroke(room);
    broadcast();
    return;
  }

  if (message.type === "select-game") {
    const availableGames = ["roulette", "blackjack", "slots", "horses", "poker", "wheel", "plinko"];
    if (!room.isPrivate || !availableGames.includes(message.game)) {
      return sendError(socket, "Choose a valid game for a private room.");
    }
    if (room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can choose the game.");
    }
    if (room.selectedGame && room.selectedGame !== message.game) {
      return sendError(socket, `This room is locked to ${room.selectedGame}.`);
    }
    room.selectedGame = message.game;
    room.gameParticipants = new Set(connectedRoomPlayers(room.code).map((member) => member.id));
    for (const member of connectedRoomPlayers(room.code)) member.currentGame = message.game;
    broadcast();
    return;
  }

  const gameByMessageType = {
    "roulette-bet": "roulette",
    "roulette-spin": "roulette",
    "slots-spin": "slots",
    "wheel-fortune-spin": "wheel",
    "plinko-drop": "plinko",
    "horse-bet": "horses",
    "horse-start": "horses",
    "join-poker": "poker",
    "start-poker": "poker",
    "join-blackjack": "blackjack",
    "start-blackjack": "blackjack",
    "blackjack-action": "blackjack",
  };
  const requestedGame = gameByMessageType[message.type];
  const gameEntryActions = new Set(["roulette-bet", "slots-spin", "horse-bet", "join-poker", "join-blackjack", "wheel-fortune-spin", "plinko-drop"]);
  if (requestedGame && gameEntryActions.has(message.type)) {
    const ban = activeGameBan(player.id, requestedGame);
    if (ban) return sendError(socket, "You are temporarily blocked from " + requestedGame + " until " + new Date(ban.expiresAt).toLocaleString() + ".");
  }
  if (requestedGame && player.currentGame && player.currentGame !== requestedGame) return sendError(socket, 'Quit your current game before switching to another one.');
  if (room.isPrivate && requestedGame && room.selectedGame !== requestedGame) {
    return sendError(socket, room.selectedGame
      ? `This room is locked to ${room.selectedGame}.`
      : "Choose the room's game before playing.");
  }
  if (requestedGame) player.currentGame = requestedGame;

  if (message.type === "set-name") {
    const name = safeName(message.name);
    if (!name) {
      sendError(socket, "Choose a username with 1–18 letters, numbers, or underscores.");
      return;
    }
    const nameTaken = [...players.values()].some(
      (candidate) =>
        candidate.id !== player.id &&
        candidate.connected &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (nameTaken) {
      sendError(socket, "That username is already in use. Choose another.");
      return;
    }
    player.name = name;
    for (const seat of room.blackjack.players) {
      if (seat.id === player.id) seat.name = player.name;
    }
    for (const bet of room.roulette.bets) {
      if (bet.playerId === player.id) bet.name = player.name;
    }
    for (const bet of room.horseRace.bets) {
      if (bet.playerId === player.id) bet.name = player.name;
    }
    for (const seat of room.poker.players) {
      if (seat.id === player.id) seat.name = player.name;
    }
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "roulette-bet") {
    const roulette = room.roulette;
    const selection = String(message.selection);
    if (roulette.spinning) return sendError(socket, "The wheel is spinning.");
    if (roulette.bets.some((bet) => bet.playerId === player.id)) {
      return sendError(socket, "You have already placed your bet for this spin.");
    }
    if (!/^(red|black|[0-9]|[12][0-9]|3[0-6])$/.test(selection)) {
      return sendError(socket, "Choose red, black, or a number from 0 to 36.");
    }
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Enter a whole-number wager from 1 chip up to your available balance.");
    }
    setChips(room, player, chipsFor(room, player) - message.amount);
    roulette.bets.push({
      playerId: player.id,
      name: player.name,
      selection,
      amount: message.amount,
    });
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "roulette-spin") {
    const roulette = room.roulette;
    if (roulette.spinning) return sendError(socket, "The wheel is already spinning.");
    if (roulette.bets.length === 0) return sendError(socket, "Place a bet before the spin.");
    const readyIds = new Set(roulette.bets.map((bet) => bet.playerId));
    if (room.isPrivate && !allRoomPlayersReady(room.code, readyIds)) {
      return sendError(socket, "Wait until everyone in the room has placed a roulette bet.");
    }
    if (room.isPrivate && room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can start the game.");
    }
    roulette.spinning = true;
    const result = randomInt(37);
    const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const color = result === 0 ? "green" : redNumbers.has(result) ? "red" : "black";
    roulette.spinningResult = { number: result, color };
    broadcast();
    setTimeout(() => {
      const currentRoulette = room.roulette;
      for (const bet of currentRoulette.bets) {
        const winner =
          bet.selection === String(result) ||
          (bet.selection === "red" && color === "red") ||
          (bet.selection === "black" && color === "black");
        if (winner) {
          const winnerPlayer = players.get(bet.playerId);
          if (winnerPlayer) {
            const payout = /^\d+$/.test(bet.selection) ? bet.amount * 36 : bet.amount * 2;
            addChips(room, winnerPlayer, payout);
            recordPlayerGame(winnerPlayer, "roulette", room, bet.amount, payout, "Win", "Bet " + bet.selection + " · result " + result + " " + color);
          }
        } else {
          const losingPlayer = players.get(bet.playerId);
          if (losingPlayer) recordPlayerGame(losingPlayer, "roulette", room, bet.amount, 0, "Loss", "Bet " + bet.selection + " · result " + result + " " + color);
        }
      }
      currentRoulette.lastResult = { number: result, color };
      currentRoulette.spinningResult = null;
      currentRoulette.history.unshift(currentRoulette.lastResult);
      currentRoulette.history = currentRoulette.history.slice(0, 12);
      currentRoulette.bets = [];
      currentRoulette.spinning = false;
      endRoomIfBroke(room);
      savePlayers();
      broadcast();
    }, 3600);
    return;
  }

  if (message.type === "wheel-fortune-spin") {
    const amount = message.amount;
    if (!validAmount(amount) || amount > chipsFor(room, player)) return sendError(socket, "Choose a wager from 1 chip up to your available balance.");
    const cooldown = gameCooldownRemaining(player, "wheel", 4300);
    if (cooldown) return sendError(socket, "Please wait " + Math.ceil(cooldown / 1000) + " seconds before spinning again.");
    const segments = [0, 0.5, 1, 0, 0.75, 2, 1, 0, 1.5, 5];
    const segment = randomInt(segments.length);
    const multiplier = segments[segment];
    setChips(room, player, chipsFor(room, player) - amount);
    const payout = Math.floor(amount * multiplier);
    if (payout) addChips(room, player, payout);
    room.wheelFortune.history.unshift({ playerId: player.id, name: player.name, amount, payout, multiplier, segment, timestamp: Date.now() });
    room.wheelFortune.history = room.wheelFortune.history.slice(0, 20);
    recordPlayerGame(player, "wheel of fortune", room, amount, payout, payout > amount ? "Win" : payout === amount ? "Push" : "Loss", multiplier + "× multiplier");
    endRoomIfBroke(room); savePlayers(); broadcast(); return;
  }

  if (message.type === "plinko-drop") {
    const amount = message.amount;
    if (!validAmount(amount) || amount > chipsFor(room, player)) return sendError(socket, "Choose a wager from 1 chip up to your available balance.");
    const cooldown = gameCooldownRemaining(player, "plinko", 2400);
    if (cooldown) return sendError(socket, "Please wait " + Math.ceil(cooldown / 1000) + " seconds before dropping again.");
    const multipliers = [0, 0, 0.5, 0.75, 1, 3, 1, 0.75, 0.5, 0, 0];
    const drop = simulatePlinkoDrop();
    const slot = drop.slot;
    const multiplier = multipliers[slot];
    setChips(room, player, chipsFor(room, player) - amount);
    const payout = Math.floor(amount * multiplier);
    if (payout) addChips(room, player, payout);
    room.plinko.history.unshift({ playerId: player.id, name: player.name, amount, payout, multiplier, slot, path: drop.path, timestamp: Date.now() });
    room.plinko.history = room.plinko.history.slice(0, 20);
    recordPlayerGame(player, "plinko", room, amount, payout, payout > amount ? "Win" : payout === amount ? "Push" : "Loss", multiplier + "× slot");
    endRoomIfBroke(room); savePlayers(); broadcast(); return;
  }

  if (message.type === "slots-spin") {
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Choose a slot wager from 1 chip up to your available balance.");
    }
    const cooldown = gameCooldownRemaining(player, "slots", 1300);
    if (cooldown) return sendError(socket, "Please wait " + Math.ceil(cooldown / 1000) + " seconds before spinning again.");
    setChips(room, player, chipsFor(room, player) - message.amount);
    const symbols = Array.from({ length: 3 }, () => slotSymbols[randomInt(slotSymbols.length)]);
    const same = symbols[0] === symbols[1] && symbols[1] === symbols[2];
    const pair = symbols.some((symbol, index) => symbols.indexOf(symbol) !== index);
    const multiplier = same
      ? symbols[0] === "7" ? 20 : 8
      : pair ? 2 : 0;
    const payout = message.amount * multiplier;
    addChips(room, player, payout);
    recordPlayerGame(player, "slots", room, message.amount, payout, payout > message.amount ? "Win" : payout === message.amount ? "Push" : "Loss", symbols.join(" "));
    room.slots.history.unshift({
      playerId: player.id,
      name: player.name,
      symbols,
      amount: message.amount,
      payout,
      timestamp: Date.now(),
    });
    room.slots.history = room.slots.history.slice(0, 12);
    endRoomIfBroke(room);
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "horse-bet") {
    const horseRace = room.horseRace;
    if (horseRace.phase !== "waiting") {
      return sendError(socket, "Wait until the current horse race is over.");
    }
    if (!horseNames.includes(message.horse)) {
      return sendError(socket, "Choose one of the horses on the track.");
    }
    if (horseRace.bets.some((bet) => bet.playerId === player.id)) {
      return sendError(socket, "You have already placed your bet for this race.");
    }
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Choose a horse bet from 1 chip up to your available balance.");
    }
    setChips(room, player, chipsFor(room, player) - message.amount);
    horseRace.bets.push({
      playerId: player.id,
      name: player.name,
      horse: message.horse,
      amount: message.amount,
    });
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "horse-start") {
    const horseRace = room.horseRace;
    if (horseRace.phase !== "waiting" || horseRace.bets.length === 0) {
      return sendError(socket, "Place a bet before starting the race.");
    }
    const readyIds = new Set(horseRace.bets.map((bet) => bet.playerId));
    if (room.isPrivate && !allRoomPlayersReady(room.code, readyIds)) {
      return sendError(socket, "Wait until everyone in the room has placed a horse bet.");
    }
    if (room.isPrivate && room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can start the game.");
    }
    horseRace.phase = "racing";
    horseRace.winner = null;
    broadcast();
    setTimeout(() => {
      const currentRace = room.horseRace;
      const winner = horseNames[randomInt(horseNames.length)];
      for (const bet of currentRace.bets) {
        if (bet.horse === winner) {
          const winnerPlayer = players.get(bet.playerId);
          if (winnerPlayer) { addChips(room, winnerPlayer, bet.amount * 3); recordPlayerGame(winnerPlayer, "horse racing", room, bet.amount, bet.amount * 3, "Win", "Picked " + bet.horse + " · winner " + winner); }
        } else {
          const losingPlayer = players.get(bet.playerId);
          if (losingPlayer) recordPlayerGame(losingPlayer, "horse racing", room, bet.amount, 0, "Loss", "Picked " + bet.horse + " · winner " + winner);
        }
      }
      currentRace.winner = winner;
      currentRace.history.unshift({ winner, bets: currentRace.bets.length });
      currentRace.history = currentRace.history.slice(0, 8);
      currentRace.bets = [];
      currentRace.phase = "waiting";
      endRoomIfBroke(room);
      savePlayers();
      broadcast();
    }, 4200);
    return;
  }

  if (message.type === "update-poker-bet") {
    const seat = room.poker.players.find((item) => item.id === player.id);
    if (room.poker.phase !== "waiting" || !seat) return sendError(socket, "You can only change your poker buy-in before the round starts.");
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player) + seat.bet) return sendError(socket, "Choose a poker buy-in within your available balance.");
    setChips(room, player, chipsFor(room, player) + seat.bet - message.amount);
    seat.bet = message.amount;
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "join-poker") {
    const poker = room.poker;
    if (poker.phase === "playing") {
      return sendError(socket, "Wait for the current poker showdown to finish.");
    }
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Choose a poker buy-in from 1 chip up to your available balance.");
    }
    if (poker.phase === "done") {
      poker.phase = "waiting";
      poker.players = [];
    }
    if (poker.players.some((seat) => seat.id === player.id)) {
      return sendError(socket, "You are already at this poker table.");
    }
    setChips(room, player, chipsFor(room, player) - message.amount);
    poker.players.push({
      id: player.id,
      name: player.name,
      bet: message.amount,
      hand: [],
      result: null,
    });
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "start-poker") {
    const poker = room.poker;
    if (poker.phase !== "waiting" || poker.players.length < 2) {
      return sendError(socket, "At least two players must join before the poker showdown.");
    }
    const readyIds = new Set(poker.players.map((seat) => seat.id));
    if (room.isPrivate && !allRoomPlayersReady(room.code, readyIds)) {
      return sendError(socket, "Wait until everyone in the room has joined the poker round.");
    }
    if (room.isPrivate && room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can start the game.");
    }
    const deck = makeDeck(Math.ceil(poker.players.length / 10));
    for (const seat of poker.players) {
      seat.hand = Array.from({ length: 5 }, () => deck.pop());
      seat.result = null;
    }
    poker.phase = "playing";
    broadcast();
    setTimeout(() => {
      const currentPoker = room.poker;
      if (currentPoker.players.length === 0) {
        currentPoker.phase = "done";
        endRoomIfBroke(room);
        broadcast();
        return;
      }
      const ranked = currentPoker.players.map((seat) => ({
        seat,
        hand: evaluatePokerHand(seat.hand),
      }));
      const best = ranked.reduce((winner, current) =>
        comparePokerHands(current.hand, winner.hand) > 0 ? current : winner
      );
      const winners = ranked.filter((candidate) =>
        comparePokerHands(candidate.hand, best.hand) === 0
      );
      const pot = currentPoker.players.reduce((total, seat) => total + seat.bet, 0);
      const share = Math.floor(pot / winners.length);
      let remainder = pot % winners.length;
      for (const candidate of ranked) {
        const winnerIndex = winners.findIndex((winner) => winner.seat.id === candidate.seat.id);
        const won = winnerIndex >= 0;
        const payout = won ? share + (remainder-- > 0 ? 1 : 0) : 0;
        const winningPlayer = players.get(candidate.seat.id);
        if (winningPlayer && won) addChips(room, winningPlayer, payout);
        if (winningPlayer) recordPlayerGame(winningPlayer, "poker", room, candidate.seat.bet, payout, won ? "Win" : "Loss", candidate.hand.name);
        candidate.seat.result = won
          ? `${candidate.hand.name} · won ${payout} chips`
          : candidate.hand.name;
      }
      poker.lastResult = {
        winners: winners.map(({ seat }) => seat.name),
        hand: best.hand.name,
        pot,
      };
      poker.phase = "done";
      endRoomIfBroke(room);
      savePlayers();
      broadcast();
    }, 2500);
    return;
  }

  if (message.type === "update-blackjack-bet") {
    const seat = room.blackjack.players.find((item) => item.id === player.id);
    if (room.blackjack.phase !== "waiting" || !seat) return sendError(socket, "You can only change your blackjack wager before the round starts.");
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player) + seat.bet) return sendError(socket, "Choose a wager within your available balance.");
    setChips(room, player, chipsFor(room, player) + seat.bet - message.amount);
    seat.bet = message.amount;
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "join-blackjack") {
    const blackjack = room.blackjack;
    if (blackjack.phase === "playing") {
      return sendError(socket, "Wait for the current blackjack round to finish.");
    }
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Choose a bet from 1 chip up to your available balance.");
    }
    if (blackjack.phase === "done") resetBlackjack(room);
    if (blackjack.players.some((seat) => seat.id === player.id)) {
      return sendError(socket, "You are already at this blackjack table.");
    }
    setChips(room, player, chipsFor(room, player) - message.amount);
    blackjack.players.push({
      id: player.id,
      name: player.name,
      bet: message.amount,
      hand: [],
      status: "waiting",
      result: null,
    });
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "start-blackjack") {
    const blackjack = room.blackjack;
    if (blackjack.phase !== "waiting" || blackjack.players.length === 0) {
      return sendError(socket, "Join the table before starting a round.");
    }
    const readyIds = new Set(blackjack.players.map((seat) => seat.id));
    if (room.isPrivate && !allRoomPlayersReady(room.code, readyIds)) {
      return sendError(socket, "Wait until everyone in the room has placed a blackjack bet.");
    }
    if (room.isPrivate && room.ownerId !== player.id) {
      return sendError(socket, "Only the private room host can start the game.");
    }
    blackjack.deck = makeDeck();
    blackjack.dealer = [];
    for (const seat of blackjack.players) {
      seat.hand = [blackjack.deck.pop(), blackjack.deck.pop()];
      seat.status = "playing";
      seat.result = null;
    }
    blackjack.dealer = [blackjack.deck.pop(), blackjack.deck.pop()];
    blackjack.phase = "playing";
    blackjack.turnIndex = 0;
    advanceBlackjack(room);
    broadcast();
    return;
  }

  if (message.type === "blackjack-action") {
    const blackjack = room.blackjack;
    const seat = currentTurn(room);
    if (blackjack.phase !== "playing" || !seat || seat.id !== player.id) {
      return sendError(socket, "It is not your turn.");
    }
    if (message.action === "hit") {
      seat.hand.push(blackjack.deck.pop());
      if (score(seat.hand) > 21) {
        seat.status = "bust";
        blackjack.turnIndex += 1;
        advanceBlackjack(room);
      }
    } else if (message.action === "stand") {
      seat.status = "stood";
      blackjack.turnIndex += 1;
      advanceBlackjack(room);
    } else {
      return sendError(socket, "Choose hit or stand.");
    }
    broadcast();
  }
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : pathname === "/admin" || pathname === "/admin/" ? "admin.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    response.writeHead(400);
    response.end("Invalid path");
    return;
  }
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const extension = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
    };
    response.writeHead(200, {
      "content-type": contentTypes[extension] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  });
});

const webSocketServer = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });
server.on("upgrade", (request, socket, head) => {
  try {
    if (new URL(request.url, `http://${request.headers.host}`).pathname !== "/live") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  } catch (error) {
    console.error("Could not establish multiplayer connection:", error);
    socket.destroy();
  }
});

webSocketServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (!message || typeof message !== "object" || typeof message.type !== "string") {
        sendError(socket, "That action could not be understood.");
        return;
      }
      handleMessage(socket, message);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(socket, "That action could not be understood.");
        return;
      }
      console.error("Could not process multiplayer action:", error);
      sendError(socket, "The table could not process that action.");
    }
  });
  socket.on("close", () => {
    sockets.delete(socket);
    const player = players.get(socket.playerId);
    if (player && player.sockets.has(socket)) {
      player.sockets.delete(socket);
      if (player.sockets.size === 0) player.connected = false;
      const room = rooms.get(player.roomCode);
      const blackjack = room?.blackjack;
      const seat = blackjack?.players.find((item) => item.id === player.id);
      if (
        player.sockets.size === 0 &&
        blackjack?.phase === "playing" &&
        seat &&
        currentTurn(room)?.id === player.id
      ) {
        seat.status = "stood";
        blackjack.turnIndex += 1;
        advanceBlackjack(room);
      }
      if (player.sockets.size === 0 && room?.ownerId === player.id) {
        room.ownerId = connectedRoomPlayers(room.code)[0]?.id ?? null;
      }
      if (player.sockets.size === 0 && room?.ended) {
        const remainingMembers = connectedRoomPlayers(room.code);
        if (
          remainingMembers.length > 0 &&
          remainingMembers.every((member) => room.replayVotes.has(member.id))
        ) {
          replayPrivateRoom(room);
        }
      }
      if (player.sockets.size === 0 && room) endRoomIfBroke(room);
      broadcast();
    }
  });
  socket.on("error", (error) => console.error("WebSocket error:", error));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Golden Hour Casino is listening on http://localhost:${port}`);
});
