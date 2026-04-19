import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// ── Mock fs before importing pageModelManager ──────────────────────────────────
const mockStore = new Map<string, string>();
const PAGE_MODELS_DIR = path.resolve('data', 'page-models');

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readdirSync: vi.fn((dir: string) => {
    return [...mockStore.keys()]
      .filter(k => k.startsWith(dir + path.sep) || k.startsWith(dir + '/'))
      .map(k => path.basename(k));
  }),
  readFileSync: vi.fn((filePath: string) => {
    const content = mockStore.get(filePath);
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    mockStore.set(filePath, data);
  }),
  existsSync: vi.fn((filePath: string) => mockStore.has(filePath)),
  unlinkSync: vi.fn((filePath: string) => { mockStore.delete(filePath); }),
}));

// Import AFTER mock is set up
import {
  listPageModels,
  getPageModelByKey,
  upsertPageModel,
  deletePageModel,
} from '../pageModelManager';

beforeEach(() => {
  mockStore.clear();
  vi.clearAllMocks();
});

describe('upsertPageModel — create', () => {
  it('creates a new PageModel with unique id', () => {
    const model = upsertPageModel({
      projectId:    'proj-1',
      pageKey:      '/patients/:id',
      pageName:     'Patient Detail',
      locatorIds:   ['loc-1', 'loc-2'],
      capturedFrom: 'recorder',
    });
    expect(model.id).toBeTruthy();
    expect(model.projectId).toBe('proj-1');
    expect(model.pageKey).toBe('/patients/:id');
    expect(model.locatorIds).toEqual(['loc-1', 'loc-2']);
    expect(model.capturedFrom).toBe('recorder');
    expect(model.capturedAt).toBeTruthy();
  });

  it('deduplicates locatorIds on create', () => {
    const model = upsertPageModel({
      projectId:    'proj-1',
      pageKey:      '/dashboard',
      locatorIds:   ['loc-1', 'loc-1', 'loc-2'],
      capturedFrom: 'recorder',
    });
    expect(model.locatorIds).toEqual(['loc-1', 'loc-2']);
  });

  it('uses pageKey as pageName when pageName omitted', () => {
    const model = upsertPageModel({
      projectId:    'proj-1',
      pageKey:      '/settings',
      locatorIds:   [],
      capturedFrom: 'prescan',
    });
    expect(model.pageName).toBe('/settings');
  });

  it('persists model to mockStore', () => {
    const model = upsertPageModel({
      projectId:    'proj-1',
      pageKey:      '/login',
      locatorIds:   ['loc-a'],
      capturedFrom: 'recorder',
    });
    const filePath = path.join(PAGE_MODELS_DIR, `${model.id}.json`);
    expect(mockStore.has(filePath)).toBe(true);
    const stored = JSON.parse(mockStore.get(filePath)!);
    expect(stored.pageKey).toBe('/login');
  });
});

describe('upsertPageModel — update', () => {
  it('merges locatorIds when model already exists', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-1', 'loc-2'], capturedFrom: 'recorder' });
    const updated = upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-2', 'loc-3'], capturedFrom: 'prescan' });
    expect(updated.locatorIds.sort()).toEqual(['loc-1', 'loc-2', 'loc-3']);
  });

  it('updates capturedFrom on merge', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-1'], capturedFrom: 'recorder' });
    const updated = upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: [], capturedFrom: 'prescan' });
    expect(updated.capturedFrom).toBe('prescan');
  });

  it('preserves existing id on update', () => {
    const first = upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-1'], capturedFrom: 'recorder' });
    const second = upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-2'], capturedFrom: 'recorder' });
    expect(second.id).toBe(first.id);
  });
});

describe('listPageModels', () => {
  it('returns only models for the requested projectId', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/login',    locatorIds: ['a'], capturedFrom: 'recorder' });
    upsertPageModel({ projectId: 'proj-1', pageKey: '/dashboard', locatorIds: ['b'], capturedFrom: 'recorder' });
    upsertPageModel({ projectId: 'proj-2', pageKey: '/login',    locatorIds: ['c'], capturedFrom: 'recorder' });
    const models = listPageModels('proj-1');
    expect(models).toHaveLength(2);
    expect(models.every(m => m.projectId === 'proj-1')).toBe(true);
  });

  it('returns empty array when no models exist for project', () => {
    expect(listPageModels('no-such-project')).toEqual([]);
  });

  it('returns models sorted by pageKey', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/z-page', locatorIds: [], capturedFrom: 'recorder' });
    upsertPageModel({ projectId: 'proj-1', pageKey: '/a-page', locatorIds: [], capturedFrom: 'recorder' });
    const models = listPageModels('proj-1');
    expect(models[0].pageKey).toBe('/a-page');
    expect(models[1].pageKey).toBe('/z-page');
  });
});

describe('getPageModelByKey', () => {
  it('returns matching model', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: ['loc-1'], capturedFrom: 'recorder' });
    const found = getPageModelByKey('proj-1', '/patients/:id');
    expect(found).not.toBeNull();
    expect(found!.pageKey).toBe('/patients/:id');
  });

  it('returns null when no match', () => {
    expect(getPageModelByKey('proj-1', '/nonexistent')).toBeNull();
  });

  it('does not cross project boundaries', () => {
    upsertPageModel({ projectId: 'proj-1', pageKey: '/patients/:id', locatorIds: [], capturedFrom: 'recorder' });
    expect(getPageModelByKey('proj-2', '/patients/:id')).toBeNull();
  });
});

describe('deletePageModel', () => {
  it('removes the model file from store', () => {
    const model = upsertPageModel({ projectId: 'proj-1', pageKey: '/delete-me', locatorIds: [], capturedFrom: 'recorder' });
    deletePageModel(model.id);
    expect(getPageModelByKey('proj-1', '/delete-me')).toBeNull();
  });

  it('does not throw when model does not exist', () => {
    expect(() => deletePageModel('nonexistent-id')).not.toThrow();
  });
});
