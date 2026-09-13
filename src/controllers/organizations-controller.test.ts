import {beforeEach,describe,it,expect,vi} from 'vitest';
const store=vi.hoisted(()=>({create:vi.fn(),getForUser:vi.fn(),linkWorkspace:vi.fn(),listForUser:vi.fn(),catalog:vi.fn()}));
vi.mock('@db/organization-store',()=>({default:store}));
vi.mock('@db/workspace-store',()=>({default:{getForUser:vi.fn()}}));
import controller from './organizations-controller.js';
const id='01KXDN4AXN6QJBTZTCWP1JWVW4';
beforeEach(()=>vi.clearAllMocks());
describe('criação de organização por conta validada',()=>{
 it('recusa nome vazio antes de qualquer escrita',async()=>{
  expect(await controller.create(id,{name:' '})).toMatchObject({ok:false,reason:'validation'});
  expect(store.create).not.toHaveBeenCalled();
 });
 it('usa a identidade autenticada como owner',async()=>{
  store.create.mockResolvedValue(true);store.getForUser.mockResolvedValue({id,name:'Organização'});
  expect(await controller.create(id,{name:'  Organização  '})).toMatchObject({ok:true});
  expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ownerId:id,organizationName:'Organização'}));
 });
 it('não confirma criação se a transação falha',async()=>{
  store.create.mockResolvedValue(false);
  expect(await controller.create(id,{name:'Organização'})).toMatchObject({ok:false,reason:'conflict'});
  expect(store.getForUser).not.toHaveBeenCalled();
 });
 it('recusa vínculo inválido e não usa roles escritas para autorizar',async()=>{
  expect(await controller.linkWorkspace('invalid',id,id)).toMatchObject({ok:false,reason:'validation'});
  expect(store.linkWorkspace).not.toHaveBeenCalled();
 });
});
