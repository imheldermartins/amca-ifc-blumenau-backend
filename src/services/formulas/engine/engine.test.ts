import {describe,it,expect} from 'vitest';
import {compileFormula,evaluateFormula,type FormulaSymbol,type FormulaContext,completionContext,displaySource} from './index.js';
const id=(n:number)=>`01M${String(n).padStart(23,'0')}`;
const total=id(1),relation=id(2),amount=id(3),cancel=id(4),derived=id(5);
const catalog:FormulaSymbol[]=[
  {id:total,name:'Total',type:'numeric',databaseId:'root'},
  {id:relation,name:'Pedidos',type:'relation',databaseId:'root',targetDatabaseId:'orders'},
  {id:amount,name:'Valor',type:'numeric',databaseId:'orders'},
  {id:cancel,name:'Cancelado',type:'checkbox',databaseId:'orders'},
  {id:derived,name:'Saldo',type:'formula',databaseId:'root',source:'markup(@Total + 1, "purple")'},
];
const context:FormulaContext={pageId:'root-page',pages:{
  'root-page':{id:'root-page',databaseId:'root',title:'Caderno',values:{[total]:10,[relation]:['a','b','hidden']}},
  a:{id:'a',databaseId:'orders',title:'A',values:{[amount]:3,[cancel]:false}},
  b:{id:'b',databaseId:'orders',title:'B',values:{[amount]:7,[cancel]:true}},
  hidden:{id:'hidden',databaseId:'orders',title:'Privado',readable:false,values:{[amount]:999}},
}};
const compile=(source:string)=>compileFormula(source,{catalog,databaseId:'root'});
const run=(source:string)=>evaluateFormula(compile(source),context);
const value=(source:string)=>{const result=run(source);expect(result.ok,JSON.stringify(result)).toBe(true);return result.ok?result.value:undefined};
describe('Controlled formula language',()=>{
  it.each([['2+3*4',14],['20/2/2',5],['"Total " + 2','Total 2'],['toNumber("12")-2',10],['abs(-2)+floor(2.9)+ceil(2.1)',7],['round(12.345,2)',12.35],['" ÁB ".trim().lower()','áb'],['"😀a".length()',2],['replace("ab ab","ab","x")','x x']])('evaluates %s',(source,expected)=>expect(value(source as string)).toEqual(expected));
  it.each(['eval("1")','globalThis','({x:1})','while(true){}','@Total.constructor()','1;2','toNumber("1,2")','"2" - 1','if(1,2,3)','1/0','@Total + 1/0','markup(1,"cyan")'])('rejects %s',source=>expect(compile(source).ok).toBe(false));
  it.each(['if(true,1,1/0)','coalesce(1,1/0)','true || 1/0 > 0','false && 1/0 > 0'])('short circuits %s',source=>expect(compile(source).ok).toBe(true));
  it('filters authorized relation pages and preserves root scope',()=>{
    expect(value('map(filter(@Pedidos,!@Cancelado),@Valor).sum()')).toBe(3);
    expect(value('map(@Pedidos,@root.Total-@Valor).max()')).toBe(7);
    expect(value('@Pedidos.count()')).toBe(2);
    expect(compile('map(@Total,@Valor)').ok).toBe(false);
    expect(compile('map(@Pedidos,@Total)').ok).toBe(false);
  });
  it('formula references use their unstyled value',()=>expect(value('@Saldo+1')).toBe(12));
  it('sums only numeric values within inclusive bounds',()=>{
    expect(value('map(filter(@Pedidos,@Valor >= 3 && @Valor <= 7),@Valor).sum()')).toBe(10);
    expect(value('map(filter(@Pedidos,@Valor > 3 && @Valor <= @root.Total),@Valor).sum()')).toBe(7);
    expect(value('map(filter(@Pedidos,@Valor >= 10 && @Valor <= 50),@Valor).sum()')).toBe(0);
  });
  it('canonical IDs survive renamed labels',()=>{const result=compile('@Total+1');expect(result.ok).toBe(true);if(!result.ok)return;expect(result.canonicalSource).toBe(`@columns.${total}+1`);expect(displaySource(result.canonicalSource,[{...catalog[0]!,name:'Novo'}])).toBe('@Novo+1')});
  it('keeps IDs when labels would be ambiguous or unparseable',()=>{
    const source=`@columns.${total}+1`;
    expect(displaySource(source,[catalog[0]!,{...catalog[0]!,id:id(99)}])).toBe(source);
    expect(displaySource(source,[{...catalog[0]!,name:'Total }'}])).toBe(source);
  });
  it('keeps missing values empty and supports explicit fallback',()=>{const missing={...context,pages:{...context.pages,'root-page':{...context.pages['root-page']!,values:{}}}};expect(evaluateFormula(compile('@Total+1'),missing).ok).toBe(false);expect(evaluateFormula(compile('coalesce(@Total,0)+1'),missing)).toMatchObject({ok:true,value:1})});
  it('detects cycles before execution',()=>expect(compileFormula('@Saldo',{catalog:[...catalog.slice(0,4),{...catalog[4]!,source:'@Saldo'}],databaseId:'root'})).toMatchObject({ok:false,diagnostics:[{code:'CYCLE'}]}));
  it('bounds source, parsing, text and evaluation work',()=>{expect(compile('1+'.repeat(5000)+'1').ok).toBe(false);expect(compile('('.repeat(100)+'1'+')'.repeat(100)).ok).toBe(false);expect(evaluateFormula(compile('map(@Pedidos,@Valor).sum()'),context,{steps:1})).toMatchObject({ok:false,error:{code:'BUDGET'}})});
  it('returns markup as structured data',()=>expect(value('markup("<img src=x>","purple")')).toEqual({kind:'markup',value:'<img src=x>',color:'purple'}));
  it('completes in relation context',()=>expect(completionContext('map(@Pedidos, ',14,{catalog,databaseId:'root'})).toBe('orders'));
});
