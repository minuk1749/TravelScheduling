// 작업별 모델 조회: node model-for.mjs <codex|claude> <TASK> [models.json 경로]
//   codex  → "모델<TAB>추론강도" 출력 (값이 없으면 빈 칸)
//   claude → "모델" 출력
//   claude-refactor → 리팩터링 수행 모델
//   claude-implement → Claude가 담당 작업을 구현할 모델
//   codex-review → Claude PR을 리뷰할 Codex "모델<TAB>추론강도"
//   claude-effort → Claude 실행(구현·리팩터링·리뷰) 추론 강도. 작업별 값이 없으면 기본값, 둘 다 없으면 빈 값(CLI 기본)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [kind, rawTask, file] = process.argv.slice(2);
// 리팩터링 작업(R1, R2, …)은 모두 "R" 항목으로 조회한다
const task = /^R[0-9]+$/.test(rawTask || "") ? "R" : rawTask;
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
} else if (kind === "codex-review") {
  const r = (cfg.codex || {}).review || {};
  process.stdout.write(`${r.model || ""}\t${r.effort || ""}\n`);
} else if (kind === "claude-implement") {
  const c = (cfg.claude || {}).implement || {};
  process.stdout.write(`${(c.tasks || {})[task] || c.default || "claude-opus-5-5"}\n`);
} else if (kind === "claude-refactor") {
  process.stdout.write(`${(cfg.claude || {}).refactor || "claude-opus-5-5"}\n`);
} else if (kind === "claude-effort") {
  const e = (cfg.claude || {}).effort || {};
  process.stdout.write(`${(e.tasks || {})[task] || e.default || ""}\n`);
} else {
  console.error("사용법: model-for.mjs <codex|codex-review|claude|claude-implement|claude-refactor|claude-effort> <TASK> [models.json]");
  process.exit(2);
}
