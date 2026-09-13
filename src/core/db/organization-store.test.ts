import {beforeEach,describe,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@db/shared',()=>({rqlite:query}));
vi.mock('@models/index',()=>({default:{}}));
import store from './organization-store.js';
beforeEach(()=>vi.clearAllMocks());
describe('OrganizationStore',()=>{
 it('exige conta validada e registra owner com a role Default',async()=>{
  query.mockResolvedValue([true,true,true,true]);
  expect(await store.create({organizationId:'org',organizationName:"O'Brien",ownerId:'owner',membershipId:'member'})).toBe(true);
  const [statements,,options]=query.mock.calls[0]!;
  expect(options).toEqual({transaction:true});
  expect(statements[0][0]).not.toContain("O'Brien");
  expect(statements[0]).toContain("O'Brien");
  expect(statements[0][0]).toContain('email_verified_at IS NOT NULL');
  expect(statements[1][0]).toContain("'Default'");
  expect(statements[3][0]).toContain('organization_member_role_id');
 });
 it('exige propriedade da workspace e permissão na organização para vincular',async()=>{
  query.mockResolvedValue([true]);
  expect(await store.linkWorkspace('org','workspace','actor')).toBe(true);
  const [statements,,options]=query.mock.calls[0]!;
  expect(options).toEqual({transaction:true});
  expect(statements[0][0]).toContain('organization_id IS NULL');
  expect(statements[0]).toContain('owner');
  expect(statements[0]).toContain('create');
  expect(statements[0][0]).not.toContain('superadmin');
 });
});
