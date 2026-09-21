function write(level, args) {
  const time = new Date().toISOString();
  const out = level === 'ERROR' || level === 'WARN' ? console.error : console.log;
  out(`[${time}] [${level}]`, ...args);
}

export const logger = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  debug: (...args) => {
    if (process.env.DEBUG) write('DEBUG', args);
  },
};
