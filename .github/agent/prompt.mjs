// Codex용 프롬프트 생성: node prompt.mjs <implement|fix> <TASK> <TITLE> <ROUND> [feedback.md]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [mode, task, title, round, feedbackFile] = process.argv.slice(2);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const fill = (s) =>
  s.replaceAll("{{TASK}}", task).replaceAll("{{TITLE}}", title).replaceAll("{{ROUND}}", round);

let out = fill(fs.readFileSync(path.join(dir, "codex-common.md"), "utf8"));
out += "\n\n" + fill(fs.readFileSync(path.join(dir, `codex-${mode}.md`), "utf8"));

if (mode === "fix") {
  let fb = "";
  if (feedbackFile && fs.existsSync(feedbackFile)) fb = fs.readFileSync(feedbackFile, "utf8").trim();
  out +=
    "\n\n## 직전 피드백\n\n" +
    (fb && fb !== "null"
      ? fb
      : "피드백 없음. 이전 실행이 중간에 중단되었을 수 있다. 완료 기준을 기준으로 현재 브랜치를 점검하고 마무리하라.");
}
process.stdout.write(out + "\n");
