const assert = require('node:assert/strict');
const { missionMetrics } = require('../electron/mission-metrics.cjs');
const iso = ms => new Date(ms).toISOString();
const timing = (start, end) => ({startedAtMs:start,finishedAtMs:end});
// 20s overhead plus overlapping 40s/30s tasks: 60s elapsed vs 90s serial.
assert.deepEqual(missionMetrics(iso(0),iso(60000),[timing(10000,50000),timing(10000,40000)]),{elapsedMs:60000,estimatedSerialMs:90000,estimatedSavedMs:30000,agentCount:2});
// Staggered execution: only actual overlap contributes to estimated saving.
assert.equal(missionMetrics(iso(0),iso(60000),[timing(5000,30000),timing(20000,50000)]).estimatedSavedMs,10000);
// One agent and sequential tasks claim no saving.
assert.equal(missionMetrics(iso(0),iso(60000),[timing(10000,50000)]).estimatedSavedMs,0);
assert.equal(missionMetrics(iso(0),iso(60000),[timing(10000,30000),timing(30000,50000)]).estimatedSavedMs,0);
assert.equal(missionMetrics(iso(0),iso(60000),[]).estimatedSavedMs,null);
assert.equal(missionMetrics(iso(0),iso(60000),[timing(10000,70000)]).estimatedSavedMs,null);
assert.equal(missionMetrics('invalid',iso(60000)),null);
assert.equal(missionMetrics(iso(60000),iso(0)),null);
console.log('PASS: elapsed time, overlap-based savings, overhead, one agent, sequential tasks and missing/invalid timings.');
