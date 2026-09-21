import clear from './clear.js';
import download from './download.js';
import help from './help.js';
import join from './join.js';
import leave from './leave.js';
import loop from './loop.js';
import nowplaying from './nowplaying.js';
import pause from './pause.js';
import play from './play.js';
import queue from './queue.js';
import remove from './remove.js';
import resume from './resume.js';
import shuffle from './shuffle.js';
import skip from './skip.js';
import stop from './stop.js';

export const commands = new Map(
  [help, join, play, pause, resume, skip, stop, leave, loop, queue, nowplaying, shuffle, remove, clear, download]
    .map((command) => [command.data.name, command]),
);
