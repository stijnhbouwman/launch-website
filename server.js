const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomBytes, randomInt } = require("node:crypto");
const WebSocket = require("ws");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const playersFile = path.join(dataDirectory, "players.json");
const players = new Map();
const savedPlayers = fs.existsSync(playersFile)
  ? JSON.parse(fs.readFileSync(playersFile, "utf8"))
  : {};

const slotSymbols = ["✦", "♣", "♦", "♠", "7"];
const horseNames = ["Comet", "Clover", "Sundown", "Goldrush"];
const rooms = new Map();

function createRoom(code, isPrivate, ownerId = null) {
  return {
    code,
    isPrivate,
    ownerId,
    selectedGame: null,
    bankrolls: new Map(),
    ended: false,
    replayVotes: new Set(),
    roulette: { bets: [], lastResult: null, history: [], spinning: false },
    slots: { history: [] },
    horseRace: { phase: "waiting", bets: [], winner: null, history: [] },
    blackjack: { phase: "waiting", players: [], dealer: [], deck: [], turnIndex: 0 },
    poker: { phase: "waiting", players: [], lastResult: null },
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
  const balances = [...room.bankrolls.values()];
  if (balances.length === 0 || balances.some((balance) => balance > 0)) return false;
  room.ended = true;
  room.replayVotes.clear();
  return true;
}

function replayPrivateRoom(room) {
  const nextRoom = createRoom(room.code, true, room.ownerId);
  nextRoom.selectedGame = room.selectedGame;
  for (const player of connectedRoomPlayers(room.code)) {
    nextRoom.bankrolls.set(player.id, 1000);
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

function savePlayers() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const player of players.values()) {
    savedPlayers[player.id] = {
      name: player.name,
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
        chips: chipsFor(room, player),
      })),
    room: {
      code: room.code,
      isPrivate: room.isPrivate,
      ownerId: room.ownerId,
      selectedGame: room.selectedGame,
      ended: room.ended,
      replayVotes: [...room.replayVotes],
      members: connectedRoomPlayers(roomCode).map((player) => ({
        id: player.id,
        name: player.name,
        chips: chipsFor(room, player),
      })),
    },
    roulette: {
      bets: roulette.bets.map(({ playerId, name, selection, amount }) => ({
        playerId, name, selection, amount,
      })),
      lastResult: roulette.lastResult,
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
    }
  }
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
    if (!player) {
      const saved = savedPlayers[message.id];
      player = {
        id: message.id,
        name,
        chips: saved && Number.isSafeInteger(saved.chips) && saved.chips >= 0
          ? saved.chips
          : 1000,
        lastGlobalRewardDate: typeof saved?.lastGlobalRewardDate === "string"
          ? saved.lastGlobalRewardDate
          : null,
        roomCode: requestedRoom,
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
        if (previousRoom.isPrivate) previousRoom.bankrolls.delete(player.id);
      }
    }
    player.roomCode = requestedRoom;
    player.name = name;
    player.connected = true;
    player.sockets.add(socket);
    const registeredRoom = rooms.get(requestedRoom);
    const earnedDailyBonus =
      !registeredRoom.isPrivate && claimDailyGlobalBonus(player);
    if (registeredRoom.isPrivate && !registeredRoom.bankrolls.has(player.id)) {
      registeredRoom.bankrolls.set(player.id, 1000);
    }
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
      if (currentRoom.isPrivate) currentRoom.bankrolls.delete(player.id);
      if (currentRoom.ownerId === player.id) {
        currentRoom.ownerId = connectedRoomPlayers(currentRoom.code)
          .find((member) => member.id !== player.id)?.id ?? null;
      }
      currentRoom.replayVotes.delete(player.id);
      player.roomCode = targetCode;
      const targetRoom = rooms.get(targetCode);
      earnedDailyBonus =
        !targetRoom.isPrivate && claimDailyGlobalBonus(player);
      if (targetRoom.isPrivate && !targetRoom.ownerId) targetRoom.ownerId = player.id;
      if (targetRoom.isPrivate && !targetRoom.bankrolls.has(player.id)) {
        targetRoom.bankrolls.set(player.id, 1000);
      }
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

  if (message.type === "select-game") {
    const availableGames = ["roulette", "blackjack", "slots", "horses", "poker"];
    if (!room.isPrivate || !availableGames.includes(message.game)) {
      return sendError(socket, "Choose a valid game for a private room.");
    }
    if (room.selectedGame && room.selectedGame !== message.game) {
      return sendError(socket, `This room is locked to ${room.selectedGame}.`);
    }
    room.selectedGame = message.game;
    broadcast();
    return;
  }

  const gameByMessageType = {
    "roulette-bet": "roulette",
    "roulette-spin": "roulette",
    "slots-spin": "slots",
    "horse-bet": "horses",
    "horse-start": "horses",
    "join-poker": "poker",
    "start-poker": "poker",
    "join-blackjack": "blackjack",
    "start-blackjack": "blackjack",
    "blackjack-action": "blackjack",
  };
  const requestedGame = gameByMessageType[message.type];
  if (room.isPrivate && requestedGame && room.selectedGame !== requestedGame) {
    return sendError(socket, room.selectedGame
      ? `This room is locked to ${room.selectedGame}.`
      : "Choose the room's game before playing.");
  }

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
    broadcast();
    setTimeout(() => {
      const currentRoulette = room.roulette;
      const result = randomInt(37);
      const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
      const color = result === 0 ? "green" : redNumbers.has(result) ? "red" : "black";
      for (const bet of currentRoulette.bets) {
        const winner =
          bet.selection === String(result) ||
          (bet.selection === "red" && color === "red") ||
          (bet.selection === "black" && color === "black");
        if (winner) {
          const winnerPlayer = players.get(bet.playerId);
          if (winnerPlayer) {
            addChips(room, winnerPlayer, /^\d+$/.test(bet.selection)
              ? bet.amount * 36
              : bet.amount * 2);
          }
        }
      }
      currentRoulette.lastResult = { number: result, color };
      currentRoulette.history.unshift(currentRoulette.lastResult);
      currentRoulette.history = currentRoulette.history.slice(0, 12);
      currentRoulette.bets = [];
      currentRoulette.spinning = false;
      endRoomIfBroke(room);
      savePlayers();
      broadcast();
    }, 2500);
    return;
  }

  if (message.type === "slots-spin") {
    if (!validAmount(message.amount) || message.amount > chipsFor(room, player)) {
      return sendError(socket, "Choose a slot wager from 1 chip up to your available balance.");
    }
    setChips(room, player, chipsFor(room, player) - message.amount);
    const symbols = Array.from({ length: 3 }, () => slotSymbols[randomInt(slotSymbols.length)]);
    const same = symbols[0] === symbols[1] && symbols[1] === symbols[2];
    const pair = symbols.some((symbol, index) => symbols.indexOf(symbol) !== index);
    const multiplier = same
      ? symbols[0] === "7" ? 20 : 8
      : pair ? 2 : 0;
    const payout = message.amount * multiplier;
    addChips(room, player, payout);
    room.slots.history.unshift({
      playerId: player.id,
      name: player.name,
      symbols,
      amount: message.amount,
      payout,
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
          if (winnerPlayer) addChips(room, winnerPlayer, bet.amount * 3);
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
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
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
