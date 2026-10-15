const readline = require('node:readline');
if (process.env.KTALK_TEST_HANG) setInterval(() => {}, 1000);
process.stdout.write('{"type":');
setTimeout(() => process.stdout.write('"ready"}\n'), 20);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'shutdown') {
    if (process.env.KTALK_TEST_HANG) return;
    if (process.env.KTALK_TEST_SHUTDOWN_FAILURE) process.exit(7);
    setTimeout(() => {
      process.stdout.write('{"type":"caption","text":"Finalizada"}\n');
      process.exit(0);
    }, 50);
  }
  if (command.type === 'crash') process.exit(7);
  if (command.type === 'malformed') {
    process.stdout.write('null\n42\n[]\n"noise"\n{"type":null}\nnot-json\n{"type":"pong"}\n');
  }
});
