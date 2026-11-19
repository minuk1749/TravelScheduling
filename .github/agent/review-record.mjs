// The controller reads this file from develop, never from the proposed PR.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const schema = JSON.parse(readFileSync(new URL('./review-schema.json', import.meta.url), 'utf8'));
const sha = /^[0-9a-f]{40}$/;
const taskId = /^(T[0-9]+[A-Z]?|R[0-9]+)$/;

function requireValid(condition, reason) {
  if (!condition) throw new Error(reason);
}

function matches(value, rule) {
  if (rule.type === 'string') return typeof value === 'string' && (!rule.enum || rule.enum.includes(value));
  if (rule.type === 'array') return Array.isArray(value) && value.every((item) => matches(item, rule.items));
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && rule.required.every((key) => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, item]) => Object.hasOwn(rule.properties, key) && matches(item, rule.properties[key]));
}

export function validateReview(review) {
  requireValid(matches(review, schema), '리뷰 JSON 형식이 잘못됨');
  requireValid(review.summary.trim() && review.evidence.length > 0, '리뷰 근거가 비어 있음');
  requireValid(review.evidence.every(({ criterion, source, method, status }) =>
    criterion.trim() && source.trim() && ((method === 'unverified') === (status === 'unverified'))), '리뷰 근거가 잘못됨');
  if (review.verdict === 'approve') {
    requireValid(review.issues.length === 0 && review.evidence.every(({ status }) => status === 'verified'),
      '검증이 끝나지 않았거나 수정 항목이 남아 있는 승인');
  }
  if (review.verdict === 'request_changes') requireValid(review.issues.length > 0, '수정 요청에 결함 설명이 없음');
  if (review.verdict === 'needs_human') requireValid(review.evidence.some(({ status }) => status === 'unverified'),
    '사람 검토가 필요한 미확인 항목이 없음');
  return review;
}

export function validateRequest(record, expected) {
  requireValid(record && Number.isSafeInteger(record.pr) && record.pr > 0
    && Number.isSafeInteger(record.run) && record.run > 0 && Number.isSafeInteger(record.attempt) && record.attempt > 0
    && Number.isSafeInteger(record.issue) && record.issue > 0
    && sha.test(record.head) && taskId.test(record.task)
    && record.base === 'develop' && record.tests === 'passed', '테스트·리뷰 요청 기록이 잘못됨');
  requireValid(Object.entries(expected).every(([key, value]) => record[key] === value), '요청 기록이 PR·커밋·실행과 일치하지 않음');
  requireValid(record.owner === 'claude' || record.owner === 'gpt', '알 수 없는 구현 담당');
  validateReview(record.claude);
  return record;
}

export function combineReviews(record, codex) {
  validateReview(codex);
  const claude = validateReview(record.claude);
  const opinions = [claude, codex];
  const reviewers = record.owner === 'claude'
    ? ['Claude 자체 리뷰', 'Codex 교차 리뷰']
    : ['Claude 교차 리뷰', 'Codex 자체 리뷰'];
  const verdict = opinions.some((r) => r.verdict === 'request_changes') ? 'request_changes'
    : opinions.some((r) => r.verdict === 'needs_human') ? 'needs_human' : 'approve';
  return {
    verdict,
    summary: `${reviewers[0]} (${claude.verdict}): ${claude.summary}\n\n${reviewers[1]} (${codex.verdict}): ${codex.summary}`,
    issues: [...claude.issues, ...codex.issues],
    notes: opinions.map((r) => r.notes).filter(Boolean).join('\n'),
    refactor: opinions.flatMap((r) => r.refactor),
    evidence: opinions.flatMap((r, index) => r.evidence.map((entry) => ({
      ...entry, criterion: `${reviewers[index]} — ${entry.criterion}`,
    }))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, file, pr, head, run, attempt, codexFile] = process.argv.slice(2);
  const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
  try {
    let result;
    if (command === 'review') {
      result = validateReview(json(file));
    } else {
      const expected = { pr: Number(pr), head, run: Number(run), attempt: Number(attempt) };
      const record = validateRequest(json(file), expected);
      if (command === 'request') result = record;
      else if (command === 'combine') result = combineReviews(record, json(codexFile));
      else throw new Error('사용법: review-record.mjs review|request|combine');
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
