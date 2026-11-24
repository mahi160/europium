import { existsSync } from 'node:fs';
import { openDatabase } from './src/database';
import { snapshot, verifyDatabase } from './src/maintenance';

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  process.stderr.write(
    'Usage: office-api [migrate <database> | snapshot <database> <destination>]\n',
  );
  process.exit(2);
}

try {
  if (!command) {
    await import('./src/server');
  } else if (command === 'migrate' && args.length === 1) {
    const [path] = args;
    if (!existsSync(path)) throw new Error(`Database not found: ${path}`);
    openDatabase(path, { migrate: true }).sqlite.close();
    verifyDatabase(path);
  } else if (command === 'snapshot' && args.length === 2) {
    snapshot(args[0], args[1]);
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
