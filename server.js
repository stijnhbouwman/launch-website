const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomInt } = require("node:crypto");
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

const roulette = { bets: [], lastResult: null, history: [], spinning: false };
const blackjack = {
  phase: "waiting",
  players: [],
  dealer: [],
  deck: [],
  turnIndex: 0,
};

function savePlayers() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const player of players.values()) {
    savedPlayers[player.id] = { name: player.name, chips: player.chips };
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

function makeDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    ["A", 11], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6],
    ["7", 7], ["8", 8], ["9", 9], ["10", 10], ["J", 10], ["Q", 10], ["K", 10],
  ];
  const deck = suits.flatMap((suit) =>
    ranks.map(([rank, value]) => ({ rank, suit, value }))
  );
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function currentTurn() {
  return blackjack.players[blackjack.turnIndex];
}

function advanceBlackjack() {
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
  finishBlackjack();
}

function finishBlackjack() {
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
      player.chips += Math.floor(seat.bet * 2.5);
      seat.result = "Blackjack!";
      seat.status = "done";
    } else if (dealerNatural && natural) {
      player.chips += seat.bet;
      seat.result = "Push";
      seat.status = "done";
    } else if (dealerNatural) {
      seat.result = "Dealer blackjack";
      seat.status = "done";
    } else if (dealerBust || playerScore > dealerScore) {
      player.chips += seat.bet * 2;
      seat.result = "Win";
      seat.status = "done";
    } else if (playerScore === dealerScore) {
      player.chips += seat.bet;
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
}

function snapshot() {
  const dealer = blackjack.dealer.map((card, index) => {
    if (blackjack.phase === "playing" && index === 1) return { hidden: true };
    return card;
  });
  return {
    players: [...players.values()]
      .filter((player) => player.connected)
      .map(({ id, name, chips }) => ({ id, name, chips })),
    roulette: {
      bets: roulette.bets.map(({ playerId, name, selection, amount }) => ({
        playerId, name, selection, amount,
      })),
      lastResult: roulette.lastResult,
      history: roulette.history,
      spinning: roulette.spinning,
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
      turnId: blackjack.phase === "playing" ? currentTurn()?.id ?? null : null,
    },
  };
}

const sockets = new Set();
function broadcast() {
  const message = JSON.stringify({ type: "state", state: snapshot() });
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN && socket.playerId) {
      socket.send(message);
    }
  }
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
}

function validAmount(amount) {
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= 500;
}

function resetBlackjack() {
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
        connected: false,
        sockets: new Set(),
      };
      players.set(message.id, player);
    }
    player.name = name;
    player.connected = true;
    player.sockets.add(socket);
    socket.playerId = player.id;
    savePlayers();
    broadcast();
    return;
  }

  const player = players.get(socket.playerId);
  if (!player || !player.sockets.has(socket)) return;

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
    for (const seat of blackjack.players) {
      if (seat.id === player.id) seat.name = player.name;
    }
    savePlayers();
    broadcast();
    return;
  }

  if (message.type === "roulette-bet") {
    const selection = String(message.selection);
    if (roulette.spinning) return sendError(socket, "The wheel is spinning.");
    if (!/^(red|black|[0-9]|[12][0-9]|3[0-6])$/.test(selection)) {
      return sendError(socket, "Choose red, black, or a number from 0 to 36.");
    }
    if (!validAmount(message.amount) || message.amount > player.chips) {
      return sendError(socket, "That bet is not available in your chip balance.");
    }
    player.chips -= message.amount;
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
    if (roulette.spinning) return sendError(socket, "The wheel is already spinning.");
    if (roulette.bets.length === 0) return sendError(socket, "Place a bet before the spin.");
    roulette.spinning = true;
    broadcast();
    setTimeout(() => {
      const result = randomInt(37);
      const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
      const color = result === 0 ? "green" : redNumbers.has(result) ? "red" : "black";
      for (const bet of roulette.bets) {
        const winner =
          bet.selection === String(result) ||
          (bet.selection === "red" && color === "red") ||
          (bet.selection === "black" && color === "black");
        if (winner) {
          const winnerPlayer = players.get(bet.playerId);
          if (winnerPlayer) {
            winnerPlayer.chips += /^\d+$/.test(bet.selection)
              ? bet.amount * 36
              : bet.amount * 2;
          }
        }
      }
      roulette.lastResult = { number: result, color };
      roulette.history.unshift(roulette.lastResult);
      roulette.history = roulette.history.slice(0, 12);
      roulette.bets = [];
      roulette.spinning = false;
      savePlayers();
      broadcast();
    }, 2500);
    return;
  }

  if (message.type === "join-blackjack") {
    if (blackjack.phase === "playing") {
      return sendError(socket, "Wait for the current blackjack round to finish.");
    }
    if (!validAmount(message.amount) || message.amount > player.chips) {
      return sendError(socket, "Choose a bet between 1 and 500 chips within your balance.");
    }
    if (blackjack.phase === "done") resetBlackjack();
    if (blackjack.players.some((seat) => seat.id === player.id)) {
      return sendError(socket, "You are already at this blackjack table.");
    }
    player.chips -= message.amount;
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
    if (blackjack.phase !== "waiting" || blackjack.players.length === 0) {
      return sendError(socket, "Join the table before starting a round.");
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
    advanceBlackjack();
    broadcast();
    return;
  }

  if (message.type === "blackjack-action") {
    const seat = currentTurn();
    if (blackjack.phase !== "playing" || !seat || seat.id !== player.id) {
      return sendError(socket, "It is not your turn.");
    }
    if (message.action === "hit") {
      seat.hand.push(blackjack.deck.pop());
      if (score(seat.hand) > 21) {
        seat.status = "bust";
        blackjack.turnIndex += 1;
        advanceBlackjack();
      }
    } else if (message.action === "stand") {
      seat.status = "stood";
      blackjack.turnIndex += 1;
      advanceBlackjack();
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
      const seat = blackjack.players.find((item) => item.id === player.id);
      if (
        player.sockets.size === 0 &&
        blackjack.phase === "playing" &&
        seat &&
        currentTurn()?.id === player.id
      ) {
        seat.status = "stood";
        blackjack.turnIndex += 1;
        advanceBlackjack();
      }
      broadcast();
    }
  });
  socket.on("error", (error) => console.error("WebSocket error:", error));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Golden Hour Casino is listening on http://localhost:${port}`);
});
