// Kleiner Scheduler, damit Module keine eigenen setInterval-Timer verwalten
// müssen und beim Shutdown garantiert alles gestoppt wird.
export class Scheduler {
  constructor(logger) {
    this.logger = logger;
    this.jobs = new Map();
  }

  // Läuft sofort und danach im Intervall. Überlappende Läufe werden übersprungen.
  every(name, intervalMs, task, { runImmediately = true } = {}) {
    this.cancel(name);

    const job = { timer: null, running: false, intervalMs };

    const run = async () => {
      if (job.running) {
        return;
      }

      job.running = true;
      try {
        await task();
      } catch (error) {
        this.logger.warn(`Job fehlgeschlagen: ${name}`, { error: String(error?.stack || error) });
      } finally {
        job.running = false;
      }
    };

    job.timer = setInterval(run, Math.max(1000, intervalMs));
    job.timer.unref?.();
    this.jobs.set(name, job);

    if (runImmediately) {
      run();
    }

    return job;
  }

  cancel(name) {
    const job = this.jobs.get(name);
    if (!job) {
      return false;
    }

    clearInterval(job.timer);
    this.jobs.delete(name);
    return true;
  }

  cancelPrefix(prefix) {
    let count = 0;
    for (const name of [...this.jobs.keys()]) {
      if (name.startsWith(prefix)) {
        this.cancel(name);
        count += 1;
      }
    }

    return count;
  }

  has(name) {
    return this.jobs.has(name);
  }

  stopAll() {
    for (const name of [...this.jobs.keys()]) {
      this.cancel(name);
    }
  }
}
