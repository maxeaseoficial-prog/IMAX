// Estimated serial time reuses the measured task durations and keeps all
// planning/integration/review overhead. It is not a benchmark of one agent.
function missionMetrics(startedAt, finishedAt, timings = []) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null;
  const elapsedMs = finish - start;
  const valid = timings.filter(t => Number.isFinite(t.startedAtMs) && Number.isFinite(t.finishedAtMs) &&
    t.startedAtMs >= start && t.finishedAtMs >= t.startedAtMs && t.finishedAtMs <= finish);
  if (!valid.length || valid.length !== timings.length) return { elapsedMs, estimatedSerialMs: null, estimatedSavedMs: null, agentCount: valid.length };
  const parallelMs = Math.max(...valid.map(t => t.finishedAtMs)) - Math.min(...valid.map(t => t.startedAtMs));
  const totalTaskMs = valid.reduce((sum, t) => sum + t.finishedAtMs - t.startedAtMs, 0);
  const estimatedSavedMs = Math.max(0, totalTaskMs - parallelMs);
  return { elapsedMs, estimatedSerialMs: elapsedMs + estimatedSavedMs, estimatedSavedMs, agentCount: valid.length };
}
module.exports = { missionMetrics };
