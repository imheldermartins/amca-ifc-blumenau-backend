import {describe,it,expect} from 'vitest';
import {defineWorkspaceAbility} from './workspace-ability.js';
describe('permissões da workspace',()=>{
 it('nomes de role não concedem direitos',()=>{expect(defineWorkspaceAbility('superadmin').can('manage','WorkspaceSettings')).toBe(false)});
 it('leitura não permite editar configuração',()=>{const ability=defineWorkspaceAbility({permissions:{read:['view'],write:[]}});expect(ability.can('read','WorkspaceRoot')).toBe(true);expect(ability.can('manage','WorkspaceSettings')).toBe(false)});
 it('usa permissões explícitas',()=>{expect(defineWorkspaceAbility({permissions:{read:['view'],write:['update']}}).can('manage','WorkspaceSettings')).toBe(true)});
});
