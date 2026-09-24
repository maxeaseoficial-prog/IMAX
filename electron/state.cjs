const fs = require("node:fs");
const path = require("node:path");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

class AppState {
  constructor(userDataDir) {
    this.settingsFile = path.join(userDataDir, "settings.json");
    this.missionsFile = path.join(userDataDir, "missions.json");
  }

  getSettings() {
    return {
      workspace: "",
      agentCount: 4,
      autoEdit: true,
      ...readJson(this.settingsFile, {})
    };
  }

  setSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    writeJson(this.settingsFile, next);
    return next;
  }

  listMissions() {
    return readJson(this.missionsFile, []);
  }

  upsertMission(mission) {
    const history = this.listMissions();
    const safeMission = JSON.parse(JSON.stringify(mission));
    const index = history.findIndex((item) => item.id === mission.id);

    if (index >= 0) {
      history[index] = safeMission;
    } else {
      history.unshift(safeMission);
    }

    const trimmed = history
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, 50);

    writeJson(this.missionsFile, trimmed);
    return safeMission;
  }
}

module.exports = { AppState };
