export function buildCommandRegistry(modules) {
  const commandRegistry = new Map();
  const commandPayload = [];

  for (const moduleDef of modules) {
    for (const command of moduleDef.commands || []) {
      const commandName = command?.data?.name;
      if (!commandName) {
        continue;
      }

      if (commandRegistry.has(commandName)) {
        throw new Error(`Doppelter Slash-Command gefunden: ${commandName}`);
      }

      commandRegistry.set(commandName, command);
      commandPayload.push(command.data.toJSON());
    }
  }

  return { commandRegistry, commandPayload };
}

export function getEventHandlers(modules, eventName) {
  const handlers = [];

  for (const moduleDef of modules) {
    const moduleHandlers = moduleDef?.events?.[eventName] || [];
    for (const handler of moduleHandlers) {
      handlers.push({ moduleName: moduleDef.name, handler });
    }
  }

  return handlers;
}

export async function runEventHandlers(modules, eventName, payload, logger) {
  const handlers = getEventHandlers(modules, eventName);

  for (const { moduleName, handler } of handlers) {
    try {
      await handler(payload);
    } catch (error) {
      logger.warn(`Event-Handler fehlgeschlagen (${eventName})`, {
        module: moduleName,
        error: String(error)
      });
    }
  }
}
