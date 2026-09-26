// Runs the silentfail pipeline once and prints wall time and peak memory as JSON.
import { run } from '../../src/run.js';

let peak = process.memoryUsage().rss;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
const start = Date.now();
const result = await run({ days: 3650 });
clearInterval(timer);
peak = Math.max(peak, process.memoryUsage().rss);
process.stdout.write(JSON.stringify({ ms: Date.now() - start, peakRss: peak, badLines: result.stats.badLines }));
