// tests/runner-a.js — Runner Livello A (unit test backend Apps Script)
//
// Esegue tutti i test JSON in tests/data/a-*.json contro Apps Script.
// Ogni test: setup → steps → cleanup. Nessun modello coinvolto.

const fs = require('fs');
const path = require('path');
const {
  resolvePlaceholders,
  callAppsScript,
  runAssertions,
  safeCancelByEventId,
} = require('./utils.cjs');

const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');
const BATCH_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTORS: mappa "action" di JSON → chiamata Apps Script
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_EXECUTORS = {
  check_availability: (params) => callAppsScript({ action: 'check_availability', ...params }),
  create_reservation: (params) => callAppsScript({ source: 'test', forceNew: true, ...params }),
  find_reservation:   (params) => callAppsScript({ action: 'find_reservation', ...params }),
  update_reservation: (params) => callAppsScript({ action: 'update_reservation', ...params }),
  cancel_reservation: (params) => callAppsScript({ action: 'cancel_reservation', ...params }),
  request_event:      (params) => callAppsScript({ action: 'request_event', ...params }),
  get_restaurant_info:(params) => callAppsScript({ action: 'get_restaurant_info', ...(params || {}) }),
};

// ─────────────────────────────────────────────────────────────────────────────
// RUN SINGLE TEST
// ─────────────────────────────────────────────────────────────────────────────

async function runTest(test) {
  const startedAt = Date.now();
  const ctx = {}; // variables saved between steps
  const artifacts = []; // eventIds da pulire in caso di errore
  const stepResults = [];
  let status = 'passed';
  let failReason = null;

  const record = (msg) => stepResults.push(msg);

  // SETUP
  try {
    for (let i = 0; i < (test.setup || []).length; i++) {
      const raw = test.setup[i];
      const step = resolvePlaceholders(raw, ctx);
      const exec = ACTION_EXECUTORS[step.action];
      if (!exec) throw new Error(`unknown action '${step.action}' in setup[${i}]`);
      const result = await exec(step.params || step);
      if (step.save) {
        for (const [k, srcPath] of Object.entries(step.save)) {
          const val = srcPath.split('.').reduce((a, s) => a?.[s], result);
          if (val !== undefined) ctx[k] = val;
        }
      }
      if (step.action === 'create_reservation' && result?.eventId) artifacts.push(result.eventId);
      record(`  setup[${i}] ${step.action}: ok`);
    }
  } catch (e) {
    status = 'failed';
    failReason = `setup error: ${e?.message || e}`;
  }

  // STEPS (solo se setup OK)
  if (status === 'passed') {
    for (let i = 0; i < (test.steps || []).length; i++) {
      const raw = test.steps[i];
      const step = resolvePlaceholders(raw, ctx);
      const exec = ACTION_EXECUTORS[step.action];
      if (!exec) {
        status = 'failed';
        failReason = `unknown action '${step.action}' in steps[${i}]`;
        break;
      }
      let result;
      try {
        result = await exec(step.params || {});
      } catch (e) {
        status = 'failed';
        failReason = `steps[${i}] ${step.action} threw: ${e?.message || e}`;
        break;
      }
      // Save variables
      if (step.save) {
        for (const [k, srcPath] of Object.entries(step.save)) {
          const val = srcPath.split('.').reduce((a, s) => a?.[s], result);
          if (val !== undefined) ctx[k] = val;
        }
      }
      // Track created reservations for cleanup
      if (step.action === 'create_reservation' && result?.eventId) artifacts.push(result.eventId);

      // Assertions
      const errors = runAssertions(result, step.assert || []);
      if (errors.length > 0) {
        status = 'failed';
        failReason = `steps[${i}] ${step.action}: ${errors.join('; ')} | actual=${JSON.stringify(result).substring(0, 300)}`;
        break;
      }
      record(`  steps[${i}] ${step.action}: ok`);
    }
  }

  // CLEANUP (best-effort, sempre eseguito)
  const cleanupSteps = test.cleanup || [];
  for (const raw of cleanupSteps) {
    try {
      const step = resolvePlaceholders(raw, ctx);
      const exec = ACTION_EXECUTORS[step.action];
      if (exec) await exec(step.params || {});
    } catch { /* best-effort */ }
  }
  // Extra safety: cancella tutti gli eventId tracciati che non sono già stati puliti
  for (const eid of artifacts) {
    await safeCancelByEventId(eid);
  }

  return {
    id: test.id,
    category: test.category,
    description: test.description,
    status,
    failReason,
    duration: Date.now() - startedAt,
    stepResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('▶ Runner A — Backend unit tests');
  console.log(`  Apps Script URL: ${process.env.APPS_SCRIPT_URL?.substring(0, 60)}...`);

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('a-') && f.endsWith('.json'))
    .sort();

  const allTests = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    for (const t of arr) allTests.push({ ...t, _sourceFile: f });
  }
  console.log(`  ${allTests.length} tests found in ${files.length} files\n`);

  const results = [];
  for (let i = 0; i < allTests.length; i++) {
    const t = allTests[i];
    process.stdout.write(`  [${String(i+1).padStart(3,'0')}/${allTests.length}] ${t.id} ${t.category}... `);
    const r = await runTest(t);
    results.push(r);
    console.log(r.status === 'passed' ? `✓ ${r.duration}ms` : `✗ ${r.duration}ms`);
  }

  // Genera report MD in batch da 50
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeBatchReports('a', results, BATCH_SIZE);
  writeSummary('a', results);

  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.length - passed;
  console.log(`\n▶ Runner A finito: ${passed}/${results.length} passati, ${failed} falliti`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT WRITERS
// ─────────────────────────────────────────────────────────────────────────────

function writeBatchReports(prefix, results, batchSize) {
  const totalBatches = Math.ceil(results.length / batchSize);
  for (let b = 0; b < totalBatches; b++) {
    const slice = results.slice(b * batchSize, (b + 1) * batchSize);
    const passed = slice.filter(r => r.status === 'passed');
    const failed = slice.filter(r => r.status !== 'passed');
    const start = b * batchSize + 1;
    const end = b * batchSize + slice.length;
    const filename = `latest-${prefix}-batch-${String(b + 1).padStart(2, '0')}.md`;

    let md = `# Batch ${prefix.toUpperCase()}-${String(b + 1).padStart(2, '0')} (tests ${start}-${end})\n`;
    md += `Run: ${new Date().toISOString()} | Total: ${slice.length} | Passed: ${passed.length} (${Math.round(passed.length / slice.length * 100)}%) | Failed: ${failed.length}\n\n`;

    if (passed.length > 0) {
      md += `## ✅ Passed (${passed.length})\n\n`;
      for (const r of passed) {
        md += `- **${r.id}** \`${r.category}\`: ${r.description} (${r.duration}ms)\n`;
      }
      md += '\n';
    }

    if (failed.length > 0) {
      md += `## ❌ Failed (${failed.length})\n\n`;
      for (const r of failed) {
        md += `### ${r.id} — \`${r.category}\`\n`;
        md += `**Description**: ${r.description}\n\n`;
        md += `**Reason**: ${r.failReason}\n\n`;
        md += `**Duration**: ${r.duration}ms\n\n`;
        if (r.stepResults.length) {
          md += `**Steps executed**:\n\`\`\`\n${r.stepResults.join('\n')}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
      }
    }

    fs.writeFileSync(path.join(REPORTS_DIR, filename), md);
  }
}

function writeSummary(prefix, results) {
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.length - passed;
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0, failed: 0 };
    byCategory[r.category].total++;
    if (r.status === 'passed') byCategory[r.category].passed++;
    else byCategory[r.category].failed++;
  }

  let md = `# Summary — Runner ${prefix.toUpperCase()}\n`;
  md += `Run: ${new Date().toISOString()}\n\n`;
  md += `**Total**: ${results.length} | **Passed**: ${passed} (${Math.round(passed / results.length * 100 || 0)}%) | **Failed**: ${failed}\n\n`;
  md += `## By category\n\n`;
  md += `| Category | Total | Passed | Failed | Pass rate |\n|---|---|---|---|---|\n`;
  for (const [cat, s] of Object.entries(byCategory).sort()) {
    const rate = Math.round(s.passed / s.total * 100);
    md += `| \`${cat}\` | ${s.total} | ${s.passed} | ${s.failed} | ${rate}% |\n`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, `summary-${prefix}.md`), md);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
