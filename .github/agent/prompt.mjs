// 작업 이슈 본문 생성: node prompt.mjs <TASK> <TITLE>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [task, title] = process.argv.slice(2);
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "codex-common.md");
const out = fs.readFileSync(file, "utf8").replaceAll("{{TASK}}", task).replaceAll("{{TITLE}}", title);
process.stdout.write(out);
