const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(level = "info") {
  const minLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;

  function shouldLog(targetLevel) {
    return (LEVEL_ORDER[targetLevel] ?? LEVEL_ORDER.info) >= minLevel;
  }

  function format(levelName, message, meta) {
    const prefix = `[${new Date().toISOString()}] [${levelName.toUpperCase()}]`;
    if (meta === undefined) {
      return `${prefix} ${message}`;
    }
    return `${prefix} ${message} ${JSON.stringify(meta)}`;
  }

  return {
    debug(message, meta) {
      if (shouldLog("debug")) {
        console.debug(format("debug", message, meta));
      }
    },
    info(message, meta) {
      if (shouldLog("info")) {
        console.info(format("info", message, meta));
      }
    },
    warn(message, meta) {
      if (shouldLog("warn")) {
        console.warn(format("warn", message, meta));
      }
    },
    error(message, meta) {
      if (shouldLog("error")) {
        console.error(format("error", message, meta));
      }
    }
  };
}
