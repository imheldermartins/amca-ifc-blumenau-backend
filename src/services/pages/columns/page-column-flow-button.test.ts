import { describe, expect, it } from 'vitest';
import { PageColumnConfigurationService } from '@/services/pages/columns/page-column-configuration-service';
describe('Flow button column configuration', () => {
  const config = new PageColumnConfigurationService();
  it('preserves the button across unrelated partial updates', () => {
    const flowButton = { label: null, icon: 'lucide:play' };
    expect(config.merge({ flowButton }, { mask: 'email' })).toMatchObject({ flowButton, mask: 'email' });
  });
  it('normalizes empty labels into circular buttons', () => {
    expect(config.merge({}, { flowButton: { label: '  ', icon: 'lucide:send' } }).flowButton).toEqual({ label: null, icon: 'lucide:send' });
  });
  it('rejects invalid labels and icon identifiers', () => {
    expect(() => config.merge({}, { flowButton: { label: 1, icon: 'lucide:play' } })).toThrow('inválido');
    expect(() => config.merge({}, { flowButton: { label: null, icon: '<script>' } })).toThrow('inválido');
  });
});
