// 같은 PR 커밋에서 역할별 필수 검사가 완료된 경우에만 다음 쓰기 작업을 허용한다.
import { execFileSync } from "node:child_process";

const [repo, number, head, owner] = process.argv.slice(2);
const fields = "state,isDraft,isCrossRepository,baseRefName,headRefOid,labels,statusCheckRollup";
const pr = JSON.parse(execFileSync("gh", ["pr", "view", number, "-R", repo, "--json", fields], { encoding: "utf8" }));

if (pr.state !== "OPEN" || pr.isDraft || pr.isCrossRepository || pr.baseRefName !== "develop" ||
    pr.headRefOid !== head || pr.labels.some(label => label.name === "needs-human")) {
  throw new Error("PR 상태 또는 대상 커밋이 달라 자동 처리를 중단합니다.");
}
if (!["gpt", "claude"].includes(owner)) throw new Error("구현 담당을 확인할 수 없습니다.");

const checks = [["ci", "check"], ["agent-review", "gate"], ["agent-review", "test"],
  ["agent-review", "review"], ["agent-review", "decide"]];
for (const [workflow, name] of checks) {
  const jobs = pr.statusCheckRollup.filter(job => job.workflowName === workflow && job.name === name);
  // Claude 구현분의 교차 리뷰는 Mac에서 실행한다. 이 경우에만 GitHub의 Claude 리뷰 잡을 건너뛴다.
  const valid = owner === "claude" && name === "review" ? ["SUCCESS", "SKIPPED"] : ["SUCCESS"];
  if (!jobs.length || jobs.some(job => job.status !== "COMPLETED" || !valid.includes(job.conclusion))) {
    throw new Error(workflow + "/" + name + " 통과 기록이 없어 자동 처리를 중단합니다.");
  }
}
