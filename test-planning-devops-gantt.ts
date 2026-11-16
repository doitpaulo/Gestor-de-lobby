import assert from 'node:assert/strict';
import http from 'node:http';
import app from './api/index.ts';
import {
  DEFAULT_PLANNING_CONFIG,
  addCalendarDaysIso,
  applyPlanningFieldChange,
  calculateBusinessHoursBetween,
  calculateEndDateFromHours,
  countBusinessDaysBetween,
  formatHoursAsDuration,
  getTaskPlanningMetrics,
  isBusinessDay,
  isTaskOverdue,
  parseCivilDateStrict,
  parsePlanningDurationInput
} from './services/planningUtils.ts';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

tests.push(
  test('1. Business-day validation & week-end skipping', () => {
    assert.equal(isBusinessDay('2026-11-16'), true); // Monday
    assert.equal(isBusinessDay('2026-11-20'), true); // Friday
    assert.equal(isBusinessDay('2026-11-21'), false); // Saturday
    assert.equal(isBusinessDay('2026-11-22'), false); // Sunday
    assert.equal(parseCivilDateStrict('2026-02-30'), null);
    assert.equal(parseCivilDateStrict('2026-13-01'), null);
  }),

  test('2. Scenario A exact examples (Dates -> Business Hours at 8h/day)', () => {
    const r1 = calculateBusinessHoursBetween('2026-11-16', '2026-11-16');
    assert.equal(r1.valid, true);
    assert.equal(r1.businessDays, 1);
    assert.equal(r1.hours, 8);

    const r2 = calculateBusinessHoursBetween('2026-11-16', '2026-11-17');
    assert.equal(r2.valid, true);
    assert.equal(r2.businessDays, 2);
    assert.equal(r2.hours, 16);

    const r3 = calculateBusinessHoursBetween('2026-11-16', '2026-11-20');
    assert.equal(r3.valid, true);
    assert.equal(r3.businessDays, 5);
    assert.equal(r3.hours, 40);

    const r4 = calculateBusinessHoursBetween('2026-11-16', '2026-11-23');
    assert.equal(r4.valid, true);
    assert.equal(r4.businessDays, 6);
    assert.equal(r4.hours, 48);
  }),

  test('3. Scenario B exact examples (Start + Hours -> End Date skipping weekends)', () => {
    const e1 = calculateEndDateFromHours('2026-11-16', 24);
    assert.equal(e1.valid, true);
    assert.equal(e1.businessDays, 3);
    assert.equal(e1.endDate, '2026-11-18');

    const e2 = calculateEndDateFromHours('2026-11-16', 8);
    assert.equal(e2.endDate, '2026-11-16');

    const e3 = calculateEndDateFromHours('2026-11-16', 48);
    assert.equal(e3.endDate, '2026-11-23');

    // Decimal hours
    const eDec1 = calculateEndDateFromHours('2026-11-16', 12.5);
    assert.equal(eDec1.valid, true);
    assert.equal(eDec1.businessDays, 2);
    assert.equal(eDec1.endDate, '2026-11-17');

    const eDec2 = calculateEndDateFromHours('2026-11-16', 4.5);
    assert.equal(eDec2.businessDays, 1);
    assert.equal(eDec2.endDate, '2026-11-16');
  }),

  test('4. Configurable workday hours & future holidays support', () => {
    const cfg = { hoursPerDay: 6, workingDays: [1, 2, 3, 4, 5], holidays: ['2026-11-18'] };
    const hrs = calculateBusinessHoursBetween('2026-11-16', '2026-11-20', cfg);
    // Mon(16), Tue(17), [Wed 18 holiday], Thu(19), Fri(20) = 4 days * 6h = 24h
    assert.equal(hrs.businessDays, 4);
    assert.equal(hrs.hours, 24);

    // 18h starting Mon 16 at 6h/day skipping Wed 18 => Mon(16), Tue(17), Thu(19) -> 2026-11-19
    const end = calculateEndDateFromHours('2026-11-16', 18, cfg);
    assert.equal(end.endDate, '2026-11-19');
  }),

  test('5. Invalid dates and negative hours rejected safely', () => {
    const invDates = calculateBusinessHoursBetween('2026-11-20', '2026-11-16');
    assert.equal(invDates.valid, false);
    assert.ok(invDates.error);

    const negHours = calculateEndDateFromHours('2026-11-16', -8);
    assert.equal(negHours.valid, false);
    assert.ok(negHours.error);

    const negInput = parsePlanningDurationInput('-4h');
    assert.equal(negInput.valid, false);

    const badFormat = parsePlanningDurationInput('abc');
    assert.equal(badFormat.valid, false);
  }),

  test('6. Bidirectional form transitions without circular loops or actualTime mutation', () => {
    // User enters startDate + endDate -> calculates estimatedTime, leaves actualTime intact
    let state = { startDate: '2026-11-16', endDate: '', estimatedTime: '', actualTime: '3h' };
    let out = applyPlanningFieldChange(state, 'endDate', '2026-11-23', DEFAULT_PLANNING_CONFIG);
    assert.equal(out.nextState.estimatedTime, '48h');
    assert.equal(out.nextState.actualTime, '3h');
    assert.equal(out.driver, 'dates');

    // User switches to editing estimatedTime -> keeps startDate, updates endDate, preserves actualTime
    out = applyPlanningFieldChange(out.nextState, 'estimatedTime', '24h', DEFAULT_PLANNING_CONFIG, out.driver);
    assert.equal(out.nextState.startDate, '2026-11-16');
    assert.equal(out.nextState.endDate, '2026-11-18');
    assert.equal(out.nextState.actualTime, '3h');
    assert.equal(out.driver, 'hours');

    // User edits actualTime -> NEVER changes startDate, endDate, or estimatedTime
    const afterAct = applyPlanningFieldChange(out.nextState, 'actualTime', '10.5h', DEFAULT_PLANNING_CONFIG, out.driver);
    assert.equal(afterAct.nextState.startDate, '2026-11-16');
    assert.equal(afterAct.nextState.endDate, '2026-11-18');
    assert.equal(afterAct.nextState.estimatedTime, '24h');
    assert.equal(afterAct.nextState.actualTime, '10.5h');

    // User shifts startDate while driver === 'hours' -> preserves 24h and shifts endDate
    const shifted = applyPlanningFieldChange(afterAct.nextState, 'startDate', '2026-11-19', DEFAULT_PLANNING_CONFIG, afterAct.driver);
    assert.equal(shifted.nextState.estimatedTime, '24h');
    // Thu(19), Fri(20), Mon(23)
    assert.equal(shifted.nextState.endDate, '2026-11-23');
    assert.equal(shifted.nextState.actualTime, '10.5h');
  }),

  test('7. Gantt metrics, overdue detection, and date shift helper', () => {
    const overdueTask = {
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      estimatedTime: '40h',
      actualTime: '12.5h',
      status: 'Em Progresso'
    };
    const m1 = getTaskPlanningMetrics(overdueTask, '2026-11-16');
    assert.equal(m1.businessDays, 5);
    assert.equal(m1.estimatedHours, 40);
    assert.equal(m1.actualHours, 12.5);
    assert.equal(m1.isOverdue, true);

    const completedTask = { ...overdueTask, status: 'Concluído' };
    assert.equal(isTaskOverdue(completedTask, '2026-11-16'), false);

    const futureTask = { ...overdueTask, endDate: '2026-11-20' };
    assert.equal(isTaskOverdue(futureTask, '2026-11-16'), false);

    const nextStart = addCalendarDaysIso('2026-11-16', 7);
    assert.equal(nextStart, '2026-11-23');
    assert.equal(formatHoursAsDuration(12.5), '12.5h');
    assert.equal(countBusinessDaysBetween('2026-11-16', '2026-11-20').businessDays, 5);
  }),

  test('8. Backend Azure DevOps integration: task-fields discovery, create-task & update-task with OriginalEstimate, CompletedWork & graceful date fallback', async () => {
    const capturedRequests: Array<{ url: string; method: string; body?: any }> = [];
    const originalFetch = globalThis.fetch;

    let failDateOnPatch = false;
    let templateSupportsDates = true;

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      capturedRequests.push({ url, method, body });

      if (url.includes('/_apis/wit/workitemtypes/Task/fields')) {
        const baseFields = [
          { referenceName: 'System.Title', name: 'Title' },
          { referenceName: 'Microsoft.VSTS.Scheduling.OriginalEstimate', name: 'Original Estimate' },
          { referenceName: 'Microsoft.VSTS.Scheduling.CompletedWork', name: 'Completed Work' },
          { referenceName: 'Microsoft.VSTS.Scheduling.RemainingWork', name: 'Remaining Work' }
        ];
        if (templateSupportsDates) {
          baseFields.push(
            { referenceName: 'Microsoft.VSTS.Scheduling.StartDate', name: 'Start Date' },
            { referenceName: 'Microsoft.VSTS.Scheduling.TargetDate', name: 'Target Date' }
          );
        }
        return new Response(JSON.stringify({ value: baseFields }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url.includes('/_apis/wit/workitems/$Task')) {
        return new Response(JSON.stringify({ id: 98765 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url.includes('/_apis/wit/workitems/98765')) {
        if (failDateOnPatch && Array.isArray(body) && body.some((op: any) => String(op.path).includes('StartDate') || String(op.path).includes('TargetDate'))) {
          return new Response(
            JSON.stringify({ message: 'TF401320: Rule Error for field Microsoft.VSTS.Scheduling.StartDate' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ id: 98765 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response('Not mocked', { status: 404 });
    }) as any;

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // A) Inspect Task fields
      const fieldsRes = await originalFetch(`${baseUrl}/api/devops/task-fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organization: 'OrgTest', project: 'ProjA', pat: 'pat123', forceRefresh: true })
      });
      assert.equal(fieldsRes.status, 200);
      const fieldsJson = (await fieldsRes.json()) as any;
      assert.equal(fieldsJson.success, true);
      assert.equal(fieldsJson.recommendedStartDateField, 'Microsoft.VSTS.Scheduling.StartDate');
      assert.equal(fieldsJson.recommendedTargetDateField, 'Microsoft.VSTS.Scheduling.TargetDate');
      assert.equal(fieldsJson.effortFields.hasOriginalEstimate, true);
      assert.equal(fieldsJson.effortFields.hasCompletedWork, true);

      // B) Create Task linked to User Story with OriginalEstimate (NOT RemainingWork), CompletedWork, dates & IterationPath
      const createRes = await originalFetch(`${baseUrl}/api/devops/create-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization: 'OrgTest',
          project: 'ProjA',
          pat: 'pat123',
          userStoryId: '56399',
          title: 'INC-101 - Automacao Boletos',
          estimate: 24,
          completed: 6.5,
          startDate: '2026-11-16',
          endDate: '2026-11-18',
          tag: 'Melhoria',
          iterationPath: 'ProjA\\Sprint 1'
        })
      });
      assert.equal(createRes.status, 200);
      const createJson = (await createRes.json()) as any;
      assert.equal(createJson.success, true);
      assert.equal(createJson.id, 98765);
      assert.deepEqual(createJson.appliedDateFields, [
        'Microsoft.VSTS.Scheduling.StartDate',
        'Microsoft.VSTS.Scheduling.TargetDate'
      ]);

      const devopsCreateCall = capturedRequests.find((r) => r.url.includes('/_apis/wit/workitems/$Task'));
      assert.ok(devopsCreateCall);
      const patchOps = devopsCreateCall.body as Array<{ op: string; path: string; value: any }>;
      assert.equal(patchOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate')?.value, 24);
      assert.equal(patchOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.CompletedWork')?.value, 6.5);
      assert.equal(patchOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.RemainingWork'), undefined);
      assert.equal(patchOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.StartDate')?.value, '2026-11-16T12:00:00Z');
      assert.equal(patchOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.TargetDate')?.value, '2026-11-18T12:00:00Z');
      assert.equal(patchOps.find((p) => p.path === '/fields/System.IterationPath')?.value, 'ProjA\\Sprint 1');
      assert.ok(patchOps.find((p) => p.path === '/relations/-')?.value?.url?.includes('56399'));

      // C) Update Task via POST (proxy/iframe safe) and PATCH when Azure DevOps rejects date field -> graceful retry succeeds with OriginalEstimate & CompletedWork
      failDateOnPatch = true;
      const updateRes = await originalFetch(`${baseUrl}/api/devops/update-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization: 'OrgTest',
          project: 'ProjA',
          pat: 'pat123',
          id: '98765',
          title: 'INC-101 - Automacao Boletos (Atualizado)',
          status: 'Em Progresso',
          estimate: 40,
          completed: 12.5,
          startDate: '2026-11-16',
          endDate: '2026-11-20',
          iterationPath: 'ProjA\\Sprint 2'
        })
      });
      assert.equal(updateRes.status, 200);
      const updateJson = (await updateRes.json()) as any;
      assert.equal(updateJson.success, true);
      assert.ok(updateJson.warning, 'Should surface clear warning when date fields are rejected');

      const patchCalls = capturedRequests.filter((r) => r.url.includes('/_apis/wit/workitems/98765'));
      assert.equal(patchCalls.length, 2, 'First PATCH attempts with date fields, second PATCH retries without unsupported date fields');
      const retryOps = patchCalls[1].body as Array<{ op: string; path: string; value: any }>;
      assert.equal(retryOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate')?.value, 40);
      assert.equal(retryOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.CompletedWork')?.value, 12.5);
      assert.equal(retryOps.find((p) => p.path === '/fields/Microsoft.VSTS.Scheduling.RemainingWork'), undefined);
      assert.equal(retryOps.find((p) => p.path === '/fields/System.State')?.value, 'Active');

      const updatePatchRes = await originalFetch(`${baseUrl}/api/devops/update-task`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization: 'OrgTest',
          project: 'ProjA',
          pat: 'pat123',
          id: '98765',
          estimate: 40
        })
      });
      assert.equal(updatePatchRes.status, 200);

      // D) Project template without date fields discovered -> skips date fields cleanly without extra failure
      templateSupportsDates = false;
      capturedRequests.length = 0;
      const fieldsRes2 = await originalFetch(`${baseUrl}/api/devops/task-fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organization: 'OrgTest', project: 'ProjNoDates', pat: 'pat123', forceRefresh: true })
      });
      const fieldsJson2 = (await fieldsRes2.json()) as any;
      assert.equal(fieldsJson2.recommendedStartDateField, null);
      assert.equal(fieldsJson2.recommendedTargetDateField, null);

      const createNoDatesRes = await originalFetch(`${baseUrl}/api/devops/create-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization: 'OrgTest',
          project: 'ProjNoDates',
          pat: 'pat123',
          userStoryId: '56399',
          title: 'INC-102 - Sem Data no Template',
          estimate: 16,
          startDate: '2026-11-16',
          endDate: '2026-11-17'
        })
      });
      assert.equal(createNoDatesRes.status, 200);
      const createNoDatesJson = (await createNoDatesRes.json()) as any;
      assert.equal(createNoDatesJson.success, true);
      assert.deepEqual(createNoDatesJson.appliedDateFields, []);
      assert.equal(createNoDatesJson.skippedDateFields.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  })
);

async function main() {
  console.log(`Executando ${tests.length} testes de Planejamento, Azure DevOps e Gantt...`);
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✔ ${t.name}`);
    } catch (err: any) {
      console.error(`  ✘ FALHA em "${t.name}":`, err?.stack || err);
      process.exitCode = 1;
    }
  }
  console.log(`\nResultado: ${passed}/${tests.length} aprovados.`);
}

main();
