/**
 * ArcadeHae — UNO Game Engine (Node.js)
 * -------------------------------------
 * Pure game-logic module: no networking, no I/O.
 * This is the "rules authority" — the same code will later run
 * on the server so that every move is validated server-side
 * (a client can never award itself cards or a win).
 *
 * Simplified ruleset for v1 (per the spec doc):
 *   - Colors: red, blue, green, yellow
 *   - Numbers: 0-9
 *   - No special cards yet (Skip / Reverse / Draw Two / Wild) — v2 feature
 *
 * Usage:
 *   const { UnoGame } = require('./uno-engine');
 *   const game = new UnoGame(['playerA', 'playerB']);
 *   game.playCard('playerA', cardId);
 *   game.drawCard('playerA');
 */

const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function buildDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    for (const number of NUMBERS) {
      // one '0' per color, two of every other number per color (standard UNO ratio)
      const copies = number === 0 ? 1 : 2;
      for (let i = 0; i < copies; i++) {
        deck.push({ id: `c${id++}`, color, number });
      }
    }
  }
  return deck;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class UnoGame {
  /**
   * @param {string[]} playerIds - exactly 2 player identifiers (1v1)
   * @param {object} [opts]
   * @param {number} [opts.handSize=7] - starting hand size
   */
  constructor(playerIds, opts = {}) {
    if (!Array.isArray(playerIds) || playerIds.length !== 2) {
      throw new Error('UnoGame requires exactly 2 player IDs for a 1v1 match');
    }
    const handSize = opts.handSize ?? 7;

    this.players = playerIds;
    this.hands = {};
    this.drawPile = shuffle(buildDeck());
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.winner = null;
    this.status = 'in_progress'; // 'in_progress' | 'finished'
    this.log = [];

    // deal starting hands
    for (const pid of this.players) {
      this.hands[pid] = this.drawPile.splice(0, handSize);
    }

    // flip the first card to start the discard pile
    this.discardPile.push(this.drawPile.shift());

    this._pushLog(`Match started between ${this.players[0]} and ${this.players[1]}`);
  }

  _pushLog(message) {
    this.log.push({ t: Date.now(), message });
  }

  get topCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  get opponentOf() {
    return (pid) => this.players.find((p) => p !== pid);
  }

  /** Public-safe view of game state for a given player (hides opponent's hand contents) */
  getStateFor(playerId) {
    const opponentId = this.players.find((p) => p !== playerId);
    return {
      you: playerId,
      yourHand: this.hands[playerId],
      opponentCardCount: this.hands[opponentId]?.length ?? 0,
      topCard: this.topCard,
      currentPlayer: this.currentPlayer,
      drawPileCount: this.drawPile.length,
      status: this.status,
      winner: this.winner,
    };
  }

  _isPlayable(card, top) {
    return card.color === top.color || card.number === top.number;
  }

  _assertPlayersTurn(playerId) {
    if (this.status !== 'in_progress') {
      throw new Error('Game is already finished');
    }
    if (playerId !== this.currentPlayer) {
      throw new Error(`It is not ${playerId}'s turn`);
    }
  }

  _advanceTurn() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
  }

  /**
   * Attempt to play a card from a player's hand.
   * @param {string} playerId
   * @param {string} cardId
   * @returns {object} result summary
   */
  playCard(playerId, cardId) {
    this._assertPlayersTurn(playerId);

    const hand = this.hands[playerId];
    const cardIndex = hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) {
      throw new Error(`Card ${cardId} not found in ${playerId}'s hand`);
    }

    const card = hand[cardIndex];
    if (!this._isPlayable(card, this.topCard)) {
      throw new Error(
        `Card ${card.color}-${card.number} does not match top card ${this.topCard.color}-${this.topCard.number}`
      );
    }

    // move the card from hand to discard pile
    hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    this._pushLog(`${playerId} played ${card.color}-${card.number}`);

    // win check
    if (hand.length === 0) {
      this.status = 'finished';
      this.winner = playerId;
      this._pushLog(`${playerId} wins!`);
      return { ok: true, finished: true, winner: playerId };
    }

    this._advanceTurn();
    return { ok: true, finished: false };
  }

  /**
   * Draw a card from the draw pile (used when a player has no playable card).
   * @param {string} playerId
   */
  drawCard(playerId) {
    this._assertPlayersTurn(playerId);

    if (this.drawPile.length === 0) {
      // reshuffle discard pile (except top card) back into draw pile
      const top = this.discardPile.pop();
      this.drawPile = shuffle(this.discardPile);
      this.discardPile = [top];
      this._pushLog('Draw pile reshuffled from discard pile');
    }

    const card = this.drawPile.shift();
    this.hands[playerId].push(card);
    this._pushLog(`${playerId} drew a card`);

    this._advanceTurn();
    return { ok: true, drawn: card };
  }

  /** True if the given player has at least one legal move right now */
  hasPlayableCard(playerId) {
    return this.hands[playerId].some((c) => this._isPlayable(c, this.topCard));
  }
}

module.exports = { UnoGame, buildDeck, shuffle };
