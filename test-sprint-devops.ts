import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  formatDevOpsSprintName,
  deriveDatesFromDevOpsSprintName,
  convertLegacySprintNameToDevOps,
  upsertDevOpsSprintInList,
  collectRegisteredIterationPaths,
  normalizeIterationPath,
  isOpenTask
} from './services/sprintUtils.ts';
import { Sprint, Task, User, NEXUS_OWNER_UID, getTaskSprintId } from './types.ts';

// Minimal browser shim before loading StorageService / api
if (typeof (globalThis as any).window === 'undefined') {
  const store = new Map<string, string>();
  const eventTarget = new EventTarget();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {
    dispatchEvent: (ev: Event) => eventTarget.dispatchEvent(ev),
    addEventListener: (...args: any[]) => (eventTarget as any).addEventListener(...args),
    removeEventListener: (...args: any[]) => (eventTarget as any).removeEventListener(...args),
    localStorage: (globalThis as any).localStorage
  };
  (globalThis as any).CustomEvent = class CustomEvent<T = any> extends Event {
    detail: T;
    constructor(type: string, params?: CustomEventInit<T>) {
      super(type, params);
      this.detail = params?.detail as T;
    }
  };
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

tests.push(
  {
    name: '1. formatDevOpsSprintName & deriveDatesFromDevOpsSprintName follow Hyperautomation\\Sprint Semana X e Y - Mmm-AAAA',
    fn: () => {
      const ctx = { project: 'Hyperautomation', defaultIterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026' };
      assert.equal(
        formatDevOpsSprintName('2026-11-16', ctx),
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      );
      assert.equal(
        formatDevOpsSprintName('2026-11-30', ctx),
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      );
      assert.equal(
        formatDevOpsSprintName('2026-11-01', ctx),
        'Hyperautomation\\Sprint Semana 1 e 2 - Nov-2026'
      );
      assert.equal(
        formatDevOpsSprintName('2026-11-15', ctx),
        'Hyperautomation\\Sprint Semana 1 e 2 - Nov-2026'
      );

      assert.deepEqual(
        deriveDatesFromDevOpsSprintName('Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'),
        { startDate: '2026-11-16', endDate: '2026-11-30' }
      );
      assert.deepEqual(
        deriveDatesFromDevOpsSprintName('Hyperautomation\\Sprint Semana 1 e 2 - Nov-2026'),
        { startDate: '2026-11-01', endDate: '2026-11-15' }
      );
      assert.equal(
        normalizeIterationPath('Hyperautomation/Sprint Semana 3 e 4 - Nov-2026/'),
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      );
    }
  },
  {
    name: '2. convertLegacySprintNameToDevOps converts legacy Nexus sprint names into DevOps Iteration Path format',
    fn: () => {
      const ctx = { project: 'Hyperautomation' };
      assert.equal(
        convertLegacySprintNameToDevOps(
          { name: 'Sprint Semana 3 - Nov-2026', startDate: '2026-11-16', endDate: '2026-11-30' },
          ctx
        ),
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      );
      assert.equal(
        convertLegacySprintNameToDevOps(
          { name: 'Sprint Semana 1 e 2 - Dez-2026', startDate: '2026-12-01', endDate: '2026-12-15' },
          ctx
        ),
        'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026'
      );
      assert.equal(
        convertLegacySprintNameToDevOps(
          { name: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026', startDate: '2026-11-16', endDate: '2026-11-30' },
          ctx
        ),
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      );
    }
  },
  {
    name: '3. upsertDevOpsSprintInList creates/upgrades sprint without duplicating and collectRegisteredIterationPaths deduplicates',
    fn: () => {
      const initial: Sprint[] = [
        {
          id: 'sp-unprefixed',
          name: 'Sprint Semana 3 e 4 - Nov-2026',
          startDate: '2026-11-16',
          endDate: '2026-11-30',
          status: 'Em Execução',
          goals: '',
          tasks: []
        }
      ];

      // Matching unprefixed sprint upgrades in place
      const up1 = upsertDevOpsSprintInList(initial, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026', {
        todayIso: '2026-11-17'
      });
      assert.equal(up1.nextSprints.length, 1);
      assert.equal(up1.updated, true);
      assert.equal(up1.sprint?.id, 'sp-unprefixed');
      assert.equal(up1.sprint?.name, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
      assert.equal(up1.sprint?.iterationPath, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');

      // New sprint is added cleanly
      const up2 = upsertDevOpsSprintInList(up1.nextSprints, 'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026', {
        todayIso: '2026-11-17'
      });
      assert.equal(up2.created, true);
      assert.equal(up2.nextSprints.length, 2);
      assert.equal(up2.sprint?.startDate, '2026-12-01');
      assert.equal(up2.sprint?.endDate, '2026-12-15');
      assert.equal(up2.sprint?.status, 'Planejada');

      const paths = collectRegisteredIterationPaths(
        {
          defaultIterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026',
          registeredIterationPaths: ['Hyperautomation/Sprint Semana 3 e 4 - Nov-2026']
        },
        up2.nextSprints
      );
      assert.deepEqual(paths, [
        'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026',
        'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026'
      ]);
    }
  },
  {
    name: '4. getTaskSprintId resolves sprintId first, then iterationPath case-insensitively, then sprint.tasks',
    fn: () => {
      const sprints: Sprint[] = [
        {
          id: 'sp-1',
          name: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026',
          iterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026',
          startDate: '2026-11-16',
          endDate: '2026-11-30',
          status: 'Em Execução',
          goals: '',
          tasks: []
        }
      ];
      const byIter: Partial<Task> = {
        id: 'INC-10',
        iterationPath: 'hyperautomation\\sprint semana 3 e 4 - nov-2026'
      };
      assert.equal(getTaskSprintId(byIter as Task, sprints), 'sp-1');

      const cleared: Partial<Task> = {
        id: 'INC-11',
        sprintId: null as any,
        iterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
      };
      assert.equal(getTaskSprintId(cleared as Task, sprints), undefined);
    }
  },
  {
    name: '5. Backend POST /api/devops/config rejects unauthenticated and stores/returns registeredIterationPaths for ADM',
    async fn() {
      const devopsFilePath = path.join(process.cwd(), 'data', 'nexus-devops.json');
      const hadExistingFile = fs.existsSync(devopsFilePath);
      const previousContent = hadExistingFile ? fs.readFileSync(devopsFilePath, 'utf-8') : null;

      const { default: app } = await import('./api/index.ts');
      const { PowerBIService } = await import('./services/powerbiService.ts');
      const originalVerify = PowerBIService.verifyFirebaseIdToken;
      PowerBIService.verifyFirebaseIdToken = (async (token: string) => {
        if (token === 'mock-owner-token') {
          return { uid: NEXUS_OWNER_UID, email: 'owner@teste.local' };
        }
        throw new Error('Token inválido');
      }) as any;

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        // Reject unauthenticated writes
        const unauthRes = await fetch(`${baseUrl}/api/devops/config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organization: 'OrgTest' })
        });
        assert.equal(unauthRes.status, 403);

        const postRes = await fetch(`${baseUrl}/api/devops/config`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Authorization': 'Bearer mock-owner-token'
          },
          body: JSON.stringify({
            organization: 'OrgTest',
            project: 'Hyperautomation',
            pat: 'fake-pat',
            isActive: true,
            defaultIterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026',
            registeredIterationPaths: [
              'Hyperautomation\\Sprint Semana 1 e 2 - Nov-2026',
              'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026'
            ]
          })
        });
        assert.equal(postRes.status, 200);
        const postJson = (await postRes.json()) as any;
        assert.equal(postJson.success, true);
        assert.equal(postJson.config.defaultIterationPath, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
        assert.ok(Array.isArray(postJson.config.registeredIterationPaths));
        assert.ok(
          postJson.config.registeredIterationPaths.includes('Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026')
        );
        assert.ok(
          postJson.config.registeredIterationPaths.includes('Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026')
        );

        const getRes = await fetch(`${baseUrl}/api/devops/config`);
        assert.equal(getRes.status, 200);
        const getJson = (await getRes.json()) as any;
        assert.equal(getJson.defaultIterationPath, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
        assert.ok(
          getJson.registeredIterationPaths.includes('Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026')
        );
      } finally {
        PowerBIService.verifyFirebaseIdToken = originalVerify;
        if (hadExistingFile && previousContent !== null) {
          fs.writeFileSync(devopsFilePath, previousContent, 'utf-8');
        } else if (!hadExistingFile && fs.existsSync(devopsFilePath)) {
          fs.unlinkSync(devopsFilePath);
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
  {
    name: '6. StorageService.registerDevOpsSprint, alignOpenDemandsAndSprintsToDevOps & updateTasksSprint bulk apply + DevOps sync',
    async fn() {
      const { StorageService } = await import('./services/storageService.ts');
      const { FirebaseService } = await import('./services/firebase.ts');

      const originalBatch = FirebaseService.updateTasksSprintBatch;
      const originalSaveDevOps = FirebaseService.saveDevOpsConfig;
      const originalSaveSetting = FirebaseService.saveSetting;
      const originalFetch = globalThis.fetch;

      const devopsSyncCalls: any[] = [];
      let batchCalls = 0;

      FirebaseService.updateTasksSprintBatch = (async () => {
        batchCalls++;
      }) as any;
      FirebaseService.saveDevOpsConfig = (async () => true) as any;
      FirebaseService.saveSetting = (async () => true) as any;

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/devops/update-task')) {
          devopsSyncCalls.push(JSON.parse(String(init?.body || '{}')));
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }) as any;

      try {
        StorageService.clearAllMemory();
        const adminUser: User = {
          id: NEXUS_OWNER_UID,
          name: 'Admin Teste',
          email: 'adm@teste.local',
          role: 'ADM',
          status: 'active'
        };

        const oldSprint: Sprint = {
          id: 'sp-legacy',
          name: 'Sprint Semana 3 - Nov-2026',
          startDate: '2026-11-16',
          endDate: '2026-11-30',
          status: 'Em Execução',
          goals: '',
          tasks: [{ taskId: 'INC-1', plannedHours: 8, actualHours: 0, status: 'Em Progresso' }]
        };
        const doneSprint: Sprint = {
          id: 'sp-done',
          name: 'Sprint Concluida Antiga',
          startDate: '2026-10-01',
          endDate: '2026-10-15',
          status: 'Concluída',
          goals: '',
          tasks: []
        };

        const openLinkedTask: Task = {
          id: 'INC-1',
          summary: 'Demanda Aberta 1',
          type: 'Incidente',
          status: 'Em Progresso',
          subcategory: 'RPA',
          priority: '2 - Alta',
          createdAt: '2026-11-16',
          assignee: 'Dev A',
          sprintId: 'sp-legacy',
          estimatedTime: '16h',
          devopsFeatureId: '77001'
        };
        const openUnassignedTask: Task = {
          id: 'PRJ-2',
          summary: 'Demanda Aberta 2',
          type: 'Melhoria',
          status: 'Novo',
          subcategory: 'RPA',
          priority: '3 - Moderada',
          createdAt: '2026-11-16',
          assignee: 'Dev B',
          estimatedTime: '8h'
        };
        const closedTask: Task = {
          id: 'INC-3',
          summary: 'Demanda Concluida',
          type: 'Incidente',
          status: 'Concluído',
          subcategory: 'RPA',
          priority: '4 - Baixa',
          createdAt: '2026-10-02',
          assignee: 'Dev A',
          sprintId: 'sp-done'
        };

        assert.equal(isOpenTask(openLinkedTask), true);
        assert.equal(isOpenTask(closedTask), false);

        StorageService.setSprintsInMemory([oldSprint, doneSprint]);
        StorageService.setTasksInMemory([openLinkedTask, openUnassignedTask, closedTask]);
        StorageService.setDevOpsConfigInMemory({
          organization: 'OrgTest',
          project: 'Hyperautomation',
          pat: 'fake-pat',
          isActive: true,
          defaultIterationPath: 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026'
        });

        // A) Align open sprint & open demands to DevOps format
        const aligned = await StorageService.alignOpenDemandsAndSprintsToDevOps(adminUser);
        assert.equal(aligned.alignedSprintsCount, 1);
        assert.equal(aligned.alignedTasksCount, 1);
        const alignedSp = aligned.updatedSprints.find((s) => s.id === 'sp-legacy');
        assert.equal(alignedSp?.name, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
        assert.equal(alignedSp?.iterationPath, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
        const alignedT1 = aligned.updatedTasks.find((t) => t.id === 'INC-1');
        assert.equal(alignedT1?.iterationPath, 'Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026');
        // Concluded sprint & closed demand remained untouched
        assert.equal(aligned.updatedSprints.find((s) => s.id === 'sp-done')?.name, 'Sprint Concluida Antiga');
        assert.equal(aligned.updatedTasks.find((t) => t.id === 'INC-3')?.iterationPath, undefined);

        // B) Register a new Sprint via Integração Azure DevOps
        const reg = await StorageService.registerDevOpsSprint(
          'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026',
          { setAsDefault: true, userId: adminUser.id }
        );
        assert.equal(reg.created, true);
        assert.ok(reg.sprint);
        assert.equal(reg.sprint?.name, 'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026');
        assert.ok(
          reg.devopsConfig.registeredIterationPaths?.includes('Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026')
        );

        // C) Bulk apply new registered Sprint to both open demands (INC-1 and PRJ-2)
        const bulk = await StorageService.updateTasksSprint(
          ['INC-1', 'PRJ-2'],
          reg.sprint!.id,
          adminUser,
          { syncDevOps: true }
        );
        assert.equal(batchCalls, 1);
        assert.equal(bulk.devopsSyncedCount, 1);
        assert.equal(devopsSyncCalls.length, 1);
        assert.equal(devopsSyncCalls[0].id, '77001');
        assert.equal(devopsSyncCalls[0].iterationPath, 'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026');

        const updatedT1 = bulk.updatedTasks.find((t) => t.id === 'INC-1');
        const updatedT2 = bulk.updatedTasks.find((t) => t.id === 'PRJ-2');
        assert.equal(updatedT1?.sprintId, reg.sprint!.id);
        assert.equal(updatedT1?.iterationPath, 'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026');
        assert.equal(updatedT2?.sprintId, reg.sprint!.id);
        assert.equal(updatedT2?.iterationPath, 'Hyperautomation\\Sprint Semana 1 e 2 - Dez-2026');

        // Moved task INC-1 must be removed from old sprint and added to new sprint
        const prevSprintAfter = bulk.updatedSprints.find((s) => s.id === 'sp-legacy');
        const newSprintAfter = bulk.updatedSprints.find((s) => s.id === reg.sprint!.id);
        assert.equal(prevSprintAfter?.tasks.some((st) => st.taskId === 'INC-1'), false);
        assert.equal(newSprintAfter?.tasks.some((st) => st.taskId === 'INC-1'), true);
        assert.equal(newSprintAfter?.tasks.some((st) => st.taskId === 'PRJ-2'), true);
        assert.equal(newSprintAfter?.tasks.find((st) => st.taskId === 'INC-1')?.plannedHours, 16);
      } finally {
        FirebaseService.updateTasksSprintBatch = originalBatch;
        FirebaseService.saveDevOpsConfig = originalSaveDevOps;
        FirebaseService.saveSetting = originalSaveSetting;
        globalThis.fetch = originalFetch;
      }
    }
  }
);

async function main() {
  let passed = 0;
  console.log(`Executando ${tests.length} testes de Sprints & Azure DevOps...`);
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
