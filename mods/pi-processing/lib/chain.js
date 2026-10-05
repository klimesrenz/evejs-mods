'use strict';
// Exact fractions keep shared intermediate requirements from being rounded twice.
function gcd(a,b){while(b){const next=a%b;a=b;b=next;}return a;}
function fraction(n,d=1n){const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor};}
function add(a,b){return fraction(a.n*b.d+b.n*a.d,a.d*b.d);}
function multiply(a,n,d=1){return fraction(a.n*BigInt(n),a.d*BigInt(d));}
function safe(n){const value=Number(n);if(!Number.isSafeInteger(value)||value<=0)throw Error('PI_CHAIN_QUANTITY_OUT_OF_RANGE');return value;}
function expandChains(recipes,tierOf){
  const producers=new Map();
  for(const r of recipes){const typeID=r.outputs[0].typeID;if(producers.has(typeID))throw Error('AMBIGUOUS_PI_RECIPE:'+typeID);producers.set(typeID,r);}
  return recipes.map(root=>{
    const leaves=new Map(),runs=new Map();
    function accumulate(map,id,value){map.set(id,add(map.get(id)||fraction(0n),value));}
    function visit(typeID,quantity,parentTier,path){
      const tier=tierOf(typeID);
      if(tier===1){accumulate(leaves,typeID,quantity);return 0;}
      const producer=producers.get(typeID);
      if(!producer)throw Error('PI_CHAIN_RECIPE_MISSING:'+typeID);
      if(path.has(typeID)||!Number.isInteger(tier)||tier>=parentTier)throw Error('INVALID_PI_CHAIN:'+typeID);
      const cycles=multiply(quantity,1,producer.outputs[0].quantity);
      accumulate(runs,typeID,cycles);
      const next=new Set(path);next.add(typeID);
      const duration=producer.cycleMs+Math.max(...producer.inputs.map(input=>visit(input.typeID,multiply(cycles,input.quantity),tier,next)));
      if(!Number.isSafeInteger(duration))throw Error('INVALID_PI_CHAIN_DURATION');
      return duration;
    }
    const cycleMs=root.cycleMs+Math.max(...root.inputs.map(input=>visit(input.typeID,fraction(BigInt(input.quantity)),root.tier,new Set([root.outputs[0].typeID]))));
    if(!Number.isSafeInteger(cycleMs)||cycleMs<=0)throw Error('INVALID_PI_CHAIN_DURATION');
    let scale=1n;
    for(const value of [...runs.values(),...leaves.values()])scale=scale/gcd(scale,value.d)*value.d;
    const inputs=[...leaves].map(([typeID,q])=>({typeID,quantity:safe(q.n*scale/q.d)})).sort((a,b)=>a.typeID-b.typeID);
    return {...root,mode:'p1-chain',sourceCycles:safe(scale),cycleMs,inputs,
      outputs:root.outputs.map(o=>({typeID:o.typeID,quantity:safe(BigInt(o.quantity)*scale)}))};
  });
}
module.exports={expandChains};
