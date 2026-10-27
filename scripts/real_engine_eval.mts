/** Local, headless engine adapter. No browser, public server, or network game.
 * Loads the pinned upstream as a runtime dependency; does not copy its source.
 * This is a small land-only adapter, not the complete Solo AggroBot planner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.OPENFRONT_SOURCE || path.join(project, 'vendor/openfrontio'));
const requireUpstream = createRequire(path.join(root, 'package.json'));
const ownRequire = createRequire(import.meta.url);
const schema7 = ownRequire('../browser/schema7.cjs');
const args = process.argv.slice(2);
function arg(name: string, fallback: string) {
  const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1];
}
const ticks = Number(arg('--ticks', '2000'));
const seed = Number(arg('--seed', '10001'));
const games = Number(arg('--games', '4'));
if (!Number.isInteger(ticks) || ticks < 50 || !Number.isInteger(games) || games < 1 || !Number.isInteger(seed)) {
  throw new Error('Need integer --ticks >=50, --games >=1, and --seed');
}
const policyPath = path.resolve(arg('--policy', path.join(project, 'dist/policy.json')));
const policy = schema7.validate(JSON.parse(fs.readFileSync(policyPath, 'utf8')));
async function upstream(name: string) {
  return import(pathToFileURL(requireUpstream.resolve(name)).href);
}
const { PlayerInfo, PlayerType } = await upstream('@openfront/engine-api/game/GameTypes');
const { EngineConfig } = await upstream('@openfront/engine/configuration/EngineConfig');
const { SpawnExecution } = await upstream('@openfront/engine/execution/SpawnExecution');
const { AttackExecution } = await upstream('@openfront/engine/execution/AttackExecution');
const { setup } = await import(pathToFileURL(path.join(root, 'tests/util/Setup.ts')).href);
const out: any[] = [];
const start = performance.now();

for (let match = 0; match < games; match++) {
  // EngineConfig, NOT TestConfig: real attack, economy, spawn, and growth rules.
  const game = await setup('plains', { bots: 0 }, [], undefined, EngineConfig, true);
  const rotation = ((seed + match) % 4 + 4) % 4;
  const corners = [[20, 20], [79, 79], [20, 79], [79, 20]];
  const players = Array.from({ length: 4 }, (_, p) => {
    const info = new PlayerInfo(p === 0 ? 'OpenFrontAI' : `Heuristic-${p}`, PlayerType.Human, null, `p${p}`);
    const player = game.addPlayer(info);
    const [x, y] = corners[(p + rotation) % 4];
    game.addExecution(new SpawnExecution(`openfront-ai-${seed}-${match}`, info, game.ref(x, y)));
    return player;
  });
  game.executeNextTick(); game.executeNextTick();
  const initialLand = players.map(p => p.numTilesOwned());
  if (initialLand.some(n => n === 0)) throw new Error('Engine failed to spawn a player');
  let neuralDecisions = 0, commands = 0, enemyCommands = 0;
  let observedNeutralExpansion = false;
  const counts: Record<string, number> = { wait: 0, expand: 0, attack: 0 };
  let previousTroops = players.map(p => p.troops());
  for (let t = 0; t < ticks; t++) {
    if (t % 20 === 0) {
      // Rotate command submission order so the learner is not always first.
      for (let offset = 0; offset < 4; offset++) {
        const p = (offset + Math.floor(t / 20) + rotation) % 4;
        const me = players[p];
        if (me.numTilesOwned() === 0 || me.outgoingAttacks().length > 0) continue;
        const groups = new Map<string, any>();
        for (const tile of me.borderTiles()) {
          for (const neighbor of game.neighbors(tile)) {
            if (!game.isLand(neighbor)) continue;
            const target = game.owner(neighbor);
            if (target.id() === me.id()) continue;
            if (target.isPlayer() && !me.canAttackPlayer(target)) continue;
            groups.set(target.id(), target);
          }
        }
        const home = Math.max(1, me.troops());
        const strongest = Math.max(0, ...Array.from(groups.values()).filter(q => q.isPlayer()).map(q => q.troops()));
        const incoming = me.incomingAttacks().reduce((sum, a) => sum + a.troops(), 0);
        const state = {
          home, troops: home, reserve: .25 * home, gold: Number(me.gold()),
          land: me.numTilesOwned(), maxLand: me.numTilesOwned(), gamePhase: Math.min(20, game.ticks() / 200),
          income: 0, enemyPressure: Math.min(1, strongest / home),
          activeWars: Array.from(groups.values()).filter(q => q.isPlayer()).length,
          frontCount: groups.size, allyPressure: 0, homeThreat: Math.min(1, incoming / home),
          nukeThreat: 0, recentLandTrend: 0,
          recentTroopTrend: Math.max(-1, Math.min(1, (home - previousTroops[p]) / Math.max(1, previousTroops[p]))),
        };
        previousTroops[p] = home;
        const branches: any[] = [{ kind: 'wait', ruleUtility: 10 + 35 * Math.max(0, Math.min(1, strongest / home - .5)),
          reserveAfter: home, expectedDefenseValue: Math.max(0, 1 - strongest / home / 2), cooldownReady: true }];
        for (const target of groups.values()) {
          for (const fraction of [.2, .5, .8]) {
            const cost = Math.floor(home * fraction);
            if (cost < 100) continue;
            const attack = target.isPlayer();
            const density = attack ? target.troops() / Math.max(1, target.numTilesOwned()) : 0;
            const possible = Math.min(6, cost / (70 + 1.2 * density));
            branches.push({ kind: attack ? 'attack' : 'expand', targetId: target.id(),
              cost, troopCommitment: cost, reserveAfter: home - cost,
              ruleUtility: attack ? 30 + 12 * possible - 30 * fraction - 30 * Math.min(2, density / home)
                                  : 65 + 6 * possible - 35 * fraction,
              targetStrength: attack ? Math.min(1, target.troops() / home) : 0,
              targetLand: possible / home, cooldownReady: true, targetReachable: true,
              isExpansion: !attack });
          }
        }
        const top = Math.max(...branches.map(b => b.ruleUtility));
        let selected = branches[0], best = -Infinity;
        for (const b of branches) {
          const value = p === 0 ? schema7.predict(policy, schema7.features(state, b, { ruleTop1: top })).branchScore : b.ruleUtility;
          if (value > best) { best = value; selected = b; }
        }
        if (p === 0) { neuralDecisions++; counts[selected.kind]++; }
        if (selected.kind !== 'wait') {
          const execution = new AttackExecution(selected.cost, me, selected.targetId);
          game.addExecution(execution);
          if (p === 0) {
            commands++;
            if (selected.kind === 'attack') enemyCommands++;
          }
        }
      }
    }
    game.executeNextTick();
    if (players[0].numTilesOwned() > initialLand[0]) observedNeutralExpansion = true;
    if (players[0].numTilesOwned() === 0 || players.filter(p => p.numTilesOwned() > 0).length <= 1) break;
  }
  out.push({ match, spawn_rotation: rotation, ticks: game.ticks(), neural_decisions: neuralDecisions,
    commands_submitted: commands, enemy_attack_commands: enemyCommands, choices: counts,
    observed_territory_growth: observedNeutralExpansion, initial_land: initialLand,
    final_land: players.map(p => p.numTilesOwned()),
    final_troops: players.map(p => p.troops()) });
}
const report = { domain: 'actual pinned OpenFront engine, headless land-only adapter',
  engine_commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  uses_real_engine_config: true, policy: policyPath, games: out.length, seed,
  decision_interval_ticks: 20, elapsed_seconds: (performance.now() - start) / 1000,
  limitations: ['plains map only', 'heuristic opponents, not built-in nations', 'no economy/naval/nuclear/diplomacy actions',
    'bounded matches may end at tick limit; not all are completed games', 'browser userscript discovery is not exercised'],
  matches: out };
const json = JSON.stringify(report, null, 2);
console.log(json);
const resultPath = args.includes('--out') ? path.resolve(arg('--out', '')) : null;
if (resultPath) { fs.mkdirSync(path.dirname(resultPath), { recursive: true }); fs.writeFileSync(resultPath, json + '\n'); }
if (!out.every(m => m.neural_decisions > 0) || !out.some(m => m.observed_territory_growth)) {
  throw new Error('Model did not demonstrate territory growth in the actual engine; inspect the report');
}
