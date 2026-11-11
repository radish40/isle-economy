import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source = process.argv[2];
if (!source || process.argv.length !== 3) {
  console.error('Usage: npm run rules:install -- /path/to/reviewed/pet-world-rules.js');
  process.exit(2);
}
const baseline = JSON.parse(await fs.readFile(new URL('../vendor/survey-baseline.json', import.meta.url)));
const rule = await fs.readFile(source);
if (createHash('sha256').update(rule).digest('hex') !== baseline['/pet-world-rules.js'].rawHash) {
  console.error('The file does not match the reviewed legacy rules. No file was installed.');
  process.exit(1);
}
await fs.writeFile(new URL('../vendor/world-rules.mjs', import.meta.url), rule, {mode: 0o600});
console.log('Installed the reviewed legacy rules locally; the file is ignored by Git.');
