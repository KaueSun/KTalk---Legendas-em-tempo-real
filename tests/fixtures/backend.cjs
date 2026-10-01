const readline = require('node:readline');
process.stdout.write('{"type":');
setTimeout(() => process.stdout.write('"ready"}\n'), 20);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'shutdown') {
    if (process.env.KTALK_TEST_SHUTDOWN_FAILURE) process.exit(7);
    setTimeout(() => {
      process.stdout.write('{"type":"caption","text":"Finalizada"}\n');
      process.exit(0);
    }, 50);
  }
  if (command.type === 'crash') process.exit(7);
});
