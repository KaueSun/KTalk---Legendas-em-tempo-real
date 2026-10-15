const { spawn } = require('node:child_process');

class Backend {
  constructor({ command, args, cwd, env, onEvent, onExit }) {
    Object.assign(this, { command, args, cwd, env, onEvent, onExit });
    this.child = null;
    this.promise = null;
    this.closing = false;
    this.shutdownPromise = null;
  }

  ensure() {
    if (this.shutdownPromise) return this.shutdownPromise.then(() => this.ensure());
    if (this.closing && this.child)
      return Promise.reject(new Error('O motor anterior ainda está encerrando. Tente reconectar novamente.'));
    if (this.promise) return this.promise;
    this.closing = false;
    this.promise = new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      let ready = false;
      let buffer = '';
      const timer = setTimeout(() => {
        reject(new Error('O motor de voz demorou para responder. Use Reconectar motor.'));
        child.kill();
      }, 45000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          reject(new Error('Resposta inválida do motor de voz.'));
          child.kill();
          return;
        }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string')
            continue;
          if (event.type === 'ready') {
            ready = true;
            clearTimeout(timer);
            resolve();
          }
          this.onEvent(event);
        }
      });
      child.stderr.on('data', (chunk) => {
        if (process.env.KTALK_DEBUG) process.stderr.write(chunk);
      });
      child.stdin.on('error', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Não foi possível abrir o motor de voz. Verifique a instalação do KTalk.'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null;
        this.promise = null;
        if (!ready) reject(new Error('O motor de voz foi encerrado durante a inicialização.'));
        this.onExit(code, this.closing);
      });
    });
    return this.promise;
  }

  send(value) {
    if (!this.child?.stdin.writable)
      throw new Error('O motor local não está conectado. Use Reconectar motor.');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  shutdown(timeout = 12000) {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    const child = this.child;
    if (!child) return Promise.resolve(true);
    this.shutdownPromise = new Promise((resolve) => {
      let forced = false;
      const timer = setTimeout(() => {
        forced = true;
        child.kill();
      }, timeout);
      const fallback = setTimeout(() => resolve(false), timeout + 2000);
      child.once('close', (code) => {
        clearTimeout(timer);
        clearTimeout(fallback);
        resolve(!forced && code === 0);
      });
      if (child.stdin.writable) child.stdin.end('{"type":"shutdown"}\n');
      else child.kill();
    }).finally(() => {
      this.shutdownPromise = null;
    });
    return this.shutdownPromise;
  }
}

module.exports = { Backend };
