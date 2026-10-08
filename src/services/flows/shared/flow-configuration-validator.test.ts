import { describe, expect, it, vi } from 'vitest';

import type { Schema } from '@/db/schemas/index';
import { validateFlowConfigurationActions } from '@/services/flows/shared/flow-configuration-validator';

const columns = [
  { id: 'email', name: 'E-mail', type: 'text', data: { mask: 'email' } },
  { id: 'status', name: 'Status', type: 'text', data: {} },
] as unknown as Schema.PageColumn[];

const descriptors = [
  { key: '@columns.email', label: 'E-mail', kind: 'column', valueType: 'email' },
] as Schema.MacroDescriptor[];

const flow = (to = '@columns.email'): Schema.FlowDefinitionV2 => ({
  version: 2,
  trigger: { type: 'manual' },
  nodes: [
    { id: 'start', type: 'start', config: {} },
    {
      id: 'condition',
      type: 'switch',
      config: {
        columnId: 'status',
        operator: 'equals',
        value: 'novo',
        whenTrue: [
          { id: 'mail', type: 'email', config: { to, subject: 'Olá', body: 'Mensagem' } },
          { id: 'write', type: 'set_value', config: { columnId: 'status', value: 'enviado' } },
        ],
        whenFalse: [],
      },
    },
    { id: 'done', type: 'callback', config: {} },
  ],
});

describe('validateFlowConfigurationActions', () => {
  it('valida ações aninhadas pelo mapa de handlers', async () => {
    const canMutate = vi.fn().mockResolvedValue(true);

    await expect(validateFlowConfigurationActions(flow(), {
      columns,
      descriptors,
      canMutate,
    })).resolves.toBeNull();
    expect(canMutate).toHaveBeenCalledWith('status');
  });

  it('rejeita destinatário incompatível antes de validar a próxima ação', async () => {
    const canMutate = vi.fn().mockResolvedValue(true);

    await expect(validateFlowConfigurationActions(flow('@columns.status'), {
      columns,
      descriptors,
      canMutate,
    })).resolves.toEqual({
      reason: 'validation',
      message: 'Escolha membros ou variáveis de e-mail disponíveis',
    });
    expect(canMutate).not.toHaveBeenCalled();
  });
});
