// 작업별 모델 조회: node model-for.mjs <codex|claude> <TASK> [models.json 경로]
//   codex  → "모델<TAB>추론강도" 출력 (값이 없으면 빈 칸)
//   claude → "모델" 출력
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [kind, task, file] = process.argv.slice(2);
const src = file || path.join(path.dirname(fileURLToPath(import.meta.url)), "models.json");
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(src, "utf8"));
} catch {
  // 설정이 없거나 깨졌으면 빈 값 → 호출 쪽 기본값 사용
}

if (kind === "codex") {
  const c = cfg.codex || {};
  const merged = { ...(c.default || {}), ...((c.tasks || {})[task] || {}) };
  process.stdout.write(`${merged.model || ""}\t${merged.effort || ""}\n`);
} else if (kind === "claude") {
  const c = cfg.claude || {};
  process.stdout.write(`${(c.tasks || {})[task] || c.default || ""}\n`);
} else {
  console.error("사용법: model-for.mjs <codex|claude> <TASK> [models.json]");
  process.exit(2);
}
