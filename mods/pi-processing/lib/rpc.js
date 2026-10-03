'use strict';
const MESSAGES={DOCK_AT_JOB_LOCATION:'Нужно докнуться в месте производства.',LOCATION_ACCESS_DENIED:'Нет доступа к ангару структуры.',LOCATION_UNAVAILABLE:'Место производства недоступно.',JOB_NOT_READY:'Партия ещё не готова.',JOB_NOT_FOUND:'Задание не найдено.',REQUEST_MISMATCH:'Параметры повторного запроса отличаются.',INSUFFICIENT_MATERIALS_OR_QUANTITY_LIMIT:'Не хватает материалов или превышен технический размер партии.',RATE_LIMIT:'Слишком частые запросы. Повторите через секунду.',START_NOT_COMMITTED:'Материалы не списаны. Запустите новую партию.',INVALID_QUANTITY:'Введите положительное целое количество.',TOO_MANY_STACKS:'Слишком много отдельных стопок. Объедините материалы в ангаре.'};
function installRpc(Service,getService){
  const ready=new WeakMap(),limits=new WeakMap(),handlers=new Map();
  const char=s=>Number(s?.characterID||s?.charid)||0;
  function add(name,fn){if(Service.prototype[name])throw Error('RPC_ALREADY_REGISTERED');Service.prototype[name]=fn;handlers.set(name,fn);}
  function decode(args,fields){let raw=args?.[0];if(raw&&['wstring','token','rawstr'].includes(raw.type))raw=raw.value;if(Buffer.isBuffer(raw))raw=raw.toString('utf8');if(typeof raw!=='string'||Buffer.byteLength(raw)>4096)throw Error('INVALID_REQUEST');const req=JSON.parse(raw);if(!req||Array.isArray(req)||typeof req!=='object'||Object.keys(req).some(k=>!fields.includes(k)))throw Error('INVALID_REQUEST');return req;}
  add('Handle_PiProcessingReady',function(args,s){if(char(s))ready.set(s,char(s));return JSON.stringify({ok:!!char(s),version:'0.1.0'});});
  for(const [name,method,fields] of [['Catalogue','catalogue',[]],['Quote','quote',['schematicID','batches']],['Start','start',['schematicID','batches','requestID']],['Collect','collect',['jobID','requestID']],['Jobs','list',['cursor','limit']]]){
    add('Handle_PiProcessing'+name,function(args,s){try{
      if(!char(s)||ready.get(s)!==char(s))throw Error('CHARACTER_REQUIRED');
      const now=Date.now(),prior=limits.get(s)||{at:0,count:0};if(now-prior.at>1000){prior.at=now;prior.count=0;}prior.count++;limits.set(s,prior);if(prior.count>8)throw Error('RATE_LIMIT');
      const req=decode(args,fields),reply=JSON.stringify(getService()[method](s,req));if(Buffer.byteLength(reply)>256*1024)throw Error('RESPONSE_TOO_LARGE');return reply;
    }catch(e){console.error('[PIProcessing] '+e.message);return JSON.stringify({ok:false,code:e.message,message:MESSAGES[e.message]||('Операция недоступна: '+String(e.message).slice(0,120))});}});
  }
  return {open(s){if(ready.get(s)!==char(s)||!char(s))return 'PI Processing UI not ready; restart client.';s.sendNotification('OnPiProcessingOpen','clientID',[]);return 'PI Processing opened.';},restore(){for(const [name,fn]of handlers)if(Service.prototype[name]===fn)delete Service.prototype[name];}};
}
module.exports={installRpc};
