// CI dependency-audit gate.
//
// Why a script rather than a raw `pnpm audit --audit-level high`: a single
// unfixable high finding would permanently red-light the job — the classic
// pressure to just delete the gate. pnpm can mute an advisory
// (`auditConfig.ignoreGhsas`), but a mute carries no reason and never expires,
// so it silently outlives the premise it was granted on. This script keeps the
// gate hard (any high/critical fails the build) while allowing a *documented,
// dated* exception per advisory, and it actively nags when an exception has
// gone stale (the advisory is no longer present, so the entry should be
// removed) or has passed its review date. Dependency-free on purpose: adding an
// audit tool would add its own dependency tree — and its own audit surface.
//
// Usage: node .github/scripts/audit-gate.mjs <path-to-pnpm-audit-json>
// The JSON is the output of `pnpm audit --json`, run at the workspace root:
// one object whose `advisories` map is keyed by the registry's advisory id.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const KNOWN_SEVERITIES = new Set([
  'info',
  'low',
  'moderate',
  'high',
  'critical',
]);

// Advisories consciously accepted, with the rationale in-line so the next
// reader (or auditor) sees *why* without digging through git history. Match is
// by GitHub advisory id, CVE, or the registry's numeric id — whichever the
// tooling reports. Keep `reviewBy` realistic: once it passes, the gate warns so
// the exception gets re-justified rather than silently outliving its reason.
//
// EMPTY BY DEFAULT, and it should stay that way as long as possible. An
// allowlist entry is the LAST rung of the ladder, not the first:
//
//   1. `pnpm update <parent>` — most advisories are satisfied by a version the
//      parent's declared range ALREADY permits, i.e. the lockfile is stale
//      rather than the upstream constraint being real. Costs nothing and
//      leaves package.json untouched.
//   2. An `overrides` entry in pnpm-workspace.yaml — only when a parent
//      genuinely pins a vulnerable range. Note next to it when it can be
//      removed. The notes live here, beside the gate they serve:
//        - `qs ^6.17.1` — in range for every parent (express, twilio); only
//          refreshes a stale lockfile. Remove once the lockfile resolves >=6.17.1
//          without it.
//        - `gaxios@7.1.3 → 7.1.4` — gcp-metadata 8.1.4 (under
//          @opentelemetry/auto-instrumentations-node) pins gaxios exactly
//          7.1.3, whose unused `rimraf` dependency drags in vulnerable
//          glob/minimatch; 7.1.4 dropped it. Remove once gcp-metadata depends
//          on gaxios >=7.1.4.
//        - `deepmerge-ts ^8.0.2` — see the note above the blocking step in
//          .github/workflows/security.yml.
//   3. An entry here — only when NO compatible patched version exists at all
//      (e.g. the only fix is ESM-only on a CJS require chain).
//
// Diagnose which rung you are on with:
//   pnpm audit --audit-level high          → module, vulnerable versions, paths
//   pnpm why <package>                      → which parent pulls it in
//   npm view <parent> dependencies.<pkg>    → does its range allow the fix?
//
// Shape of an entry:
//
//   {
//     ids: ['GHSA-xxxx-xxxx-xxxx', 'CVE-2026-00000', '1234567'],
//     package: 'some-package',
//     reason:
//       'What the vulnerability is, why no upgrade path exists, and why it is ' +
//       'not exploitable in THIS codebase. Be specific — "low risk" is not a ' +
//       'rationale.',
//     reviewBy: '2026-12-31',
//   }
// Empty by default, and worth keeping that way: an entry's premise expires. A
// backport can land on a maintenance line the consumer's declared range already
// permits, at which point the lockfile was stale rather than the constraint
// real, and a refresh clears the advisory outright — rung 1 of the ladder above.
// That is why every entry carries a review date.
export const ALLOWLISTED_ADVISORIES = [];

/**
 * Applies the gate to a parsed `pnpm audit --json` report. Pure, so the
 * decision is testable without running an audit.
 *
 * @returns {{ accepted: object[], unaccepted: object[], stale: object[] }}
 */
export function evaluateAuditReport(report, allowlist) {
  // An unreadable or degraded report must never read as "no findings".
  if (
    report === null ||
    typeof report !== 'object' ||
    report.advisories === null ||
    typeof report.advisories !== 'object' ||
    Array.isArray(report.advisories)
  ) {
    throw new Error('audit-gate: the report has no `advisories` object');
  }
  if (!(report.metadata?.totalDependencies > 0)) {
    throw new Error(
      'audit-gate: the report audited no dependencies — the audit did not really run',
    );
  }

  const advisories = Object.values(report.advisories).map((advisory) => {
    const severity = String(advisory.severity ?? '').toLowerCase();
    if (!KNOWN_SEVERITIES.has(severity)) {
      throw new Error(
        `audit-gate: unknown severity "${advisory.severity}" on ${advisory.module_name}`,
      );
    }
    return { ...advisory, severity };
  });

  // The report's own tally must agree with the advisories it lists, or part
  // of the report was lost on the way here.
  const reportedBlockingCount = [...BLOCKING_SEVERITIES].reduce(
    (total, severity) =>
      total + (report.metadata.vulnerabilities?.[severity] ?? 0),
    0,
  );
  const listedBlockingCount = advisories.filter((advisory) =>
    BLOCKING_SEVERITIES.has(advisory.severity),
  ).length;
  if (reportedBlockingCount > 0 && listedBlockingCount === 0) {
    throw new Error(
      `audit-gate: the report counts ${reportedBlockingCount} high/critical ` +
        'finding(s) but lists none',
    );
  }

  const blockingAdvisories = advisories
    .filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity))
    .map((advisory) => ({
      severity: advisory.severity,
      package: advisory.module_name,
      identifiers: [
        advisory.github_advisory_id,
        String(advisory.id),
        ...(advisory.cves ?? []),
      ].filter(Boolean),
    }));

  const accepted = [];
  const unaccepted = [];
  for (const advisory of blockingAdvisories) {
    const allowlistEntry = allowlist.find((entry) =>
      advisory.identifiers.some((identifier) => entry.ids.includes(identifier)),
    );
    if (allowlistEntry) {
      accepted.push({ advisory, allowlistEntry });
    } else {
      unaccepted.push(advisory);
    }
  }

  // A stale allowlist entry (its advisory no longer appears) is a smell: the
  // exception outlived the vulnerability. Surfaced, but it does not fail the
  // build on its own — the entry is harmless until someone prunes it.
  const stale = allowlist.filter(
    (entry) => !accepted.some(({ allowlistEntry }) => allowlistEntry === entry),
  );

  return { accepted, unaccepted, stale };
}

function main(auditJsonPath) {
  if (!auditJsonPath) {
    console.error('audit-gate: missing path to pnpm audit JSON output');
    return 2;
  }

  const { accepted, unaccepted, stale } = evaluateAuditReport(
    JSON.parse(readFileSync(auditJsonPath, 'utf8')),
    ALLOWLISTED_ADVISORIES,
  );

  const today = new Date().toISOString().slice(0, 10);
  for (const { advisory, allowlistEntry } of accepted) {
    const reviewNote =
      allowlistEntry.reviewBy < today
        ? ' (REVIEW OVERDUE — re-justify or remove)'
        : '';
    console.log(
      `audit-gate: allowing ${advisory.severity} ${advisory.package} ` +
        `[${allowlistEntry.ids.join(', ')}] until ${allowlistEntry.reviewBy}${reviewNote}`,
    );
  }

  for (const staleEntry of stale) {
    console.log(
      `audit-gate: allowlist entry for ${staleEntry.package} [${staleEntry.ids.join(', ')}] ` +
        `no longer matches any finding — remove it from audit-gate.mjs`,
    );
  }

  if (unaccepted.length > 0) {
    console.error(
      `\naudit-gate: ${unaccepted.length} un-allowlisted high/critical ` +
        `advisory(ies) — failing the build:`,
    );
    for (const advisory of unaccepted) {
      console.error(
        `  - ${advisory.severity} ${advisory.package} [${advisory.identifiers.join(', ')}]`,
      );
    }
    console.error(
      '\nFix by upgrading (prefer an in-range parent bump over an override), ' +
        'or, only if genuinely unfixable, add a documented+dated entry to ' +
        'ALLOWLISTED_ADVISORIES in this file.',
    );
    return 1;
  }

  console.log('\naudit-gate: no un-allowlisted high/critical advisories. OK.');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv[2]));
}
