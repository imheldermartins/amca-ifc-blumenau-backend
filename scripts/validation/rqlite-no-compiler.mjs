import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='typescript-compiler'||specifier.startsWith('typescript-compiler/')||specifier==='tsx'||specifier.startsWith('tsx/')){
    throw new Error('Production runtime attempted to load development compiler: '+specifier);
  }
  return nextResolve(specifier,context);
}});
