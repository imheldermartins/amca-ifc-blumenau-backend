import {describe,it,expect} from 'vitest';
import {compileFormula,evaluateFormula,type FormulaSymbol,type FormulaContext,completionContext,displaySource,LIMITS} from './index.js';
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

describe('Text padding',()=>{
  it.each([
    ['padStart("7", 3, "0")', '007'],
    ['"7".padEnd(3, "0")', '700'],
    ['padStart("a", 4)', '   a'],
    ['padEnd("a", 4)', 'a   '],
    ['padStart("abc", 2, "0")', 'abc'],
    ['padEnd("abc", 0, "0")', 'abc'],
    ['padStart("a", 5, "")', 'a'],
    ['padEnd("", 3, "ab")', 'aba'],
    ['padStart("x", 4, "ab")', 'abax'],
    ['padEnd("😀", 4, "🐱a")', '😀🐱a🐱'],
    ['padStart("😀", 3, "🐱")', '🐱🐱😀'],
    ['padStart(toText(@Total), 4, "0")', '0010'],
    ['map(@Pedidos, padEnd(@page.title, 3, "!")).join(",")', 'A!!,B!!'],
  ])('evaluates %s',(source,expected)=>expect(value(source)).toBe(expected));
  it.each([
    'padStart("a")', 'padEnd("a", 2, "0", "x")',
    'padStart(7, 3, "0")', 'padEnd("a", "3")', 'padStart("a", 3, 0)',
    'padEnd(null, 3)', 'padStart("a", 3, null)',
    'padStart("a", -1)', 'padEnd("a", 2.5)', `padStart("a", ${LIMITS.text + 1})`,
  ])('rejects invalid arguments in %s',source=>expect(compile(source).ok).toBe(false));
  it('validates dynamic sizes and missing values at evaluation time',()=>{
    const compiled=compile('padStart(@page.title, @Total, "0")');
    for(const size of [-1,1.5,LIMITS.text+1]) {
      const pages={...context.pages,'root-page':{...context.pages['root-page']!,values:{[total]:size}}};
      expect(evaluateFormula(compiled,{...context,pages})).toMatchObject({ok:false,error:{code:'ARGUMENT'}});
    }
    const pages={...context.pages,'root-page':{...context.pages['root-page']!,title:null}};
    expect(evaluateFormula(compiled,{...context,pages})).toMatchObject({ok:false,error:{code:'TEXT'}});
  });
  it('bounds allocation in UTF-16 units and respects the execution budget',()=>{
    const compiled=compile('padEnd(@page.title, 65536, "x")');
    const result=evaluateFormula(compiled,context,{steps:200000});
    expect(result.ok && typeof result.value==='string' && result.value.length).toBe(LIMITS.text);
    expect(compile(`padEnd("", ${LIMITS.text}, "😀")`)).toMatchObject({ok:false,diagnostics:[{code:'TEXT_LIMIT'}]});
    expect(evaluateFormula(compile('padStart(@page.title, 100, "0")'),context,{steps:50})).toMatchObject({ok:false,error:{code:'BUDGET'}});
  });
});

describe('Page index',()=>{
  const indexed:FormulaContext={...context,pages:{...context.pages,
    'root-page':{...context.pages['root-page']!,index:3},
    a:{...context.pages.a!,index:2},b:{...context.pages.b!,index:8},
  }};
  it('compiles contextual calls without inventing a constant result',()=>{
    expect(compile('index()')).toMatchObject({ok:true,valueType:{kind:'number'},requiresPageIndex:true});
    expect(run('index()')).toMatchObject({ok:false,error:{code:'PAGE_INDEX'}});
    expect(evaluateFormula(compile('index()'),indexed)).toMatchObject({ok:true,value:3});
    expect(evaluateFormula(compile('padStart(toText(index()), 4, "0")'),indexed)).toMatchObject({ok:true,value:'0003'});
  });
  it.each(['index(1)','@Total.index()','index()+1/0','padStart("a", index(), 1)'])('rejects %s',source=>expect(compile(source).ok).toBe(false));
  it('uses each related page database position rather than its list position',()=>{
    expect(evaluateFormula(compile('map(@Pedidos,index())'),indexed)).toMatchObject({ok:true,value:[2,8]});
    expect(evaluateFormula(compile('map(filter(@Pedidos,index()>3),index()).sum()'),indexed)).toMatchObject({ok:true,value:8});
  });
  it('propagates contextual dependencies and respects the referenced formula owner',()=>{
    const symbols=[...catalog.slice(0,4),{...catalog[4]!,source:'index()'}];
    const compiled=compileFormula('map(@Pedidos,@root.Saldo+index()).sum()',{catalog:symbols,databaseId:'root'});
    expect(compiled).toMatchObject({ok:true,requiresPageIndex:true});
    expect(evaluateFormula(compiled,indexed)).toMatchObject({ok:true,value:16});
  });
  it('preserves lazy evaluation and rejects invalid or unauthorized page context',()=>{
    expect(value('if(true, 1, index())')).toBe(1);
    for(const index of [0,-1,1.5,Infinity]) {
      expect(evaluateFormula(compile('index()'),{...indexed,pages:{...indexed.pages,'root-page':{...indexed.pages['root-page']!,index}}})).toMatchObject({ok:false,error:{code:'PAGE_INDEX'}});
    }
    expect(evaluateFormula(compile('index()'),{...indexed,pageId:'hidden'})).toMatchObject({ok:false,error:{code:'ACCESS'}});
    expect(evaluateFormula(compile('index()'),{...indexed,pageId:'a'})).toMatchObject({ok:false,error:{code:'SCOPE'}});
  });
});
