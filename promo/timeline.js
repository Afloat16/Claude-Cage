// Shared timing for the promo page (promo.js) and the soundtrack (soundtrack.mjs).
// All values are seconds from the start of the video. Loaded as a classic script
// in the browser and through require() in Node.
(function (root) {
  const TL = {
    duration: 60,
    fps: 60,
    width: 1920,
    height: 1080,

    // Act 1 · the problem, four hard-cut beats and a question.
    pain: {
      slam: 0.15,
      losses: [0.85, 1.15, 1.45],
      b2: 3.4,
      rows: [3.75, 4.05, 4.35, 4.65],
      total: 5.0,
      b3: 6.4,
      wires: 6.75,
      tags: [7.25, 7.55, 7.85, 8.15, 8.45],
      b4: 9.4,
      vm: 9.55,
      vmMem: 10.5,
      vmTodo: [10.9, 11.15, 11.4, 11.65],
      b5: 12.2,
      end: 13.75,
    },

    // Act 2 · the answer.
    room: {
      start: 13.75,
      pixels: 14.0,
      frame: 14.65,
      bars: [15.0, 15.2],
      blink: 16.0,
      word: 15.55,
      pos: 16.1,
      sub: 16.75,
      end: 19.7,
    },

    // Act 3 · three steps inside the app.
    app: {
      rise: 19.4,
      step1: 20.4,
      clickProxy: 22.1,
      modalOpen: 22.3,
      clickNode: 23.8,
      clickUse: 24.7,
      modalClose: 24.8,
      tzFlip: 26.15,
      step2: 27.6,
      clickLaunch: 28.5,
      launch: 28.6,
      image: [29.0, 30.0],
      tools: [30.0, 30.8],
      checks: 30.85,
      checkStep: 0.2,
      released: 33.25,
      step3: 34.8,
      clickTerminal: 35.25,
      terminal: 35.4,
      typeClaude: 36.2,
      enterClaude: 37.0,
      welcome: 37.2,
      typePrompt: 37.8,
      enterPrompt: 39.4,
      reply: [39.65, 40.3, 40.95, 41.7],
      out: 43.0,
      end: 44.0,
    },

    // Act 4 · everything that comes in the box.
    perks: {
      start: 43.8,
      head: 44.1,
      tiles: [44.7, 44.95, 45.2, 45.45],
      out: 48.9,
      end: 49.5,
    },

    // Act 5 · why the cage exists.
    letter: {
      start: 49.3,
      lines: [50.1, 51.0, 51.9],
      out: 54.0,
      end: 54.7,
    },

    // Act 6 · end card.
    end: {
      start: 54.85,
      blink: 57.9,
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = TL;
  else root.TL = TL;
})(this);
