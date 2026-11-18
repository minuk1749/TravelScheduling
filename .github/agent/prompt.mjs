// 작업 이슈 본문 생성: node prompt.mjs <TASK> <TITLE>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [task, title] = process.argv.slice(2);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
const out = (read("codex-common.md") + "\n" + read("quality.md")).replaceAll("{{TASK}}", task).replaceAll("{{TITLE}}", title);
process.stdout.write(out);
