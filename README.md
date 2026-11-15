# ♞ Royal 3D Chess

A fully 3D, playable chess board in the browser — carved wooden frame, lathe-turned
pieces, drag & drop — powered by **Stockfish 19** and **chess.js**.

## Run it

```bash
npm start          # → http://localhost:8080
```

(or `node server.js` — needs nothing installed beyond `npm install`, which is done.)

## Features

- **Play vs Stockfish 19** (WASM, runs fully client-side) — Beginner `~800` through Maximum `2800+`
- **Two Players** local mode
- Real 3D: Three.js scene, PBR materials, shadows, engraved board coordinates, victory particle burst
- **Click-to-move and full drag & drop**, legal-move dots, capture rings, check highlight, animated hops
- **Matchup header** — You vs Stockfish (or White vs Black): live accuracy %, captured pieces, material lead, turn glow, crown on the winner
- **Analytics & Predictions** panel: live evaluation graph, win-probability graph, material-balance graph, opening detection, per-move quality tags (`!`, `?!`, `?`, `??`), per-side accuracy bars, per-side move-quality breakdown, **Deep Analyze** full-game review
- Golden **hint arrow** (💡), takeback (↩), flip board (⤾), WebAudio sound effects
- **Win/draw/loss record vs Stockfish** persisted in `localStorage`, plus saved settings (mode, difficulty, side, sound)
- Keyboard shortcuts: `N` new · `F` flip · `U` undo · `H` hint · `M` sound

## Tech

- [Three.js](https://threejs.org/) — board, pieces (procedural lathe geometry + extruded knight), lighting
- [chess.js](https://github.com/jhlywa/chess.js) — rules, SAN, legal moves
- [stockfish.js](https://github.com/nmrugg/stockfish.js/) `stockfish-19-lite-single` — engine via Web Worker (no special server headers needed), used twice: once to play, once to analyze
