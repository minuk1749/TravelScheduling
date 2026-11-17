// docs/tasks.md 표를 읽고 쓰는 도구 (외부 의존 없음)
//   node tasks.mjs next  [file]                 → 다음 자동 작업 {"id","title"} 또는 {}
//   node tasks.mjs title <ID> [file]            → 작업 제목
//   node tasks.mjs set <ID> 열=값 ... [--file f] → 해당 행 갱신
import fs from "node:fs";

const COLS = ["#", "작업", "선행", "자동", "상태", "담당", "브랜치", "PR"];

function load(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const rows = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\|\s*(T\d+[A-Z]?)\s*\|/);
    if (!m) return;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== COLS.length) {
      throw new Error(`${file}:${i + 1} 열 개수가 ${COLS.length}개가 아님`);
    }
    rows.push({ line: i, cells });
  });
  return { lines, rows };
}

const get = (row, col) => row.cells[COLS.indexOf(col)];

function next(file) {
  const { rows } = load(file);
  const done = new Set(rows.filter((r) => get(r, "상태") === "완료").map((r) => get(r, "#")));
  const pick = rows.find((r) => {
    if (get(r, "상태") !== "대기" || get(r, "자동") !== "Y") return false;
    const deps = get(r, "선행").split(",").map((d) => d.trim()).filter((d) => d && d !== "-");
    return deps.every((d) => done.has(d));
  });
  return pick ? { id: get(pick, "#"), title: get(pick, "작업") } : {};
}

function set(file, id, pairs) {
  const { lines, rows } = load(file);
  const row = rows.find((r) => get(r, "#") === id);
  if (!row) throw new Error(`작업 ${id} 없음`);
  for (const p of pairs) {
    const eq = p.indexOf("=");
    const col = p.slice(0, eq);
    const idx = COLS.indexOf(col);
    if (eq < 0 || idx < 0) throw new Error(`잘못된 인자: ${p}`);
    row.cells[idx] = p.slice(eq + 1).replace(/\|/g, "/");
  }
  lines[row.line] = `| ${row.cells.join(" | ")} |`;
  fs.writeFileSync(file, lines.join("\n"));
}

const [cmd, ...args] = process.argv.slice(2);
const fileFlag = args.indexOf("--file");
let file = "docs/tasks.md";
if (fileFlag >= 0) {
  file = args[fileFlag + 1];
  args.splice(fileFlag, 2);
}

if (cmd === "next") {
  console.log(JSON.stringify(next(args[0] ?? file)));
} else if (cmd === "title") {
  const { rows } = load(args[1] ?? file);
  const row = rows.find((r) => get(r, "#") === args[0]);
  if (!row) throw new Error(`작업 ${args[0]} 없음`);
  console.log(get(row, "작업"));
} else if (cmd === "set") {
  set(file, args[0], args.slice(1));
} else {
  console.error("사용법: tasks.mjs next|title|set");
  process.exit(2);
}
