export function buildCommandRegistry(modules) {
  const commandRegistry = new Map();
  const commandPayload = [];
  const commandToModule = new Map();

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
      commandToModule.set(commandName, moduleDef.name);
      commandPayload.push(command.data.toJSON());
    }
  }

  return { commandRegistry, commandPayload, commandToModule };
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
  const store = payload?.client?.botContext?.moduleConfigStore;
  const guildId = payload?.guild?.id || payload?.interaction?.guildId || null;

  for (const { moduleName, handler } of handlers) {
    const handlerAlwaysAvailable = Boolean(handler?.alwaysAvailable);
    if (
      store
      && guildId
      && moduleName !== "setup"
      && !handlerAlwaysAvailable
      && !store.isModuleEnabled(guildId, moduleName)
    ) {
      continue;
    }

    try {
      await handler(payload);
    } catch (error) {
      const apiCode = error?.code;
      if (apiCode === 10062 || apiCode === 40060) {
        continue;
      }

      logger.warn(`Event-Handler fehlgeschlagen (${eventName})`, {
        module: moduleName,
        error: String(error)
      });
    }
  }
}
