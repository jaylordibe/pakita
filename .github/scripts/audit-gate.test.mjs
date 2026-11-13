// Run with: pnpm test:scripts (node --test, from the workspace root)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateAuditReport } from './audit-gate.mjs';

// The shape `pnpm audit --json` emits, reduced to the fields the gate reads.
function reportWith(...advisories) {
  const vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const advisory of advisories) {
    const severity = String(advisory.severity).toLowerCase();
    if (severity in vulnerabilities) vulnerabilities[severity] += 1;
  }
  return {
    advisories: Object.fromEntries(
      advisories.map((advisory) => [String(advisory.id), advisory]),
    ),
    metadata: { vulnerabilities, totalDependencies: 1167 },
  };
}

const highAdvisory = {
  id: 1000001,
  github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
  cves: ['CVE-2026-11111'],
  severity: 'high',
  module_name: 'vulnerable-package',
};

test('fails on an un-allowlisted high advisory', () => {
  const result = evaluateAuditReport(reportWith(highAdvisory), []);
  assert.equal(result.unaccepted.length, 1);
  assert.equal(result.unaccepted[0].package, 'vulnerable-package');
});

test('fails on a critical advisory', () => {
  const result = evaluateAuditReport(
    reportWith({ ...highAdvisory, severity: 'critical' }),
    [],
  );
  assert.equal(result.unaccepted.length, 1);
});

test('ignores moderate and low advisories', () => {
  const result = evaluateAuditReport(
    reportWith(
      { ...highAdvisory, id: 1, severity: 'moderate' },
      { ...highAdvisory, id: 2, severity: 'low' },
    ),
    [],
  );
  assert.deepEqual(result.unaccepted, []);
});

test('accepts an allowlisted advisory, matched by any of its identifiers', () => {
  for (const identifier of [
    'GHSA-aaaa-bbbb-cccc',
    'CVE-2026-11111',
    '1000001',
  ]) {
    const allowlistEntry = {
      ids: [identifier],
      package: 'vulnerable-package',
      reason: 'test',
      reviewBy: '2099-01-01',
    };
    const result = evaluateAuditReport(reportWith(highAdvisory), [
      allowlistEntry,
    ]);
    assert.deepEqual(result.unaccepted, [], identifier);
    assert.equal(result.accepted.length, 1, identifier);
    assert.deepEqual(result.stale, [], identifier);
  }
});

test('reports an allowlist entry that no longer matches any finding as stale', () => {
  const staleEntry = {
    ids: ['GHSA-zzzz-zzzz-zzzz'],
    package: 'fixed-package',
    reason: 'test',
    reviewBy: '2099-01-01',
  };
  const result = evaluateAuditReport(reportWith(), [staleEntry]);
  assert.deepEqual(result.stale, [staleEntry]);
});

test('refuses a report with no advisories object instead of passing it', () => {
  for (const unreadable of [
    null,
    {},
    { advisories: null },
    { advisories: [] },
    'not json',
  ]) {
    assert.throws(() => evaluateAuditReport(unreadable, []), /no `advisories`/);
  }
});

test('refuses a report that audited no dependencies', () => {
  const report = { ...reportWith(), metadata: { totalDependencies: 0 } };
  assert.throws(() => evaluateAuditReport(report, []), /no dependencies/);
});

test('treats severity case-insensitively and refuses an unknown severity', () => {
  const upperCase = evaluateAuditReport(
    reportWith({ ...highAdvisory, severity: 'HIGH' }),
    [],
  );
  assert.equal(upperCase.unaccepted.length, 1);
  assert.throws(
    () =>
      evaluateAuditReport(
        reportWith({ ...highAdvisory, severity: 'severe' }),
        [],
      ),
    /unknown severity/,
  );
});

test('refuses a report whose tally counts findings it does not list', () => {
  const report = reportWith();
  report.metadata.vulnerabilities.high = 2;
  assert.throws(() => evaluateAuditReport(report, []), /lists none/);
});
