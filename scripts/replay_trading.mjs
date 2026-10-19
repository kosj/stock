/** Node >=22.18: same engine as production, no TS compiler or live database needed.
 * Usage: node scripts/replay_trading.mjs snapshots.json > replay-result.json
 * Input schema: frontend/lib/core/replay.ts (ReplayInput).
 */
import { readFile } from "node:fs/promises";
import { replayTrading } from "../frontend/lib/core/replay.ts";
if (!process.argv[2]) throw new Error("Usage: node scripts/replay_trading.mjs snapshots.json");
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
// Keep stdout machine-readable; engine diagnostics go to stderr.
console.log = (...args) => console.error(...args);
const result = await replayTrading(input);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
