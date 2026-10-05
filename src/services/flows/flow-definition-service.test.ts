import { describe, expect, it } from 'vitest';

import type { Schema } from '@/db/schemas/index';

import { FlowDefinitionService, flowMacroInputs } from './flow-definition-service.js';

const service = new FlowDefinitionService();

function validFlow(): Schema.FlowDefinition {
  return {
    version: 1,
    trigger: { type: 'manual' },
    nodes: [
      { id: 'start', type: 'start', config: { nextNodeId: 'decision' } },
      {
        id: 'decision',
        type: 'switch',
        config: {
          left: '@columns.score',
          operator: 'greater_than',
          right: 10,
          trueTargetId: 'notify',
          falseTargetId: 'done',
        },
      },
      {
        id: 'notify',
        type: 'email',
        config: {
          to: '@people.user-1.email',
          subject: 'Resultado de @page.title',
          body: 'Workspace: @workspace.name',
          nextNodeId: 'done',
        },
      },
      { id: 'done', type: 'callback', config: { message: 'Concluído' } },
    ],
  };
}

function validFlowV2(): Schema.FlowDefinitionV2 {
  return {
    version: 2,
    trigger: { type: 'manual' },
    nodes: [
      { id: 'start', type: 'start', config: {} },
      {
        id: 'decision',
        type: 'switch',
        config: {
          columnId: 'status',
          operator: 'equals',
          value: 'approved',
          whenTrue: [{
            id: 'nested',
            type: 'switch',
            config: {
              columnId: 'score',
              operator: 'greater_than',
              value: 10,
              whenTrue: [],
              whenFalse: [],
            },
          }],
          whenFalse: [],
        },
      },
      { id: 'done', type: 'callback', config: { message: 'Concluído' } },
    ],
  }
}

const conditionColumns = [
  {
    id: 'status', type: 'select', name: 'Status',
    data: { options: [{ id: 'approved', value: 'Aprovado' }] },
  },
  { id: 'score', type: 'numeric', name: 'Pontuação', data: {} },
] as unknown as Schema.PageColumn[]

describe('FlowDefinitionService', () => {
  it('aceita uma árvore v2 aninhada e valida literais pelos tipos das colunas', () => {
    const parsed = service.parse(validFlowV2())
    expect(parsed.version).toBe(2)
    expect(() => service.validateAgainstColumns(parsed, conditionColumns)).not.toThrow()
  })

  it('não interpreta o literal da condição v2 como macro', () => {
    const flow = validFlowV2()
    ;(flow.nodes[1] as Schema.FlowSwitchStepV2).config.value = '@texto.literal'
    expect(flowMacroInputs(flow)).not.toContain('@texto.literal')
    expect(JSON.stringify(flowMacroInputs(flow))).not.toContain('@texto.literal')
  })

  it('rejeita IDs duplicados em níveis distintos e mais de 100 nodes no v2', () => {
    const duplicate = validFlowV2()
    const decision = duplicate.nodes[1] as Schema.FlowSwitchStepV2
    decision.config.whenFalse.push({
      id: 'nested', type: 'email', config: { to: '@page.title', subject: 'Assunto', body: 'Corpo' },
    })
    expect(() => service.parse(duplicate)).toThrow('IDs de nodes devem ser únicos')

    const oversized = validFlowV2()
    ;(oversized.nodes[1] as Schema.FlowSwitchStepV2).config.whenFalse = Array.from({ length: 98 }, (_, index) => ({
      id: `mail-${index}`,
      type: 'email' as const,
      config: { to: '@page.title', subject: 'Assunto', body: 'Corpo' },
    }))
    expect(() => service.parse(oversized)).toThrow('O flow deve ter no máximo 100 nodes')
  })

  it('mantém a condição inválida quando coluna, opção ou operador deixam de existir', () => {
    const missingColumn = service.parse(validFlowV2())
    expect(() => service.validateAgainstColumns(missingColumn, conditionColumns.slice(1)))
      .toThrow('Coluna da condição não existe mais')

    const missingOption = service.parse(validFlowV2())
    ;(missingOption.nodes[1] as Schema.FlowSwitchStepV2).config.value = 'removed'
    expect(() => service.validateAgainstColumns(missingOption, conditionColumns))
      .toThrow('Opção da condição não existe mais')

    const incompatible = service.parse(validFlowV2())
    ;(incompatible.nodes[1] as Schema.FlowSwitchStepV2).config.operator = 'contains'
    expect(() => service.validateAgainstColumns(incompatible, conditionColumns))
      .toThrow('Operador incompatível com a coluna da condição')
  })
  it('normaliza um flow manual válido e preserva os contratos dos cards', () => {
    const flow = validFlow();
    flow.nodes[0]!.id = ' start ';
    (flow.nodes[0] as Schema.FlowStartNode).config.nextNodeId = ' decision ';

    expect(service.parse(flow)).toEqual({
      ...validFlow(),
      nodes: [
        { id: 'start', type: 'start', config: { nextNodeId: 'decision' } },
        ...validFlow().nodes.slice(1),
      ],
    });
  });

  it('aceita membros e variáveis dinâmicas separados por vírgula ou ponto e vírgula', () => {
    const commaSeparated = validFlow();
    (commaSeparated.nodes[2] as Schema.FlowEmailNode).config.to =
      '@people.user-1.email, @people.user-2.email';
    expect((service.parse(commaSeparated).nodes[2] as Schema.FlowEmailNode).config.to)
      .toBe('@people.user-1.email, @people.user-2.email');

    const semicolonSeparated = validFlow();
    (semicolonSeparated.nodes[2] as Schema.FlowEmailNode).config.to =
      '@page.title; @columns.contact';
    expect(() => service.parse(semicolonSeparated)).not.toThrow();
  });

  it.each([
    'person@example.com',
    '@people.user-1.name',
    '@workspace.name',
    '@people.user-1.email, person@example.com',
  ])('rejeita destinatário fora das fontes de e-mail: %s', (to) => {
    const flow = validFlow();
    (flow.nodes[2] as Schema.FlowEmailNode).config.to = to;

    expect(() => service.parse(flow))
      .toThrow('Destinatários devem ser membros ou variáveis de e-mail disponíveis');
  });

  it.each([
    {
      name: 'documento sem trigger manual',
      mutate: (flow: Record<string, unknown>) => { flow.trigger = { type: 'scheduled' }; },
      message: 'Definição de flow inválida',
    },
    {
      name: 'id duplicado',
      mutate: (flow: Schema.FlowDefinition) => { flow.nodes[1]!.id = 'start'; },
      message: 'IDs de nodes devem ser únicos',
    },
    {
      name: 'node inicial diferente de start',
      mutate: (flow: Schema.FlowDefinition) => { flow.nodes = flow.nodes.slice(1); },
      message: 'O flow deve iniciar com start e terminar com callback',
    },
    {
      name: 'destino inexistente',
      mutate: (flow: Schema.FlowDefinition) => {
        (flow.nodes[0] as Schema.FlowStartNode).config.nextNodeId = 'missing';
      },
      message: 'Destino inexistente: missing',
    },
    {
      name: 'retorno para node anterior',
      mutate: (flow: Schema.FlowDefinition) => {
        (flow.nodes[2] as Schema.FlowEmailNode).config.nextNodeId = 'decision';
      },
      message: 'O flow não pode conter ciclos ou retornos',
    },
  ])('rejeita $name', ({ mutate, message }) => {
    const flow = validFlow();
    mutate(flow as Schema.FlowDefinition & Record<string, unknown>);

    expect(() => service.parse(flow)).toThrow(message);
  });

  it('rejeita node desconectado mesmo quando todos os destinos existem', () => {
    const flow = validFlow();
    (flow.nodes[1] as Schema.FlowSwitchNode).config.trueTargetId = 'done';

    expect(() => service.parse(flow)).toThrow('Node desconectado: notify');
  });

  it('rejeita mais de um switch e comparação sem lado direito', () => {
    const secondSwitch = validFlow();
    secondSwitch.nodes.splice(2, 0, {
      id: 'decision-2',
      type: 'switch',
      config: {
        left: '@columns.score',
        operator: 'is_empty',
        trueTargetId: 'notify',
        falseTargetId: 'done',
      },
    });
    (secondSwitch.nodes[1] as Schema.FlowSwitchNode).config.trueTargetId = 'decision-2';

    expect(() => service.parse(secondSwitch)).toThrow('Switch aninhado não é suportado nesta versão');

    const missingRight = validFlow();
    delete (missingRight.nodes[1] as Schema.FlowSwitchNode).config.right;
    expect(() => service.parse(missingRight)).toThrow('Comparação do switch exige valor à direita');
  });
});
