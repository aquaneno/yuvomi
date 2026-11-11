/** Real Yuvomi manifest loader and installer, against an isolated target folder. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'timetable-install-'));
process.env.MODULES_DIR = directory;
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'timetable-install-test-only-secret';
process.env.LOG_LEVEL = 'error';
const { loadModuleDir, listModules, setModuleEnabled, resolveAssetPath } = await import('../../../server/services/modules.js');
const { installFilesUnlocked, installFromZip } = await import('../../../server/services/module-install.js');
const { closeForShutdown } = await import('../../../server/db.js');
const source = fileURLToPath(new URL('../../../modules/school-timetable', import.meta.url));
after(async () => { await closeForShutdown(Date.now() + 1000); rmSync(directory, { recursive: true, force: true }); });

test('real loader accepts manifest, composition, module permission and isolated API prefix', async () => {
  const loaded = await loadModuleDir(source, 'school-timetable');
  assert.equal(loaded.manifest.id, 'school-timetable');
  assert.equal(loaded.manifest.page.composition, 'data');
  assert.equal(loaded.capabilities.permissionModuleKey, 'ext:school-timetable');
  assert.equal(loaded.capabilities.apiPrefix, '/api/extensions/school-timetable');
  assert.deepEqual(loaded.i18n.availableLocales, ['de', 'en']);
});
test('web installer copies all runtime assets, starts disabled and loads after session approval', async () => {
  function files(dir, prefix = '') {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? files(join(dir, entry.name), prefix + entry.name + '/')
      : [{ name: 'release/modules/school-timetable/' + prefix + entry.name, data: readFileSync(join(dir, entry.name)) }]);
  }
  const result = process.env.TIMETABLE_ARCHIVE
    ? await installFromZip(readFileSync(process.env.TIMETABLE_ARCHIVE), { userId: null })
    : await installFilesUnlocked(files(source), { userId: null, source: 'zip' });
  assert.equal(result.module.status, 'disabled');
  assert.deepEqual(result.skipped, []);
  for (const asset of ['index.js', 'api.js', 'dialog.js', 'page-layout.js', 'model.js', 'sortable.js', 'style.css', 'vendor/sortable.esm.min.js']) {
    assert.ok(existsSync(join(directory, 'school-timetable', asset)), asset);
  }
  await setModuleEnabled('school-timetable', true);
  const [installed] = await listModules();
  assert.equal(installed.status, 'enabled');
  assert.ok(await resolveAssetPath('school-timetable', 'model.js'));
});
