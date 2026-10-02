import { describe, expect, it } from 'vitest';

import {
  fullPermissions,
  parsePermissions,
  PERMISSION_CATALOG,
} from './permissions.js';

describe('permissão page.write.lock_columns', () => {
  it('faz parte do catálogo e das permissões completas de página', () => {
    expect(PERMISSION_CATALOG.page.write).toContain('lock_columns');
    expect(fullPermissions('page').write).toContain('lock_columns');
  });

  it('aceita lock_columns somente junto de update e view', () => {
    expect(parsePermissions('page', {
      read: ['view'],
      write: ['update', 'lock_columns'],
    })).toEqual({
      read: ['view'],
      write: ['update', 'lock_columns'],
    });

    expect(parsePermissions('page', {
      read: ['view'],
      write: ['lock_columns'],
    })).toBeNull();

    expect(parsePermissions('page', {
      read: [],
      write: ['update', 'lock_columns'],
    })).toBeNull();
  });

  it('não aceita lock_columns fora do escopo de página', () => {
    expect(parsePermissions('workspace', {
      read: ['view'],
      write: ['update', 'lock_columns'],
    })).toBeNull();
    expect(parsePermissions('organization', {
      read: ['view'],
      write: ['update', 'lock_columns'],
    })).toBeNull();
  });
});
