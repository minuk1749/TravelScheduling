import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(t, rows) {
  const dir = mkdtempSync(join(tmpdir(), "travel-task-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "tasks.md");
  writeFileSync(file, rows.join("\n"));
  return (issues, prs) => {
    const paths = [issues, prs].map((items, i) => {
      const path = join(dir, i + ".json");
      writeFileSync(path, JSON.stringify(items));
      return path;
    });
    return execFileSync(process.execPath, [".github/agent/tasks.mjs", "writer", ...paths, "--file", file], { encoding: "utf8" }).trim();
  };
}

const claudeRow = "| T22 | 지도 | - | Y | 진행중 | claude | | |";
const gptRow = "| T27 | 재시도 | T22 | Y | 진행중 | gpt | | |";
const reviewRow = "| T8B | UUID | T8A | N | 리뷰 | gpt | t8b-indexed-trip-lookup | |";
const issue = (id, number) => ({ number, title: id + ": 작업", labels: [] });
const pr = (id, number, fields = {}) => ({
  ...issue(id, number), baseRefName: "develop", headRefName: id.toLowerCase() + "-local",
  isCrossRepository: false, isDraft: false, ...fields,
});

test("Claude PR의 라벨이 누락돼도 작업표의 Codex 배정만 선택한다", (t) => {
  const target = fixture(t, [claudeRow, gptRow]);
  const claims = [issue("T22", 72), issue("T27", 95)];
  assert.equal(target(claims, [pr("T22", 87)]), "T27 95 -");
  assert.equal(target(claims, [pr("T22", 87), pr("T27", 96)]), "T27 95 96");
  assert.equal(target([claims[0]], [pr("T22", 87)]), "");
});

test("리뷰 중인 수동 작업은 등록된 브랜치의 기존 PR만 수정한다", (t) => {
  const target = fixture(t, [reviewRow]);
  const claims = [issue("T8B", 91)];
  const match = pr("T8B", 90, { headRefName: "t8b-indexed-trip-lookup" });
  assert.equal(target(claims, [match]), "T8B 91 90");
  for (const prs of [[], [pr("T8B", 92)], [match, match],
    [{ ...match, isDraft: true }], [{ ...match, isCrossRepository: true }],
    [{ ...match, baseRefName: "main" }], [{ ...match, labels: [{ name: "needs-human" }] }],
    [{ ...match, labels: [{ name: "owner-claude" }] }]]) {
    assert.equal(target(claims, prs), "");
  }
  assert.equal(target([], [match]), "");
  assert.equal(target([...claims, ...claims], [match]), "");
  assert.equal(target([{ ...claims[0], labels: [{ name: "owner-claude" }] }], [match]), "");
});

test("보류 상태와 복수의 유효 배정에서는 게시하지 않는다", (t) => {
  const claims = [issue("T27", 95), issue("T8B", 91)];
  const prs = [pr("T8B", 90, { headRefName: "t8b-indexed-trip-lookup" })];
  assert.equal(fixture(t, [gptRow, reviewRow])(claims, prs), "");
  assert.equal(fixture(t, [gptRow.replace("진행중", "보류")])(claims, []), "");
});

test("T22 이후에는 앞 작업이 완료된 뒤 한 담당의 다음 작업만 열린다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "travel-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "tasks.md");
  const cli = (...args) => execFileSync(process.execPath, [".github/agent/tasks.mjs", ...args, "--file", file], { encoding: "utf8" }).trim();
  const chain = ["T27", "T28", "T24", "T25", "T29", "T26", "T30", "T26A"];
  const ids = ["T8B", "T22", "T23", ...chain];
  const rows = readFileSync("docs/tasks.md", "utf8").split("\n").filter(line => ids.includes(line.split("|")[1]?.trim()));
  writeFileSync(file, rows.join("\n"));
  const setState = (id, state) => cli("set", id, "상태=" + state);
  const ready = () => ["gpt", "claude"].map(owner => JSON.parse(cli("next", "--owner", owner)).id);
  for (const id of chain) setState(id, "대기");
  setState("T23", "완료");
  setState("T8B", "완료");
  for (const state of ["진행중", "리뷰", "보류"]) {
    setState("T22", state);
    assert.deepEqual(ready(), [undefined, undefined]);
  }
  setState("T22", "완료");
  setState("T8B", "리뷰");
  assert.deepEqual(ready(), [undefined, undefined]);
  setState("T8B", "완료");
  for (const id of chain) {
    const owner = cli("get", id, "담당");
    assert.deepEqual(ready(), owner === "gpt" ? [id, undefined] : [undefined, id]);
    setState(id, "리뷰");
    assert.deepEqual(ready(), [undefined, undefined]);
    setState(id, "완료");
  }
});
