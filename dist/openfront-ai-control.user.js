// ==UserScript==
// @name         OpenFrontAI Local Neural (Solo AggroBot derivative)
// @namespace    https://openfront.io/
// @version      1.21.6
// @description  OpenFront autopilot for Singleplayer, Public and Private games; economy, combat, nukes, defense and diplomacy.
// @run-at       document-start
// @grant        none
// @license MIT
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// ==/UserScript==

(() => {
  'use strict';
  if(!['localhost','127.0.0.1'].includes(location.hostname)) return;
  if (window.__ofSoloAggroBot1111) return;
  window.__ofSoloAggroBot1111 = true;

  const VERSION = '1.21.5', PREFIX = '[Solo AggroBot]', KEY = 'of-solo-aggrobot-v1111';
  const defaults = {enabled:false, autoStart:false, learningEnabled:true, fullAuto:true, aggressive:85, reserve:35, actionsPerMinute:72,
    economy:true, boats:true, autoSpawn:true, defense:true, stopOnError:false,
    upgrades:true, plan:'Adaptiv', safeMode:true, maxTargets:16, buildStyle:'Ausgewogen',
    autoStrategy:true, diplomacy:true, offerAlliances:true, nukes:true, antiNuke:true, lateOffense:true,
    impossibleMode:true,impossibleExperiment:false,neuralEnabled:false,evidenceMode:false,shadowRankEnabled:false,
    // P5: bounded candidate-v5 control. Off by default (shadow-only). When on,
    // the schema-5 ranker shifts the bounded candidate ranking so it can drive
    // the channel director; legality downstream remains authoritative.
    // candidateControlMode selects the score->utility mapping (campaign §5):
    // 'raw' (default, backward-compatible), 'calibrated', 'adaptive', 'rank',
    // 'gated'. capGain/confidenceRef/margin bound the variant-specific mapping.
    candidateControlEnabled:false,candidateControlGain:18,
    candidateControlMode:'raw',candidateControlCapGain:60,
    candidateControlConfidenceRef:0.5,candidateControlMargin:0.25,
    // P7: schema-7 branch controller (after hard safety, before send).
    // actionRankEnabled: score every legal, safety-approved, executable
    // branch with the bundled schema-7 model (shadow observation).
    // actionControlEnabled: the argmax branch drives the emitted intent.
    actionRankEnabled:true,actionControlEnabled:true,
    duoEnabled:false,duoPartnerID:'',duoPartnerName:'',duoRoom:'',archetype:'legacy'};
  let opts;
  try { opts = {...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; }
  catch (_) {opts = {...defaults};}
  try {if(!localStorage.getItem(KEY)){
    opts={...defaults,...JSON.parse(localStorage.getItem('of-solo-aggrobot-v1110')||localStorage.getItem('of-solo-aggrobot-v11010')||localStorage.getItem('of-solo-aggrobot-v1109')||localStorage.getItem('of-solo-aggrobot-v1108')||localStorage.getItem('of-solo-aggrobot-v1107')||localStorage.getItem('of-solo-aggrobot-v1106')||localStorage.getItem('of-solo-aggrobot-v1105')||localStorage.getItem('of-solo-aggrobot-v1104')||localStorage.getItem('of-solo-aggrobot-v1103')||localStorage.getItem('of-solo-aggrobot-v1102')||localStorage.getItem('of-solo-aggrobot-v1101')||localStorage.getItem('of-solo-aggrobot-v1100')||localStorage.getItem('of-solo-aggrobot-v199')||localStorage.getItem('of-solo-aggrobot-v198')||localStorage.getItem('of-solo-aggrobot-v197')||localStorage.getItem('of-solo-aggrobot-v196')||localStorage.getItem('of-solo-aggrobot-v195')||localStorage.getItem('of-solo-aggrobot-v194')||localStorage.getItem('of-solo-aggrobot-v193')||localStorage.getItem('of-solo-aggrobot-v192')||localStorage.getItem('of-solo-aggrobot-v191')||localStorage.getItem('of-solo-aggrobot-v190')||localStorage.getItem('of-solo-aggrobot-v181')||localStorage.getItem('of-solo-aggrobot-v18')||localStorage.getItem('of-solo-aggrobot-v17')||'{}')};
    // Only import user-adjustable preferences, never a previously enabled bot.
  }}catch(_){}
  // Drop retired localhost Brain/Qwen preferences without keeping the old token
  // in the active options key; browser-only learning and neural settings survive.
  const retiredBrainSettings=['brainEnabled','brainToken','qwenPolicy']
    .some(key=>Object.prototype.hasOwnProperty.call(opts,key));
  delete opts.brainEnabled;delete opts.brainToken;delete opts.qwenPolicy;
  opts.actionRankEnabled=true; opts.actionControlEnabled=true; opts.autoStart=false;
  opts.enabled = false;                         // Start only after a playable match and EventBus are discovered.
  // One-time v1.10 migration: full autonomy includes marine operation;
  // a later manual choice is saved under the new key as usual.
  if(!localStorage.getItem(KEY) && opts.fullAuto)opts.boats=true;
  if(opts.fullAuto)opts.autoStrategy=true;     // Full autonomy includes strategy selection.
  // User preferences are distinct from temporary archetype overrides.
  const ARCHETYPE_SETTING_KEYS=['boats','diplomacy','offerAlliances','nukes'];
  let archetypeBaseOptions=Object.fromEntries(
    ARCHETYPE_SETTING_KEYS.map(k=>[k,opts[k]]));
  let archetypeEffectiveOptions=null;
  function captureBaseOptions(){
    for(const k of ARCHETYPE_SETTING_KEYS){
      if(!archetypeEffectiveOptions||
         opts[k]!==archetypeEffectiveOptions[k])
        archetypeBaseOptions[k]=opts[k];
    }
  }
  const persist = () => {try {
    captureBaseOptions();
    localStorage.setItem(KEY,JSON.stringify({...opts,...archetypeBaseOptions}));
  } catch (_) {}};
  if(retiredBrainSettings)persist();
function archetypeRankKernel(candidates,arch,tick){
  const out=(candidates||[]).map(c=>({...c}));
  for(const c of out){
    if(c.kind==='attack'){
      c.utility+=arch.attackUtility||0;
      if(tick<(arch.firstAttackGate||0))c.utility-=1000;
    }else if(c.kind==='hold'||c.kind==='support')c.utility+=arch.holdUtility||0;
    else if(c.kind==='invest')c.utility+=arch.investUtility||0;
    else if(c.kind==='naval')c.utility+=arch.navalUtility||0;
  }
  out.sort((a,b)=>b.utility-a.utility||String(a.id).localeCompare(String(b.id)));
  return out;
}
function economyRecoveryKernel(input){
  const x=input||{};
  const incomeCollapse=x.observed===true&&x.train===0&&x.trade===0&&
    x.cities>=1&&x.factories>=1&&
    (x.cities<2||x.factories<2||x.failedEconomyProbes>=5);
  const coreRecovery=(x.startup||incomeCollapse)&&x.land>0&&x.incoming===0&&
    !(incomeCollapse&&x.nuclearThreat&&!x.startup);
  return {incomeCollapse,coreRecovery};
}
function marineObservationGraceKernel(arrivalTick,observationLostTick){
  const projected=Number.isFinite(arrivalTick)?
    arrivalTick-observationLostTick+120:120;
  return Math.min(360,Math.max(120,projected));
}
function candidateControlKernel(candidates,scores,gain=18){
  const g=Number.isFinite(+gain)?Math.min(60,Math.max(0,+gain)):18;
  const out=(candidates||[]).map(c=>{
    const score=scores?.get?scores.get(c.id):scores?.[c.id];
    return Number.isFinite(score)?{...c,utility:Math.round(c.utility+g*score)}:{...c};
  });
  out.sort((a,b)=>b.utility-a.utility||String(a.id).localeCompare(String(b.id)));
  return out;
}
// Controller variants (campaign §5). `raw` is identical to candidateControlKernel
// (gain * raw score). All variants re-order only already-legal candidates and
// never change legality (the downstream channel director still authorizes the
// selected candidate). `calibrated` normalizes model scores to a per-frame
// z-score before scaling, so a near-degenerate score vector still expresses its
// full ranking; `adaptive` scales the gain up to capGain with the model's
// top-1/top-2 confidence margin; `rank` maps the model's rank position to a
// scale-free utility bonus (1 = best, 0 = worst); `gated` applies the bonus only
// when the model's top-1 clearly beats the rule top-1 by `margin` AND the
// implied required gain is within capGain, otherwise it keeps the rule order.
function candidateControlVariant(candidates,scores,gain=18,mode='raw',opts={}){
  const g=Number.isFinite(+gain)?Math.min(60,Math.max(0,+gain)):18;
  const cand=Array.isArray(candidates)?candidates:[];
  const rows=cand.map(c=>{
    const sc=scores?.get?scores.get(c.id):scores?.[c.id];
    return {c,score:Number.isFinite(sc)?sc:null};
  });
  const scored=rows.filter(r=>r.score!=null);
  const byScore=[...scored].sort((a,b)=>b.score-a.score||String(a.c.id).localeCompare(String(b.c.id)));
  const top1=byScore[0],top2=byScore[1];
  const confidence=(top1&&top2)?(top1.score-top2.score):0;
  const ruleTop=cand[0];
  const cap=Number.isFinite(+opts.capGain)?Math.min(60,Math.max(0,+opts.capGain)):60;
  const confRef=Number.isFinite(+opts.confidenceRef)&&+opts.confidenceRef>0?+opts.confidenceRef:0.5;
  const margin=Number.isFinite(+opts.margin)?+opts.margin:0.25;
  let utilityOf;
  if(mode==='calibrated'){
    const vals=scored.map(r=>r.score);
    const mean=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
    const sd=Math.sqrt(vals.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,vals.length));
    const inv=sd>1e-9?1/sd:1;
    utilityOf=r=>r.score==null?r.c.utility:Math.round(r.c.utility+g*(r.score-mean)*inv);
  } else if(mode==='adaptive'){
    const gEff=g+(cap-g)*Math.max(0,Math.min(1,confidence/confRef));
    utilityOf=r=>r.score==null?r.c.utility:Math.round(r.c.utility+gEff*r.score);
  } else if(mode==='rank'){
    const n=scored.length;
    const rankOf=new Map();
    byScore.forEach((r,i)=>rankOf.set(r.c.id,n>1?1-i/(n-1):1));
    utilityOf=r=>{const p=rankOf.get(r.c.id);return p==null?r.c.utility:Math.round(r.c.utility+cap*p);};
  } else if(mode==='gated'){
    const modelTop=top1?top1.c.id:null;
    const ruleId=ruleTop?ruleTop.id:null;
    const ruleScore=ruleId!=null?((byScore.find(r=>r.c.id===ruleId)?.score)??0):0;
    const modelScore=top1?top1.score:0;
    const modelUtil=modelTop!=null?((byScore.find(r=>r.c.id===modelTop)?.c.utility)??ruleTop?.utility??0):(ruleTop?.utility??0);
    const ruleUtil=ruleTop?.utility??0;
    const gap=modelScore-ruleScore;
    const required=(modelTop!=null&&modelTop!==ruleId&&gap>1e-9)?(ruleUtil-modelUtil)/gap:0;
    const gate=ruleId!=null&&modelTop!=null&&modelTop!==ruleId&&gap>=margin&&required<=cap;
    const gUse=gate?cap:0;
    utilityOf=r=>r.score==null?r.c.utility:Math.round(r.c.utility+gUse*r.score);
  } else {
    // 'raw' (and default): the original gain * raw score mapping.
    utilityOf=r=>r.score==null?r.c.utility:Math.round(r.c.utility+g*r.score);
  }
  const out=rows.map(r=>({...r.c,utility:utilityOf(r)}));
  out.sort((a,b)=>b.utility-a.utility||String(a.id).localeCompare(String(b.id)));
  return out;
}
function reserveResolutionKernel(home,floors){
  const f=floors||{},entries=Object.entries(f).filter(([,v])=>Number.isFinite(v));
  const reserve=Math.min(Math.max(0,home||0),
    Math.ceil(Math.max(0,...entries.map(([,v])=>v))));
  const reason=entries.filter(([,v])=>v>=reserve-.501)
    .map(([k])=>k).join('+')||'baseline';
  return {reserve,available:Math.max(0,Math.floor((home||0)-reserve)),
    reserveReason:reason};
}
function actionEvidenceKernel(ledger){
  const rows=Array.isArray(ledger)?ledger:[];
  const confirmed=rows.filter(v=>
    String(v?.observed||'').endsWith('_confirmed')||
    v?.observed==='engine-donate-event');
  const unconfirmed=rows.filter(v=>
    String(v?.observed||'').endsWith('_unconfirmed'));
  const effects=rows.filter(v=>v?.effect!=null&&v.effect!=='unknown');
  return {
    intents:rows.length,
    confirmedObservations:confirmed.length,
    unconfirmedObservations:unconfirmed.length,
    stillUnknown:rows.filter(v=>!v?.observed||v.observed==='unknown').length,
    effectsObserved:effects.length,
    ratios:{
      confirmedPerIntent:rows.length?confirmed.length/rows.length:null,
      effectPerIntent:rows.length?effects.length/rows.length:null
    },
    semantics:'intent -> confirmation observation -> effect observation; missing evidence is never failure or success'
  };
}
// Shared SAM/silo policy: observed inbound nukes, not a visible enemy silo,
// override a funded first silo. A missing/stale relay never blocks solo play.
function duoNuclearInvestmentKernel(x){
  const coreReady=x.coreReady===true,peerValid=x.peerValid===true;
  const siloReady=x.siloAllowed===true&&coreReady&&x.late===true&&
    x.land>900&&x.siloSiteBlocked!==true;
  // Old peers have no canonical readiness. Do not interpret missing as false:
  // that makes both browsers elect themselves. Wait for an observed peer silo.
  const peerProtocol=peerValid&&x.peerNuclearProtocol===1;
  const peerReady=peerProtocol&&x.peerSiloReady===true;
  const primary=!peerValid || (peerProtocol&&
    (siloReady!==peerReady?siloReady:String(x.ownId)<String(x.peerId)));
  const peerHasSilo=peerValid&&x.peerSilos>0;
  const firstSiloWindow=siloReady&&(primary||peerHasSilo);
  const incoming=Math.max(0,x.incomingNukes||0);
  const uncovered=Math.max(0,x.uncovered||0);
  const ownSAM=Math.max(0,x.ownSAM||0),silos=Math.max(0,x.silos||0);
  // A visible enemy silo is not an incoming strike. First finish the two
  // City/two Factory economic core; actual inbound nukes still bypass it.
  const firstGuard=x.antiNuke===true&&!x.samSearchBlocked&&
    coreReady&&uncovered>0&&ownSAM===0&&
    ((x.enemySilos||0)>0||x.proactiveSAM===true);
  const siloFundActive=firstSiloWindow&&silos===0&&
    !x.urgentVictory&&!incoming&&!firstGuard;
  let wantedSAM=0;
  if(uncovered>0&&x.antiNuke===true){
    if(incoming)wantedSAM=Math.min(7,Math.max(ownSAM+1,
      Math.ceil(uncovered/3)+Math.min(2,incoming)));
    else if(firstGuard)wantedSAM=1;
    else if(coreReady&&(x.enemySilos||0)>0&&!siloFundActive)
      wantedSAM=Math.min(silos>0&&x.nukeShots>0?3:silos>0?1:2,
        Math.max(ownSAM,Math.ceil(uncovered/3)));
    else if(coreReady&&x.proactiveSAM===true&&ownSAM===0)wantedSAM=1;
  }
  return {primary,peerValid,firstSiloWindow,siloFundActive,firstGuard,
    wantedSAM,samFundingUrgent:incoming>0||firstGuard,
    samUpgradeAllowed:uncovered>0&&
      (incoming>0||silos>0&&x.nukeShots>0&&(x.enemySilos||0)>0)};
}

  // P1: versionierte, überprüfbare Gegner-Archetypen. Ein Archetyp ist eine
  // GEFRORENE Strategiepolitik, die die Kandidaten-Rangfolge des Planers – und
  // damit die tatsächlich gesendete Aktion – ändert. Die Unterscheidbarkeit
  // liegt in Timing, Zielauswahl und aktivierten Subsystemen, NICHT nur in
  // Slider-Werten. Die Version wird in jeder Liga festgehalten; ein unbekanntes
  // oder fehlendes Feld ist 'legacy' (der exakte Basiswert ohne Zusatzpolitik).
  const ARCHETYPE_VERSION='archetype-v1';
  const ARCHETYPES=Object.freeze({
    legacy:{version:ARCHETYPE_VERSION,kind:'baseline',
      note:'aktueller deterministischer Regel-Basiswert ohne Zusatzpolitik'},
    rush:{version:ARCHETYPE_VERSION,kind:'offensive-early',
      note:'frühe Angriffe und frühe Front; geringe Wartezeit'},
    turtle:{version:ARCHETYPE_VERSION,kind:'defensive-late',
      note:'hohe Reserve, späte Angriffe, defensive Festigung'},
    economy:{version:ARCHETYPE_VERSION,kind:'economic-growth',
      note:'Einkommensbau und Goldsparen vor Angriffen'},
    naval:{version:ARCHETYPE_VERSION,kind:'naval-operations',
      note:'Marine-/Flotten-Operationen priorisieren'},
    opportunist:{version:ARCHETYPE_VERSION,kind:'weakest-target',
      note:'schwächsten Feind bevorzugen'},
    diplomat:{version:ARCHETYPE_VERSION,kind:'alliance-builder',
      note:'proaktive Bündnisangebote'},
    nuke:{version:ARCHETYPE_VERSION,kind:'nuclear-strike',
      note:'Nuke-Kapazitäten priorisieren'},
    duo:{version:ARCHETYPE_VERSION,kind:'coordinated-team',
      note:'bestätigte Duo-/Team-Koordination über Relay'},
    champion:{version:ARCHETYPE_VERSION,kind:'frozen-champion',
      note:'eingefrorener Run3 Schema-4-Champion (Policy)'}
  });
  // Reine Abfrage der gefrorenen Politik für das aktuelle opts.archetype.
  function archetypePolicy(){
    const id=ARCHETYPES[opts.archetype]?opts.archetype:'legacy';
    const base={id,version:ARCHETYPES[id].version,kind:ARCHETYPES[id].kind,
      firstAttackGate:0,attackUtility:0,holdUtility:0,investUtility:0,
      navalUtility:0,targetWeakest:false,
      boats:null,diplomacy:null,offerAlliances:null,nukes:null};
    if(id==='rush')return {...base,firstAttackGate:1,attackUtility:24,
      investUtility:-20,boats:false,offerAlliances:false};
    if(id==='turtle')return {...base,firstAttackGate:640,attackUtility:-28,
      holdUtility:16,investUtility:8,boats:false};
    if(id==='economy')return {...base,firstAttackGate:420,attackUtility:-22,
      investUtility:28,holdUtility:8,nukes:false};
    if(id==='naval')return {...base,firstAttackGate:180,navalUtility:36,
      investUtility:8,attackUtility:-6,boats:true};
    if(id==='opportunist')return {...base,firstAttackGate:120,targetWeakest:true,
      attackUtility:10};
    if(id==='diplomat')return {...base,firstAttackGate:300,attackUtility:-12,
      holdUtility:8,diplomacy:true,offerAlliances:true};
    if(id==='nuke')return {...base,firstAttackGate:240,attackUtility:4,nukes:true};
    return base;
  }
  // Überprüfbares Verhaltensprofil: wird pro Planungstick befüllt und in der
  // Diagnose exponiert. Beweist, dass Archetypen tatsächlich verschiedene
  // Strategien fahren (Timing, Zielauswahl, Subsysteme), nicht nur Namen.
  const archetypeStats={version:ARCHETYPE_VERSION,id:null,
    firstAttackTick:null,plannedTicks:0,
    selectedByKind:{attack:0,hold:0,invest:0,naval:0,expand:0,support:0},
    attackTargetTotal:0,attackWeakestTarget:0};
  function archetypeRecord(selected,groups,me,tick){
    archetypeStats.plannedTicks++;
    archetypeStats.id=archetypePolicy().id;
    const kind=selected?.kind;
    if(kind&&archetypeStats.selectedByKind[kind]!==undefined)
      archetypeStats.selectedByKind[kind]++;
    if(kind==='attack'){
      archetypeStats.attackTargetTotal++;
      if(archetypeStats.firstAttackTick===null)archetypeStats.firstAttackTick=tick;
      const hostiles=(groups||[]).filter(g=>g.id!==null&&!friendly(g.opponent,me));
      const weakest=hostiles.slice().sort((a,b)=>
        number(()=>a.opponent?.troops?.(),0)-number(()=>b.opponent?.troops?.(),0))[0];
      if(weakest&&selected.target===weakest.id)archetypeStats.attackWeakestTarget++;
    }
  }
  function archetypeSignature(){
    const s=archetypeStats;
    return {version:s.version,archetype:s.id,firstAttackTick:s.firstAttackTick,
      plannedTicks:s.plannedTicks,selectedByKind:{...s.selectedByKind},
      attackTargetTotal:s.attackTargetTotal,
      weakestTargetFraction:s.attackTargetTotal>0?
        s.attackWeakestTarget/s.attackTargetTotal:null,
      semantics:'observed-planner-choice; sent-is-not-confirmed-effect'};
  }
  // Erzwinge die vom Archetypen geforderten Subsysteme (Marine, Diplomatie,
  // Nukes), damit die gefrorene Strategie auch tatsächlich ausgeführt wird.
  // 'legacy' erzwingt nichts (alle Felder null) und bleibt der Basiswert.
  function applyArchetypeOptions(){
    // Capture deliberate preference edits, not the previous archetype's
    // effective overrides. Restore the base BEFORE applying any new policy.
    captureBaseOptions();
    for(const k of ARCHETYPE_SETTING_KEYS)opts[k]=archetypeBaseOptions[k];
    const p=archetypePolicy();
    for(const k of ARCHETYPE_SETTING_KEYS)
      if(p[k]!==null)opts[k]=p[k];
    archetypeEffectiveOptions=Object.fromEntries(
      ARCHETYPE_SETTING_KEYS.map(k=>[k,opts[k]]));
    // Never persist effective archetype overrides as user preferences.
  }

  // Deployment replaces only the literal below; benchmark loads a signed-by-hash
  // local model from its isolated loopback storage. No browser network fetches.
  const NEURAL_BUNDLED_MODEL = null;
  const SHADOW_V5_BUNDLED_MODEL = null;
  // GENERATED-SHADOW-V5-BEGIN: keep equal to trainer/candidate-policy-v5.cjs
  const shadowV5=(()=>{
const INPUTS=32,HIDDEN=20,OUTPUTS=2;
const LENGTH=INPUTS*HIDDEN+HIDDEN+HIDDEN*OUTPUTS+OUTPUTS;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const logrel=(n,base)=>clamp(Math.log1p(Math.max(0,Number(n)||0))/
  Math.log1p(Math.max(1,Number(base)||1)),0,2)/2;
function features(state={},candidate={}){
  const home=Math.max(1,Number(state.home)||1),gold=Math.max(1,Number(state.gold)||1);
  const values=[
    logrel(state.home,state.maxTroops),logrel(state.gold,10000000),
    clamp((state.incoming||0)/home,0,2)/2,clamp((state.committed||0)/home,0,2)/2,
    clamp((state.reserve||0)/home,0,1),clamp(state.economyRelative,0,2)/2,
    clamp(state.capacityUse,0,1),clamp(state.frontReach,0,1),
    clamp(state.partnerNeed,0,1),clamp(state.enemyBound,0,1),
    clamp(state.landTrend,-1,1)/2+.5,clamp(state.goldTrend,-1,1)/2+.5,
    clamp(state.troopTrend,-1,1)/2+.5,clamp(state.frontCount/8,0,1),
    clamp(state.portAccess,0,1),clamp(state.technologyCoverage,0,1),
    clamp(candidate.expectedLand/Math.max(1,state.land||1),0,1),
    clamp(candidate.costTroops/home,0,1),clamp(candidate.costGold/gold,0,1),
    clamp(candidate.duration/1200,0,1),clamp(candidate.returnTime/1200,0,1),
    clamp(candidate.counterRisk,0,1),clamp(candidate.thirdPartyRisk,0,1),
    clamp(candidate.infrastructureValue,0,1),clamp(candidate.incomeValue,0,1),
    clamp(candidate.recruitmentValue,0,1),clamp(candidate.siteRisk,0,1),
    clamp(candidate.holdProbability,0,1),clamp(candidate.legalConfidence,0,1),
    candidate.kind==='attack'?1:0,candidate.kind==='investment'?1:0,
    candidate.kind==='naval'?1:0
  ];
  return values.map(v=>clamp(v));
}
function validate(model){
  if(!model||model.schema!==5||model.arch!=='32x20x2-tanh'||
    !Array.isArray(model.outputs)||model.outputs.length!==OUTPUTS||
    model.outputs[0]!=='heldGain'||model.outputs[1]!=='lossRisk'||
    !Array.isArray(model.weights)||model.weights.length!==LENGTH||
    Array.from(model.weights).some(x=>!Number.isFinite(x)||Math.abs(x)>5))
    throw Error('Invalid schema-5 candidate model');
  return model;
}
function zero(){return {schema:5,arch:'32x20x2-tanh',
  outputs:['heldGain','lossRisk'],weights:Array(LENGTH).fill(0)};}
function predict(model,input){
  const w=validate(model).weights;
  if(!Array.isArray(input)||input.length!==INPUTS||input.some(x=>!Number.isFinite(x)||x<0||x>1))
    throw Error('Invalid candidate feature vector');
  const h=[],hiddenBias=INPUTS*HIDDEN,outStart=hiddenBias+HIDDEN,
    outBias=outStart+HIDDEN*OUTPUTS;
  for(let j=0;j<HIDDEN;j++){let z=w[hiddenBias+j];for(let i=0;i<INPUTS;i++)z+=input[i]*w[i*HIDDEN+j];h.push(Math.tanh(z));}
  const out=[];for(let k=0;k<OUTPUTS;k++){let z=w[outBias+k];for(let j=0;j<HIDDEN;j++)z+=h[j]*w[outStart+j*OUTPUTS+k];out.push((Math.tanh(z)+1)/2);}
  return {heldGain:out[0],lossRisk:out[1]};
}
    return {features,validate,predict};
  })();
  // GENERATED-SHADOW-V5-END
  let shadowV5Model=null;
  try{shadowV5Model=shadowV5.validate(SHADOW_V5_BUNDLED_MODEL);}catch(_){shadowV5Model=null;}
  const SHADOW_V6_BUNDLED_MODEL = null;
  // GENERATED-SHADOW-V6-BEGIN: keep equal to trainer/candidate-policy-v6.cjs
  const shadowV6=(()=>{
const INPUTS=38,OUTPUTS=2;
const KINDS=['hold','invest','attack','expand','naval','support'];
const HIDDEN_BY_ARCH={'38x24x2-tanh':24,'38x40x2-tanh':40};
const ARCHES=Object.keys(HIDDEN_BY_ARCH);
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const logrel=(n,base)=>clamp(Math.log1p(Math.max(0,Number(n)||0))/
  Math.log1p(Math.max(1,Number(base)||1)),0,2)/2;
// Bounded rule-utility normalization. Rule utilities are order-of-magnitude
// bounded in [~-1000 (gated early attack), ~+150 (strong candidate)]; the
// absolute feature is an offset/scale map, the gaps are signed-bounded so a
// candidate far below the rule leader saturates at 1 without the -1000 gated
// early-attack floor collapsing the whole frame.
const RU_ABS_OFFSET=100,RU_ABS_SCALE=200,RU_GAP_SCALE=100;
function lengthFor(arch){const h=HIDDEN_BY_ARCH[arch];
  if(h===undefined)throw Error('Invalid schema-6 arch '+arch);
  return INPUTS*h+h+h*OUTPUTS+OUTPUTS;}
// 38-dim candidate feature vector.
//   idx 0-28  state + candidate contract (identical to schema-5, verified)
//   idx 29-34 kind one-hot: hold, invest, attack, expand, naval, support
//   idx 35    candidateRuleUtility (own rule utility, bounded)
//   idx 36    utilityGapToRuleTop1 (top-1 utility - own, bounded)
//   idx 37    utilityGapToRuleTop2 (top-2 utility - own, bounded)
// ctx is the per-frame rule-utility context: {ownRu, ruTop1, ruTop2}.
function features(state={},candidate={},ctx={}){
  const home=Math.max(1,Number(state.home)||1),gold=Math.max(1,Number(state.gold)||1);
  const kind=String(candidate.kind||'');
  const ownRu=Number(ctx.ownRu),top1=Number(ctx.ruTop1),top2=Number(ctx.ruTop2);
  const values=[
    logrel(state.home,state.maxTroops),logrel(state.gold,10000000),
    clamp((state.incoming||0)/home,0,2)/2,clamp((state.committed||0)/home,0,2)/2,
    clamp((state.reserve||0)/home,0,1),clamp(state.economyRelative,0,2)/2,
    clamp(state.capacityUse,0,1),clamp(state.frontReach,0,1),
    clamp(state.partnerNeed,0,1),clamp(state.enemyBound,0,1),
    clamp(state.landTrend,-1,1)/2+.5,clamp(state.goldTrend,-1,1)/2+.5,
    clamp(state.troopTrend,-1,1)/2+.5,clamp(state.frontCount/8,0,1),
    clamp(state.portAccess,0,1),clamp(state.technologyCoverage,0,1),
    clamp(candidate.expectedLand/Math.max(1,state.land||1),0,1),
    clamp(candidate.costTroops/home,0,1),clamp(candidate.costGold/gold,0,1),
    clamp(candidate.duration/1200,0,1),clamp(candidate.returnTime/1200,0,1),
    clamp(candidate.counterRisk,0,1),clamp(candidate.thirdPartyRisk,0,1),
    clamp(candidate.infrastructureValue,0,1),clamp(candidate.incomeValue,0,1),
    clamp(candidate.recruitmentValue,0,1),clamp(candidate.siteRisk,0,1),
    clamp(candidate.holdProbability,0,1),clamp(candidate.legalConfidence,0,1),
    // idx 29-34: explicit one-hot for every action kind (no all-zero fallback).
    ...(KINDS.map(k=>k===kind?1:0)),
    // idx 35: candidateRuleUtility.
    Number.isFinite(ownRu)?clamp((ownRu+RU_ABS_OFFSET)/RU_ABS_SCALE,0,1):0,
    // idx 36: utilityGapToRuleTop1 (0 for the rule leader, grows below it).
    (Number.isFinite(ownRu)&&Number.isFinite(top1))
      ?clamp((top1-ownRu)/RU_GAP_SCALE,0,1):0.5,
    // idx 37: utilityGapToRuleTop2.
    (Number.isFinite(ownRu)&&Number.isFinite(top2))
      ?clamp((top2-ownRu)/RU_GAP_SCALE,0,1):0.5
  ];
  return values.map(v=>clamp(v));
}
function validate(model){
  if(!model||model.schema!==6)throw Error('Invalid schema-6 candidate model');
  const h=HIDDEN_BY_ARCH[model.arch];
  if(h===undefined)throw Error('Invalid schema-6 candidate model');
  const L=lengthFor(model.arch);
  if(!Array.isArray(model.outputs)||model.outputs.length!==OUTPUTS||
    model.outputs[0]!=='heldGain'||model.outputs[1]!=='lossRisk'||
    !Array.isArray(model.weights)||model.weights.length!==L||
    Array.from(model.weights).some(x=>!Number.isFinite(x)||Math.abs(x)>5))
    throw Error('Invalid schema-6 candidate model');
  return model;
}
function zero(arch){arch=arch||ARCHES[0];
  if(!HIDDEN_BY_ARCH[arch])throw Error('Invalid arch '+arch);
  return {schema:6,arch,outputs:['heldGain','lossRisk'],
    weights:Array(lengthFor(arch)).fill(0)};}
function predict(model,input){
  const m=validate(model);const h=HIDDEN_BY_ARCH[m.arch];
  if(!Array.isArray(input)||input.length!==INPUTS||
    input.some(x=>!Number.isFinite(x)||x<0||x>1))
    throw Error('Invalid candidate feature vector');
  const w=m.weights;const hb=INPUTS*h,outStart=hb+h,outBias=outStart+h*OUTPUTS;
  const hid=[];
  for(let j=0;j<h;j++){let z=w[hb+j];
    for(let i=0;i<INPUTS;i++)z+=input[i]*w[i*h+j];hid.push(Math.tanh(z));}
  const out=[];
  for(let k=0;k<OUTPUTS;k++){let z=w[outBias+k];
    for(let j=0;j<h;j++)z+=hid[j]*w[outStart+j*OUTPUTS+k];
    out.push((Math.tanh(z)+1)/2);}
  return {heldGain:out[0],lossRisk:out[1]};
}
    return {features,validate,predict};
  })();
  // GENERATED-SHADOW-V6-END
  let shadowV6Model=null;
  try{shadowV6Model=shadowV6.validate(SHADOW_V6_BUNDLED_MODEL);}catch(_){shadowV6Model=null;}
  const SHADOW_V7_BUNDLED_MODEL = {"schema": 7, "arch": "38x40x2-tanh", "outputs": ["branchScore"], "weights": [-0.027379753068089485, -0.29599010944366455, -0.35588815808296204, 0.23384377360343933, -0.02936345525085926, -0.04903163015842438, -0.07773475348949432, 0.18696917593479156, -0.021312983706593513, -0.12714943289756775, -0.17310333251953125, -0.11027895659208298, -0.11936488747596741, 0.23106274008750916, 0.059478674083948135, -0.11620081216096878, 0.140431746840477, -0.13201552629470825, -0.5102263689041138, 0.17458458244800568, -0.36008572578430176, 0.059267837554216385, 0.023175816982984543, 0.0527503676712513, -0.3038936257362366, -0.10012072324752808, -0.054544564336538315, 0.21058444678783417, 0.11775928735733032, 0.17985157668590546, 0.17802269756793976, 0.10558874905109406, 0.14587447047233582, -0.08271482586860657, -0.23760633170604706, 0.050934385508298874, 0.037859927862882614, -0.16501982510089874, -0.033897943794727325, 0.24317309260368347, 0.0881936252117157, 0.0006110561080276966, 0.08894887566566467, -0.1833668053150177, -0.05675605311989784, 0.3924241065979004, -0.09434299170970917, -0.10141631215810776, 0.04733988270163536, 0.20933084189891815, -0.19087298214435577, -0.016299936920404434, -0.24855008721351624, -0.10321489721536636, -0.06718754768371582, 0.037626687437295914, 0.05297471582889557, -0.10194143652915955, 0.0379369854927063, -0.09791926294565201, -0.4132424592971802, 0.046041205525398254, 0.023856280371546745, 0.05111340060830116, -0.1027391329407692, 0.10964517295360565, 0.042523887008428574, 0.21081483364105225, -0.04884658753871918, -0.3255755305290222, 0.017559830099344254, 0.07144729048013687, 0.07030504196882248, 0.240648090839386, -0.027738112956285477, 0.057824376970529556, 0.010706146247684956, 0.10141780972480774, -0.01553711574524641, -0.064261794090271, 0.12100661545991898, -0.07978469878435135, 0.11933859437704086, -0.04337580129504204, 0.31817832589149475, -0.08957947790622711, 8.95852135727182e-05, 0.18389013409614563, 0.06589687615633011, 0.1254843771457672, 0.04599003493785858, -0.17611905932426453, -0.27275407314300537, -0.09350370615720749, 0.04117899015545845, 0.20896261930465698, 0.03895517438650131, 0.26269295811653137, -0.08156091719865799, -0.03780593350529671, 0.09995122998952866, 0.16025374829769135, 0.05080842599272728, 0.04617086425423622, -0.1239946186542511, -0.08605021238327026, 0.00847019162029028, -0.024618608877062798, -0.12380431592464447, 0.2692558169364929, -0.10687881708145142, -0.18872855603694916, -0.26915717124938965, -0.16643527150154114, 0.10726223140954971, 0.000507658114656806, 0.03774792701005936, 0.14228329062461853, 0.14229604601860046, 0.22205299139022827, -0.3249768614768982, 0.005566232372075319, 0.03480163961648941, -0.049786604940891266, 0.14160491526126862, 0.08862341940402985, -0.13468828797340393, 0.013640184886753559, 0.027646811679005623, 0.023534249514341354, 0.11608823388814926, -0.15629011392593384, 0.16141650080680847, 0.0467764176428318, 0.21339580416679382, -0.30967557430267334, 0.07804293185472488, -0.26119935512542725, -0.26324841380119324, 0.010675479657948017, 0.045921310782432556, 0.18442019820213318, -0.0039465404115617275, -0.0929066613316536, -0.3346491754055023, -0.02985016629099846, -0.2709588408470154, 0.03777627274394035, -0.25400373339653015, -0.19057722389698029, -0.016132045537233353, 0.07077565044164658, -0.2798258662223816, -0.018764926120638847, 0.2917826473712921, 0.17004066705703735, -0.22651715576648712, -0.16194996237754822, 0.19490888714790344, -0.14124061167240143, 0.12046904116868973, 0.06448814272880554, -0.13457563519477844, 0.012037822976708412, -0.07103227823972702, 0.2823598086833954, -0.15448755025863647, 0.05679149925708771, 0.2297855168581009, 0.1440061628818512, -0.11905241012573242, 0.2571430802345276, 0.05790940299630165, 0.009255877695977688, 0.0730905830860138, -0.09378857910633087, -0.23443712294101715, -0.20759983360767365, -0.1661607176065445, 0.07075053453445435, 0.004500173963606358, -0.21128730475902557, -0.1317318230867386, -0.004051790572702885, -0.24703764915466309, -0.278533935546875, -0.18505670130252838, -0.25456035137176514, 0.27883490920066833, 0.21271799504756927, 0.31481829285621643, -0.16207273304462433, -0.16286863386631012, -0.10595963895320892, 0.027565188705921173, 0.09763024747371674, 0.2210407555103302, -0.11331716179847717, 0.04555842652916908, -0.10139990597963333, 0.2443276047706604, 0.1096881851553917, -0.001347322016954422, -0.19139336049556732, 0.11823958903551102, 0.022451620548963547, 0.03229505196213722, 0.08273477107286453, 0.06589002162218094, -0.09013403952121735, 0.0969596728682518, -0.1931535303592682, 0.34313100576400757, 0.08211690932512283, -0.01070582028478384, 0.06858997046947479, -0.24540574848651886, -0.06632568687200546, -0.15869663655757904, 0.021175812929868698, -0.01651378720998764, 0.06099821999669075, 0.2152593433856964, 0.260293185710907, 0.10985931009054184, 0.18393440544605255, -0.006730719469487667, -0.15517543256282806, -0.1927425116300583, -0.20311608910560608, -0.0030717942863702774, -0.1436227411031723, 0.08239991962909698, -0.07078766822814941, -0.4232388734817505, -0.19568486511707306, 0.020181605592370033, -0.05048108473420143, 0.2534010410308838, -0.08361442387104034, -0.2457941174507141, 0.08887999504804611, -0.45108747482299805, -0.015236795879900455, -0.010013904422521591, 0.10802262276411057, 0.0470796599984169, 0.14730185270309448, -0.3247891664505005, 0.18588079512119293, 0.1895841509103775, -0.05022763833403587, 0.0944795310497284, -0.025781730189919472, 0.22794941067695618, 0.13549470901489258, -0.1786554604768753, -0.083360955119133, -0.07260371744632721, -0.21715059876441956, -0.33840683102607727, 0.13900262117385864, -0.19153130054473877, 0.2637879252433777, 0.04996716231107712, -0.0704813003540039, -0.21199370920658112, -0.07914577424526215, 0.11709248274564743, 0.12094410508871078, 0.03822731971740723, 0.3139228820800781, -0.03922084718942642, -0.17213180661201477, 0.07977370917797089, 0.020087821409106255, 0.19904378056526184, -0.3020685911178589, -0.3168877065181732, 0.2382388710975647, 0.05973852425813675, 0.020243890583515167, -0.1254958063364029, -0.023434439674019814, -0.008759919553995132, -0.03798527643084526, -0.48257556557655334, 0.10323947668075562, -0.1835654228925705, 0.13721983134746552, -0.49928998947143555, 0.040050432085990906, 0.3823992609977722, -0.17766131460666656, 0.15693652629852295, -0.12486609071493149, -0.23311233520507812, 0.1785278171300888, -0.21510933339595795, -0.01886662468314171, -0.1943618804216385, 0.21914224326610565, -0.06088237091898918, 0.11717558652162552, -0.12306001782417297, -0.10026426613330841, -0.2454550415277481, 0.20378851890563965, 0.19904981553554535, 0.2837696671485901, -0.1040363684296608, 0.1493901163339615, 0.3031434714794159, -0.11997111886739731, 0.2678154408931732, -0.0252370722591877, 0.015978198498487473, -0.15174831449985504, 0.07969506084918976, 0.10767506062984467, 0.060566164553165436, -0.1796107143163681, 0.20114897191524506, 0.14022935926914215, 0.2037157267332077, 0.06305605173110962, -0.0475628599524498, -0.21140849590301514, -0.2744888663291931, 0.17491483688354492, -0.11248086392879486, -0.033488884568214417, 0.04016295075416565, 0.40195101499557495, -0.11193552613258362, -0.07419206947088242, -0.14824442565441132, -0.21997208893299103, -0.27200964093208313, 0.19501785933971405, -0.0384657196700573, -0.13638460636138916, -0.30185040831565857, 0.33501264452934265, 0.11192604154348373, -0.22285902500152588, -0.2881740629673004, 0.08614081889390945, 0.020458118990063667, 0.0065508754923939705, -0.10373763740062714, 0.02132793515920639, 0.01984512247145176, 0.08922404050827026, 0.23912478983402252, 0.028374800458550453, 0.08577036112546921, -0.03306962177157402, 0.028442641720175743, 0.23775610327720642, 0.10411306470632553, -0.16481024026870728, -0.06683140993118286, -0.2724345624446869, 0.08110427856445312, -0.28482818603515625, 0.2988108694553375, 0.2848573923110962, 0.1675674170255661, 0.024040639400482178, 0.0008682338520884514, 0.2264692336320877, 0.2075684368610382, 0.018005456775426865, -0.1922495812177658, 0.033317744731903076, 0.25327789783477783, -0.0040079141035676, 0.16676302254199982, -0.05592718720436096, -0.059255361557006836, -0.1137574315071106, -0.011210298165678978, -0.02996259182691574, 0.05077657848596573, -0.08927392959594727, -0.21756456792354584, 0.23680561780929565, 0.12735837697982788, -0.10198285430669785, -0.21130508184432983, -0.19569021463394165, -0.10673625767230988, 0.1539594680070877, -0.06045542657375336, 0.07858044654130936, -0.11518144607543945, -0.21191401779651642, -0.0840405747294426, -0.13222433626651764, 0.42713165283203125, 0.06275922060012817, -0.07214068621397018, -0.18156130611896515, -0.05309015512466431, -0.1760268360376358, 0.10757094621658325, -0.23208904266357422, -0.17784567177295685, 0.14044442772865295, -0.042461853474378586, -0.0911581963300705, 0.20269718766212463, 0.17100609838962555, 0.22367869317531586, -0.17714543640613556, 0.05321240425109863, -0.042418040335178375, 0.07606201618909836, 0.02804679609835148, -0.10625078529119492, 0.19823062419891357, 0.008974543772637844, -0.08261634409427643, -0.1454363316297531, -0.17386659979820251, -0.012676123529672623, -0.036249227821826935, 0.14293207228183746, 0.11969565600156784, 0.32967105507850647, 0.2041410505771637, -0.08481529355049133, 0.09657640010118484, -0.10591723769903183, 0.24139145016670227, -0.2194100022315979, 0.11802952736616135, -0.0011128629557788372, 0.19470573961734772, 0.17793720960617065, 0.08856227993965149, -0.21177220344543457, 0.1528458595275879, -0.022794732823967934, 0.09960396587848663, -0.04036300256848335, 0.299661785364151, -0.07987754791975021, 0.1605006754398346, -0.27214953303337097, -0.12707363069057465, 0.014174871146678925, -0.0560927540063858, 0.05818749591708183, -0.12793569266796112, 0.4113900363445282, -0.012545288540422916, -0.019778788089752197, 0.13929234445095062, 0.1372450292110443, -0.06367512047290802, -0.10695765167474747, -0.01507505588233471, 0.1308450698852539, 0.11830343306064606, -0.11256060004234314, -0.4509204626083374, -0.08011724799871445, -0.11493824422359467, -0.10251538455486298, 0.011820865795016289, -0.025864319875836372, 0.1534395068883896, 0.004500165581703186, -0.1793382167816162, -0.1792532205581665, 0.17595174908638, -0.15264374017715454, 0.03215062618255615, 0.08777029067277908, -0.15427497029304504, 0.14926129579544067, 0.2598927617073059, 0.047286152839660645, -0.16797660291194916, -0.08960442245006561, 0.0027898356784135103, 0.1634753942489624, 0.2339210957288742, 0.03196520730853081, -0.08653394877910614, 0.2697758972644806, -0.01975751854479313, -0.284381240606308, -0.29839661717414856, -0.0008154548122547567, -0.1560860127210617, -0.09093883633613586, -0.18797719478607178, 0.017632894217967987, 0.2035902440547943, 0.019672295078635216, 0.1095900908112526, -0.13194718956947327, 0.10033702105283737, 0.054483965039253235, 0.035239361226558685, 0.06036653742194176, 0.0008055972284637392, 0.2710736095905304, 0.14601151645183563, -0.06218581646680832, -0.05907934159040451, 0.17873167991638184, -0.2710530757904053, 0.20644597709178925, -0.13982994854450226, -0.32019591331481934, 0.08928836137056351, -0.06797373294830322, 0.35765546560287476, 0.3923383355140686, 0.14107926189899445, -0.02325117588043213, -0.00039468571776524186, 0.15808387100696564, 0.2180575281381607, 0.017003823071718216, 0.10852677375078201, 0.1859784722328186, 0.006685434374958277, -0.10608398169279099, 0.09774205088615417, 0.2039000391960144, -0.23485876619815826, 0.0030225394293665886, 0.006522952578961849, -0.34614458680152893, 0.03900783509016037, 0.0003261492238380015, 0.20441360771656036, 0.058328401297330856, 0.028372928500175476, 0.17048165202140808, -0.1254519373178482, 0.04464571923017502, 0.06090468913316727, 0.22361694276332855, 0.11370749026536942, 0.028190793469548225, -0.11928156018257141, 0.26545238494873047, 0.16193512082099915, 0.012348390184342861, 0.08165833353996277, -0.17048975825309753, -0.040262024849653244, -0.11446831375360489, -0.20919771492481232, -0.23515066504478455, 0.09817490726709366, 0.00933836679905653, -0.09134023636579514, -0.058957770466804504, -0.5205040574073792, 0.23311229050159454, -0.30545786023139954, 0.08868399262428284, -0.1984456479549408, -0.015501726418733597, 0.12498332560062408, -0.30519381165504456, -0.10621494799852371, -0.054869044572114944, 0.013918012380599976, -0.03751327842473984, 0.13085460662841797, 0.340053528547287, 0.16973274946212769, 0.13747291266918182, -0.08708846569061279, 0.30732861161231995, -0.30561843514442444, 0.3311013877391815, 0.010858151130378246, -0.08065962791442871, -0.26991379261016846, -0.23944717645645142, -0.4818442463874817, 0.05400804430246353, -0.37739720940589905, 0.12765251100063324, -0.10295645892620087, 0.003184518776834011, -0.2889636754989624, -0.10227740556001663, 0.14540405571460724, 0.1161520704627037, -0.24236398935317993, 0.18132275342941284, -0.12440681457519531, -0.11524202674627304, 0.16795775294303894, 0.5550022125244141, 0.3319792151451111, -0.11704318970441818, 0.08361206948757172, 0.09973417967557907, -0.08741945773363113, -0.2547304928302765, 0.15329894423484802, 0.1514388918876648, 0.09077943861484528, 0.369649201631546, 0.23489446938037872, -0.06809014827013016, -0.22048743069171906, -0.21720154583454132, -0.3879703879356384, 0.00289989379234612, 0.14655564725399017, -0.1967112123966217, 0.2638969421386719, -0.0736982598900795, -0.05019831657409668, -0.4549676179885864, 0.18199075758457184, 0.21095474064350128, 0.11721313744783401, 0.294030100107193, 0.3643530607223511, 0.3789181113243103, -0.2969796657562256, 0.056916531175374985, 0.20669333636760712, 0.026744505390524864, -0.16660341620445251, -0.25321561098098755, 0.5131003856658936, 0.05190730839967728, -0.27713704109191895, 0.05364934727549553, 0.2876433730125427, 0.13241665065288544, 0.11777753382921219, -0.037099022418260574, 0.22633102536201477, -0.15647874772548676, 0.4133853614330292, -0.4800398647785187, -0.2745979428291321, 0.2586110532283783, 0.27007728815078735, 0.4657556712627411, 0.5602654814720154, -0.15026742219924927, -0.06431574374437332, -0.08711230009794235, -0.014587514102458954, -0.13411027193069458, 0.053418368101119995, -0.10282855480909348, 0.47363001108169556, -0.3736601769924164, -0.021432120352983475, -0.28249117732048035, 0.14490172266960144, 0.031047683209180832, 0.2810218334197998, 0.35688716173171997, 0.2971048951148987, 0.20524862408638, -0.1877172738313675, 0.1408870667219162, 0.3258365988731384, 0.24509844183921814, -0.4121261537075043, -0.308800607919693, -0.08086097240447998, 0.03206847980618477, -0.520354688167572, -0.032970134168863297, 0.09112950414419174, 0.0864618569612503, 0.2832845449447632, -0.1551794707775116, 0.3865121901035309, -0.05215767025947571, 0.1952711045742035, -0.05864175036549568, -0.23155611753463745, 0.46438902616500854, 0.12821444869041443, 0.3314301669597626, 0.30257847905158997, -0.28040313720703125, -0.3574267029762268, -0.08170636743307114, -0.1653026044368744, -0.289602667093277, 0.3407977521419525, -0.3352985084056854, 0.05455981567502022, -0.2782738506793976, -0.32032567262649536, -0.06922803074121475, -0.050576355308294296, 0.07294990122318268, 0.19530968368053436, 0.09801505506038666, -0.06921405345201492, 0.5202257037162781, -0.02927747741341591, 0.2571466863155365, 0.2693367004394531, 0.2661604583263397, 0.005070587154477835, -0.2455066591501236, 0.4353203773498535, 0.10474783927202225, 0.3097655773162842, 0.13880370557308197, -0.03427695482969284, -0.6640312671661377, -0.24674323201179504, 0.11316894739866257, -0.13969631493091583, 0.06449224054813385, -0.4958825707435608, 0.3818223476409912, 0.35184624791145325, -0.10961951315402985, -0.13235825300216675, -0.062254324555397034, 0.017896784469485283, 0.34714239835739136, 0.24013245105743408, 0.1945711374282837, 0.12723876535892487, 0.3969014585018158, -0.16154874861240387, -0.12619143724441528, -0.029199395328760147, -0.028938543051481247, 0.4179249107837677, 0.13299235701560974, 0.022308800369501114, -0.25548499822616577, -0.29349416494369507, -0.18493951857089996, -0.2817188799381256, -0.1506505012512207, 0.2819890081882477, -0.08937357366085052, -0.14969953894615173, -0.03877142816781998, 0.20403741300106049, 0.27926144003868103, -0.06905411183834076, -0.0940013974905014, -0.04690894857048988, 0.1835843026638031, 0.1738806515932083, -0.0014584718737751245, 0.1934589445590973, -0.071149542927742, 0.1539190262556076, -0.10233715921640396, 0.24797773361206055, -0.07203459739685059, 0.31716281175613403, 0.015079519711434841, 0.15042990446090698, -0.008273550309240818, -0.00668377848342061, -0.11039203405380249, -0.12184707820415497, 0.09841248393058777, -0.16286443173885345, 0.168582946062088, 0.07521868497133255, 0.2824879288673401, -0.12301306426525116, -0.09233730286359787, -0.24597884714603424, -0.049253471195697784, -0.06109486147761345, -0.45715653896331787, 0.18989898264408112, -0.07042010873556137, 0.23322854936122894, 0.1613030731678009, -0.0471186600625515, -0.09257309883832932, -0.04049520194530487, 0.08733952045440674, -0.32532748579978943, 0.018617931753396988, 0.22247177362442017, -0.2939893901348114, 0.22111284732818604, 0.10127205401659012, -0.06758128851652145, -0.03303202614188194, -0.29335901141166687, 0.062233004719018936, -0.0959002748131752, 0.1491624414920807, 0.08602902293205261, 0.20150667428970337, 0.32230740785598755, -0.14191792905330658, -0.15742114186286926, -0.40983137488365173, 0.26761552691459656, 0.15989376604557037, 0.04307318478822708, 0.028543448075652122, 0.28683650493621826, 0.39844799041748047, 0.12156600505113602, 0.22148947417736053, -0.21313606202602386, -0.0012935887789353728, 0.07347407191991806, 0.17182698845863342, -0.21958230435848236, 0.19177915155887604, -0.44807910919189453, -0.24235330522060394, 0.10584510117769241, -0.1355350762605667, 0.2351628690958023, -0.29953551292419434, -0.06720542907714844, -0.17255650460720062, 0.3656975030899048, 0.2997615337371826, -0.17947198450565338, 0.010669130831956863, 0.21380241215229034, 0.18820808827877045, -0.14074374735355377, 0.026998749002814293, 0.10528168082237244, -0.10946551710367203, -0.08092422783374786, -0.2312200367450714, 0.028548166155815125, 0.2098110318183899, -0.09113118052482605, 0.1777363419532776, -0.10311906784772873, -0.06314036250114441, 0.15955814719200134, 0.3223707377910614, -0.01672341860830784, -0.11057765781879425, 0.04826037213206291, -0.046597033739089966, -0.3715895712375641, 0.2700813412666321, -0.05437576025724411, -0.301501601934433, -0.22283199429512024, -0.06411530822515488, 0.06618638336658478, 0.05228079482913017, -0.04834001511335373, -0.02712988667190075, -0.0935787633061409, 0.15432299673557281, -0.2506967782974243, 0.04825937747955322, -0.18626931309700012, -0.0065273866057395935, 0.06675595045089722, -0.23999571800231934, 0.07757838070392609, 0.22817187011241913, -0.25876957178115845, -0.32393163442611694, 0.32700031995773315, 0.16653013229370117, 0.33933359384536743, -0.017115509137511253, -0.06129835546016693, -0.16578200459480286, -0.007120020221918821, 0.14869673550128937, -0.2463853508234024, 0.172239288687706, -0.010817032307386398, -0.13834641873836517, 0.15776731073856354, -0.1958194375038147, 0.12280483543872833, -0.042398422956466675, 0.07845868915319443, -0.0882551372051239, 0.26029711961746216, 0.06600334495306015, 0.05312902480363846, -0.18238800764083862, -0.04420757293701172, -0.5824159383773804, 0.07934175431728363, 0.1208079531788826, 0.30246078968048096, 0.15274542570114136, 0.13185474276542664, 0.27795568108558655, 0.12430240958929062, 0.11423908919095993, 0.22640040516853333, 0.14702817797660828, -0.08815962821245193, -0.19850243628025055, -0.039224397391080856, -0.057583920657634735, -0.09735529124736786, 0.06785290688276291, 0.14835499227046967, -0.08253932744264603, 0.29679393768310547, -0.12049125134944916, 0.2774220108985901, -0.13193555176258087, -0.18317727744579315, -0.04346075654029846, -0.1243116706609726, 0.22980161011219025, 0.15926414728164673, -0.218117818236351, 0.038088295608758926, -0.006294061429798603, -0.06481140851974487, 0.20478560030460358, 0.09552627056837082, -0.02687946893274784, -0.03893548995256424, -0.04168642684817314, 0.05831650644540787, 0.18524768948554993, -0.13366451859474182, 0.10919680446386337, 0.045290373265743256, 0.13177496194839478, 0.07168412953615189, 0.09155305474996567, 0.200742706656456, -0.02848370000720024, -0.3605291545391083, 0.06392300873994827, 0.2061801254749298, -0.2986404597759247, -0.07808792591094971, 0.10338946431875229, -0.0067556933499872684, 0.17651249468326569, -0.11863699555397034, 0.07210960984230042, 0.188227117061615, 0.13398940861225128, -0.239030122756958, -0.40807005763053894, 0.08319959044456482, 0.061382658779621124, -0.04456670582294464, 0.29639732837677, 0.18950244784355164, 0.00836440920829773, 0.02645142376422882, 0.14859949052333832, 0.20269550383090973, -0.10650809109210968, 0.022278260439634323, -0.04270301014184952, -0.03588215261697769, -0.34869036078453064, -0.25575435161590576, 0.15172185003757477, -0.0648544430732727, 0.11039672046899796, 0.12129736691713333, 0.05871005356311798, -0.16304713487625122, -0.026913858950138092, -0.014489307999610901, 0.053298428654670715, 0.11224105954170227, -0.10923801362514496, 0.23107576370239258, 0.16799098253250122, 0.012545958161354065, -0.2640071511268616, 0.007716909050941467, -0.020730985328555107, -0.0760311484336853, -0.3998348116874695, 0.22096583247184753, 0.02181924320757389, -0.19318772852420807, 0.07424753159284592, -0.26223084330558777, 0.04608948528766632, -0.3029143512248993, 0.24025018513202667, -0.12885215878486633, 0.07207030802965164, 0.050176553428173065, 0.09861566871404648, -0.2086886763572693, -0.3235721290111542, 0.009343663230538368, 0.1745840609073639, 0.07097645103931427, -0.04347168654203415, 0.0011795160826295614, 0.288387268781662, -0.3548314869403839, 0.08683361858129501, -0.18052513897418976, 0.3579786419868469, 0.24346159398555756, 0.25550708174705505, -0.07469741255044937, -0.44248801469802856, 0.12965212762355804, -0.06727723032236099, -0.14699384570121765, -0.05168043076992035, 0.2702387571334839, -0.2551952004432678, 0.16824589669704437, -0.017854755744338036, 0.3138531744480133, 0.029687734320759773, -0.1671745479106903, 0.07083217799663544, 0.018017735332250595, 0.03231776878237724, 0.044581614434719086, 0.0008640866726636887, -0.1028391420841217, -0.04964187368750572, -0.04058302193880081, 0.020719528198242188, 0.23339293897151947, 0.16013513505458832, 0.05316310003399849, -0.08260654658079147, -0.0917145386338234, 0.1136791855096817, 0.013371439650654793, 0.03850684314966202, -0.486924409866333, 0.20836785435676575, 0.2657533586025238, -0.05049355328083038, 0.022867124527692795, -0.11167961359024048, -0.1728748381137848, 0.07943231612443924, 0.35744708776474, -0.1643189638853073, 0.1899450123310089, 0.005788713693618774, 0.28235405683517456, -0.17854300141334534, 0.0045722611248493195, 0.07758770138025284, -0.2941112816333771, -0.15426397323608398, -0.10406714677810669, 0.006708428263664246, 0.13289640843868256, 0.06551813334226608, -0.096009761095047, 0.014408014714717865, 0.03859512507915497, 0.08260555565357208, 0.12386777997016907, -0.19311398267745972, -0.08868788182735443, 0.08598005771636963, -0.15754595398902893, 0.032923247665166855, -0.003955904394388199, -0.11919485032558441, -0.09177181124687195, -0.08411294966936111, -0.1931118220090866, -0.21295401453971863, 0.16894060373306274, -0.2915799021720886, -0.08306676149368286, -0.13141164183616638, -0.20881210267543793, 0.009469643235206604, -0.013975527137517929, -0.2726476788520813, -0.04795821011066437, -0.19079749286174774, -0.060224927961826324, -0.06927569955587387, -0.0635484829545021, -0.13216356933116913, 0.05546209216117859, -0.09490606188774109, -0.1355004608631134, -0.03381527215242386, -0.04997781664133072, -0.1930258721113205, -0.08524513244628906, -0.5774458050727844, -0.08267561346292496, -0.2045471966266632, 0.0009149163961410522, 0.16486744582653046, -0.08192339539527893, -0.13723012804985046, 0.13007323443889618, 0.0863051563501358, 0.003387448377907276, -0.32912084460258484, 0.0973542258143425, -0.05937450751662254, -0.1297225058078766, -0.03431699052453041, -0.1595107465982437, 0.02848081663250923, -0.018248742446303368, 0.2884284257888794, 0.002973533235490322, -0.13684333860874176, -0.12880949676036835, 0.08457040041685104, -0.017230486497282982, 0.0788484513759613, 0.09621463716030121, -0.13699541985988617, 0.13688191771507263, -0.019299959763884544, -0.49642711877822876, -0.09046292304992676, 0.29808157682418823, -0.009181384928524494, 0.0013247763272374868, -0.09749609231948853, 0.22221381962299347, -0.11992797255516052, 0.1080654039978981, -0.24157750606536865, -0.09779420495033264, 0.20562662184238434, 0.025468965992331505, -0.29960834980010986, -0.09082389622926712, 0.08134900778532028, -0.2519867718219757, -0.3712303340435028, 0.16873151063919067, 0.08915355801582336, 0.13652966916561127, -0.3490065038204193, 0.013348015956580639, -0.05096049979329109, 0.46597665548324585, 0.030181720852851868, -0.2288425713777542, 0.10698128491640091, 0.5583125352859497, 0.2031649947166443, 0.10010215640068054, -0.018290484324097633, 0.10395055264234543, -0.07596538960933685, -0.5722194910049438, -0.046843547374010086, 0.014184189029037952, -0.2675962448120117, 0.11536888778209686, -0.14681480824947357, -0.1683059185743332, -0.21878160536289215, 0.12267689406871796, 0.19439375400543213, 0.1342289298772812, 0.034559689462184906, 0.060385968536138535, 0.37282630801200867, -0.2481033354997635, -0.04858233407139778, 0.08858967572450638, 0.09103579819202423, -0.11298587918281555, 0.004892522934824228, -0.024878451600670815, 0.23413406312465668, -0.009197651408612728, -0.18986377120018005, -0.002020420040935278, 0.21484237909317017, -0.04173986241221428, 0.05985606834292412, 0.07655980437994003, -0.41884711384773254, -0.16519412398338318, -0.19921696186065674, -0.06003943830728531, -0.03736249729990959, 0.13175025582313538, -0.03203577548265457, 0.08645116537809372, -0.05019832029938698, -0.375401109457016, -0.05574313551187515, -0.385428786277771, -0.05542698875069618, 0.031483158469200134, 0.006552852690219879, 0.020784514024853706, -0.2706693410873413, 0.04293728247284889, 0.04889341816306114, -0.13596822321414948, 0.1683136373758316, 0.28019168972969055, -0.09751404821872711, 0.13471552729606628, 0.21599896252155304, 0.0921194925904274, 0.21902750432491302, 0.0453500896692276, 0.1670326292514801, -0.18118378520011902, 0.08325131237506866, -0.10006355494260788, -0.35427743196487427, -0.16396349668502808, 0.46881774067878723, -0.23202131688594818, -0.02337293140590191, -0.10735661536455154, 0.21467308700084686, -0.2651212215423584, 0.20245225727558136, -0.4432235062122345, 0.12571962177753448, 0.1451897770166397, -0.09463479369878769, -0.07449906319379807, -0.01652469113469124, -0.1745937466621399, 0.17229126393795013, 0.28118273615837097, 0.2542473375797272, 0.09439973533153534, 0.1814689189195633, -0.1705227792263031, 0.03921986371278763, -0.17340362071990967, -0.04154498502612114, 0.2638060748577118, 0.12879842519760132, -0.3677454888820648, 0.07661177963018417, -0.074751116335392, -0.28009918332099915, 0.04527067393064499, -0.10862225294113159, 0.17612731456756592, -0.2780357301235199, -0.42041242122650146, -0.13305224478244781, 0.25061291456222534, 0.1393912434577942, -0.30397337675094604, -0.01741517335176468, -0.09951886534690857, -0.12129756063222885, 0.43417680263519287, -0.01932436414062977, 0.17104072868824005, 0.368538498878479, -0.09643561393022537, -0.10375434160232544, 0.09686514735221863, -0.07404762506484985, 0.16480319201946259, 0.30150073766708374, -0.1381651908159256, 0.20911715924739838, 0.08561170846223831, 0.040719520300626755, -0.033186476677656174, -0.1386113166809082, -0.20473873615264893, -0.1755422204732895, -0.026262622326612473, 0.11410962790250778, 0.04199619218707085, 0.05899907648563385, -0.12837843596935272, 0.04971322789788246, 0.18249879777431488, 0.0439433753490448, 0.038181550800800323, -0.059596844017505646, -0.056998349726200104, -0.21311718225479126, -0.010161835700273514, 0.03369927406311035, -0.19275043904781342, -0.015880271792411804, 0.27632591128349304, 0.23818916082382202, -0.06868402659893036, -0.006813798099756241, 0.15335901081562042, 0.0907968059182167, 0.18151311576366425, 0.12502503395080566, -0.07279457151889801, -0.015319989062845707, 0.1053469255566597, -0.12376261502504349, -0.009007681161165237, -0.033987268805503845, 0.3007856607437134, 0.05612218379974365, 0.1007656678557396, -0.12243800610303879, -0.29040777683258057, -0.0948815569281578, 0.16457059979438782, 0.08346404135227203, -0.0161636583507061, -0.2882794141769409, 0.06728537380695343, -0.05046277120709419, 0.17626327276229858, -0.2688899338245392, 0.06008085235953331, -0.05869337171316147, -0.1470956653356552, -0.1386532485485077, -0.08171135187149048, -0.2163732647895813, -0.04603113979101181, -0.04970015957951546, -0.2625879645347595, -0.1593385636806488, 0.35221293568611145, 0.11078798025846481, 0.27657487988471985, -0.17697466909885406, -0.04448264092206955, 0.16168057918548584, 0.0605207197368145, -0.11166422069072723, -0.0013134432956576347, -0.08286520093679428, 0.0806412398815155, -0.007366374600678682, -0.37748026847839355, 0.36188095808029175, -0.06505405157804489, 0.0013425424695014954, 0.09499801695346832, 0.06950116157531738, 0.12024234235286713, 0.022772034630179405, 0.15931671857833862, 0.261586457490921, -0.016634061932563782, -0.09436127543449402, 0.15794521570205688, -0.15330833196640015, 0.2986946702003479, 0.03593071922659874, 0.12995751202106476, 0.07745224237442017, -0.1443541795015335, 0.19839055836200714, -0.18939155340194702, -0.06462229043245316, 0.09227089583873749, -0.36180928349494934, 0.0418027862906456, 0.01666819304227829, -0.17156586050987244, 0.1705431491136551, 0.037198349833488464, -0.013723403215408325, -0.21691825985908508, -0.12531813979148865, -0.09171946346759796, -0.027741894125938416, 0.11367267370223999, -0.06715425848960876, -0.10222633183002472, 0.3147355020046234, 0.13206905126571655, -0.030267398804426193, 0.04017153009772301, -0.206181138753891, -0.019821254536509514, -0.016308996826410294, 0.24099351465702057, 0.12649038434028625, 0.21399442851543427, -0.0798833966255188, 0.17591120302677155, 0.04330332577228546, 0.16196757555007935, -0.07127879559993744, 0.17136232554912567, -0.14851436018943787, 0.2179369479417801, -0.4270693063735962, -0.24738457798957825, -0.05421210452914238, -0.006830689497292042, 0.09361516684293747, 0.09291407465934753, -0.1673305630683899, 0.095703125, 0.27940085530281067, -0.04384772107005119, -0.024873942136764526, 0.037704676389694214, -0.027315407991409302, -0.318814218044281, -0.002694379538297653, -0.0601043701171875, -0.06556877493858337, -0.16241903603076935, -0.1213921308517456, 0.2549900710582733, -0.23477113246917725, -0.09875956177711487, -0.049116190522909164, 0.01621337980031967, 0.12994204461574554, 0.14647634327411652, 0.3103982210159302, -0.030427996069192886, -0.017985664308071136, -0.02139396034181118, -0.010068506002426147, 0.3779900074005127, -0.04296286404132843, 0.007223665714263916, -0.2328718900680542, -0.04217810928821564, 0.15493668615818024, 0.09908551722764969, 0.004894249141216278, -0.08636221289634705, 0.1621202975511551, 0.1834300309419632, -0.2122892439365387, 0.040049899369478226, -0.005740812513977289, 0.16083011031150818, -0.04777985438704491, 0.14699149131774902, -0.028260450810194016, 0.1033962219953537, 0.030903667211532593, 0.11871007084846497, 0.2616528272628784, -0.2478451430797577, -0.18759791553020477, 0.32770025730133057, -0.09649784117937088, 0.09698665142059326, -0.07331214845180511, 0.02230186015367508, -0.16753864288330078, 0.16278469562530518, 0.29869353771209717, -0.10344590991735458, 0.083133265376091, -0.11459726840257645, 0.062348872423172, 0.0687561184167862, 0.17332574725151062, 0.036771610379219055, -0.04369035363197327, -0.30659887194633484, 0.010622484609484673, -0.14494283497333527, 0.09371139854192734, 0.02631848305463791, 0.29999858140945435, 0.18683071434497833, 0.10949833691120148, -0.14279641211032867, -0.13167957961559296, 0.2913149893283844, -0.18140271306037903, -0.07827197015285492, 0.3732583820819855, -0.0015789270401000977, -0.0619686096906662, -0.1205470934510231, 0.09254473447799683, -0.09504510462284088, 0.2957409918308258, 0.06773293763399124, -0.00931490957736969, -0.009831659495830536, -0.18902595341205597, -0.09811116755008698, 0.19232815504074097, -0.06843507289886475, -0.014637837186455727, 0.03906235098838806, 0.032124295830726624, 0.08330859988927841, 0.08359745144844055, 0.046843040734529495, -0.014548507519066334, -0.0038618429098278284, -0.005055314861238003, 0.08096416294574738, -0.04426882788538933, -0.07806264609098434, 0.07172758877277374, 0.07693834602832794, 0.07128246873617172, -0.09582344442605972, -0.08631185442209244, -0.025404201820492744, -0.08799753338098526, 0.06996749341487885, -0.035141024738550186, -0.009831619448959827, 0.005855814088135958, -0.09728493541479111, -0.0843350887298584, -0.010949581861495972, 0.021739251911640167, 0.03321266919374466, 0.07359132170677185, -0.022430172190070152, -0.045289717614650726, 0.007744527887552977, -0.04919644817709923, 0.019125433638691902, 0.026107601821422577, 0.06046438589692116, -0.008378853090107441, -0.11615795642137527, -0.044452883303165436, 0.1023588553071022, -0.04954163357615471, 0.1420721560716629, 0.07375560700893402, -0.1526184380054474, -0.12636741995811462, -0.13625702261924744, 0.12356977164745331, -0.13328711688518524, 0.12503550946712494, -0.1397015005350113, 0.1370687186717987, 0.10595603287220001, -0.1476513296365738, -0.1513458639383316, -0.12532520294189453, -0.1469140201807022, 0.14587433636188507, 0.11378462612628937, 0.15060333907604218, 0.14011771976947784, 0.1261146366596222, -0.1306707262992859, 0.09222831577062607, -0.13156233727931976, 0.14120401442050934, 0.12026303261518478, 0.1258644461631775, -0.05284823104739189, -0.08618462830781937, -0.14480063319206238, -0.13477353751659393, -0.1605946123600006, -0.13500501215457916, 0.1578693687915802, -0.12702211737632751, -0.1159282773733139, -0.17048680782318115, 0.17206323146820068, 0.1231130063533783, -0.17896991968154907, -0.07684441655874252], "training_domain": "OpenFront headless engine plains v1", "supported_kinds": ["wait", "expand", "attack"], "real_game_strength": "unvalidated"};
  // GENERATED-SHADOW-V7-BEGIN: keep equal to trainer/action-policy-v7.cjs
  const shadowV7=(()=>{
const INPUTS=38,OUTPUTS=1;
// The 9 emission-relevant branch families (kind one-hot). Finer distinctions
// (front vs finisher vs neutral target, which build type, which send kind)
// are carried by the subtype/flag features and targetId, not by exploding the
// one-hot, so the ranker generalizes across the 16 contract subclasses.
const KINDS=['wait','expand','attack','boat','warship','build_warship',
  'nuclear','build_economy','donate'];
const HIDDEN_BY_ARCH={'38x24x2-tanh':24,'38x40x2-tanh':40};
const ARCHES=Object.keys(HIDDEN_BY_ARCH);
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const logrel=(n,base)=>clamp(Math.log1p(Math.max(0,Number(n)||0))/
  Math.log1p(Math.max(1,Number(base)||1)),0,2)/2;
// Bounded rule-utility normalization (same convention as schema-6): rule
// utilities are order-of-magnitude bounded in [~-1000 (gated early attack),
// ~+150 (strong candidate)]; the absolute feature is an offset/scale map, the
// gap is signed-bounded so a branch far below the rule leader saturates at 1
// without a gated early-attack floor collapsing the whole frame.
const RU_ABS_OFFSET=100,RU_ABS_SCALE=200,RU_GAP_SCALE=100;
function lengthFor(arch){const h=HIDDEN_BY_ARCH[arch];
  if(h===undefined)throw Error('Invalid schema-7 arch '+arch);
  return INPUTS*h+h+h*OUTPUTS+OUTPUTS;}
// 38-dim action-branch feature vector.
//   idx 0-13  state: gamePhase, landRatio, troopRatio, reserveRatio,
//                  goldRatio, income, enemyPressure, activeWars, frontCount,
//                  allyPressure, homeThreat, nukeThreat, recentLandTrend,
//                  recentTroopTrend
//   idx 14    ruleUtility (own, bounded)
//   idx 15    utilityGapToTop (rule top-1 - own, bounded; 0.5 if unknown)
//   idx 16    costRatio
//   idx 17    troopCommitmentRatio
//   idx 18    reserveAfterRatio
//   idx 19    targetStrengthRatio
//   idx 20    targetLandRatio
//   idx 21    expectedBuildValue
//   idx 22    expectedDefenseValue
//   idx 23    cooldownReady
//   idx 24    alreadyActiveOperation
//   idx 25    targetReachable
//   idx 26    isEmergency
//   idx 27    isFinisher
//   idx 28    isExpansion
//   idx 29-37 kind one-hot: wait, expand, attack, boat, warship, build_warship,
//                  nuclear, build_economy, donate
// state/branch are the runtime-reliable fields documented in v7-features.cjs;
// ctx is the per-frame rule-utility context {ownRu, ruleTop1}.
function features(state={},branch={},ctx={}){
  const home=Math.max(1,Number(state.home)||1);
  const land=Number(state.land)||0;
  const troops=Number(state.troops)||Number(state.home)||0;
  const kind=String(branch.kind||'');
  const ownRu=Number(ctx.ownRu!==undefined?ctx.ownRu:branch.ruleUtility);
  const top1=Number(ctx.ruleTop1);
  const values=[
    // state idx 0-13
    clamp((state.gamePhase||0)/20,0,1),
    land?clamp(land/Math.max(1,Number(state.maxLand)||land),0,1):0,
    clamp(troops/home,0,1),
    clamp((state.reserve||0)/home,0,1),
    logrel(state.gold,10000000),
    clamp(state.income,0,2)/2,
    clamp(state.enemyPressure,0,1),
    clamp((state.activeWars||0)/8,0,1),
    clamp((state.frontCount||0)/8,0,1),
    clamp(state.allyPressure,0,1),
    clamp(state.homeThreat,0,1),
    clamp(state.nukeThreat,0,1),
    clamp(state.recentLandTrend,-1,1)/2+.5,
    clamp(state.recentTroopTrend,-1,1)/2+.5,
    // branch idx 14-22
    Number.isFinite(ownRu)?clamp((ownRu+RU_ABS_OFFSET)/RU_ABS_SCALE,0,1):0,
    (Number.isFinite(ownRu)&&Number.isFinite(top1))
      ?clamp((top1-ownRu)/RU_GAP_SCALE,0,1):0.5,
    clamp((branch.cost||0)/Math.max(1,home),0,1),
    clamp((branch.troopCommitment||0)/home,0,1),
    clamp((branch.reserveAfter||0)/home,0,1),
    clamp(branch.targetStrength,0,1),
    clamp(branch.targetLand,0,1),
    clamp(branch.expectedBuildValue,0,1),
    clamp(branch.expectedDefenseValue,0,1),
    // branch idx 23-28
    branch.cooldownReady?1:0,
    branch.alreadyActiveOperation?1:0,
    branch.targetReachable?1:0,
    branch.isEmergency?1:0,
    branch.isFinisher?1:0,
    branch.isExpansion?1:0,
    // kind one-hot idx 29-37
    ...(KINDS.map(k=>k===kind?1:0))
  ];
  return values.map(v=>clamp(v));
}
function validate(model){
  if(!model||model.schema!==7)throw Error('Invalid schema-7 action model');
  const h=HIDDEN_BY_ARCH[model.arch];
  if(h===undefined)throw Error('Invalid schema-7 action model');
  const L=lengthFor(model.arch);
  if(!Array.isArray(model.outputs)||model.outputs.length!==OUTPUTS||
    model.outputs[0]!=='branchScore'||
    !Array.isArray(model.weights)||model.weights.length!==L||
    Array.from(model.weights).some(x=>!Number.isFinite(x)||Math.abs(x)>5))
    throw Error('Invalid schema-7 action model');
  return model;
}
function zero(arch){arch=arch||ARCHES[0];
  if(!HIDDEN_BY_ARCH[arch])throw Error('Invalid arch '+arch);
  return {schema:7,arch,outputs:['branchScore'],
    weights:Array(lengthFor(arch)).fill(0)};}
function predict(model,input){
  const m=validate(model);const h=HIDDEN_BY_ARCH[m.arch];
  if(!Array.isArray(input)||input.length!==INPUTS||
    input.some(x=>!Number.isFinite(x)||x<0||x>1))
    throw Error('Invalid action-branch feature vector');
  const w=m.weights;const hb=INPUTS*h,outStart=hb+h,outBias=outStart+h*OUTPUTS;
  const hid=[];
  for(let j=0;j<h;j++){let z=w[hb+j];
    for(let i=0;i<INPUTS;i++)z+=input[i]*w[i*h+j];hid.push(Math.tanh(z));}
  const out=[];
  for(let k=0;k<OUTPUTS;k++){let z=w[outBias+k];
    for(let j=0;j<h;j++)z+=hid[j]*w[outStart+j*OUTPUTS+k];
    out.push((Math.tanh(z)+1)/2);}
  return {branchScore:out[0]};
}
    return {features,validate,predict};
  })();
  // GENERATED-SHADOW-V7-END
  let shadowV7Model=null;
  try{shadowV7Model=shadowV7.validate(SHADOW_V7_BUNDLED_MODEL);}catch(_){shadowV7Model=null;}
  // §28 branch funnel: one record per combat decision, accumulated in
  // 40-economy-runner.js (the dispatch loop after strategicDirector). The
  // counts feed the pre-gate (§26) and the dev/holdout comparison (§35/38).
  // With no bundled model (shadowV7Model===null) the funnel stays at
  // noModelFrames and the emitted action is identical to the rule basis.
  const branchFunnel={planningFrames:0,actionableFrames:0,
    multiChoiceFrames:0,modelDifferentFrames:0,differentEmittedActions:0,
    engineConfirmedDifferences:0,positiveOutcomeDifferences:0,
    negativeOutcomeDifferences:0,rankErrors:0,noModelFrames:0,
    controlEmits:0,ruleEmits:0,waitEmits:0,lastDecision:null};
  // Record one branch decision. `decision` is the object built by
  // 40-economy-runner.chooseActionBranch; `emittedChannel` is the channel that
  // actually sent an intent this turn (null when the model waited / no
  // channel emitted). Keeping the aggregation here (not in the runner) keeps
  // the funnel a single source of truth exposed by the snapshot + bridge.
  // differentEmittedActions / engineConfirmedDifferences only count a
  // model-caused emission: the channel the model steered to is the one that
  // emitted. The exact intent-level diff is reconciled offline (§27
  // turn-divergence.json from intents.jsonl); this is the live proxy.
  function recordBranchDecision(decision,emittedChannel){
    const f=branchFunnel;
    if(decision.basis==='no-model'){f.noModelFrames++;f.ruleEmits++;return;}
    f.planningFrames++;
    if(decision.actionableCount>=1)f.actionableFrames++;
    if(decision.actionableCount>=2)f.multiChoiceFrames++;
    const differs=!!(decision.modelTop&&decision.ruleTop&&
      decision.modelTop.id!==decision.ruleTop.id);
    if(differs)f.modelDifferentFrames++;
    const modelEmitted=emittedChannel!==null&&
      decision.modelTop&&emittedChannel===decision.modelTop.channel;
    if(decision.controlActive&&differs){
      if(decision.modelTop.kind==='wait')f.waitEmits++;
      else f.controlEmits++;
      if(modelEmitted){
        f.differentEmittedActions++;
        f.engineConfirmedDifferences++;
      }
    }
    f.lastDecision={tick:decision.tick,ruleTop:decision.ruleTop?.id??null,
      modelTop:decision.modelTop?.id??null,
      modelTopChannel:decision.modelTop?.channel??null,
      modelScores:decision.scores??null,
      controlActive:!!decision.controlActive,
      emittedKind:emittedChannel??null,
      actionableCount:decision.actionableCount,
      state:decision.state?{...decision.state}:null,
      ruleTop1:decision.state?
        (decision.branches?.[0]?.ruleUtility??0):null,
      branches:decision.branches?
        decision.branches.map(b=>({id:b.id,kind:b.kind,channel:b.channel,
          ruleUtility:b.ruleUtility,cost:b.cost,troopCommitment:b.troopCommitment,
          reserveAfter:b.reserveAfter,targetStrength:b.targetStrength,
          targetLand:b.targetLand,expectedBuildValue:b.expectedBuildValue,
          expectedDefenseValue:b.expectedDefenseValue,
          cooldownReady:b.cooldownReady,
          alreadyActiveOperation:b.alreadyActiveOperation,
          targetReachable:b.targetReachable,isEmergency:b.isEmergency,
          isFinisher:b.isFinisher,isExpansion:b.isExpansion})):null};
  }
  const NEURAL_LENGTH=90,NEURAL_STORAGE='of-aggrobot-neural-policy-v1';
  let neuralModel=null;
  function neuralValidate(data){
    const old=data?.schema===1&&data.arch==='8x8x2-tanh'&&
      data.weights?.length===NEURAL_LENGTH;
    const actions=data?.schema===2&&data.arch==='16x12x1-tanh'&&
      data.weights?.length===217;
    const strategic=data?.schema===3&&data.arch==='16x16x16-tanh'&&
      data.weights?.length===544;
    const strategic4=data?.schema===4&&data.arch==='24x24x16-tanh'&&
      data.weights?.length===1000;
    if((!old&&!actions&&!strategic&&!strategic4)||!Array.isArray(data.weights)||
      data.weights.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>5))
      return null;
    return data;
  }
  try{
    const local=['localhost','127.0.0.1','[::1]'].includes(window.location?.hostname)&&
      window.__OF_BENCHMARK_CONFIG__?.enabled===true;
    neuralModel=neuralValidate(local?
      JSON.parse(localStorage.getItem(NEURAL_STORAGE)||'null'):
      NEURAL_BUNDLED_MODEL);
  }catch(_){neuralModel=null;}
  // Deployed v3 is active on a fresh install; an explicit saved off-switch wins.
  if([3,4].includes(neuralModel?.schema) && !localStorage.getItem(KEY))opts.neuralEnabled=true;
  const NEURAL_CHANNELS=['reserve','aggression','neutralCommit','enemyCommit',
    'warThreshold','navalThreshold','landPriority','navalPriority',
    'holdPriority','cityPriority','factoryPriority','portPriority',
    'defensePriority','nuclearPriority','diplomacyPriority','fleetPriority'];
  let neuralPolicyCache={key:null,output:null};
  function neuralStrategicSignals(me,s,tick=number(()=>game?.ticks?.(),0)){
    if(!opts.neuralEnabled||!opts.fullAuto||![3,4].includes(neuralModel?.schema)||
      !me||!s||s.home<=0)return null;
    const home=Math.max(1,s.home),max=Math.max(1,s.max||home);
    const gold=goldAmount(me),
      land=number(()=>me.numTilesOwned?.(),0);
    const units=ownStructures(me),groups=strategic.groups||[];
    const cities=units.filter(u=>u.type?.()==='City').length,
      ports=units.filter(u=>u.type?.()==='Port').length;
    const foes=groups.filter(g=>g.id!==null&&g.opponent?.isAlive?.()&&!friendly(g.opponent,me));
    const thirdParty=foes.some(g=>adversaryWindow(me,g.opponent).exposed);
    const vector=[
      clamp(home/max,0,1.5)/1.5,clamp((s.incoming||0)/home,0,2)/2,
      clamp((s.strongest||0)/home,0,3)/3,clamp((s.committed||0)/home,0,2)/2,
      clamp(gold/1000000,0,1),clamp(land/20000,0,1),
      lateGame(me)?1:0,groups.some(g=>g.id===null&&!g.fallout)?1:0,
      clamp(foes.length/8,0,1),clamp((s.activeEnemy||0)/4,0,1),
      clamp((s.available||0)/home,0,1),
      clamp((s.growthPotential||0)/Math.max(1,max*.01),0,1),
      clamp(cities/8,0,1),clamp(ports/4,0,1),isWar()?1:0,thirdParty?1:0
    ];
    if(neuralModel.schema===4){
      const pressure=frontPressureForecast(me,groups,tick);
      const losses=Math.max(0,-(armyTrend(tick)?.tiles||0));
      const uncovered=nuclearIntel(me,units).uncovered.length;
      vector.push(clamp(pressure.secondary/home,0,3)/3,
        clamp(losses/Math.max(1,land),0,1),
        clamp((incomeStatus.train||0)/1000000,0,1),
        clamp((incomeStatus.trade||0)/1000000,0,1),
        clamp(uncovered/8,0,1),recentHostilePressure(tick)?1:0,
        clamp(units.filter(u=>u.type?.()==='Defense Post').length/12,0,1),
        clamp((marineStats.transportUnconfirmed+marineStats.transportUnresolved)/12,0,1));
    }
    const key=tick+':'+vector.join(',');
    if(neuralPolicyCache.key===key)return neuralPolicyCache.output;
    const w=neuralModel.weights,h=[],output={};
    const size=neuralModel.schema===4?24:16;
    const start=size*size,outputs=start+size,bias=outputs+size*16;
    for(let j=0;j<size;j++){
      let z=w[start+j];
      for(let i=0;i<size;i++)z+=vector[i]*w[i*size+j];
      h.push(Math.tanh(z));
    }
    for(let k=0;k<16;k++){
      let z=w[bias+k];
      for(let j=0;j<size;j++)z+=h[j]*w[outputs+j*16+k];
      output[NEURAL_CHANNELS[k]]=Math.tanh(z);
    }
    neuralPolicyCache={key,output};
    neuralEvidence.calls++;
    if(Object.values(output).some(v=>Math.abs(v)>1e-8))neuralEvidence.nonzero++;
    neuralEvidence.last={tick,schema:neuralModel.schema,
      channels:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,Number(v.toFixed(5))]))};
    if(neuralEvidence.calls%20===1)telemetry('neural_inference',
      'Neurale Strategie-Ausgabe beobachtet',{model:neuralModelInfo(),
        inference:neuralEvidence.last});
    return output;
  }
  function neuralModelInfo(){
    const model=neuralModel;
    if(!model)return {loaded:false,enabled:!!opts.neuralEnabled,reason:'no-valid-model'};
    // This fingerprint is for tracking the deployed weights across diagnostic
    // exports, not a cryptographic or trainer policy SHA256.
    const raw=JSON.stringify(model.weights),bytes=raw.length;
    let hash=2166136261;
    for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return {loaded:true,enabled:!!opts.neuralEnabled,schema:model.schema,
      weights:model.weights.length,nonzeroWeights:model.weights.filter(v=>v!==0).length,
      fingerprint:'fnv1a-'+(hash>>>0).toString(16).padStart(8,'0')+'-'+bytes};
  }
  function shadowModelInfo(){
    const model=shadowV6Model||shadowV5Model;
    if(!model)return {loaded:false,enabled:!!opts.shadowRankEnabled,
      reason:'no-valid-candidate'};
    // FNV-1a tracking fingerprint (not a trainer policy SHA256), mirroring
    // neuralModelInfo for the schema-5 shadow candidate.
    const raw=JSON.stringify(model.weights),bytes=raw.length;
    let hash=2166136261;
    for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return {loaded:true,enabled:!!opts.shadowRankEnabled,schema:model.schema,
      weights:model.weights.length,
      controlEnabled:opts.candidateControlEnabled===true,
      controlGain:opts.candidateControlGain,
      fingerprint:'fnv1a-'+(hash>>>0).toString(16).padStart(8,'0')+'-'+bytes};
  }
  // Schema-7 branch controller: it sits AFTER hard legality/safety, BEFORE
  // send(kind,args). Off by default (no model bundled). When a v7 model is
  // bundled and actionRankEnabled is set it scores every currently-legal,
  // safety-approved, executable branch; when actionControlEnabled the argmax
  // drives the emitted intent (hard safety stays outside the learning).
  function shadowV7ModelInfo(){
    const model=shadowV7Model;
    if(!model)return {loaded:false,enabled:!!opts.actionRankEnabled,
      reason:'no-valid-action-model'};
    const raw=JSON.stringify(model.weights),bytes=raw.length;
    let hash=2166136261;
    for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return {loaded:true,enabled:!!opts.actionRankEnabled,schema:model.schema,
      arch:model.arch,weights:model.weights.length,
      controlEnabled:opts.actionControlEnabled===true,
      fingerprint:'fnv1a-'+(hash>>>0).toString(16).padStart(8,'0')+'-'+bytes};
  }
  // Deployment identity for the panel and diagnostic export: model/script/
  // engine hashes plus the rollback reference. The model hashes are FNV-1a
  // tracking fingerprints; the champion model-file SHA256 is recorded by the
  // deploy/build tooling, not recomputed here.
  function deploymentInfo(){
    return {
      model:{champion:neuralModelInfo(),candidate:shadowModelInfo(),
        action:shadowV7ModelInfo()},
      script:{version:VERSION},
      engine:{commit:window.BOOTSTRAP_CONFIG?.gitCommit??null},
      rollback:'candidate is shadow-only (opt-in control); the NEURAL_BUNDLED_MODEL champion placeholder is never replaced by a schema-5 deploy'};
  }
  function neuralChannel(name,me,s=troopSnapshot,tick=number(()=>game?.ticks?.(),0)){
    return neuralStrategicSignals(me,s,tick)?.[name]||0;
  }
  function neuralAdjust(v,base,me,s,items,emergency){
    if(!opts.neuralEnabled||!opts.fullAuto||neuralModel?.schema!==1||emergency||
      s.incoming>0||recentHostilePressure(number(()=>game.ticks(),0))||
      s.strongest>s.home*1.25)return v;
    const home=Math.max(1,s.home),cap=Math.max(1,s.max);
    const features=[
      clamp(home/cap,0,1.5)/1.5,
      clamp(s.incoming/home,0,2)/2,
      clamp(s.strongest/home,0,3)/3,
      clamp(s.committed/home,0,2)/2,
      items.some(x=>x.id===null&&!x.fallout)?1:0,
      clamp(items.filter(x=>x.id!==null).length/8,0,1),
      clamp(number(()=>me.numTilesOwned(),0)/20000,0,1),
      lateGame(me)?1:0];
    const w=neuralModel.weights,h=[];
    for(let j=0;j<8;j++){
      let z=w[64+j];
      for(let i=0;i<8;i++)z+=features[i]*w[i*8+j];
      h.push(Math.tanh(z));
    }
    const out=[];
    for(let k=0;k<2;k++){
      let z=w[88+k];
      for(let j=0;j<8;j++)z+=h[j]*w[72+j*2+k];
      out.push(Math.tanh(z));
    }
    // Baseline-relative bounds prevent stacked browser-learning/NN adjustments
    // from bypassing reserves. Military and worker legality still recheck.
    return {...v,
      aggressive:clamp(v.aggressive+Math.round(out[0]*8),base.aggressive-8,base.aggressive+8),
      reserve:clamp(v.reserve+Math.round(out[1]*8),base.reserve-8,base.reserve+8)};
  }
  // Schema 2 re-ranks ONLY candidates already admitted by the original
  // planner; legalTarget(), worker actions, reserve and alliance rechecks
  // retain complete authority. No direct AI-generated game intents.
  function neuralActionDelta(kind,score,me,s=troopSnapshot,candidate={}) {
    if(!opts.neuralEnabled||!opts.fullAuto||![2,3,4].includes(neuralModel?.schema)||
      s.incoming>0||recentHostilePressure(number(()=>game.ticks(),0))||
      s.strongest>Math.max(1,s.home)*1.25)return 0;
    const kinds=['attack','economy','naval'],index=kinds.indexOf(kind);
    if(index<0)return 0;
    if(neuralModel.schema>=3){
      // Modern strategic heads also rank legal, already-filtered actions;
      // they never grant construction, combat or naval authorization.
      const signals=neuralStrategicSignals(me,s);
      const head=kind==='attack'?signals?.landPriority:kind==='naval'?
        signals?.navalPriority:({City:signals?.cityPriority,
          Factory:signals?.factoryPriority,Port:signals?.portPriority,
          'Defense Post':signals?.defensePriority,
          'SAM Launcher':signals?.defensePriority,
          'Missile Silo':signals?.nuclearPriority})[candidate.type];
      const delta=Number.isFinite(head)?clamp(head*(10+4*clamp(candidate.opportunity??0,0,1)-
        3*clamp(candidate.cost??0,0,1)-3*clamp(candidate.risk??0,0,1)),-14,14):0;
      neuralEvidence.actionCalls++;
      if(Math.abs(delta)>1e-8)neuralEvidence.actionNonzero++;
      if(neuralEvidence.actionCalls%30===1)telemetry('neural_action_inference',
        'Neurales Aktionsranking beobachtet',{model:neuralModelInfo(),kind,
          type:candidate.type??null,delta,baseline:score});
      return delta;
    }
    const home=Math.max(1,s.home),max=Math.max(1,s.max);
    const vector=[
      clamp(home/max,0,1.5)/1.5,
      clamp(s.incoming/home,0,2)/2,
      clamp(s.strongest/home,0,3)/3,
      clamp(s.committed/home,0,2)/2,
      clamp(goldAmount(me)/1000000,0,1),
      clamp(number(()=>me.numTilesOwned(),0)/20000,0,1),
      lateGame(me)?1:0,
      strategic.groups.some(x=>x.id===null&&!x.fallout)?1:0,
      ...kinds.map((_,i)=>i===index?1:0),
      clamp(score,-150,150)/150,
      clamp(candidate.magnitude??0,0,1),
      clamp(candidate.opportunity??0,0,1),
      clamp(candidate.cost??0,0,1),
      clamp(candidate.risk??0,0,1)
    ];
    const w=neuralModel.weights,h=[];
    for(let j=0;j<12;j++){
      let z=w[192+j];
      for(let i=0;i<16;i++)z+=vector[i]*w[i*12+j];
      h.push(Math.tanh(z));
    }
    let z=w[216];
    for(let j=0;j<12;j++)z+=h[j]*w[204+j];
    const delta=Math.tanh(z)*14;
    neuralEvidence.actionCalls++;
    if(Math.abs(delta)>1e-8)neuralEvidence.actionNonzero++;
    if(neuralEvidence.actionCalls%30===1)telemetry('neural_action_inference',
      'Neurales Aktionsranking beobachtet',{model:neuralModelInfo(),
        kind,delta,baseline:score});
    return delta;
  }
  // Hybrid learning: bounded contextual adjustments; keep existing combat safety checks.
  const LEARN_KEY='of-aggrobot-learning-v1';
  let learn={schema:1,contexts:{},updates:0,lastResult:null};
  let learnMatch={sample:null,key:null,finished:false};
  try {
    const saved=JSON.parse(localStorage.getItem(LEARN_KEY)||'null');
    if(saved?.schema===1&&saved.contexts&&typeof saved.contexts==='object'){
      for(const [k,x] of Object.entries(saved.contexts).slice(0,48))
        if(/^(BALANCED|EXPAND|ASSAULT|RECOVER|ECONOMY|TECH|LATE):(SAFE|THREAT)$/.test(k)&&
          Number.isInteger(x?.n)&&x.n>=0&&x.n<=100000&&Number.isFinite(x?.mean)&&Math.abs(x.mean)<=1)
          learn.contexts[k]={n:x.n,mean:x.mean};
      learn.updates=Math.max(0,Math.min(1000000,Math.floor(Number(saved.updates)||0)));
      learn.lastResult=['victory','defeat'].includes(saved.lastResult)?saved.lastResult:null;
    }
  }catch(_){}
  function saveLearn(){try{localStorage.setItem(LEARN_KEY,JSON.stringify(learn));}catch(_){}}
  function learnKey(mode,s){
    return /^(BALANCED|EXPAND|ASSAULT|RECOVER|ECONOMY|TECH|LATE)$/.test(mode)?
      mode+':'+(s.incoming>0||s.strongest>Math.max(1,s.home)*1.1?'THREAT':'SAFE'):null;
  }
  function learnObserve(tick,me,s,mode){
    if(!opts.learningEnabled||!opts.fullAuto||!me?.hasSpawned?.()||!me?.isAlive?.())return;
    const key=learnKey(mode,s);if(!key)return;
    const now={tick,land:number(()=>me.numTilesOwned(),0),troops:number(()=>me.troops(),0),max:Math.max(1,s.max)};
    const prev=learnMatch.sample;
    if(prev&&tick-prev.tick>=240){
      // Progress proxy, NOT causal credit for a specific attack.
      const reward=clamp(.75*(now.land-prev.land)/Math.max(100,prev.land)+
        .25*(now.troops-prev.troops)/Math.max(1,prev.max),-1,1);
      if(learnMatch.key){
        const old=learn.contexts[learnMatch.key]||{n:0,mean:0};
        const n=Math.min(100000,old.n+1),mean=clamp(old.mean+(reward-old.mean)/Math.min(n,100),-1,1);
        learn.contexts[learnMatch.key]={n,mean};learn.updates++;
        if(learn.updates%8===0)saveLearn();
        telemetry('learning_update','Strategie-Erfahrung',{context:learnMatch.key,reward,samples:n,mean});
      }
      learnMatch.sample=now;learnMatch.key=key;
    }else if(!prev){learnMatch.sample=now;learnMatch.key=key;}
  }
  function learnAdjust(v,mode,s,emergency){
    if(!opts.learningEnabled||!opts.fullAuto||emergency)return v;
    const memory=learn.contexts[learnKey(mode,s)];
    if(!memory||memory.n<3)return v;
    const signal=clamp(memory.mean*Math.min(1,(memory.n-2)/15),-1,1);
    return {...v,aggressive:clamp(v.aggressive+Math.round(signal*5),40,100),
      reserve:clamp(v.reserve-Math.round(signal*4),18,65)};
  }
  function learnFinish(outcome){
    if(learnMatch.finished)return;
    learnMatch.finished=true;
    if(!opts.learningEnabled||!['victory','defeat'].includes(outcome))return;
    learn.lastResult=outcome;saveLearn();
  }


  const escapeHTML = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (n,a,b) => Math.min(b,Math.max(a,Number.isFinite(+n)?+n:a));
  const number = (fn, fallback=0) => {try {const n=Number(fn());return Number.isFinite(n)?n:fallback;}catch(_){return fallback;}};
  // BigInt gold can exceed Number's precise integer range in long games.
  // Cap to a conservative representable balance rather than rounding upward.
  function goldAmount(p,fallback=0){
    try{
      const raw=p.gold(),limit=Number.MAX_SAFE_INTEGER;
      if(typeof raw==='bigint'){
        if(raw>BigInt(limit))return limit;
        if(raw<-BigInt(limit))return -limit;
      }
      const value=Number(raw);
      return Number.isFinite(value)?Math.max(-limit,Math.min(limit,value)):fallback;
    }catch(_){return fallback;}
  }
  const nameOf = p => {try{return p.displayName?.() || p.name?.() || String(p.id());}catch(_){return '?';}};
  const safeID = p => {try{return p.id();}catch(_){return null;}};
  // OpenFront AttackUpdate.targetID/attackerID are numeric smallIDs.
  // The bot keeps warState, pendingAttack and other targets as PlayerID strings.
  function attackTargetPlayer(targetID){
    if(typeof targetID==='number'&&Number.isInteger(targetID)&&targetID>0){
      try{
        const player=game?.playerBySmallID?.(targetID);
        if(player)return player;
      }catch(_){}
      try{return game?.playerViews?.().find(p=>p?.smallID?.()===targetID)||null;}
      catch(_){return null;}
    }
    if(typeof targetID==='string'){
      try{return game?.playerViews?.().find(p=>safeID(p)===targetID)||null;}
      catch(_){return null;}
    }
    return null;
  }
  function attackTargetID(targetID){
    if(targetID===null||targetID===0)return null;
    if(typeof targetID==='string')return targetID; // Older client/test compatibility.
    return safeID(attackTargetPlayer(targetID));
  }
  function attackTargets(targetID,playerOrID){
    if(playerOrID===null)return targetID===null||targetID===0;
    const id=typeof playerOrID==='object'?safeID(playerOrID):playerOrID;
    return id!==null&&attackTargetID(targetID)===id;
  }
  let game=null, bus=null, ctors={}, panel=null, busy=false, generation=0;
  let winnerBus=null,winnerCtor=null,winnerHandler=null,lastWinnerSignal=null;
  const INTENT_KINDS=['spawn','attack','cancel','boat','build','upgrade','alliance','reject'];
  const CORE_INTENTS=['spawn','attack','build'];
  let lastIntentHealth=null,lastIntentProbe=-Infinity,missingIntentLogged=new Set();
  let lastTick=-1, lastSpawn=-Infinity, lastEconomy=-Infinity, lastEconomyProbe=-Infinity;
  let lastBoat=-Infinity, lastBorderTick=-Infinity, borderCache=null, borderPlayer=null;
  let buildCursor=0, spawnCache=null, spawnJob=null, spawnRetryAt=0, spawnAlternatives=[], spawnState={scanned:0,phase:'idle',lastSent:null,attempts:0,blocked:null,deadline:null}, status='Warte auf Spiel';
  let plan=null, rejected=new Map(), lastEmission=0, lastSelection='';
  let totalSent=0, totalFailed=0;
  let borderOffset=0, lastBorderRefresh=0, lastPlanTick=-Infinity;
  let recent=[], actions=[], cooldowns=new Map(), lastPaint=0, errors=0;
  let troopSamples=[], lastRecoveryReason='', lastBattle=null, blockedTargets=new Map();
  let troopSnapshot={home:0,max:0,committed:0,incoming:0,enemy:0,ratio:0,reserve:0,available:0};
  let lastDecisionFrame=null;
  let lastEconomicAction=-Infinity, lastNeutralSend=-Infinity, lastEnemySend=-Infinity,lastHostilePressure=-Infinity;
  let consecutiveIdle=0;
  let economicPending=null, economicBlocked=new Map(), economicNegative=new Map(), economicStatus='Bauplanung bereit', economicLastPlan='—';
  let samQuotedCost=0,portQuotedCost=0,samQuotedTick=-Infinity,portQuotedTick=-Infinity;
  let samAffordableFailureSince=null;
  let economyBusy=false, borderInflight=null, legalNegative=new Map();
  let runtime={borderMs:0,combatMs:0,economyMs:0,attackProbes:0,buildProbes:0};
  let strategic={mode:'EXPAND',reason:'Startphase',buildStyle:'Ausgewogen',since:-Infinity,groups:[]};
  let diplomacyHandled=new Map(),lastDiplomacyTick=-Infinity,lastProposalTick=-Infinity;
  let diplomacyStatus='Noch keine Anfrage', diplomacyStats={accepted:0,rejected:0,offered:0};
  let diplomacyPending=new Map(),lastDiplomaticEmit=0,diplomacyMissingLogged=new Set();
  let goldSamples=[],incomeStatus={train:null,trade:null,gold:null,observed:false};
  let winStatus={mode:'FFA',progress:null,threshold:null,remaining:null,urgent:false};
  let fleetStatus='Keine Marineaktivität',lastFleet=-Infinity,lastDonation=-Infinity,navalSweep=0;
  let tradeStatus='Handel automatisch offen',lastTradeTick=-Infinity,
    tradeBusy=false,tradeStats={opened:0,embargoed:0,skipped:0},
    botEmbargoes=new Set(),tradeAssessments=[];
  let pendingBoat=null,pendingWarship=null,navalCooldown=new Map(),navalBackoffUntil=-Infinity,portProbeFailures=0,lastPortRetryTick=-Infinity,navalSiteNegative=new Map();
  let landingAudits=[],marineUnresolvedWatches=[];
  let marineStats={transportSent:0,transportConfirmed:0,transportArrived:0,bridgeheadHeld:0,
    bridgeheadHeld120:0,bridgeheadHeld600:0,bridgeheadLost:0,
    transportUnconfirmed:0,transportUnresolved:0,warshipSent:0,
    warshipConfirmed:0,warshipUnconfirmed:0};
  let strategicTelemetry={favorableVictims:0,falloutSkipped:0,falloutFallback:0,afkTargets:0,assists:0,neutralLandings:0,forecastCount:0,
    engineForecasts:0,proxyForecasts:0,forecastComparisons:0,forecastUnavailable:0};
  let nukeBusy=false, lastNuke=-Infinity, nukePending=null, nukeStatus='Warte auf Silo', nukeShots=0,nukeAttempts=0,nukeUnconfirmed=0;
  let nuclearCache=null, nuclearCacheTick=-Infinity;
  let warState={id:null,name:'—',since:-Infinity,blockedUntil:-Infinity};
  let diagnostics=[],lastDiagnosticTick=-Infinity,gameEnd=null;
  let pendingAttack=null,attackReceipts={confirmed:0,unconfirmed:0,territoryGained:0};
  let attackCommands=[],attackCommandSequence=0,observedAttacks=new Map();
  let forecastAudits=[],lastForecastAudit=null,incomeAttribution=[];
  let failedEconomyProbes=0,successfulEconomyTick=-Infinity,warWaitSince=-Infinity;
  let coreQuotes=new Map(),lastCoreFundingReport=-Infinity,coreFunding=null;
  let lastEconomyProbeReport=null,neuralDecisionEvidence=null,economyBudgetEvidence=null,shadowDecisionEvidence=null;
  // Yield silo lead only after an observed funded, illegal-site worker scan.
  let duoSiloBlockedUntil=-Infinity;
  let investmentStatus='Grundaufbau',lastWarReview=-Infinity;
  let defenseStatus='Keine Bedrohung',lastEmergencyRetreat=-Infinity,lastDefenseLog=-Infinity;
  let targetIntelCache=new Map(),frontMemory=new Map(),lastFrontWarning=-Infinity;
  let opponentHistory=new Map(),opponentProfiles=new Map(),lastEconomyPosture='—',lastDirectorDecision=null;
  let planningState={tick:-Infinity,candidates:[],selected:null,rejected:null,
    durationMs:0,budgetMs:50,truncated:false};
  // P0: one canonical decision frame per planning tick (bounded), resolved
  // against confirmations/observations at fixed horizons before export.
  let decisionFrames=[];
  // Step 3: benchmark-only per-decision frame for real training capture.
  // Mirrors the P5 runtime state EXACTLY: planningState.v5State carries the
  // very state object strategicCandidatePlan scored (17 fields, including
  // v5StateExtension), and each candidate's `v5` contract is the exact
  // candidate object shadowV5.features received. Diagnostics only: it
  // reads state, never authorizes or blocks actions.
  function planningFrame(){
    const me=myPlayer();
    if(!me?.hasSpawned?.())return null;
    const sel=planningState?.selected;
    if(!sel||!sel.kind)return null;
    const s=troopSnapshot,groups=strategic?.groups||[];
    const project=c=>({kind:c.kind,costTroops:c.cost||0,
      counterRisk:c.risk||0,
      holdProbability:1-Math.min(1,c.risk||0),
      ...(c.v5||{})});
    return {tick:number(()=>game?.ticks?.(),null),
      land:number(()=>me.numTilesOwned(),0),
      home:s.home,maxTroops:s.max,committed:s.committed,
      incoming:s.incoming,reserve:s.reserve,gold:goldAmount(me),
      capacityUse:s.ratio,frontCount:groups?.length||0,
      ...(planningState?.v5State||{}),
      // §4 binding evidence: per-candidate rule utility, model score,
      // effective gain and combined utility, plus the frame-level gain and
      // the 1st-vs-2nd rule gap. Lets the binding analysis compute the gain
      // required to flip the pick from actual scores and utility gaps, not
      // an average. modelSHA is the candidate-model fingerprint; the
      // authoritative candidate SHA256 is pinned in benchmarkMeta.
      binding:planningState?.binding??null,
      controlGain:planningState?.controlGain??0,
      controlMode:planningState?.controlMode??null,
      controlCapGain:planningState?.controlCapGain??null,
      controlConfidenceRef:planningState?.controlConfidenceRef??null,
      controlMargin:planningState?.controlMargin??null,
      ruleTop2Gap:planningState?.ruleTop2Gap??null,
      modelSHA:planningState?.provenance?.modelHashes?.candidate??null,
      ruleChoice:planningState?.ruleChoice??null,
      modelChoice:planningState?.modelChoice??null,
      finalChoice:planningState?.finalChoice??null,
      changedIntent:planningState?.changedIntent??false,
      safetyBlockReason:planningState?.safetyBlockReason??null,
      // §19 on-policy branch capture: the schema-7 decision for this frame
      // (rule top, model top, per-branch scores, emitted kind). Null when no
      // schema-7 model is bundled, in which case the training frame is the
      // pure rule basis.
      branch:branchFunnel.lastDecision?{...branchFunnel.lastDecision}:null,
      candidate:project(sel),
      candidates:(planningState?.candidates||[]).map(project)};
  }
  let investmentAssessments=[];
  let operation=null,operationCooldown=new Map(),duoPlan=null,victoryThreat=null,decisionTimeline=[],decisionKeys=new Map();
  // sessionStorage is tab-scoped: survives reloads but never assigns the
  // same ID to two ordinary tabs sharing one browser profile.
  function duoInstanceID(){
    const key='aggrobot-duo-tab-instance-v1';
    try{
      const old=sessionStorage.getItem(key);
      if(old&&/^[a-zA-Z0-9_.:@-]{1,128}$/.test(old))return old;
      const id='tab-'+(typeof crypto!=='undefined'&&crypto.randomUUID?
        crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));
      sessionStorage.setItem(key,id);return id;
    }catch(_){return 'tab-'+Math.random().toString(36).slice(2)+Date.now().toString(36);}
  }
  let duoLocal={instance:duoInstanceID(),
    peer:null,status:'AUS',lastAt:0,lastPublished:0,match:null,
    partnerID:null,ownID:null,failures:0,lastPromise:null,
     relayDrops:0,relayTimeouts:0,ackTimeouts:0,seenPeer:false,lastExpiredPlan:null};
  let retreatRequests=new Map(),defenseStats={retreatsOrdered:0,retreatsObserved:0,unknown:0,unconfirmed:0};
  // Manual slider values remain saved; fullAuto computes independent live values.
  let autoTuning={aggressive:85,reserve:35,actionsPerMinute:72,maxTargets:16,
    mode:'INIT',reason:'Warte auf Spielzustand',tick:-Infinity};
  const hardMode=()=>opts.impossibleMode && game?.config?.().gameConfig?.().difficulty==='Impossible';
  // The large World map is out-expanded by Impossible AI: the bot ends as the
  // defender and its territory plateaus early. Detect it to extend the
  // aggressive opening so the bot establishes territory before it is attacked.
  const largeMap=()=>{try{const cfg=game?.config?.().gameConfig?.()||{};
    const name=String(cfg.gameMap||'');if(name)return /world/i.test(name);}catch(_){}return false;};
  // Keep single-front coordination in Public/Medium as well as Impossible.
  // Difficulty-specific troop ratios remain tied to actual difficulty.
  const coordinatedWar=()=>opts.impossibleMode;
  const isWar=()=>warState.id!==null;
  // Test control exists only on loopback and only after explicit harness opt-in.
  const benchmark = ['localhost','127.0.0.1','[::1]'].includes(window.location?.hostname) &&
    window.__OF_BENCHMARK_CONFIG__?.enabled===true ? window.__OF_BENCHMARK_CONFIG__ : null;
  // recordsDropped counts true journal loss (a record the persistent stream
  // never received); recordsEvicted only counts in-memory ring rotations of
  // records the stream already received. The two must not be conflated.
  let recordSequence=0,recordCounts={},recordsDropped=0,recordsEvicted=0,streamErrors=0;
  // Stable per-match IDs identify individual emitted actions. An emitted
  // intent is NOT proof the worker accepted it or that it achieved a result.
  let actionSequence=0,lastActionId=null;
  let monitorSession='';
  let actionLedger=[];
  let diagnosticLastPeerTick=-Infinity;
  let diagnosticHelpSequence=0,diagnosticHelpId=null,diagnosticHelpSince=null;
  let diagnosticLastReceivedHelp=null,diagnosticLastHelpAck=null;
  let diagnosticHelpDeadline=null,diagnosticHelpExpired=false;
  let diagnosticAid=null,diagnosticLastCommitmentSeen=null;
  let diagnosticHelpClosing=null;
  let diagnosticDonationSeen=new Map();
  let donationCapture={polls:0,readable:0,candidates:0,matched:0,
    lastProbeTick:-Infinity,lastReceiptTick:null,lastProblem:null};
  let diagnosticDecisionSequence=0;
  // Diagnostic v2: preserve critical events independently of the 1400-record UI ring.
  // Session storage is tab-scoped and never shares another bot's player identity.
  const diagnosticV2={schemaVersion:2,critical:[],dropped:0,lastDuoStatus:null,
    lastDuoPeer:null,lastDuoAt:null,lastVerifiedPartnerId:null};
  const DIAGNOSTIC_CRITICAL_LIMIT=1200;
  function diagnosticCritical(record){
    const frozen=jsonCopy(record);
    diagnosticV2.critical.push(frozen);
    if(diagnosticV2.critical.length>DIAGNOSTIC_CRITICAL_LIMIT){
      diagnosticV2.critical.shift();diagnosticV2.dropped++;
    }
    // Full history is journaled to IndexedDB; no megabyte sessionStorage writes.
    // The compact tab-scoped checkpoint permits same-player reload recovery.
  }
  function diagnosticDuoTransition(status,peer,reason){
    const id=peer?.id??null;
    if(diagnosticV2.lastDuoStatus===status&&diagnosticV2.lastDuoPeer===id)return;
    diagnosticV2.lastDuoStatus=status;diagnosticV2.lastDuoPeer=id;
    diagnosticV2.lastDuoAt=new Date().toISOString();
    telemetry('duo_transition','Duo-Statuswechsel',{
      duoStatus:status,peerId:id,reason:reason??null,
      ownId:safeID(myPlayer()),matchId:String(game?.gameID?.()??'unknown'),
      duoRoom:opts.duoRoom||null});
  }
  // IndexedDB journals every telemetry record, not just the last UI-ring entries.
  // On unavailable/quota-blocked storage the export reports the missing range.
  const diagnosticStore={queue:[],opening:null,flushing:null,timer:null,
    persisted:0,lost:0,error:null};
  function diagnosticOpen(){
    if(diagnosticStore.opening)return diagnosticStore.opening;
    diagnosticStore.opening=new Promise(resolve=>{
      if(!window.indexedDB){diagnosticStore.error='indexeddb-unavailable';resolve(null);return;}
      try{
        const request=window.indexedDB.open('aggrobot-diagnostic-v2',1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('events'))
            db.createObjectStore('events',{keyPath:['session','seq']});
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>{diagnosticStore.error='open-failed';resolve(null);};
        request.onblocked=()=>{diagnosticStore.error='open-blocked';resolve(null);};
      }catch(_){diagnosticStore.error='open-exception';resolve(null);}
    });
    return diagnosticStore.opening;
  }
  function diagnosticEnqueue(record){
    diagnosticStore.queue.push(jsonCopy(record));
    if(diagnosticStore.queue.length>10000){
      const excess=diagnosticStore.queue.length-10000;
      diagnosticStore.queue.splice(0,excess);diagnosticStore.lost+=excess;
    }
    try{sessionStorage.setItem('aggrobot-diagnostic-v2-meta',JSON.stringify({
      session:monitorSession,matchId:String(game?.gameID?.()??'unknown'),
      playerId:safeID(myPlayer()),seq:recordSequence}));}catch(_){}
    if(!diagnosticStore.timer)
      diagnosticStore.timer=setTimeout(()=>{diagnosticStore.timer=null;
        void diagnosticFlush();},500);
  }
  async function diagnosticFlush(){
    if(diagnosticStore.flushing)return diagnosticStore.flushing;
    diagnosticStore.flushing=(async()=>{
      const db=await diagnosticOpen();
      if(!db){diagnosticStore.lost+=diagnosticStore.queue.length;
        diagnosticStore.queue=[];return;}
      while(diagnosticStore.queue.length){
        const batch=diagnosticStore.queue.splice(0,200);
        const ok=await new Promise(resolve=>{
          try{
            const tx=db.transaction('events','readwrite');
            const store=tx.objectStore('events');
            for(const entry of batch)store.put(entry);
            tx.oncomplete=()=>resolve(true);
            tx.onerror=()=>resolve(false);
            tx.onabort=()=>resolve(false);
          }catch(_){resolve(false);}
        });
        if(ok)diagnosticStore.persisted+=batch.length;
        else{diagnosticStore.lost+=batch.length;
          diagnosticStore.error='transaction-failed';}
      }
    })();
    try{await diagnosticStore.flushing;}finally{diagnosticStore.flushing=null;}
  }
  async function diagnosticReadAll(session=monitorSession){
    if(diagnosticStore.timer){if(typeof clearTimeout==='function')clearTimeout(diagnosticStore.timer);
      diagnosticStore.timer=null;}
    await diagnosticFlush();
    const db=await diagnosticOpen();
    if(!db)return diagnostics.map(jsonCopy);
    return new Promise(resolve=>{
      const entries=[];
      try{
        const tx=db.transaction('events','readonly');
        const range=IDBKeyRange.bound([session,0],
          [session,Number.MAX_SAFE_INTEGER]);
        const request=tx.objectStore('events').openCursor(range);
        request.onsuccess=()=>{
          const cursor=request.result;
          if(cursor){entries.push(cursor.value);cursor.continue();}
          else resolve(entries);
        };
        request.onerror=()=>{diagnosticStore.error='read-failed';
          resolve(diagnostics.map(jsonCopy));};
      }catch(_){diagnosticStore.error='read-exception';
        resolve(diagnostics.map(jsonCopy));}
    });
  }
  let budgetCommitments=[];
  let attackBlockReport=null,lastAttackBlockReport=-Infinity,
    lastOffenseDroughtReport=-Infinity;
  let crisisTrend=null,lastCrisisReport=-Infinity;
  let landingFailures=new Map();
  let neuralEvidence={calls:0,nonzero:0,actionCalls:0,actionNonzero:0,last:null};
  const jsonCopy=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
  function telemetry(kind,message,extra={}) {
    if((!opts.enabled&&kind!=='game_over') || !permittedMatch(game))return;
    let m=myPlayer(),tick=number(()=>game.ticks(),0);
    // Freeze each historical snapshot; otherwise shared mutable metrics can
    // make every old record appear to contain the latest values.
    let frozen=extra;
    if(kind==='snapshot'){
      try{frozen=JSON.parse(JSON.stringify(extra,(_,v)=>
        typeof v==='bigint'?v.toString():v));}
      catch(_){frozen={snapshotError:'Daten konnten nicht eingefroren werden'};}
    }
    // Generic troopSnapshot values are fallbacks; decision-local measurements
    // supplied by a caller after an async worker check must take precedence.
    const record={detailKind:frozen.kind,session:monitorSession,
      snapshotTick:lastTick,seq:++recordSequence,time:new Date().toISOString(),
      tick,kind,message,mode:strategic.mode,warTarget:warState.name,
      home:number(()=>m?.troops?.()),gold:number(()=>Number(m?.gold?.())),
      land:number(()=>m?.numTilesOwned?.()),committed:troopSnapshot.committed,
      incoming:troopSnapshot.incoming,...frozen};
    // Protect recording identity and metadata from an accidental extra field.
    record.session=monitorSession;record.seq=recordSequence;
    record.time=new Date().toISOString();record.tick=tick;
    record.kind=kind;record.message=message;
    record.schemaVersion=2;
    record.playerId=safeID(m);
    record.matchId=String(game?.gameID?.()??'unknown');
    record.frameId=monitorSession+':t'+tick;
    record.decisionId=record.decisionId??null;
    record.actionId=record.actionId??null;
    diagnostics.push(record);
    diagnosticEnqueue(record);
    if(/^(game_over|duo_|attack_confirmed|attack_unconfirmed|build_confirmed|build_unconfirmed|boat_|transport_|action)$/.test(kind))
      diagnosticCritical(record);
    if(kind==='action'&&record.actionId){
      actionLedger.push({actionId:record.actionId,decisionId:record.decisionId,
        tick:record.tick,intent:record.intent,description:message,
        requestedTroops:record.requestedTroops??null,
        quotedCost:record.quotedCost??null,emission:'event-bus',
        homeBefore:record.home,goldBefore:record.gold,
        actualTroopOutflow:'unknown',actualGoldCost:'unknown',
        observed:'unknown',effect:'unknown'});
      if(actionLedger.length>300)actionLedger.shift();
    }else if(record.actionId&&/^(attack|build|boat|transport)_(confirmed|unconfirmed|arrived|unresolved)$/.test(kind)){
      const action=actionLedger.find(x=>x.actionId===record.actionId);
      if(action){action.observed=kind;action.observedTick=record.tick;
        action.homeAfterObserved=record.home;
        action.goldAfterObserved=record.gold;
        action.effect='unknown';}
    }else if(record.actionId&&kind==='attack_outcome_observed'){
      const action=actionLedger.find(x=>x.actionId===record.actionId);
      if(action)action.outcomeObservation={
        ownLandBefore:record.ownLandBefore,ownLandAfter:record.ownLandAfter,
        defenderLandBefore:record.defenderLandBefore,
        defenderLandAfter:record.defenderLandAfter,
        observedOutcome:record.observedOutcome,attribution:record.attribution,
        effect:'unknown'};
    }
    recordCounts[kind]=(recordCounts[kind]||0)+1;
    if(benchmark && typeof benchmark.onRecord==='function'){
      try{benchmark.onRecord(jsonCopy(record));}
      // A record the journal callback failed to receive is a true loss.
      catch(_){streamErrors++;recordsDropped++;}
    }
    if(diagnostics.length>1400){
      // Ring eviction is a display cap, not a recording loss: the persistent
      // journal/stream received every record before it was evicted.
      const evicted=diagnostics.length-1400;recordsEvicted+=evicted;
      diagnostics.splice(0,evicted);
    }
  }
  // P0: link decision frames to emitted intents and confirmations.
  // A frame stays "pending" until the fixed observation horizon passes; if
  // the match ends before confirmation it is "censored", never "unknown=0".
  const DECISION_EFFECT_HORIZON=120,DECISION_RESOLVE_HORIZON=600;
  const DECISION_RESOLVED_HISTORY=16,DECISION_MAX_PENDING=1024;
  function compactDecisionFrames(tick){
    // Retain ALL pending frames through their 600-tick observation horizon.
    // Only already-resolved display history is a small bounded ring.
    let pending=0;
    for(const frame of decisionFrames)if(!frame.resolved)pending++;
    if(pending>DECISION_MAX_PENDING){
      let overflow=pending-DECISION_MAX_PENDING;
      for(const frame of decisionFrames){
        if(!overflow||frame.resolved)continue;
        frame.resolved=true;frame.outcomeStatus='unknown';
        frame.resolution={atTick:tick,censored:true,reason:'pending-capacity',
          effectHorizon:DECISION_EFFECT_HORIZON,
          resolveHorizon:DECISION_RESOLVE_HORIZON};
        overflow--;
      }
    }
    let resolved=0;
    for(let i=decisionFrames.length-1;i>=0;i--){
      if(!decisionFrames[i].resolved)continue;
      if(++resolved>DECISION_RESOLVED_HISTORY)decisionFrames.splice(i,1);
    }
  }
  function censorPendingDecisionFrames(tick,reason='match-end'){
    for(const frame of decisionFrames){
      if(frame.resolved)continue;
      frame.resolved=true;frame.outcomeStatus='unknown';
      frame.resolution={atTick:tick,censored:true,reason,
        effectHorizon:DECISION_EFFECT_HORIZON,
        resolveHorizon:DECISION_RESOLVE_HORIZON};
    }
    compactDecisionFrames(tick);
  }
  function resolveDecisionFrames(tick){
    if(tick===null||!Number.isFinite(tick)||tick<0)return;
    for(const frame of decisionFrames){
      if(frame.resolved)continue;
      const linked=actionLedger.filter(e=>e.decisionId===frame.decisionId);
      const seen=new Map();
      for(const e of linked)seen.set(e.actionId,e);
      const intents=[...seen.values()].map(e=>({actionId:e.actionId,
        intent:e.intent,tick:e.tick,emission:e.emission,
        observed:e.observed,observedTick:e.observedTick??null}));
      frame.actualIntents=intents;
      frame.actionReceipt=[...seen.values()].map(e=>({actionId:e.actionId,
        observed:e.observed,observedTick:e.observedTick??null,
        effect:e.effect,outcomeObservation:e.outcomeObservation??null,
        homeAfter:e.homeAfterObserved??null,
        goldAfter:e.goldAfterObserved??null}));
      frame.observedEffects=[...seen.values()].map(e=>({actionId:e.actionId,
        effect:e.effect,
        observedOutcome:e.outcomeObservation?.observedOutcome??null}));
      const confirmed=seen.size>0&&[...seen.values()].some(e=>
        String(e.observed).endsWith('confirmed'));
      const unconfirmed=seen.size>0&&[...seen.values()].some(e=>
        e.observed==='attack_unconfirmed'||e.observed==='build_unconfirmed');
      const horizonReached=tick>=frame.tick+DECISION_EFFECT_HORIZON;
      if(horizonReached&&
        (confirmed||unconfirmed||tick>=frame.tick+DECISION_RESOLVE_HORIZON)){
        frame.outcomeStatus=confirmed?'confirmed':
          unconfirmed?'unconfirmed':'unknown';
        frame.resolution={atTick:tick,
          censored:!confirmed&&!unconfirmed,
          effectHorizon:DECISION_EFFECT_HORIZON,
          resolveHorizon:DECISION_RESOLVE_HORIZON};
        frame.resolved=true;
      }
    }
    compactDecisionFrames(tick);
  }
  function gameOutcome(g,me){
    const result={outcome:'unknown',source:'gameOver',tick:number(()=>g?.ticks?.(),-1),
      alive:me?.isAlive?.()??null,land:number(()=>me?.numTilesOwned?.(),0),
      progress:winStatus.progress,mode:winStatus.mode};
    // The official GameView.gameOver() only says a WinUpdate was observed;
    // the official winner tuple carries the actual player/team outcome.
    try{
      const updates=g?.updatesSinceLastTick?.();
      const current=Object.values(updates||{}).flat().find(u=>
        u && typeof u==='object' && Object.hasOwn(u,'winner') &&
        Object.hasOwn(u,'allPlayersStats'));
      const win=lastWinnerSignal||current;
      if(win){
        const winner=win.winner;
        result.source='WinUpdate';
        result.winnerType=Array.isArray(winner)?winner[0]:null;
        result.winnerNames=Array.isArray(winner)&&winner[0]==='team'?
          [String(winner[1])]:[];
        if(winner===null||winner===undefined)result.outcome='incomplete';
        else if(Array.isArray(winner)&&['player','team','nation'].includes(winner[0])){
          const ids=winner.slice(winner[0]==='player'?1:2);
          // Winner tuples contain ClientID, not PlayerID or numeric smallID.
          const clientID=me?.clientID?.();
          if(winner[0]==='team'&&me?.team?.()!==null&&
            me?.team?.()!==undefined&&String(winner[1])===String(me.team()))
            result.outcome='victory';
          else if(typeof clientID==='string'&&clientID.length)
            result.outcome=winner[0]==='nation'?'defeat':ids.includes(clientID)?'victory':'defeat';
        }
      }
    }catch(_){}
    return result;
  }
  function diagnosticSnapshot() {
    const config=game?.config?.().gameConfig?.()||{};
    const details={bot:VERSION,learning:{enabled:!!opts.learningEnabled,updates:learn.updates,contexts:jsonCopy(learn.contexts),lastResult:learn.lastResult,lastResultScope:'persistent-learning-history',currentMatchResult:gameEnd?.outcome??null},gameType:config.gameType,
      difficulty:config.difficulty,
      benchmarkMeta:{gameMap:config.gameMap??null,
        gameMapSize:config.gameMapSize??null,gameMode:config.gameMode??null,
        seed:config.seed??null,engineCommit:window.BOOTSTRAP_CONFIG?.gitCommit??null,
        matchEndObserved:gameEnd!==null,resultsVerifiedByBrowser:false},
      matchContext:matchContext(),
      options:{...opts,enabled:false},archetype:archetypePolicy(),archetypeSignature:archetypeSignature(),
      intents:intentHealth(),tuning:{...autoTuning,enabled:!!opts.fullAuto,
        effective:{aggressive:setting('aggressive'),reserve:setting('reserve'),
          actionsPerMinute:setting('actionsPerMinute'),maxTargets:setting('maxTargets')}},attackReceipts, pendingAttack, attackCommands, attackOrigins:[...observedAttacks.values()],
      construction:{pending:economicPending,blocked:[...economicBlocked.entries()],failedProbes:failedEconomyProbes,lastConfirmed:successfulEconomyTick,investment:investmentStatus,
        coreFunding,lastProbe:lastEconomyProbeReport},
      neuralDecisionEvidence,
      attackBlockReport,crisisTrend,landingFailures:[...landingFailures],
      neuralEvidence:{...neuralEvidence,model:neuralModelInfo()},
      deployment:deploymentInfo(),
      // §28 schema-7 branch funnel: aggregate counts + the last decision so
      // the pre-gate (differentExecutedTurns>0) and the dev/holdout
      // comparison can be reconciled offline from the match report.
      branchFunnel:{...branchFunnel,lastDecision:{...branchFunnel.lastDecision}},
      validation:{forecastAudits,incomeAttribution,
        terrainMethod:'nuke-cubic-bezier-conservative',
        railMethod:'owned-land-corridor-proxy',
        fullBrowserMatchValidated:false,
        note:'Die Datei ist ein Spielmitschnitt; Sieg und echte Mehrkarten-Benchmarks erfordern vollständige Browser-Matches.'},
      opponents:[...opponentProfiles.values()].map(v=>({...v})),
      decisionFrame:lastDecisionFrame,planning:planningState,
      decisionFrames:decisionFrames.map(v=>({...v})),
      economyBudgetEvidence,shadowDecisionEvidence,
      investmentAssessments,operation,duoPlan,victoryThreat,
      localDuo:{status:duoLocal.status,peer:duoLocal.peer,
        partnerID:opts.duoPartnerID,resolvedPartnerID:
          duoTrustedPeer()?.id??diagnosticV2.lastVerifiedPartnerId??null,
        ownID:safeID(myPlayer()),connected:!!duoTrustedPeer(),match:duoLocal.match,
        failures:duoLocal.failures,relayDrops:duoLocal.relayDrops,
        relayTimeouts:duoLocal.relayTimeouts,ackTimeouts:duoLocal.ackTimeouts,
        phase:duoStatusView(opts.duoEnabled,duoTrustedPeer(),duoPlan,
          number(()=>game?.ticks?.(),-1),duoLocal)},
      decisionTimeline:decisionTimeline.map(v=>({...v})),
      war:{...warState},gameEnd,spawn:{...spawnState,best:spawnCache?{...spawnCache}:null},victory:winStatus,income:incomeStatus,fleet:fleetStatus,marine:{stats:marineStats,pendingBoat,pendingWarship,landingAudits:landingAudits.map(a=>({...a})),
        marineUnresolvedWatches:marineUnresolvedWatches.map(a=>({...a})),portProbeFailures},strategicTelemetry,military:troopSnapshot,
      defense:{status:defenseStatus,stats:defenseStats,pendingRetreats:[...retreatRequests.values()]},
      rockets:{confirmed:nukeShots,attempts:nukeAttempts,unconfirmed:nukeUnconfirmed,pending:nukePending},
      diplomacy:{status:diplomacyStatus,stats:diplomacyStats,pending:[...diplomacyPending.values()]},records:diagnostics,createdAt:new Date().toISOString()};
    details.actionTrace={nextSequence:actionSequence+1,lastActionId,
      ledger:actionLedger.map(v=>({...v})),
      semantics:'sent-is-not-confirmed; confirmations are observations; effect unknown'};
    details.actionEvidence=actionEvidenceKernel(actionLedger);
    details.diagnosticV2={schemaVersion:2,matchId:String(game?.gameID?.()??'unknown'),
      playerId:safeID(myPlayer()),playerName:nameOf(myPlayer()),
      partnerId:opts.duoEnabled?
        duoTrustedPeer()?.id??diagnosticV2.lastVerifiedPartnerId??null:null,
      partnerIdEvidence:!opts.duoEnabled?'local-duo-off':
        duoTrustedPeer()?'verified-current-peer':
        diagnosticV2.lastVerifiedPartnerId?'last-verified-this-match':'unknown',
      duoRoom:opts.duoEnabled?opts.duoRoom||null:null,
      personalEliminationTick:gameEnd?.personalEliminated?gameEnd.tick:null,
      matchEndTick:game?.gameOver?.()?number(()=>game.ticks(),null):null,
      donationCapture:{...donationCapture},
      critical:diagnosticV2.critical,dropped:diagnosticV2.dropped,
      journal:{persisted:diagnosticStore.persisted,queued:diagnosticStore.queue.length,
        lost:diagnosticStore.lost,error:diagnosticStore.error},
      lastDuoTransitionAt:diagnosticV2.lastDuoAt,
      helpRequestId:diagnosticHelpId,helpSinceTick:diagnosticHelpSince,
      helpDeadlineTick:diagnosticHelpDeadline,
      helpAckObserved:diagnosticLastHelpAck===diagnosticHelpId&&
        diagnosticHelpId!==null,
      evidence:'event-bus emission is not confirmed effect'};
    details.recording={total:recordSequence,counts:{...recordCounts},dropped:recordsDropped,
      evicted:recordsEvicted,
      firstSequence:diagnostics[0]?.seq??null,streamErrors};
    return jsonCopy(details);
  }

  // Stored ZIP: a single download avoids multi-download browser blocking.
  function diagnosticZip(files){
    const encoder=new TextEncoder(),locals=[],central=[];
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)
      c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
    const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)
      c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
    const put16=(view,at,n)=>view.setUint16(at,n,true);
    const put32=(view,at,n)=>view.setUint32(at,n,true);
    let offset=0,centralSize=0;
    if(files.length>65535)throw Error('ZIP entry limit');
    for(const [name,body] of files){
      const filename=encoder.encode(name),bytes=encoder.encode(body);
      if(bytes.length>0xffffffff||offset+bytes.length>0xffffffff)
        throw Error('Diagnostic ZIP too large');
      const crc=crc32(bytes),local=new Uint8Array(30),lv=new DataView(local.buffer);
      put32(lv,0,0x04034b50);put16(lv,4,20);put16(lv,6,0x0800);
      put16(lv,8,0);put32(lv,14,crc);put32(lv,18,bytes.length);
      put32(lv,22,bytes.length);put16(lv,26,filename.length);
      locals.push(local,filename,bytes);
      const header=new Uint8Array(46),cv=new DataView(header.buffer);
      put32(cv,0,0x02014b50);put16(cv,4,20);put16(cv,6,20);
      put16(cv,8,0x0800);put32(cv,16,crc);put32(cv,20,bytes.length);
      put32(cv,24,bytes.length);put16(cv,28,filename.length);
      put32(cv,42,offset);
      central.push(header,filename);
      offset+=local.length+filename.length+bytes.length;
      centralSize+=header.length+filename.length;
    }
    const ending=new Uint8Array(22),ev=new DataView(ending.buffer);
    put32(ev,0,0x06054b50);put16(ev,8,files.length);
    put16(ev,10,files.length);put32(ev,12,centralSize);
    put32(ev,16,offset);
    return new Blob([...locals,...central,ending],{type:'application/zip'});
  }
  function diagnosticDownload(blob,filename){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  let diagnosticAutoExported=false;
  async function exportDiagnosticPackage(automatic=false){
    if(automatic){
      if(diagnosticAutoExported)return;
      diagnosticAutoExported=true;
    }
    if(automatic)censorPendingDecisionFrames(
      number(()=>game?.ticks?.(),-1),'match-end-or-elimination');
    const session=monitorSession,summary=diagnosticSnapshot();
    const rows=await diagnosticReadAll(session);
    const complete=rows.length===summary.recording.total&&
      rows.every((row,i)=>row.session===session&&row.seq===i+1)&&
      diagnosticStore.lost===0&&!diagnosticStore.error;
    summary.diagnosticV2.journal={
      ...summary.diagnosticV2.journal,storedRows:rows.length,
      expectedRows:summary.recording.total,complete,
      note:complete?'IndexedDB timeline complete':
        'Timeline incomplete or storage unavailable; do not use as complete evidence'};
    const sorted=rows.sort((a,b)=>a.seq-b.seq);
    const jsonl=items=>items.map(x=>JSON.stringify(x)).join('\n')+
      (items.length?'\n':'');
    const duo=sorted.filter(x=>/^duo_/.test(x.kind)||
      x.kind==='action'&&/^DUO/.test(x.message||''));
    const snapshot=sorted.filter(x=>x.kind==='snapshot');
    // Official Engine Team and localhost Duo are independent. Only actual
    // engine DonateEvent receipts count as delivered support; an emitted
    // TEAMHILFE intent is NOT evidence that a donation arrived.
    const officialTeam=summary.benchmarkMeta?.gameMode==='Team';
    const team=officialTeam?sorted.filter(x=>
      x.kind==='donation_observed'||/^team_/.test(x.kind)||
      x.kind==='game_over'||
      x.kind==='action'&&/TEAMHILFE|TEAMGOLD/.test(x.message||'')):[];
    summary.diagnosticV2.team={
      officialTeam,localDuoEnabled:opts.duoEnabled===true,
      observedDonationEvents:team.filter(x=>x.kind==='donation_observed').length,
      personalEliminationTick:summary.diagnosticV2.personalEliminationTick,
      teamOutcome:gameEnd?.teamOutcomePending?'unknown':gameEnd?.outcome??'unknown',
      outcomeSemantics:'personal elimination is not proof of team defeat'};
    // Compact overview includes the old diagnostic for existing consumers.
    // No statement of action success is inferred from gold/land deltas.
    const files=[
      ['summary.json',JSON.stringify(summary,null,2)],
      ['events.jsonl',jsonl(sorted)],
      ['snapshots.jsonl',jsonl(snapshot)],
      ['duo.jsonl',jsonl(duo)],
      ['team.jsonl',jsonl(team)],
      ['README.txt','OpenFront diagnostic v2 | session='+session+
        '\ncomplete='+complete+' | event bus emission is not effect proof.'+
        '\nZIP uses stored entries. Merge browsers by matchId, then playerId and session.\n']
    ];
    if(session!==monitorSession)return; // Never label a new match as old.
    try{diagnosticDownload(diagnosticZip(files),
      'OpenFront_'+VERSION+'_'+String(summary.diagnosticV2.playerId||'unknown')+
      '_DiagnoseV2.zip');}
    catch(e){console.warn(PREFIX,'Diagnosepaket konnte nicht exportiert werden',e);}
  }
  function exportDiagnostics(){void exportDiagnosticPackage();}


  const log = message => {recent.unshift(message);recent=recent.slice(0,7);console.info(PREFIX,message);telemetry('decision',message);};
  const gameType = g => {
    try{return g?.config?.().gameConfig?.().gameType ?? null;}catch(_){return null;}
  };
  const multiplayerMatch = g => ['Public','Private'].includes(gameType(g));
  // Ranked 2v2 is an explicit OpenFront gameConfig marker. A normal Duos
  // lobby must keep its old economy and combat tuning.
  function rankedDuo(me=myPlayer()) {
    const gc=game?.config?.().gameConfig?.()||{};
    if(!me||gc.rankedType!=='2v2'||gc.gameMode!=='Team')return null;
    const team=me.team?.();
    if(team===null||team===undefined)return null;
    const views=game?.playerViews?.()||[];
    const partners=views.filter(p=>p&&safeID(p)!==safeID(me)&&
      p.isAlive?.()&&p.team?.()===team&&me.isOnSameTeam?.(p));
    if(partners.length!==1)return null;
    const enemies=views.filter(p=>p?.isAlive?.()&&p.isPlayer?.()&&
      safeID(p)!==safeID(me)&&!friendly(p,me));
    return {partner:partners[0],enemies,team,
      ownID:safeID(me),partnerID:safeID(partners[0])};
  }
  function duoFocus(me,enemy){
    // Only game-observed attacks by a genuinely allied reciprocal peer
    // earn combat credit. Relay intentions are never counted as troops.
    const peer=duoTrustedPeer();
    const local=peer&&actualFriendly(peer.player,me)?
      {partner:peer.player,partnerID:peer.id}:null;
    const duo=rankedDuo(me)||local;
    if(!duo||!enemy||safeID(enemy)===duo.partnerID||
      friendly(enemy,me))return null;
    const outgoing=(duo.partner.outgoingAttacks?.()||[])
      .filter(a=>!a.retreating&&a.troops>0);
    const on=outgoing.filter(a=>attackTargets(a.targetID,enemy))
      .reduce((sum,a)=>sum+number(()=>a.troops,0),0);
    const elsewhere=outgoing.filter(a=>a.targetID!==null&&a.targetID!==0&&
      !attackTargets(a.targetID,enemy))
      .reduce((sum,a)=>sum+number(()=>a.troops,0),0);
    return {on,elsewhere,partner:duo.partnerID};
  }
  // Credit only an actually observed, non-retreating partner stack. Never
  // count an announced attack, an allied intention or the partner's whole
  // home army. All independent home/front/worker gates remain authoritative.
  function duoBattleCredit(me,enemy) {
    const on=duoFocus(me,enemy)?.on||0;
    const troops=Math.max(0,number(()=>enemy?.troops?.(),0));
    return Math.min(on*.55,troops*.75);
  }
  function matchContext(me=myPlayer()) {
    const cfg=game?.config?.().gameConfig?.()||{};
    const players=(game?.playerViews?.()||[]).filter(p=>p?.isPlayer?.()&&p?.isAlive?.());
    const selfID=safeID(me);
    let humans=0,nations=0,hostileHumans=0,hostileNations=0;
    for(const p of players){
      if(safeID(p)===selfID)continue;
      const human=typeof p.clientID?.()==='string'&&p.clientID?.().length>0;
      if(human)humans++;else nations++;
      if(!friendly(p,me)){if(human)hostileHumans++;else hostileNations++;}
    }
    return {gameType:cfg.gameType??null,gameMode:cfg.gameMode??null,
      difficulty:cfg.difficulty??null,multiplayer:multiplayerMatch(game),
      rankedType:cfg.rankedType??null,ranked2v2:cfg.rankedType==='2v2'&&
        cfg.gameMode==='Team',humans,nations,hostileHumans,hostileNations,
      team:winStatus.mode==='Team'};
  }
  // Allow every known playable OpenFront game type without a second opt-in.
  // Fail closed for unknown modes and recorded replays.
  const permittedMatch = g => {
    try{return !!g && !g.config().isReplay?.() &&
      ['Singleplayer','Public','Private'].includes(gameType(g));}
    catch(_){return false;}
  };
  const conflicts = () => !!(window.__ofSoloAggroBot1110 || window.__ofSoloAggroBot11010 || window.__ofSoloAggroBot1109 || window.__ofSoloAggroBot1108 || window.__ofSoloAggroBot1 || window.__ofSoloAggroBot11 || window.__ofSoloAggroBot12 || window.__ofSoloAggroBot13 || window.__ofSoloAggroBot14 || window.__ofSoloAggroBot15 || window.__ofSoloAggroBot16 || window.__ofSoloAggroBot17 || window.__ofSoloAggroBot18 || window.__ofSoloAggroBot181 || window.__ofSoloAggroBot190 || window.__ofSoloAggroBot191 || window.__ofSoloAggroBot192 || window.__ofSoloAggroBot193 || window.__ofSoloAggroBot194 || window.__ofSoloAggroBot195 || window.__ofSoloAggroBot196 || window.__ofSoloAggroBot197 || window.__ofSoloAggroBot198 || window.__ofSoloAggroBot199 || window.__ofSoloAggroBot1100 || window.__ofSoloAggroBot1101 || window.__ofSoloAggroBot1102 || window.__ofSoloAggroBot1103 || window.__ofSoloAggroBot1104 || window.__ofSoloAggroBot1105 || window.__ofSoloAggroBot1106 || window.__ofSoloAggroBot1107);
  function advisorConflict() {
    if (!window.__openfrontSpawnAdvisorV104) return false;
    try {const s=JSON.parse(localStorage.getItem('openfront-spawn-advisor-10.4')||'{}');
      return s.auto!==false || s.smart===true || s.accept===true;
    } catch (_) {return true;}
  }
  const connected = () => permittedMatch(game) && !game?.gameOver?.() && !conflicts() && !advisorConflict() && bus && typeof bus.emit==='function';
  const myPlayer = () => {try{return game?.myPlayer?.() || null;}catch(_){return null;}};
  const live = serial => serial===generation && opts.enabled && connected();
  function discover() {
    const tags=['spawn-timer','build-menu','control-panel','unit-display','game-left-sidebar','game-right-sidebar'];
    for(const tag of tags) {
      const element=document.querySelector(tag), g=element?.game;
      if(!g || typeof g.playerViews!=='function' || typeof g.terrainByte!=='function' ||
         typeof g.ref!=='function' || typeof g.config!=='function') continue;
      let b=element.eventBus;
      if(!b) for(const otherTag of tags) {
        const other=document.querySelector(otherTag);
        if(other?.game===g && other.eventBus){b=other.eventBus;break;}
      }
      return {g,b:b||null};
    }
    return null;
  }
  // We only inspect event constructors; no test event is emitted into the game.
  function recognize(b) {
    const result={};
    // EventBus may come from another JS realm; instanceof Map is unreliable
    // for Tampermonkey / VM-wrapped constructors. Inspect its interface instead.
    if(!b?.listeners || typeof b.listeners.keys!=='function')return result;
    const names={spawn:'SendSpawnIntentEvent',attack:'SendAttackIntentEvent',cancel:'CancelAttackIntentEvent',
      boat:'SendBoatAttackIntentEvent',build:'BuildUnitIntentEvent',
      upgrade:'SendUpgradeStructureIntentEvent',
      alliance:'SendAllianceRequestIntentEvent',reject:'SendAllianceRejectIntentEvent',
      embargo:'SendEmbargoIntentEvent',embargoAll:'SendEmbargoAllIntentEvent',
      warship:'MoveWarshipIntentEvent',cancelBoat:'CancelBoatIntentEvent',
      donateTroops:'SendDonateTroopsIntentEvent',donateGold:'SendDonateGoldIntentEvent',
      extend:'SendAllianceExtensionIntentEvent',winnerSignal:'SendWinnerEvent'};
    const possibilities=Object.fromEntries(Object.keys(names).map(k=>[k,[]]));
    for(const C of b.listeners.keys()) {
      if(typeof C!=='function') continue;
      for(const [key,n] of Object.entries(names)) if(C.name===n) result[key]=C;
      try {const o=new C(4812);if(o?.tile===4812 && Object.keys(o).length===1) possibilities.spawn.push(C);}catch(_){}
      try {const o=new C('__BOT_PROBE__',4812);if(o?.targetID==='__BOT_PROBE__' && o?.troops===4812) possibilities.attack.push(C);}catch(_){}
      try {const o=new C('__BOT_CANCEL__');if(o?.attackID==='__BOT_CANCEL__' && Object.keys(o).length===1)possibilities.cancel.push(C);}catch(_){}
      try {const o=new C(4812,1824);if(o?.dst===4812 && o?.troops===1824) possibilities.boat.push(C);}catch(_){}
      try {const o=new C('City',4812);if(o?.unit==='City' && o?.tile===4812) possibilities.build.push(C);}catch(_){}
      try {const o=new C(4812,'City',1);if(o?.unitId===4812 && o?.unitType==='City') possibilities.upgrade.push(C);}catch(_){}
      const probeA={id(){return '__OF_BOT_A__';}},probeB={id(){return '__OF_BOT_B__';}};
      try {const o=new C(probeA,probeB);if(o?.requestor===probeA && o?.recipient===probeB &&
        Object.keys(o).length===2)possibilities.alliance.push(C);}catch(_){}
      try {const o=new C(probeA);if(o?.requestor===probeA && Object.keys(o).length===1)
        possibilities.reject.push(C);}catch(_){}
      try {const o=new C(probeB,'start');if(o?.target===probeB&&
        o?.action==='start')possibilities.embargo.push(C);}catch(_){}
      try {const o=new C('start');if(o?.action==='start'&&
        Object.keys(o).length===1)possibilities.embargoAll.push(C);}catch(_){}
      try {const o=new C([4812],1824);if(o?.tile===1824&&o?.unitIds?.[0]===4812)
        possibilities.warship.push(C);}catch(_){}
      try {const o=new C(4812);if(o?.unitID===4812&&Object.keys(o).length===1)
        possibilities.cancelBoat.push(C);}catch(_){}
      try {const o=new C(probeA,4812);if(o?.recipient===probeA&&o?.troops===4812)
        possibilities.donateTroops.push(C);}catch(_){}
      try {const o=new C(probeA,4812n);if(o?.recipient===probeA&&o?.gold===4812n)
        possibilities.donateGold.push(C);}catch(_){}
      try {const o=new C(probeB);if(o?.recipient===probeB&&Object.keys(o).length===1)
        possibilities.extend.push(C);}catch(_){}
    }
    for(const k of Object.keys(possibilities)) if(!result[k] && possibilities[k].length===1)
      result[k]=possibilities[k][0];
    return result;
  }
  function bindWinnerCapture(nextBus,nextCtors=ctors){
    if(winnerBus&&winnerCtor&&winnerHandler&&typeof winnerBus.off==='function'){
      try{winnerBus.off(winnerCtor,winnerHandler);}catch(_){}
    }
    winnerBus=null;winnerCtor=null;winnerHandler=null;
    const C=nextCtors?.winnerSignal;
    if(!nextBus||typeof nextBus.on!=='function'||typeof C!=='function')return false;
    winnerHandler=event=>{
      if(!event||!Object.hasOwn(event,'winner'))return;
      lastWinnerSignal={winner:event.winner,allPlayersStats:event.allPlayersStats||{}};
      telemetry('winner_observed','Siegerereignis dauerhaft erfasst',
        {winnerType:Array.isArray(event.winner)?event.winner[0]:null});
    };
    try{nextBus.on(C,winnerHandler);winnerBus=nextBus;winnerCtor=C;return true;}
    catch(_){winnerHandler=null;return false;}
  }
  function allianceOfferPath(){
    if(typeof ctors.alliance==='function')return 'intent';
    // Official OpenFront PlayerPanel.handleAllianceClick emits the real
    // SendAllianceRequestIntentEvent through its own Transport EventBus.
    // Never synthesize an unknown/minified intent constructor.
    const panel=document.querySelector('player-panel');
    if(!panel)return null;
    return panel.g===game&&panel.eventBus===bus&&
      typeof panel.handleAllianceClick==='function'?
      'player-panel':null;
  }
  function intentHealth() {
    const alliancePath=allianceOfferPath();
    const missing=INTENT_KINDS.filter(kind=>
      typeof ctors[kind]!=='function'&&
      !(kind==='alliance'&&alliancePath==='player-panel'));
    return {found:INTENT_KINDS.length-missing.length,total:INTENT_KINDS.length,
      missing,critical:missing.filter(kind=>CORE_INTENTS.includes(kind)),
      eventBus:!!bus,alliancePath:alliancePath||'unavailable'};
  }
  // Report only when detection changes or the user explicitly starts.
  function reportIntents(force=false) {
    if(!bus)return intentHealth();
    const health=intentHealth(),signature=health.missing.join(',');
    if(force||signature!==lastIntentHealth){
      lastIntentHealth=signature;
      const message=health.found+'/'+health.total+' Intents erkannt'+
        (health.missing.length?' · fehlen: '+health.missing.join(', '):' · vollständig');
      if(health.missing.length)console.warn(PREFIX,'INTENT-WARNUNG: '+message);
      else console.info(PREFIX,message);
      if(opts.enabled){
        telemetry(health.missing.length?'intent_missing':'intent_ready',message,
          {intents:health});
        if(health.critical.length)log('ACHTUNG: Pflicht-Intents fehlen: '+health.critical.join(', '));
      }
    }
    return health;
  }
  let autoStartGame=null;
  function maybeAutoStart() {
    // One attempt per game object: manual pause and Not-Aus must not be undone
    // by the next 400-ms polling cycle. A new match clears this latch.
    if(benchmark || !opts.autoStart || opts.enabled || autoStartGame===game || !connected())return false;
    autoStartGame=game;
    opts.enabled=true;generation++;persist();
    status='Neue '+(multiplayerMatch(game)?'Multiplayer-':'Singleplayer-')+'Partie · Bot automatisch gestartet';
    log('BOT AUTO-START · '+gameType(game));
    reportIntents(true);
    return true;
  }
  function reset(g,b) {
    generation++; game=g;bus=b;ctors=recognize(b);busy=false;lastWinnerSignal=null;
    const matchId=String(g?.gameID?.()??'unknown'),playerId=safeID(myPlayer());
    let prior=null;try{prior=JSON.parse(
      sessionStorage.getItem('aggrobot-diagnostic-v2-meta')||'null');}catch(_){}
    const resumed=matchId!=='unknown'&&prior?.matchId===matchId&&
      (!prior.playerId||!playerId||prior.playerId===playerId)&&
      /^match-[a-z0-9-]+$/.test(prior.session||'');
    monitorSession=resumed?prior.session:'match-'+Date.now().toString(36)+'-'+
      Math.floor(Math.random()*0xffffffff).toString(36).padStart(8,'0');
    budgetCommitments=[];attackBlockReport=null;lastAttackBlockReport=-Infinity;
    lastOffenseDroughtReport=-Infinity;
    crisisTrend=null;lastCrisisReport=-Infinity;landingFailures.clear();
    neuralEvidence={calls:0,nonzero:0,actionCalls:0,actionNonzero:0,last:null};
    autoStartGame=null;
    bindWinnerCapture(bus,ctors);
    lastIntentHealth=null;lastIntentProbe=-Infinity;missingIntentLogged.clear();
    lastTick=-1;lastSpawn=-Infinity;lastEconomy=-Infinity;lastEconomyProbe=-Infinity;
    lastBoat=-Infinity;lastBorderTick=-Infinity;borderCache=null;borderPlayer=null;
    buildCursor=0;spawnCache=null;spawnJob=null;spawnRetryAt=0;spawnAlternatives=[];spawnState={scanned:0,phase:'idle',lastSent:null,attempts:0,blocked:null,deadline:null};cooldowns.clear();rejected.clear();
    plan=null;lastSelection='';lastEmission=0;borderOffset=0;lastBorderRefresh=0;
    totalSent=0;totalFailed=0;actions=[];errors=0;troopSamples=[];
    lastDecisionFrame=null;lastRecoveryReason='';lastBattle=null;pendingAttack=null;targetIntelCache.clear();frontMemory.clear();opponentHistory.clear();lastEconomyPosture='—';lastDirectorDecision=null;planningState={tick:-Infinity,candidates:[],selected:null,rejected:null,rejectedCandidates:[],durationMs:0,budgetMs:50,truncated:false,decisionId:null,matchId:'unknown',clientId:null,dataAge:{requestedTick:null,borderAgeTicks:null},missingMask:{borderStale:true,opponentTroopsUnknown:0,modelEnabled:false},provenance:{bot:VERSION,engineCommit:null,gameMode:'unknown'},modelChoice:null,modelScores:null,actualIntents:null,blockReasons:null,actionReceipt:null,observedEffects:null,outcomeStatus:'pending',resolved:false};investmentAssessments=[];neuralPolicyCache={key:null,output:null};lastFrontWarning=-Infinity;
    attackReceipts={confirmed:0,unconfirmed:0,territoryGained:0};blockedTargets.clear();
    attackCommands=[];attackCommandSequence=0;observedAttacks.clear();
    actionSequence=0;lastActionId=null;actionLedger=[];decisionFrames=[];
    diagnosticAutoExported=false;diagnosticLastPeerTick=-Infinity;
    diagnosticHelpSequence=0;diagnosticHelpId=null;diagnosticHelpSince=null;
    diagnosticLastReceivedHelp=null;diagnosticLastHelpAck=null;
    diagnosticHelpDeadline=null;diagnosticHelpExpired=false;
    diagnosticAid=null;diagnosticLastCommitmentSeen=null;
    diagnosticHelpClosing=null;diagnosticDecisionSequence=0;
    diagnosticDonationSeen.clear();
    donationCapture={polls:0,readable:0,candidates:0,matched:0,
      lastProbeTick:-Infinity,lastReceiptTick:null,lastProblem:null};
    diagnosticV2.critical=[];diagnosticV2.dropped=0;
    diagnosticV2.lastDuoStatus=null;diagnosticV2.lastDuoPeer=null;
    diagnosticV2.lastVerifiedPartnerId=null;
    diagnosticV2.lastDuoAt=null;
    failedEconomyProbes=0;successfulEconomyTick=-Infinity;warWaitSince=-Infinity;
    coreQuotes.clear();coreFunding=null;lastCoreFundingReport=-Infinity;
    lastEconomyProbeReport=null;neuralDecisionEvidence=null;economyBudgetEvidence=null;shadowDecisionEvidence=null;
    duoSiloBlockedUntil=-Infinity;
    lastEconomicAction=-Infinity;lastNeutralSend=-Infinity;lastEnemySend=-Infinity;lastHostilePressure=-Infinity;consecutiveIdle=0;
    economicPending=null;economicBlocked.clear();economicNegative.clear();economicStatus='Bauplanung bereit';economicLastPlan='—';
    samQuotedCost=0;portQuotedCost=0;samQuotedTick=-Infinity;portQuotedTick=-Infinity;
    samAffordableFailureSince=null;landingAudits=[];marineUnresolvedWatches=[];
    economyBusy=false;borderInflight=null;legalNegative.clear();runtime={borderMs:0,combatMs:0,economyMs:0,attackProbes:0,buildProbes:0};
    strategic={mode:'EXPAND',reason:'Startphase',buildStyle:'Ausgewogen',since:-Infinity,groups:[]};
    diplomacyHandled.clear();diplomacyPending.clear();diplomacyMissingLogged.clear();lastDiplomaticEmit=0;
    lastDiplomacyTick=-Infinity;lastProposalTick=-Infinity;diplomacyStatus='Noch keine Anfrage';
    diplomacyStats={accepted:0,rejected:0,offered:0};goldSamples=[];incomeStatus={train:null,trade:null,gold:null,observed:false};
    winStatus={mode:'FFA',progress:null,threshold:null,remaining:null,urgent:false};fleetStatus='Keine Marineaktivität';lastFleet=-Infinity;lastDonation=-Infinity;navalSweep=0;
    tradeStatus='Handel automatisch offen';lastTradeTick=-Infinity;tradeBusy=false;
    tradeStats={opened:0,embargoed:0,skipped:0};botEmbargoes.clear();tradeAssessments=[];
    pendingBoat=null;pendingWarship=null;navalCooldown.clear();navalBackoffUntil=-Infinity;portProbeFailures=0;lastPortRetryTick=-Infinity;navalSiteNegative.clear();
    marineStats={transportSent:0,transportConfirmed:0,transportArrived:0,bridgeheadHeld:0,
      bridgeheadHeld120:0,bridgeheadHeld600:0,bridgeheadLost:0,
      transportUnconfirmed:0,transportUnresolved:0,warshipSent:0,
      warshipConfirmed:0,warshipUnconfirmed:0};
    strategicTelemetry={favorableVictims:0,falloutSkipped:0,falloutFallback:0,afkTargets:0,assists:0,neutralLandings:0,forecastCount:0,engineForecasts:0,proxyForecasts:0,forecastComparisons:0,forecastUnavailable:0};
    nukeBusy=false;lastNuke=-Infinity;nukePending=null;nukeStatus='Warte auf Silo';nukeShots=0;nukeAttempts=0;nukeUnconfirmed=0;nuclearCache=null;nuclearCacheTick=-Infinity;
    learnMatch={sample:null,key:null,finished:false};
    opponentProfiles.clear();operation=null;operationCooldown.clear();duoPlan=null;victoryThreat=null;decisionTimeline=[];decisionKeys.clear();
    duoLocal.peer=null;duoLocal.match=null;duoLocal.status=opts.duoEnabled?'Neue Partie · verbinde':'AUS';
    duoLocal.lastPublished=0;duoLocal.lastAt=0;duoLocal.lastPromise=null;
    duoLocal.relayDrops=0;duoLocal.relayTimeouts=0;duoLocal.ackTimeouts=0;
    duoLocal.seenPeer=false;duoLocal.lastExpiredPlan=null;
    warState={id:null,name:'—',since:-Infinity,blockedUntil:-Infinity};diagnostics=[];recordSequence=resumed?Math.max(0,Math.floor(prior.seq||0)):0;recordCounts={};recordsDropped=0;recordsEvicted=0;streamErrors=0;lastDiagnosticTick=-Infinity;gameEnd=null;forecastAudits=[];lastForecastAudit=null;incomeAttribution=[];
    investmentStatus='Grundaufbau';lastWarReview=-Infinity;
    defenseStatus='Keine Bedrohung';lastEmergencyRetreat=-Infinity;lastDefenseLog=-Infinity;
    retreatRequests.clear();defenseStats={retreatsOrdered:0,retreatsObserved:0,unknown:0,unconfirmed:0};
    autoTuning={aggressive:85,reserve:35,actionsPerMinute:72,maxTargets:16,
      mode:'INIT',reason:'Warte auf Spielzustand',tick:-Infinity};
    // Start this new match as soon as EventBus becomes ready.
    opts.enabled=false;persist();
    status=gameType(g)==='Singleplayer'?'Singleplayer erkannt · '+(opts.autoStart?'Autostart wartet auf EventBus':'Bot bereit'):
      multiplayerMatch(g)?'Multiplayer erkannt · '+(opts.autoStart?'Autostart wartet auf EventBus':'Bot bereit'):
      'Replay/unbekannter Spieltyp · gesperrt';
    if(g?.config?.().isReplay?.())status='Replay · BOT GESPERRT';
    log(status);
    reportIntents();
  }
  // Never overwrite manually selected slider values. Auto settings are
  // recomputed from current troops, threats, strategy and worker latency.
  function setting(key){return opts.fullAuto?autoTuning[key]:opts[key];}
  // Hysteresis prevents oscillation and keeps worker/transport costs bounded.
  // Critical defense changes are immediate; ordinary strategy changes settle
  // for at least 45 ticks. These values never modify the user's manual sliders.
  function tuneAutonomously(me,items,s,tick,context) {
    if(!opts.fullAuto)return s;
    const late=lateGame(me),home=Math.max(1,s.home);
    // Rush the opening while neutral land remains and the home front is safe.
    // On the large World map the bot needs more time to establish territory
    // before Impossible AI reaches its frontier and forces it to defend.
    const opening=tick<(largeMap()?2400:1000) && items.some(g=>g.id===null&&!g.fallout) &&
      s.incoming<home*.025 && s.strongest<home*.85 && s.ratio>=.27 &&
      (!opts.impossibleExperiment || (!recentHostilePressure(tick) &&
        !(armyTrend(tick)?.tiles< -80) &&
        (!hardMode() || !frontPressureForecast(me,items,tick).pressured)));
    const invasion=s.incoming/home,neighbor=s.strongest/home;
    const emergency=invasion>=.18 || (invasion>=.10 && context.rebuilding);
    let mode='BALANCED',reason='Ausgeglichene Spielphase';
    let v={aggressive:82,reserve:35,actionsPerMinute:76,maxTargets:15};
    if(emergency || (context.wanted==='DEFEND'&&s.incoming>0)){
      mode='DEFEND';reason='Eingehender Angriff – Heimtruppen sichern';
      v={aggressive:60,reserve:63,actionsPerMinute:88,maxTargets:9};
    } else if(context.wanted==='RECOVER'||s.ratio<.23){
      mode='RECOVER';reason='Truppen regenerieren und Bauaktionen zulassen';
      v={aggressive:64,reserve:49,actionsPerMinute:65,maxTargets:10};
    } else if(context.wanted==='ASSAULT'&&!s.incoming){
      mode='ASSAULT';reason='Konzentrierte Offensive mit überprüfter Heimreserve';
      v={aggressive:late?98:92,reserve:late?23:29,actionsPerMinute:late?98:87,maxTargets:late?22:19};
    } else if(context.wanted==='TECH'||context.wanted==='ECONOMY'){
      mode=context.wanted;reason='Wirtschaft und strategische Technik finanzieren';
      v={aggressive:73,reserve:40,actionsPerMinute:72,maxTargets:13};
    } else if(context.wanted==='EXPAND'){
      mode='EXPAND';reason='Neutrales Land effizient erobern';
      v={aggressive:late?87:82,reserve:late?29:33,actionsPerMinute:late?88:78,maxTargets:late?18:15};
    } else if(late&&s.ratio>.74&&!s.incoming){
      mode='LATE';reason='Große Truppenreserve – Chancen häufiger prüfen';
      v={aggressive:93,reserve:27,actionsPerMinute:91,maxTargets:20};
    }
    if(opening && !emergency && !['DEFEND','RECOVER'].includes(mode)){
      mode='OPENING';reason='Frühe Landnahme: schneller expandieren, Reserve dynamisch schützen';
      v={aggressive:100,reserve:22,actionsPerMinute:105,maxTargets:23};
    }
    if(!emergency && s.incoming>0){
      v.reserve+=Math.min(13,Math.ceil(invasion*35));
      v.aggressive-=9;
    }
    if(!emergency && neighbor>1 && (mode==='ASSAULT'||mode==='EXPAND')){
      v.reserve+=Math.min(13,Math.ceil((neighbor-1)*14));
    }
    // More worker probes only help when workers respond promptly. Do not
    // compensate for a slow worker by flooding it with even more requests.
    if(runtime.combatMs>1100||runtime.borderMs>850){
      v.maxTargets-=5;v.actionsPerMinute-=12;
      reason+=' · Worker entlasten';
    } else if(runtime.combatMs>650){
      v.maxTargets-=3;v.actionsPerMinute-=6;
    }
    if(runtime.economyMs>1600)v.actionsPerMinute-=6;
    const unlearned={...v};
    v=learnAdjust(v,mode,s,emergency);
    const learnedChoice={...v};
    v=neuralAdjust(v,unlearned,me,s,items,emergency);
    const neuralChoice={...v};
    if(!emergency){const policy=neuralStrategicSignals(me,s,tick);
      if(policy){v.aggressive+=Math.round(policy.aggression*12);
        v.reserve+=Math.round(policy.reserve*10);}}

    v.aggressive=clamp(v.aggressive,40,100);
    v.reserve=clamp(v.reserve,18,65);
    v.actionsPerMinute=clamp(v.actionsPerMinute,45,110);
    v.maxTargets=clamp(v.maxTargets,6,24);
    const changed=mode!==autoTuning.mode || ['aggressive','reserve','actionsPerMinute','maxTargets']
      .some(k=>autoTuning[k]!==v[k]);
    if(!changed)return s;
    if(!emergency && tick-autoTuning.tick<45 &&
      !(mode==='ASSAULT'&&duoPlan?.strikeStatus==='locked-launch-window'&&
        s.incoming===0&&!recentHostilePressure(tick)))return s;
    autoTuning={...v,mode,reason,tick};
    if(opts.neuralEnabled)telemetry('neural_strategy_choice',
      'Regel-, Lern- und Modellvorschlag gegenüber finaler Einstellung',{
        decisionId:monitorSession+':t'+tick,model:neuralModelInfo(),
        mode,ruleChoice:unlearned,learnedChoice,modelChoice:neuralChoice,
        finalChoice:{...v},effect:'unknown',
        evidence:'policy-comparison-not-game-outcome'});
    if(mode!=='DEFEND'||tick-lastDefenseLog>=75){
      telemetry('auto_tuning','Autonome Parameter: '+mode,{...v,reason});
      if(mode==='DEFEND')lastDefenseLog=tick;
    }
    return military(me,items);
  }
  function actionBudget(channel='general') {
    const now=Date.now();actions=actions.filter(t=>now-t<60000);
    const cap=clamp(setting('actionsPerMinute'),15,120);
    // Combat may not consume the entire action window: leave room for
    // economic reinvestment, missiles and diplomacy.
    const reserve=channel==='combat'?Math.max(3,Math.ceil(cap*.16)):0;
    return actions.length<cap-reserve;
  }
  function send(kind,args,description,priority=false) {
    if(!opts.enabled || !connected())return false;
    if(!ctors[kind]){
      if(!missingIntentLogged.has(kind)){
        missingIntentLogged.add(kind);
        const message='Intent '+kind+' nicht erkannt – '+(CORE_INTENTS.includes(kind)?'Kernfunktion ausgefallen':'Funktion derzeit nicht verfügbar');
        console.warn(PREFIX,message);
        log('WARNUNG: '+message);
        telemetry('intent_send_blocked',message,{intent:kind,intents:intentHealth()});
      }
      return false;
    }
    if(!priority && !actionBudget(['attack','boat'].includes(kind)?'combat':'general'))return false;
    // The bot can make multiple decisions per cycle. Keep an independent
    // burst limiter so it never floods the game transport even at 60/min.
    if(!priority && Date.now()-lastEmission < 410)return false;
    // A final fail-closed check: do not emit if we switched to MP or replay.
    if(!permittedMatch(game))return false;
    try {
      const beforeIds=kind==='attack'?(myPlayer()?.outgoingAttacks?.()||[]).map(a=>a.id):[];
      const event=new ctors[kind](...args);
      bus.emit(event);actions.push(Date.now());lastEmission=Date.now();totalSent++;
      const actionId=monitorSession+':a'+(++actionSequence);
      lastActionId=actionId;
      const decisionId=monitorSession+':t'+number(()=>game.ticks(),0);
      if(kind==='attack'){
        const command={commandId:++attackCommandSequence,actionId,decisionId,
          tick:number(()=>game.ticks()),
          target:attackTargetID(args[0]),amount:Number(args[1]),beforeIds,matchedStack:null};
        attackCommands.push(command);
        if(attackCommands.length>80)attackCommands.shift();
        telemetry('attack_command',description,{...command});
      }
      log(description);telemetry('action',description,
        {intent:kind,actionId,decisionId,emission:'event-bus',
          requestedTroops:['attack','boat','donateTroops'].includes(kind)?
            Number(args[1]):null,quotedCost:null,
          effect:'unknown'});return true;
    } catch(e) {totalFailed++;log('Event fehlgeschlagen: '+String(e.message));return false;}
  }
  function valid(x,y) {return x>=0&&y>=0&&x<game.width()&&y<game.height();}
  // Duo Relay only exchanges observations. The real GameView remains
  // authoritative for an established alliance/team relation.
  function actualFriendly(p,me){
    // Keep the non-Duo path byte-for-byte equivalent in meaning to the
    // pre-1.20 friendship test; Duo-specific protection is layered below.
    try{return p?.id?.()===me.id()||p.isFriendly?.(me)||me.isFriendly?.(p);}
    catch(_){return false;}
  }
  const duoID=v=>typeof v==='string'&&v.length>=1&&v.length<=128&&
    /^[a-zA-Z0-9_.:@-]+$/.test(v);
  // The old manually saved PlayerID is intentionally ignored: IDs change
  // each match. The relay discovers the current one for this room.
  function duoConfigured(){
    const own=safeID(myPlayer());
    return opts.duoEnabled&&
      /^[a-zA-Z0-9_-]{6,64}$/.test(opts.duoRoom||'')&&duoID(own);
  }
  function duoPartnerID(){
    return duoTrustedPeer()?.id??null;
  }
  function duoMatchKey(){
    const cfg=game?.config?.().gameConfig?.()||{},loc=window.location||{};
    const seed=cfg.seed??cfg.gameID??cfg.gameId??'unknown';
    return ['v2',cfg.gameType??'unknown',cfg.gameMap??'unknown',
      cfg.gameMapSize??'unknown',cfg.gameMode??'unknown',seed,
      loc.pathname||'/'].join('|')
      .replace(/[^a-zA-Z0-9_.:@|,-]/g,'_').slice(0,260);
  }
  // Presentation only: never use these labels as plan authorization.
  function duoStatusView(enabled,trusted,plan,tick,local){
    if(!enabled)return {phase:'off',reason:'Duo deaktiviert'};
    if(!trusted)return {phase:local?.seenPeer||local?.relayDrops>0?
      'autonomous-fallback':'waiting-ack',reason:'kein frisch bestätigter Relay-Partner'};
    if(plan?.planId&&Number.isInteger(plan.expiresTick)&&tick>plan.expiresTick)
      return {phase:'expired',reason:'Planfrist überschritten'};
    if(plan?.planId&&plan.partnerAck&&plan.ready)
      return {phase:'ready',reason:'frischer Partner-ACK und sicherer Plan'};
    return {phase:'waiting-ack',reason:plan?.planId?
      'Partner-ACK oder sichere Front fehlt':'noch kein gemeinsamer Angriffsplan'};
  }
  function duoTrustedPeer(){
    const me=myPlayer(),peer=duoLocal.peer;
    if(!duoConfigured()||!peer||!duoID(peer.id)||
      peer.id===safeID(me)||Date.now()-duoLocal.lastAt>3500||
      duoLocal.match!==duoMatchKey()||
      duoLocal.ownID!==safeID(me))return null;
    // A relay match fingerprint is only a grouping hint; the actual
    // GameView must also contain both player IDs in THIS match.
    const player=(game?.playerViews?.()||[]).find(p=>
      safeID(p)===peer.id&&p.isPlayer?.());
    return player&&player.isAlive?.()!==false?{player,...peer}:null;
  }
  // Foreign alliances are not automatically OUR in-game alliances. A
  // recent, same-match peer report only adds a conservative attack veto.
  // The game alone decides whether either bot can send alliance commands.
  function duoPeerAlly(p){
    const peer=duoTrustedPeer(),id=safeID(p);
    return !!(peer&&duoID(id)&&id!==peer.id&&
      Array.isArray(peer.state?.allies)&&peer.state.allies.includes(id));
  }
  function duoOwnAllies(me){
    return (game?.playerViews?.()||[]).filter(p=>
      p?.isPlayer?.()&&p.isAlive?.()!==false&&
      safeID(p)!==safeID(me)&&duoID(safeID(p))&&
      (actualFriendly(p,me)||me.isOnSameTeam?.(p)))
      .map(safeID).sort().slice(0,16);
  }
  function friendly(p,me){
    // Protect a verified partner and its current confirmed third-party
    // allies. Do not inherit diplomatic status or retain old match IDs.
    return actualFriendly(p,me)||
      (safeID(me)===safeID(myPlayer())&&
       (safeID(p)===duoTrustedPeer()?.id||duoPeerAlly(p)));
  }
  // 0 = clear, 1 = early warning, 2 = observed invasion/loss.
  // Use engine troop units throughout; only UI display divides by ten.
  function duoWarningLevel(s,tick=number(()=>game?.ticks?.(),0)){
    if(!s||!s.home)return 0;
    if(s.incoming>=Math.max(1200,s.home*.10)||
      (crisisTrend&&tick<crisisTrend.expires&&
        (crisisTrend.lostLand>0||crisisTrend.lostAssets>0)))return 2;
    if(s.incoming>=Math.max(500,s.home*.025)||
      s.strongest>=s.home*.90||recentHostilePressure(tick))return 1;
    return 0;
  }
  // Native incoming attacks may expose an absolute arrival tick. Unknown ETA
  // stays null: troop totals or wall-clock observations do not imply speed.
  function diagnosticArrival(attacks){
    const absolute=(attacks||[]).filter(a=>!a.retreating).map(a=>{
      for(const field of ['arrivalTick','targetTick','etaTick']){
        if(Number.isSafeInteger(a?.[field]))return a[field];
      }
      return null;
    }).filter(v=>v!==null);
    return {estimatedArrivalTick:absolute.length?Math.min(...absolute):null,
      arrivalEvidence:absolute.length?'explicit-gameview-field':'unknown'};
  }
  function diagnosticCloseHelp(reason,tick){
    if(!diagnosticHelpId)return;
    const event=['deadline','player-elimination','match-end'].includes(reason)?
      'duo_help_expired':'duo_help_resolved';
    telemetry(event,'Duo-Hilferuf geschlossen',{
      requestId:diagnosticHelpId,partnerId:duoLocal.peer?.id??null,
      requestTick:diagnosticHelpSince,deadlineTick:diagnosticHelpDeadline,
      ageTicks:tick-diagnosticHelpSince,reason,
      supportObserved:'unknown',status:event==='duo_help_expired'?
        'expired-unverified':'no-longer-requested-no-causal-proof'});
    diagnosticHelpId=null;diagnosticHelpSince=null;
    diagnosticHelpDeadline=null;diagnosticHelpExpired=false;
    diagnosticLastHelpAck=null;
  }
  function diagnosticHelpObservation(me,tick){
    if(!diagnosticAid)return;
    const aid=diagnosticAid;
    if(aid.observedTick!==undefined){
      if(tick-aid.observedTick>=180)diagnosticAid=null;
      return;
    }
    const target=(game?.playerViews?.()||[]).find(p=>
      safeID(p)===aid.partnerId);
    if(!target||!target.isAlive?.()){
      telemetry('duo_help_action_unconfirmed','Hilfe nicht durch Spielbeleg auflösbar',{
        requestId:aid.requestId,actionId:aid.actionId,
        reason:'partner-not-alive-or-not-observable',
        status:'unconfirmed-not-proven-failed',supportObserved:'unknown'});
      diagnosticAid=null;return;
    }
    if(tick-aid.tick>=80){
      telemetry('duo_help_action_unconfirmed','Hilfe nach Beobachtungsfenster ungeklärt',{
        requestId:aid.requestId,actionId:aid.actionId,
        sentTick:aid.tick,partnerId:aid.partnerId,
        partnerHomeAtEmission:aid.partnerHomeAtEmission,
        partnerHomeNow:number(()=>target.troops?.(),null),
        status:'unconfirmed-not-proven-failed',supportObserved:'unknown',
        evidence:'no-direct-donation-receipt-in-gameview'});
      diagnosticAid=null;
    }
  }
  // GameView exposes engine DonateEvent updates (senderId, recipientId,
  // donationType, amount). Only this explicit receipt may prove that support
  // was delivered. Aggregate troop/gold deltas never establish causality.
  function diagnosticDonationUpdates(){
    const tick=number(()=>game?.ticks?.(),-1);
    if(tick<0)return;
    donationCapture.polls++;
    let updates;try{updates=game?.updatesSinceLastTick?.();}
    catch(_){donationCapture.lastProblem='gameview-read-error';return;}
    if(!updates){
      donationCapture.lastProblem='no-gameview-updates-this-poll';return;
    }
    donationCapture.readable++;
    const events=Object.values(updates).flat().filter(u=>
      u&&['troops','gold'].includes(u.donationType)&&
      ['string','number'].includes(typeof u.senderId)&&
      ['string','number'].includes(typeof u.recipientId)&&
      (typeof u.amount==='bigint'||typeof u.amount==='number'));
    donationCapture.candidates+=events.length;
    if((diagnosticAid||diagnosticHelpId)&&
      tick-donationCapture.lastProbeTick>=160){
      donationCapture.lastProbeTick=tick;
      telemetry('duo_donation_capture_probe','Spendenbelege im Browser geprüft',{
        polls:donationCapture.polls,readable:donationCapture.readable,
        candidateEvents:donationCapture.candidates,
        matchedEvents:donationCapture.matched,
        lastReceiptTick:donationCapture.lastReceiptTick,
        updateChannels:Object.entries(updates)
          .filter(([,rows])=>Array.isArray(rows))
          .map(([channel,rows])=>({channel,count:rows.length})).slice(0,32),
        warning:'no-receipt-is-not-proof-of-no-donation'});
    }
    for(let i=0;i<events.length;i++){
      const ev=events[i];
      const senderId=String(ev.senderId),recipientId=String(ev.recipientId);
      const key=tick+':'+i+':'+senderId+':'+recipientId+
        ':'+String(ev.amount)+':'+ev.donationType;
      if(diagnosticDonationSeen.has(key))continue;
      diagnosticDonationSeen.set(key,tick);
      const me=safeID(myPlayer());
      if(me!==senderId&&me!==recipientId)continue;
      donationCapture.matched++;donationCapture.lastReceiptTick=tick;
      donationCapture.lastProblem=null;
      const amount=String(ev.amount);
      const aid=diagnosticAid;
      const sent=ev.donationType==='troops'&&aid&&
        senderId===me&&recipientId===aid.partnerId&&
        tick>=aid.tick&&tick-aid.tick<=110&&!aid.observedTick;
      const received=ev.donationType==='troops'&&diagnosticHelpId&&
        recipientId===me&&senderId===duoTrustedPeer()?.id;
      const requestId=sent?aid.requestId:
        received?diagnosticHelpId:null;
      const actionId=sent?aid.actionId:
        received&&duoLocal.peer?.state?.aidForRequestId===diagnosticHelpId?
          duoLocal.peer.state.aidActionId??null:null;
      telemetry('donation_observed','Engine-Spendenereignis beobachtet',{
        actionId,requestId,senderId,
        recipientId,donationType:ev.donationType,
        actualAmount:amount,evidence:'gameview-donate-event'});
      if(requestId){
        telemetry('duo_help_support_observed',
          'Duo-Truppenspende durch Engine bestätigt',{
            actionId,requestId,senderId,
            recipientId,actualTroops:amount,
            status:'support-observed',evidence:'gameview-donate-event'});
        if(sent){
          aid.observedTick=tick;aid.observedTroops=amount;
          const ledger=actionLedger.find(x=>x.actionId===aid.actionId);
          if(ledger){ledger.actualTroopOutflow=amount;
            ledger.observed='engine-donate-event';ledger.effect='delivered-to-recipient';}
        }
      }
    }
    for(const [key,seenTick] of diagnosticDonationSeen)
      if(tick-seenTick>20)diagnosticDonationSeen.delete(key);
    if(diagnosticDonationSeen.size>300)diagnosticDonationSeen.clear();
  }
  function duoState(){
    const me=myPlayer(),trusted=duoTrustedPeer(),peer=trusted?.player;
    const state=me?.hasSpawned?.()?military(me,strategic.groups):null;
    const target=duoPlan?.strikeTick?duoPlan.target:
      operation?.target??duoPlan?.target??warState.id;
    const candidate=spawnCache?.tile??null,spawn=me?.state?.spawnTile;
    const tick=number(()=>game?.ticks?.(),0);
    const ownUnits=me?.units?.()||[],cfg=game?.config?.();
    const cities=ownUnits.filter(u=>u.isActive?.()&&u.type?.()==='City').length;
    const factories=ownUnits.filter(u=>u.isActive?.()&&u.type?.()==='Factory').length;
    const coreReady=(cfg?.isUnitDisabled?.('City')===true||cities>=2)&&
      (cfg?.isUnitDisabled?.('Factory')===true||factories>=2);
    const siloAllowed=opts.nukes&&cfg?.isUnitDisabled?.('Missile Silo')!==true&&
      ['Atom Bomb','Hydrogen Bomb','MIRV'].some(t=>cfg?.isUnitDisabled?.(t)!==true);
    const siloReady=!!(me?.hasSpawned?.()&&coreReady&&siloAllowed&&
      lateGame(me)&&number(()=>me?.numTilesOwned?.(),0)>900&&
      tick>=duoSiloBlockedUntil);
    const help=!!(state&&state.incoming>Math.max(1200,state.home*.1));
    const trend=armyTrend(tick);
    const earlyCrisis=!!(state&&(
      state.incoming>=Math.max(500,state.home*.025)||
      state.strongest>=state.home*.9||
      (trend?.ticks>=60&&trend.tiles<-
        Math.max(100,number(()=>me.numTilesOwned(),0)*.03))||
      (crisisTrend&&tick<crisisTrend.expires&&
        (crisisTrend.lostLand>0||crisisTrend.lostAssets>0))));
    if(diagnosticHelpId&&tick>=diagnosticHelpDeadline)
      diagnosticCloseHelp('deadline',tick);
    if(help&&!diagnosticHelpId){
      diagnosticHelpId=monitorSession+':h'+(++diagnosticHelpSequence);
      diagnosticHelpSince=tick;diagnosticHelpDeadline=tick+180;
      diagnosticLastHelpAck=null;
      const arrival=diagnosticArrival(me?.incomingAttacks?.()||[]);
      const requestedSupportTroops=Math.max(0,Math.ceil(state.incoming*1.3-state.home));
      telemetry('duo_help_request','Eigene Heimat unter Angriff; Duo-Hilfe angefragt',{
        schemaVersion:2,matchId:String(game?.gameID?.()??'unknown'),
        playerId:safeID(me),decisionId:monitorSession+':t'+tick,
        requestId:diagnosticHelpId,partnerId:trusted?.id??null,
        incomingTroops:state.incoming,homeTroops:state.home,
        availableTroops:state.available,reserveTroops:state.reserve,
        ...arrival,requestedSupportTroops,
        requestDeadlineTick:diagnosticHelpDeadline,
        estimatedShortfall:Math.max(0,Math.ceil(state.incoming-state.home)),
        status:'sent-not-acknowledged',evidence:'visible-incoming-attack'});
    }else if(!help&&diagnosticHelpId){
      diagnosticCloseHelp('below-threat-threshold',tick);
    }
    return {tick:Number.isInteger(game?.ticks?.())?game.ticks():null,
      spawn:Number.isSafeInteger(spawn)?spawn:null,
      candidate:Number.isSafeInteger(candidate)?candidate:null,
      target:duoID(target)?target:null,
      warTarget:duoID(warState.id)?warState.id:null,
      strikeTick:Number.isInteger(duoPlan?.strikeTick)?duoPlan.strikeTick:null,
      planId:duoPlan?.planId??null,expiresTick:duoPlan?.expiresTick??null,
      ackPlanId:duoPlan?.planId&&duoPlan.ready&&peer&&
        state&&state.incoming===0&&
        state.available>=(duoPlan.joint?.own??Infinity)&&
        !recentHostilePressure(number(()=>game?.ticks?.(),0))&&
        actualFriendly(peer,me)&&duoPlan.partner===safeID(peer)&&
        Number.isInteger(duoPlan.expiresTick)&&
        number(()=>game.ticks(),Infinity)<=duoPlan.expiresTick?
          duoPlan.planId:null,
      ownBudget:duoPlan?.joint?.own??null,
      partnerBudget:duoPlan?.joint?.ally??null,
      abortOn:['relay-stale','alliance-lost','front-lost','own-invasion','partner-crisis'],
      ready:!!(state&&state.incoming===0&&
        !recentHostilePressure(number(()=>game?.ticks?.(),0))&&
        !(crisisTrend&&number(()=>game?.ticks?.(),0)<crisisTrend.expires)&&
        state.ratio>=.38&&!state.activeEnemy&&
        state.available>=Math.max(1200,state.home*.09)),
      needHelp:!!(state&&state.incoming>Math.max(1200,state.home*.1)),
      earlyCrisis,land:number(()=>me?.numTilesOwned?.(),0),
      // Sender-owned, config-aware readiness. Never reconstruct from peer counts.
      nuclearProtocol:1,coreReady,siloReady,cities,factories,
      silos:(me?.units?.()||[]).filter(u=>u.isActive?.()&&u.type?.()==='Missile Silo').length,
      sams:(me?.units?.()||[]).filter(u=>u.isActive?.()&&u.type?.()==='SAM Launcher').length,
      gold:number(()=>me?.gold?.(),0),
      helpRequestId:diagnosticHelpId,helpSinceTick:diagnosticHelpSince,
      helpDeadlineTick:diagnosticHelpDeadline,
      helpShortfall:diagnosticHelpId&&state?
        Math.max(0,Math.ceil(state.incoming-state.home)):null,
      requestedSupportTroops:diagnosticHelpId&&state?
        Math.max(0,Math.ceil(state.incoming*1.3-state.home)):null,
      aidForRequestId:diagnosticAid?.requestId??null,
      aidActionId:diagnosticAid?.actionId??null,
      aidTroops:diagnosticAid?.amount??null,
      aidStatus:diagnosticAid?
        (diagnosticAid.observedTick!==undefined?'observed-engine-donate-event':
          'intent-sent-effect-unknown'):null,
      ackHelpRequestId:trusted?.state?.needHelp===true?
        trusted.state.helpRequestId??null:null,
      warning:duoWarningLevel(state),
      allied:!!(peer&&actualFriendly(peer,me)),
      allies:duoOwnAllies(me),
      fronts:(strategic.groups||[]).filter(x=>x.id!==null&&
        x.tiles?.length&&x.opponent?.isAlive?.()&&!friendly(x.opponent,me))
        .map(x=>x.id).filter(duoID).sort().slice(0,16),
      home:state?.home??null,incoming:state?.incoming??null,
      available:state?.available??null,reserve:state?.reserve??null,
      role:state&&state.incoming>Math.max(1200,state.home*.1)?'defend':
        operation?'attack':game?.inSpawnPhase?.()?'spawn':
        duoPlan?.role?.includes('entlasten')?'support':'build'};
  }
  async function duoPublish(){
    if(duoLocal.lastPromise||!opts.enabled||!duoConfigured()||
      !permittedMatch(game)||game?.gameOver?.())return;
    const ownID=safeID(myPlayer()),match=duoMatchKey(),room=opts.duoRoom;
    const partnerID=null;
    if(duoLocal.match!==match||duoLocal.partnerID!==partnerID||
      duoLocal.ownID!==ownID){
      duoLocal.peer=null;duoLocal.lastAt=0;duoLocal.match=match;
      duoLocal.partnerID=partnerID;duoLocal.ownID=ownID;
    }
    const payload={room,ownID,partnerID,match,auto:true,
      instance:duoLocal.instance,state:duoState()};
    duoLocal.lastPromise=(async()=>{
      const controller=new AbortController();
      // First browser request may wait for a local-network permission
      // prompt. 1.55s aborted it before the user could allow it.
      const timeout=setTimeout(()=>controller.abort(),8000);
      try{
        const response=await fetch('http://127.0.0.1:8767/duo',{
          method:'POST',mode:'cors',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload),signal:controller.signal
        });
        if(!response.ok){
          const error=await response.json().catch(()=>null);
          throw Error('HTTP '+response.status+
            (error?.error?' · '+error.error:''));
        }
        const data=await response.json();
        if(!opts.duoEnabled||!game||match!==duoMatchKey()||
          room!==opts.duoRoom||ownID!==safeID(myPlayer()))return;
        if(duoLocal.peer&&!data.partner)duoLocal.relayDrops++;
        if(data.partner)duoLocal.seenPeer=true;
        duoLocal.peer=data.partner||null;
        duoLocal.lastAt=data.partner?Date.now():0;
        const helpRequest=data.partner?.state?.needHelp?
          data.partner.state.helpRequestId??null:null;
        if(helpRequest&&helpRequest!==diagnosticLastReceivedHelp){
          diagnosticLastReceivedHelp=helpRequest;
          telemetry('duo_help_received','Partner-Hilferuf empfangen',{
            requestId:helpRequest,partnerId:data.partner.id,
            estimatedShortfall:data.partner.state.helpShortfall??null,
            partnerIncoming:data.partner.state.incoming??null,
            status:'received-not-committed'});
        }else if(!helpRequest)diagnosticLastReceivedHelp=null;
        const commitment=data.partner?.state?.aidForRequestId===diagnosticHelpId&&
          diagnosticHelpId?data.partner.state:null;
        if(commitment&&diagnosticLastCommitmentSeen!==commitment.aidActionId){
          diagnosticLastCommitmentSeen=commitment.aidActionId;
          telemetry('duo_help_commitment_seen','Partner meldet Hilfs-Intent',{
            requestId:diagnosticHelpId,partnerId:data.partner.id,
            partnerActionId:commitment.aidActionId,
            promisedTroops:commitment.aidTroops??null,
            status:'intent-reported-not-observed',
            supportObserved:'unknown'});
        }
        if(diagnosticHelpId&&data.partner?.state?.ackHelpRequestId===
          diagnosticHelpId&&diagnosticLastHelpAck!==diagnosticHelpId){
          diagnosticLastHelpAck=diagnosticHelpId;
          telemetry('duo_help_ack_seen','Partner bestätigt Empfang des Hilferufs',{
            requestId:diagnosticHelpId,partnerId:data.partner.id,
            status:'received-ack-only-not-support-commitment'});
        }
        const duoTick=number(()=>game?.ticks?.(),0);
        if(duoTick-diagnosticLastPeerTick>=120){
          diagnosticLastPeerTick=duoTick;
          telemetry('duo_exchange','Duo-Relay-Zustand gesendet und Antwort empfangen',{
            ownId:ownID,peerId:data.partner?.id??null,
            localState:payload.state,peerState:data.partner?.state??null,
            relayReason:data.reason??null,
            sharedMatch:match,duoRoom:room});
        }
        duoLocal.status=data.partner?'Erkannt · '+data.partner.id:
          data.reason==='different-match'?
          'Raumcode gleich, aber Match-Kennung unterscheidet sich':
          'Warte auf zweite Browser-Instanz';
        diagnosticDuoTransition(duoLocal.status,data.partner,
          data.reason??null);
        if(data.partner)duoLocal.failures=0;
      }catch(e){
        duoLocal.failures++;duoLocal.relayDrops++;
        if(e?.name==='AbortError')duoLocal.relayTimeouts++;
        duoLocal.peer=null;duoLocal.lastAt=0;
        const reason=e?.name==='AbortError'?
          'Browser-Timeout (8s) – lokalen Netzwerkzugriff fuer openfront.io pruefen':
          'Relay-Fehler: '+String(e?.message||e).slice(0,65);
        duoLocal.status=reason;
        diagnosticDuoTransition(duoLocal.status,null,reason);
        if(duoLocal.failures===1||duoLocal.failures%10===0)
          console.warn(PREFIX,'Duo-Verbindung:',reason,
            'Match:',match,'Raum:',room);
      }finally{clearTimeout(timeout);}
    })();
    try{await duoLocal.lastPromise;}finally{duoLocal.lastPromise=null;}
  }
  // The second browser chooses a separately legal spawn around the partner.
  // It never copies/forces the partner tile and still obeys spawnScore vetoes.
  function duoSpawnCandidate(g,me,candidates,urgent=false){
    const peer=duoTrustedPeer(),anchor=peer?.state?.spawn??peer?.state?.candidate;
    if(!Number.isSafeInteger(anchor)||
      (typeof g.isValidRef==='function'&&!g.isValidRef(anchor)))return null;
    const min=number(()=>g.config().minDistanceBetweenPlayers?.(),30);
    const px=g.x(anchor),py=g.y(anchor),rivals=spawnRivals(g,me);
    const tiles=new Set(candidates.filter(Boolean).map(x=>x.tile));
    for(const rad of [min+24,min+50,min+85]){
      for(let j=0;j<16;j++){
        const theta=j*Math.PI/8,x=Math.round(px+rad*Math.cos(theta)),
          y=Math.round(py+rad*Math.sin(theta));
        if(x>=4&&y>=4&&x<g.width()-4&&y<g.height()-4)
          tiles.add(g.ref(x,y));
      }
    }
    let best=null;
    for(const tile of tiles){
      const score=spawnScore(g,tile,rivals,urgent);
      if(!score)continue;
      const distance=Math.hypot(score.x-px,score.y-py);
      if(distance<min+8||distance>min+115)continue;
      const quality=score.score+
        Math.max(0,.21-Math.abs(distance-(min+52))*.0019);
      if(!best||quality>best.quality)best={...score,quality};
    }
    return best;
  }
  function spawnBlock(reason){
    if(spawnState.blocked===reason)return;
    spawnState.blocked=reason;
    spawnState.phase='Blockiert: '+reason;
    telemetry('spawn_blocked',reason,{spawn:{...spawnState},
      eventBus:!!bus,hasIntent:!!ctors.spawn,enabled:!!opts.enabled,
      autoSpawn:!!opts.autoSpawn});
  }
  function spawnRemaining(g) {
    const fallback=multiplayerMatch(g)?200:100;
    const turns=number(()=>g.config().numSpawnPhaseTurns?.(),fallback);
    return Math.max(0,turns-number(()=>g.ticks(),0));
  }
  function spawnTileValid(g,tile) {
    try{return Number.isInteger(tile)&&
      (typeof g.isValidRef!=='function'||g.isValidRef(tile))&&
      g.isLand(tile)&&!g.isImpassable(tile)&&
      !g.hasOwner(tile)&&!g.isBorder?.(tile);}
    catch(_){return false;}
  }
  function spawnRivals(g,me) {
    const ownTeam=me?.team?.(),mine=safeID(me);
    return (g.playerViews?.()||[]).filter(p=>mine===null||safeID(p)!==mine)
      .map(p=>{
        const tile=p.state?.spawnTile;
        if(!Number.isInteger(tile)||(typeof g.isValidRef==='function'&&!g.isValidRef(tile)))return null;
        return {x:g.x(tile),y:g.y(tile),
          teammate:(ownTeam!==null&&ownTeam!==undefined&&p.team?.()===ownTeam)||
            safeID(p)===duoTrustedPeer()?.id};
      }).filter(Boolean);
  }
  // Use the actual 4-tile spawn footprint and three additional land rings.
  // Nearby free plains provide opening growth, while the outer rings penalize
  // islands/peninsulas and distant teammates do not count as enemy threats.
  function spawnScore(g,tile,rivals=spawnRivals(g,myPlayer()),urgent=false) {
    if(!spawnTileValid(g,tile))return null;
    const x=g.x(tile),y=g.y(tile),w=g.width(),h=g.height();
    const good=(xx,yy)=>{
      if(xx<0||yy<0||xx>=w||yy>=h)return null;
      const t=g.ref(xx,yy);
      if(!g.isLand(t)||g.isImpassable(t)||g.hasOwner(t))return null;
      const magnitude=number(()=>g.magnitude?.(t),
        number(()=>g.terrainByte?.(t)&31,10));
      return {plain:magnitude<10,high:magnitude<20};
    };
    let core=0,coreTotal=0,plain=0;
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      if(dx*dx+dy*dy>16)continue;
      coreTotal++;
      const v=good(x+dx,y+dy);
      if(v){core++;plain+=v.plain?1:0;}
    }
    if(core<coreTotal*(urgent?.58:.83))return null;
    const minSide=Math.min(w,h),scale=Math.min(70,Math.max(15,minSide/7));
    const rings=[Math.max(8,scale*.27),Math.max(13,scale*.57),scale];
    let accessible=0,weight=0,plains=0,coastal=0;
    const angles=16;
    for(let i=0;i<rings.length;i++){
      const rr=rings[i],importance=i===0?1:i===1?1.25:1.5;
      for(let j=0;j<angles;j++){
        const t=2*Math.PI*j/angles;
        const xx=Math.round(x+rr*Math.cos(t)),yy=Math.round(y+rr*Math.sin(t));
        const v=good(xx,yy);
        weight+=importance;
        if(v){accessible+=importance;plains+=v.plain?importance:v.high?importance*.38:0;}
        try{
          if(xx>=0&&yy>=0&&xx<w&&yy<h&&
            (g.isOceanShore?.(g.ref(xx,yy))||
             (!g.isOceanShore&&g.isShore?.(g.ref(xx,yy)))))
            coastal+=importance;
        }catch(_){}
      }
    }
    const density=accessible/Math.max(1,weight);
    if(density<(urgent?.24:.48))return null;
    const enemy=rivals.filter(p=>!p.teammate)
      .map(p=>Math.abs(p.x-x)+Math.abs(p.y-y));
    const ally=rivals.filter(p=>p.teammate)
      .map(p=>Math.abs(p.x-x)+Math.abs(p.y-y));
    const nearestEnemy=enemy.length?Math.min(...enemy):Infinity;
    const nearestAlly=ally.length?Math.min(...ally):Infinity;
    const minimum=number(()=>g.config().minDistanceBetweenPlayers?.(),30);
    if(nearestEnemy<(urgent?minimum:minimum+4))return null;
    // Too many people in one shared territory prevents both players growing.
    if(nearestAlly<(urgent?16:Math.max(22,minimum*.8)))return null;
    const enemyScore=enemy.length===0?0.75:
      Math.min(1,Math.max(0,(nearestEnemy-minimum)/(minimum*2.5)));
    const teamScore=!ally.length?0:
      Math.min(1,Math.max(0,(nearestAlly-minimum)/(minimum*2.5)))*
        Math.min(1,190/Math.max(60,nearestAlly));
    // In ranked duo, independently running bots use the already visible
    // teammate spawn to converge on a shared lane without overlapping cores.
    // Keep legal spawn footprint and minimum-distance veto authoritative.
    const gc=g?.config?.().gameConfig?.()||{};
    const rankedPair=gc.rankedType==='2v2'&&gc.gameMode==='Team';
    const allyBand=rankedPair&&ally.length?
      nearestAlly<=minimum+115?
        Math.max(-.09,.12-Math.abs(nearestAlly-(minimum+45))*.0015):
        -.15:0;
    const openScore=core/coreTotal;
    const edge=Math.min(x,y,w-1-x,h-1-y);
    const edgeScore=Math.min(1,edge/Math.max(22,scale));
    // Coast is helpful for ports, not a reason to prefer a tiny island.
    const coastScore=Math.min(1,coastal/Math.max(1,weight)*3);
    // Several nearby enemy spawns are riskier than one equally close rival;
    // avoid an opening surrounded by Impossible nations even on rich land.
    const crowding=enemy.filter(d=>d<minimum*1.8).length;
    const crowdPenalty=opts.impossibleExperiment?
      Math.min(.06,Math.max(0,crowding-1)*.03):0;
    const score=openScore*.19+density*.32+
      (plain/Math.max(1,core)*.45+plains/Math.max(1,weight)*.55)*.18+
      enemyScore*.16+edgeScore*.05+coastScore*.04+
      (ally.length?teamScore*.06:0)+allyBand-crowdPenalty;
    return {tile,x,y,score,density,core:openScore,
      coast:coastScore,enemy:Number.isFinite(nearestEnemy)?nearestEnemy:null,
      teammate:Number.isFinite(nearestAlly)?nearestAlly:null};
  }
  function startSpawnSearch() {
    if(spawnJob||!game||!opts.enabled||Date.now()<spawnRetryAt||
      !game.inSpawnPhase?.()||game.config().isRandomSpawn?.())return;
    const g=game,serial=generation,me=myPlayer();
    if(me?.hasSpawned?.()||Number.isInteger(me?.state?.spawnTile))return;
    const w=g.width(),h=g.height(),margin=6;
    if(w<=margin*2||h<=margin*2)return;
    const stride=Math.max(11,Math.floor(Math.min(w,h)/19));
    const rivals=spawnRivals(g,me),candidates=new Map();
    const offsets=[0,.5].map(f=>Math.floor(stride*f));
    const jobs=[];
    for(const offset of offsets){
      for(let y=margin+offset;y<h-margin;y+=stride)
        for(let x=margin+offset;x<w-margin;x+=stride)
          jobs.push([x,y]);
    }
    let index=0;
    spawnAlternatives=[];
    spawnJob={serial,started:number(()=>g.ticks(),0),total:jobs.length,candidates};
    spawnState.phase='Suche';spawnState.scanned=0;
    function chunk(){
      if(serial!==generation||g!==game||!opts.enabled||!permittedMatch(g)||
        !g.inSpawnPhase?.()||myPlayer()?.hasSpawned?.()||
        Number.isInteger(myPlayer()?.state?.spawnTile)){
        spawnJob=null;return;
      }
      const start=performance.now();
      try{
        while(index<jobs.length && performance.now()-start<8){
          const [x,y]=jobs[index++],tile=g.ref(x,y);
          const candidate=spawnScore(g,tile,rivals);
          if(!candidate)continue;
          candidates.set(tile,candidate);
          if(candidates.size>18){
            const worst=[...candidates.values()].sort((a,b)=>a.score-b.score)[0];
            candidates.delete(worst.tile);
          }
          if(!spawnCache || candidate.score>spawnCache.score)
            spawnCache=candidate;
        }
        spawnState.scanned=index;
      }catch(e){
        spawnJob=null;spawnState.phase='Fehler';
        status='Spawn-Analyse: '+String(e?.message||e).slice(0,90);
        spawnBlock('Spawn-Suche: '+String(e?.message||e).slice(0,80));
        spawnRetryAt=Date.now()+600;return;
      }
      if(index<jobs.length){
        // Near deadline, send the best VALID candidate found so far while
        // the grid continues. Do not wait out the last spawn-phase tick.
        // Prefer a good spot early over scanning until the live spawn expires.
        const tick=number(()=>g.ticks(),0),remaining=spawnRemaining(g);
        if(spawnCache && (remaining<=110 ||
          (index>=120 && spawnCache.score>=.62)))
          doSpawn(tick);
        setTimeout(chunk,0);return;
      }
      spawnJob=null;if(!spawnState.lastSent)spawnState.phase='Fertig';
      spawnAlternatives=[...candidates.values()].sort((a,b)=>b.score-a.score).slice(0,18);
      if(candidates.size){
        // Refine only the top candidates in a bounded local neighborhood.
        for(const top of [...candidates.values()].sort((a,b)=>b.score-a.score).slice(0,6)){
          for(const [dx,dy] of [[0,0],[stride/3,0],[-stride/3,0],
            [0,stride/3],[0,-stride/3],[stride/3,stride/3],
            [-stride/3,-stride/3]]){
            const x=Math.round(top.x+dx),y=Math.round(top.y+dy);
            if(x<margin||y<margin||x>=w-margin||y>=h-margin)continue;
            const v=spawnScore(g,g.ref(x,y),rivals);
            if(v&&(!spawnCache||v.score>spawnCache.score))spawnCache=v;
          }
        }
      }
      if(!spawnCache){
        status='Spawn: kein sicherer Standort; Suche wiederholen';
        spawnRetryAt=Date.now()+800;return;
      }
      doSpawn(number(()=>g.ticks(),0));
    }
    setTimeout(chunk,0);
  }
  function emergencySpawnSearch(g,me){
    if(!g?.inSpawnPhase?.() || g.config().isRandomSpawn?.())return null;
    const w=g.width(),h=g.height(),step=Math.max(9,Math.floor(Math.min(w,h)/14)),
      rivals=spawnRivals(g,me);
    let best=null;
    for(let y=5;y<h-5;y+=step)for(let x=5;x<w-5;x+=step){
      const current=spawnScore(g,g.ref(x,y),rivals,true);
      if(current&&(!best||current.score>best.score))best=current;
    }
    if(best){
      spawnState.phase='Deadline-Fallback';spawnCache=best;
    }
    return best;
  }
  function doSpawn(tick) {
    if(!opts.autoSpawn){spawnBlock('Auto-Spawn ausgeschaltet');return;}
    if(!game?.inSpawnPhase?.()){spawnBlock('Spawnphase bereits beendet');return;}
    if(game.config().isRandomSpawn?.()){spawnBlock('Zufallsspawn aktiv');return;}
    if(!bus?.emit){spawnBlock('EventBus fehlt');return;}
    if(!ctors.spawn){spawnBlock('Spawn-Intent nicht erkannt');return;}
    if(tick-lastSpawn<22)return;
    const me=myPlayer();
    if(me?.hasSpawned?.()||Number.isInteger(me?.state?.spawnTile))return;
    spawnState.blocked=null;
    if(!spawnCache){
      if(spawnRemaining(game)<=110)spawnCache=emergencySpawnSearch(game,me);
      if(!spawnCache){spawnBlock('Kein gültiges Land im Spawn-Suchraster');startSpawnSearch();return;}
    }
    if(spawnJob && spawnRemaining(game)>110 &&
      (spawnState.scanned<120 || spawnCache.score<.62))return;
    // Deterministic leader/follower: lower PlayerID publishes first; the
    // other browser waits briefly for its anchor but never misses deadline.
    const peer=duoTrustedPeer();
    if(peer&&String(safeID(me))>String(peer.id)&&
      !Number.isSafeInteger(peer.state?.spawn)&&
      !Number.isSafeInteger(peer.state?.candidate)&&
      spawnRemaining(game)>85){
      spawnState.phase='Duo: warte kurz auf Partner-Spawn';return;
    }
    const rivals=spawnRivals(game,me),urgent=spawnRemaining(game)<=55;
    const candidates=[spawnCache,...spawnAlternatives,...(spawnJob?.candidates?.values()||[])];
    let best=null;
    for(const candidate of candidates){
      const current=spawnScore(game,candidate.tile,rivals,urgent);
      if(!current)continue;
      // A selected tile that has not appeared in the game state after a
      // full retry interval should not monopolize the last multiplayer ticks.
      if(spawnState.lastSent?.tile===current.tile &&
        tick-spawnState.lastSent.tick>=30 && candidates.length>1)continue;
      if(!best||current.score>best.score)best=current;
    }
    const duoNearby=duoSpawnCandidate(game,me,candidates,urgent);
    if(duoNearby){best=duoNearby;spawnState.phase='Duo: sicherer Nachbar-Spawn';}
    if(!best && urgent)best=emergencySpawnSearch(game,me);
    if(!best){
      spawnCache=null;spawnBlock('Alle Kandidaten belegt/ungültig; suche neu');
      if(!spawnJob)startSpawnSearch();
      return;
    }
    spawnCache=best;spawnState.blocked=null;
    if(send('spawn',[best.tile],
      'SPAWN → strategischer Standort ('+best.x+','+best.y+
      ') · Land '+Math.round(best.density*100)+'% · Score '+best.score.toFixed(3),
      true)){
      lastSpawn=tick;spawnState.phase='Auswahl gesendet';spawnState.attempts++;
      spawnState.lastSent={tile:best.tile,tick,score:best.score,
        density:best.density,enemy:best.enemy,teammate:best.teammate};
      telemetry('spawn_intent','Strategischer Spawn angefordert',
        {spawn:{...spawnState.lastSent},withoutPlayerView:!me});
    }else spawnBlock('Spawn-Intent nicht gesendet (EventBus/Spielstatus prüfen)');
  }
  async function borders(me,tick) {
    const id=safeID(me);
    if(borderCache && borderPlayer===id && tick-lastBorderTick<22)return borderCache;
    // Combat and economy may request the border at the same moment. One worker
    // query is enough for both; the old code launched several redundant queries.
    if(borderInflight && borderInflight.id===id && borderInflight.generation===generation)
      return borderInflight.promise;
    const serial=generation, t0=performance.now();
    const promise=(async()=>{
      const result=await me.borderTiles();
      const tiles=result?.borderTiles;
      if(!tiles || typeof tiles[Symbol.iterator]!=='function')return [];
      const copied=[...tiles];
      if(serial===generation && game && id===safeID(myPlayer())){
        borderCache=copied;borderPlayer=id;lastBorderTick=number(()=>game.ticks(),tick);
        if(tick-lastBorderRefresh>=15){borderOffset++;lastBorderRefresh=tick;}
        runtime.borderMs=Math.round(performance.now()-t0);
      }
      return copied;
    })();
    borderInflight={id,generation:serial,promise};
    try{return await promise;}
    finally {if(borderInflight?.promise===promise)borderInflight=null;}
  }
  // FFA vs team mode and the real win threshold from Config. Missing client
  // information is represented as null, NEVER filled with a guessed win rule.
  function victoryPlan(me) {
    const cfg=game.config(),gc=cfg.gameConfig(),mode=gc.gameMode==='Team'?'Team':'FFA';
    const team=me.team?.(),ours=number(()=>me.numTilesOwned(),0);
    const land=mode==='Team'&&team!==undefined&&team!==null ?
      (game.playerViews?.()||[]).filter(p=>p.team?.()===team)
        .reduce((n,p)=>n+number(()=>p.numTilesOwned(),0),0):ours;
    const total=number(()=>game.numLandTiles?.(),0),fallout=number(()=>game.numTilesWithFallout?.(),0);
    const elapsed=number(()=>game.elapsedGameSeconds?.(),number(()=>game.ticks(),0)/10);
    const winPct=number(()=>cfg.percentageTilesOwnedToWin?.(elapsed),NaN);
    const remaining=Number.isFinite(gc.maxTimerValue)?
      Math.max(0,gc.maxTimerValue*60-elapsed):null;
    const threshold=total>0&&Number.isFinite(winPct)?winPct:null;
    const progress=total>0?land/Math.max(1,total-fallout):null;
    const urgent=(remaining!==null&&remaining<300)||!!me.inDoomsdayClock?.()||
      (progress!==null&&threshold!==null&&progress*100>=threshold-8);
    winStatus={mode,progress,threshold,remaining,urgent,
      doomsday:!!me.inDoomsdayClock?.(),
      ownTiles:ours,teamTiles:land};
    return winStatus;
  }

  // Short, bounded, per-match explanations. Snapshot export keeps alternatives
  // even when an old telemetry stream has been truncated.
  function decisionNote(kind,why,alternatives=[],tick=number(()=>game?.ticks?.(),0)){
    const key=kind+':'+why,previous=decisionKeys.get(key);
    if(previous!==undefined&&tick-previous<90)return;
    decisionKeys.set(key,tick);
    if(decisionKeys.size>140)for(const [k,v] of decisionKeys)
      if(tick-v>1100)decisionKeys.delete(k);
    const row={tick,kind,why,alternatives:alternatives.slice(0,4),
      decisionId:monitorSession+':t'+tick+':d'+(++diagnosticDecisionSequence),
      evidence:'ranked-options-not-executed-actions'};
    decisionTimeline.push(row);
    if(decisionTimeline.length>90)decisionTimeline.shift();
    telemetry('decision_timeline',why,{decision:row});
  }
  // P1 bounded look-ahead. It compares a small set of already-known options
  // under three explicit responses. This ranks planners only; every action
  // still passes its existing worker, alliance, reserve and budget gates.
  // P5: schema-5 runtime feature extension (featuredSchemaVersion 2).
  // Signed relative change per tick against an observation at least 100
  // ticks old, bounded to [-1,1]. Visible history only (troopSamples /
  // goldSamples); no engine truth.
  function v5TrendValue(samples,field,tick){
    const latest=samples[samples.length-1];
    const old=samples.find(v=>v&&tick-v.tick>=100);
    if(!latest||!old||!(old[field]>0))return 0;
    return clamp((latest[field]-old[field])/old[field]/
      ((tick-old.tick)/100),-1,1);
  }
  // The 9 state extension fields of the schema-5 feature contract. Every
  // value is a visible observation (own state, own observation history,
  // own front groups, confirmed partner report, own structures) — never
  // hidden enemy truth. strategicCandidatePlan spreads this into the exact
  // state that shadowV5.features scores, and planningState.v5State
  // publishes it to planningFrame, so the captured training frame carries
  // the very values the live inference used (parity by construction).
  function v5StateExtension(me,s,groups,tick){
    const home=Math.max(1,s.home),
      land=number(()=>me.numTilesOwned(),0);
    const income=(incomeStatus.train||0)+(incomeStatus.trade||0);
    const hostile=(groups||[]).filter(g=>g.id!==null&&
      g.opponent?.isAlive?.()&&!friendly(g.opponent,me));
    const frontTiles=hostile.reduce((n,g)=>n+(g.tiles?.length||0),0);
    const units=ownStructures(me);
    const techTypes=new Set(units.map(u=>u.type?.()));
    return {
      economyRelative:clamp(income/home,0,2),
      frontReach:clamp(frontTiles/Math.max(1,land),0,1),
      partnerNeed:duoTrustedPeer()?.state?.needHelp?1:0,
      enemyBound:clamp((s.strongest||0)/home,0,1),
      landTrend:v5TrendValue(troopSamples,'tiles',tick),
      goldTrend:v5TrendValue(goldSamples,'gold',tick),
      troopTrend:v5TrendValue(troopSamples,'home',tick),
      portAccess:units.some(u=>u.type?.()==='Port')?1:0,
      technologyCoverage:clamp(techTypes.size/6,0,1)};
  }
  // Per-candidate schema-5 feature contract (the 14 candidate fields).
  // cost/counterRisk/holdProbability mirror the candidate's own values so
  // the contract and the candidate never disagree; the extra fields are
  // bounded visible estimates for THIS candidate only.
  function v5Contract(kind,cost,counterRisk,holdProbability,extra={}){
    const duration=extra.duration||0;
    return {kind,costTroops:cost||0,costGold:extra.costGold||0,
      expectedLand:extra.expectedLand||0,duration,
      returnTime:extra.returnTime??duration,
      counterRisk:counterRisk||0,
      thirdPartyRisk:clamp(extra.thirdPartyRisk||0,0,1),
      infrastructureValue:clamp(extra.infrastructureValue||0,0,1),
      incomeValue:clamp(extra.incomeValue||0,0,1),
      recruitmentValue:clamp(extra.recruitmentValue||0,0,1),
      siteRisk:clamp(extra.siteRisk||0,0,1),
      holdProbability:clamp(holdProbability??1,0,1),
      legalConfidence:clamp(extra.legalConfidence??1,0,1)};
  }
  function strategicCandidatePlan(me,groups,s,context,ranked,tick){
    const started=performance.now(),budgetMs=50,candidates=[];
    const home=Math.max(1,s.home),waitGrowth=Math.max(0,s.growthPotential||0);
    const holdRisk=clamp(Math.max(s.incoming,s.strongest)/home,0,2);
    // P1: versionierte Archetyp-Politik. Sie verschiebt die Kandidaten-
    // Rangfolge (Timing, Zielauswahl, Subsysteme) und ändert damit die
    // tatsächlich gewählte Aktion. 'legacy' (keine Politik) bleibt identisch.
    const arch=archetypePolicy();
    candidates.push({id:'hold',channel:'hold',kind:'hold',target:null,
      utility:Math.round(35+holdRisk*85-waitGrowth/Math.max(1,home)*900),
      cost:0,risk:holdRisk,waitCost:Math.round(waitGrowth),
      scenarios:{holds:0,counter:s.incoming,thirdParty:s.strongest},
      v5:v5Contract('hold',0,holdRisk,1-Math.min(1,holdRisk),
        {thirdPartyRisk:clamp((s.strongest||0)/home,0,1)}),
      reason:holdRisk>=.85?'sichtbarer Druck':'Reserve und Wachstum abwarten'});
    const cap=Math.max(1,s.max),capPressure=s.home/cap;
    const observedIncome=Math.max(0,(incomeStatus.train||0)+(incomeStatus.trade||0));
    candidates.push({id:'invest',channel:'hold',kind:'invest',target:null,
      utility:Math.round(42+(capPressure>.82?48:0)+Math.min(35,observedIncome/50000)-holdRisk*55),
      cost:null,risk:holdRisk,waitCost:Math.round(waitGrowth*.6),
      scenarios:{holds:observedIncome,counter:-Math.round(s.incoming*.35),thirdParty:-Math.round(s.strongest*.1)},
      v5:v5Contract('invest',null,holdRisk,1-Math.min(1,holdRisk),
        {thirdPartyRisk:clamp((s.strongest||0)/home,0,1),
         incomeValue:clamp(observedIncome/100000,0,1)}),
      reason:capPressure>.82?'Kapazität ausbauen':'beobachtetes Einkommen verstärken'});
    for(const item of (ranked||[]).slice(0,6)){
      if(performance.now()-started>budgetMs)break;
      if(item.id===null){
        const amount=Math.max(0,neutralAttackAmount(s,setting('aggressive')));
        candidates.push({id:'neutral:'+String(item.tile??item.tiles?.[0]??'land'),
          channel:'land',kind:'expand',target:null,utility:Math.round(70+Math.min(45,item.score||0)-holdRisk*60),
          cost:amount,risk:holdRisk*.55,waitCost:Math.round(waitGrowth*.25),
          scenarios:{holds:item.tiles?.length||1,counter:-Math.round(amount*.2),thirdParty:-Math.round(s.strongest*.05)},
          v5:v5Contract('expand',amount,holdRisk*.55,1-Math.min(1,holdRisk*.55),
            {expectedLand:item.tiles?.length||0,
             thirdPartyRisk:clamp((s.strongest||0)/home,0,1),
             legalConfidence:amount>0?1:0.5}),
          reason:'neutrales Wachstum mit begrenztem Einsatz'});continue;
      }
      const enemy=Math.max(0,number(()=>item.opponent?.troops?.(),0));
      const guard=frontRiskPlan(groups,s,item.id),amount=Math.max(0,
        Math.floor(Math.min(s.available*.72,guard.safeStrike||0)));
      const forecast=amount>0?attackForecast(me,item,amount):
        {loss:Infinity,time:Infinity,engine:false,method:'no-safe-budget'};
      const other=(groups||[]).filter(g=>g.id!==null&&g.id!==item.id&&
        !friendly(g.opponent,me)).reduce((n,g)=>Math.max(n,
          number(()=>g.opponent?.troops?.(),0)),0);
      const held=Math.max(0,(item.tiles?.length||0)*18-
        (Number.isFinite(forecast.loss)?forecast.loss/Math.max(1,amount)*25:60));
      const counter=Math.max(0,enemy-amount*.7),third=Math.max(0,other-(home-amount));
      const risk=clamp((counter+third)/home,0,2),econ=targetEconomics(item);
      candidates.push({id:'attack:'+item.id,channel:'land',kind:'attack',target:item.id,
        utility:Math.round(55+(item.score||0)+held-counter/home*90-third/home*70),
        cost:amount,risk,waitCost:Math.round(waitGrowth*.4),
        scenarios:{holds:Math.round(held),counter:Math.round(counter),thirdParty:Math.round(third)},
        v5:v5Contract('attack',amount,clamp(counter/Math.max(1,enemy),0,1),
          1-Math.min(1,risk),
          {thirdPartyRisk:clamp(third/home,0,1),
           siteRisk:clamp(enemy/Math.max(1,home),0,1),
           infrastructureValue:clamp(econ.posts/Math.max(1,home),0,1),
           incomeValue:0,
           expectedLand:item.tiles?.length||0,
           legalConfidence:counter>0?
             clamp(1-counter/Math.max(1,enemy),0,1):1}),
        forecast:{loss:Number.isFinite(forecast.loss)?forecast.loss:null,
          time:Number.isFinite(forecast.time)?forecast.time:null,method:forecast.method},
        reason:'Frontziel gegen Halten, Gegenangriff und Drittpartei verglichen'});
    }
    if((arch.boats??opts.boats)&&ctors.boat&&!pendingBoat&&s.incoming===0)
      candidates.push({id:'naval',channel:'naval',kind:'naval',target:null,
        utility:Math.round((ranked||[]).length?36:82-holdRisk*55),cost:null,
        risk:holdRisk,waitCost:Math.round(waitGrowth*.5),
        scenarios:{holds:25,counter:0,thirdParty:Math.round(s.strongest*.08)},
        v5:v5Contract('naval',null,holdRisk,1-Math.min(1,holdRisk),
          {thirdPartyRisk:clamp((s.strongest||0)/home,0,1)}),
        reason:'alternative Seeoperation bei begrenzter Landoption'});
    const peer=duoTrustedPeer();
    if(peer?.state?.needHelp)candidates.push({id:'support:'+peer.id,channel:'hold',
      kind:'support',target:peer.id,utility:90,risk:holdRisk,cost:null,waitCost:0,
      scenarios:{holds:40,counter:s.incoming,thirdParty:s.strongest},
      v5:v5Contract('support',null,holdRisk,1-Math.min(1,holdRisk),
        {thirdPartyRisk:clamp((s.strongest||0)/home,0,1)}),
      reason:'bestätigter Partnerbedarf'});
    // P1: die Archetyp-Politik verschiebt die Rangfolge, bevor sie gefroren
    // wird. 'legacy' hat null Werte und ändert die Rangfolge nicht.
    const archRanked=archetypeRankKernel(candidates,arch,tick);
    candidates.splice(0,candidates.length,...archRanked);
    if(arch.targetWeakest){
      const hostiles=(groups||[]).filter(g=>g.id!==null&&!friendly(g.opponent,me));
      const weakest=hostiles.slice().sort((a,b)=>
        number(()=>a.opponent?.troops?.(),0)-number(()=>b.opponent?.troops?.(),0))[0];
      if(weakest)for(const c of candidates)
        if(c.kind==='attack')c.utility+=c.target===weakest.id?500:-250;
    }
    candidates.sort((a,b)=>b.utility-a.utility||String(a.id).localeCompare(String(b.id)));
    const ruleSelected=candidates[0]||null;
    // §4 binding evidence: the rule-basis ranking (pre-control) per
    // candidate, so per-candidate rule utility can be compared against the
    // model score that (or fails to) override it.
    const ruleRank=candidates.map(c=>({id:c.id,kind:c.kind,ruleUtility:c.utility}));
    // P5: bounded candidate-v5 control + shadow scoring. The schema-5 ranker
    // scores every bounded candidate. When opts.candidateControlEnabled the
    // score shifts each utility by a bounded gain*score and the ranking is
    // recomputed, so the model can drive the channel director; downstream
    // legality (director + planners) remains authoritative. Otherwise this is
    // shadow-only (the model only observes, it never changes the pick).
    let modelScores=null,controlActive=false;
    // The exact state scored live (17 fields: base visible state +
    // v5StateExtension). It is published as planningState.v5State so the
    // captured planning frame trains on the very values used at inference.
    // Both the schema-5 and schema-6 rankers consume this same state object.
    const state={home:s.home,maxTroops:s.max,committed:s.committed,
      incoming:s.incoming,reserve:s.reserve,gold:goldAmount(me),
      land:number(()=>me.numTilesOwned(),0),capacityUse:s.ratio,
      frontCount:groups?.length||0,...v5StateExtension(me,s,groups,tick)};
    // Schema-6 takes precedence when a v6 shadow model is bundled: it scores
    // the SAME candidate contract (cand.v5) plus the rule-utility context.
    // The candidates array is still rule-sorted here (control reorders it
    // below, after all scores are computed), so candidates[0]/[1] are the
    // rule top-1/top-2 utilities — the exact parity the v6 binding trained on.
    const shadowModel=shadowV6Model||shadowV5Model;
    const shadowSchema=shadowV6Model?6:5;
    if(opts.shadowRankEnabled&&shadowModel){
      try{
        const scoreOf=cand=>{
          const contract=cand.v5||{kind:cand.kind,costTroops:cand.cost||0,
            counterRisk:cand.risk||0,holdProbability:1-Math.min(1,cand.risk||0)};
          let f,outcome,bias;
          if(shadowV6Model){
            const ctx={ownRu:cand.utility,
              ruTop1:candidates[0]?candidates[0].utility:null,
              ruTop2:candidates.length>1?candidates[1].utility:null};
            f=shadowV6.features(state,contract,ctx);
            // 38 finite features in [0,1]; `features` clamps, so a violation
            // means live inputs drifted from the trained contract.
            if(!Array.isArray(f)||f.length!==38||
               f.some(x=>!Number.isFinite(x)||x<0||x>1))
              throw Error('feature-drift');
            outcome=shadowV6.predict(shadowV6Model,f);
            bias=Number(shadowV6Model.training?.kindBias?.[cand.kind])||0;
          }else{
            f=shadowV5.features(state,contract);
            // 32 finite features in [0,1]; fail closed (rule-based) on drift.
            if(!Array.isArray(f)||f.length!==32||
               f.some(x=>!Number.isFinite(x)||x<0||x>1))
              throw Error('feature-drift');
            outcome=shadowV5.predict(shadowV5Model,f);
            // Action-kind calibration (trainer variant D): makes the live
            // score margin exactly equal to the trained margin. Absent for
            // models without training.kindBias (no-op, identical behavior).
            bias=Number(shadowV5Model.training?.kindBias?.[cand.kind])||0;
          }
          return outcome.heldGain-outcome.lossRisk+bias;
        };
        modelScores=new Map(candidates.map(c=>[c.id,scoreOf(c)]));
        if(opts.candidateControlEnabled===true){
          const controlled=candidateControlVariant(candidates,modelScores,
            opts.candidateControlGain,opts.candidateControlMode||'raw',
            {margin:opts.candidateControlMargin,
             capGain:opts.candidateControlCapGain,
             confidenceRef:opts.candidateControlConfidenceRef});
          candidates.splice(0,candidates.length,...controlled);
          controlActive=true;
        }
      }catch(e){
        // Fail-closed: any invalid model, feature drift, missing visible
        // state or scoring error drops back to the deterministic rule ranking;
        // the emergency defense is computed separately and is never delayed
        // by this bounded, synchronous model scoring.
        shadowDecisionEvidence={tick,
          failClosed:String(e?.message||e),error:String(e?.message||e),
          changedIntent:false};
      }
    }
    // §4 binding evidence: for each candidate, the pre-control rule utility,
    // the schema-5 model score, the effective gain, and the combined utility
    // the controller used (round(rule + gain*score) when control is active,
    // else rule). Bounded (one entry per candidate), read-only; it never
    // authorizes or blocks actions. Lets the binding analysis compute, from
    // actual scores and utility gaps, the gain required to flip the pick and
    // the exact reason a switch was blocked at the configured gain.
    const controlGain=controlActive?
      (Number.isFinite(+opts.candidateControlGain)?+opts.candidateControlGain:18):0;
    const combinedById=new Map(candidates.map(c=>[c.id,c.utility]));
    const binding=ruleRank.map((r,rankByRule)=>{
      const score=modelScores?modelScores.get(r.id):null;
      const scored=Number.isFinite(score);
      const neuralDelta=scored?controlGain*score:0;
      return {id:r.id,kind:r.kind,legal:true,ruleUtility:r.ruleUtility,
        modelScore:scored?score:null,gain:scored?controlGain:0,
        neuralDelta:+neuralDelta.toFixed(4),
        combinedUtility:combinedById.get(r.id)??r.ruleUtility,rankByRule};
    });
    const ruleTop2Gap=ruleRank.length>1?
      ruleRank[0].ruleUtility-ruleRank[1].ruleUtility:0;
    const limited=candidates.slice(0,8),selected=limited[0]||null;
    const rejectedCandidates=limited.slice(1);
    archetypeRecord(selected,groups,me,tick);
    planningState={tick,candidates:limited,selected,
      rejected:limited[1]||null,rejectedCandidates,
      durationMs:Number((performance.now()-started).toFixed(2)),
      budgetMs,truncated:candidates.length>limited.length||performance.now()-started>budgetMs,
      v5State:state,binding,controlGain,ruleTop2Gap,
      controlMode:opts.candidateControlMode||null,
      controlCapGain:opts.candidateControlCapGain??null,
      controlConfidenceRef:opts.candidateControlConfidenceRef??null,
      controlMargin:opts.candidateControlMargin??null,
      semantics:'bounded-ranking-only; existing legality remains authoritative'};
    // P0 canonical decision frame (diagnostics only; it never authorizes or
    // blocks actions). One frame per planning tick links the rule choice, the
    // shadow model ranking and the actually emitted intent through the same
    // decisionId that send() stamps on every action record. Rejected
    // candidates are only ranked in this match; none is executed, so no
    // counterfactual effect may be attributed to them here.
    const borderAge=lastDecisionFrame?.borderAgeTicks??null;
    planningState.decisionId=monitorSession?monitorSession+':t'+
      number(()=>game?.ticks?.(),0):':t'+number(()=>game?.ticks?.(),0);
    planningState.matchId=String(game?.gameID?.()??'unknown');
    planningState.clientId=safeID(me);
    planningState.dataAge={requestedTick:lastDecisionFrame?.requestedTick??null,
      borderAgeTicks:borderAge};
    planningState.missingMask={
      borderStale:borderAge===null||borderAge>20,
      opponentTroopsUnknown:(groups||[]).filter(g=>g.id!==null&&
        !Number.isFinite(number(()=>g.opponent?.troops?.(),NaN))).length,
      modelEnabled:!!(opts.shadowRankEnabled&&shadowModel)};
    planningState.provenance={bot:VERSION,
      engineCommit:window.BOOTSTRAP_CONFIG?.gitCommit??null,
      gameMode:game?.config?.().gameConfig?.().gameMode??'unknown',
      // Deployment identity (FNV-1a tracking fingerprints, not policy
      // SHA256); the champion model-file SHA256 is recorded by the
      // deploy/build tooling. The candidate is shadow-only, so rolling back
      // to the unchanged Run3 reference is just disabling the opt-in.
      modelHashes:{champion:neuralModelInfo().fingerprint??null,
        candidate:shadowModelInfo().fingerprint??null},
      scriptVersion:VERSION};
    planningState.modelChoice=null;
    planningState.modelScores=null;
    planningState.actualIntents=null;
    planningState.blockReasons=null;
    planningState.actionReceipt=null;
    planningState.observedEffects=null;
    planningState.outcomeStatus='pending';
    planningState.resolved=false;
    // Candidate-v5 shadow evidence (and bounded control override marker).
    // When control is off the model only observes and changedIntent stays
    // false; its output is never read by an intent, budget, reserve, legality
    // or target selector. When control is on, `selected` already reflects the
    // v5-influenced re-ranking computed above.
    if(opts.shadowRankEnabled&&shadowModel&&limited.length){
      const ruleChoice=ruleSelected?.id??null;
      const changedIntent=controlActive&&selected?.id!==ruleChoice;
      const rankedShadow=(modelScores?
        limited.map(c=>({id:c.id,score:modelScores.get(c.id)??0})):[]).sort((a,b)=>
          b.score-a.score||String(a.id).localeCompare(String(b.id)));
      const wouldPrefer=controlActive?selected?.id??null:
        rankedShadow[0]?.id??null;
      shadowDecisionEvidence={tick,ruleChoice,wouldPrefer,ranked:rankedShadow,
        changedIntent,schema:shadowSchema,
        evidence:controlActive
          ?(changedIntent
            ?`candidate-v${shadowSchema} bounded control override; legality still authoritative`
            :`candidate-v${shadowSchema} control active; model agrees with rule ranking`)
          :'shadow-only; not observed game effect'};
      planningState.modelChoice=rankedShadow[0]?.id??null;
      planningState.modelScores=rankedShadow;
      if(tick%100<4)telemetry('neural_shadow_rank',
        changedIntent?`Schema-${shadowSchema} Kandidatensteuerung aktiv`:`Schema-${shadowSchema} nur protokolliert`,
        shadowDecisionEvidence);
    }
    // §3/§4: explicit per-frame decision-path fields. ruleChoice is the
    // pre-control rule pick, finalChoice the actually selected candidate,
    // modelChoice the model's top by score. changedIntent is true only when
    // control flipped the pick away from the rule. safetyBlockReason marks
    // frames where the model's top differs from the rule pick but the final
    // pick stayed with the rule (the switch did not take effect at the
    // configured gain); the precise gain-vs-gap reason is computed by the
    // binding analysis from the per-candidate `binding` data.
    planningState.ruleChoice=ruleSelected?.id??null;
    planningState.finalChoice=selected?.id??null;
    planningState.changedIntent=controlActive&&
      selected?.id!==ruleSelected?.id;
    planningState.safetyBlockReason=
      (controlActive&&planningState.modelChoice!=null&&
       planningState.modelChoice!==ruleSelected?.id&&
       selected?.id===ruleSelected?.id)?'model-preference-blocked':null;
    return planningState;
  }
  // Observed behaviour is evidence, not knowledge of a human's intentions.
  // No guesses from hidden armies, and no cross-match personal profiling.
  function observeHumanProfiles(me,tick){
    const current=new Set();
    const fleets=(game.playerViews?.()||[]).filter(p=>p.isAlive?.()&&
      (p.type?.()==='HUMAN'||typeof p.clientID?.()==='string'&&p.clientID().length>0)).map(p=>
      (p.units?.()||[]).filter(u=>u.isActive?.()&&u.type?.()==='Warship').length)
      .sort((a,b)=>a-b);
    const typicalFleet=fleets.length?fleets[Math.floor(fleets.length/2)]:0;
    for(const p of game.playerViews?.()||[]){
      const id=safeID(p);
      if(id===null||id===safeID(me)||!p.isAlive?.()||friendly(p,me)||
         me.isOnSameTeam?.(p))continue;
      const human=p.type?.()==='HUMAN' ||
        (typeof p.clientID?.()==='string'&&p.clientID().length>0);
      if(!human)continue;
      current.add(id);
      const old=opponentProfiles.get(id);
      if(old&&tick-old.tick<80)continue;
      const deployed=(p.outgoingAttacks?.()||[]).filter(a=>!a.retreating);
      const attacks=deployed.filter(a=>number(()=>a.troops,0)>0);
      const weight=attacks.reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
      const home=Math.max(1,number(()=>p.troops?.(),1));
      const units=(()=>{try{return p.units?.()||[];}catch(_){return [];}})();
      const ports=units.filter(u=>u.isActive?.()&&u.type?.()==='Port').length;
      const warships=units.filter(u=>u.isActive?.()&&u.type?.()==='Warship').length;
      const transports=units.filter(u=>u.isActive?.()&&u.type?.()==='Transport').length;
      const ships=warships+transports;
      const past=opponentTrend(p,tick);
      const samples=Math.min(12,(old?.samples||0)+1);
      const early=tick<1600;
      // Ports are infrastructure, not evidence of naval aggression. Compare
      // fleets with the current match, so island maps do not label everyone.
      const naval=transports>0||warships>=Math.max(2,typicalFleet*1.5);
      const aggressive=weight>=Math.max(900,home*.22) ||
        (past.valid&&past.landChange>.09&&early);
      const opportunistic=weight>=Math.max(500,home*.12)&&
        (past.sustained||adversaryWindow(me,p).exposed);
      const economic=past.valid&&past.growing&&
        weight<Math.max(500,home*.12);
      const profile=naval?'Marinefokus':opportunistic?'Gelegenheitsangreifer':
        aggressive&&early?'Früher Angreifer':
        economic?'Wirtschaftsaufbauer':'Unbestimmt';
      const signalSamples=profile==='Unbestimmt'?0:
        old?.profile===profile?Math.min(12,(old.signalSamples||0)+1):1;
      // A changed label starts with weak evidence even after a long match.
      // This is a heuristic score, not a calibrated probability.
      const confidence=signalSamples?Math.min(naval&&transports===0?.65:.85,
        .20+signalSamples*.07):0;
      const result={id,name:nameOf(p),profile,confidence,samples,tick,
        signalSamples,confidenceMethod:'consecutive-signal-heuristic',
        weight,ports,ships,warships,transports,typicalFleet,home};
      opponentProfiles.set(id,result);
      if(old?.profile!==profile&&confidence>=.38)
        decisionNote('profil',nameOf(p)+': '+profile+' ('+
          Math.round(confidence*100)+'% heuristische Konfidenz)',[],tick);
    }
    for(const id of opponentProfiles.keys())
      if(!current.has(id))opponentProfiles.delete(id);
  }
  // A competitor's land is measured against the same visible win denominator
  // as ours. Team players are grouped once, not counted as separate threats.
  function observeVictoryThreat(me,tick){
    const total=number(()=>game.numLandTiles?.(),0)-
      number(()=>game.numTilesWithFallout?.(),0);
    const threshold=winStatus.threshold;
    if(total<=0||!Number.isFinite(threshold)){
      victoryThreat=null;return null;
    }
    const team=winStatus.mode==='Team',ours=me.team?.(),seen=new Set();
    let leader=null;
    for(const p of game.playerViews?.()||[]){
      if(!p?.isAlive?.()||friendly(p,me)||me.isOnSameTeam?.(p))continue;
      const pTeam=p.team?.(),sameTeam=team&&pTeam!==null&&pTeam!==undefined;
      const key=sameTeam?'team:'+String(pTeam):'player:'+String(safeID(p));
      if(seen.has(key))continue;
      seen.add(key);
      if(sameTeam&&pTeam===ours)continue;
      const members=sameTeam?(game.playerViews?.()||[]).filter(q=>
        q.isAlive?.()&&q.team?.()===pTeam):[p];
      const land=members.reduce((n,q)=>n+Math.max(0,number(()=>q.numTilesOwned?.(),0)),0);
      const progress=land/total*100;
      if(!leader||progress>leader.progress)
        leader={id:safeID(p),name:sameTeam?'Team '+String(pTeam):nameOf(p),
          team:sameTeam?pTeam:null,progress,land};
    }
    const urgent=!!leader&&leader.progress>=threshold-8;
    const last=victoryThreat;
    victoryThreat=leader?{...leader,threshold,urgent,tick}:null;
    if(urgent&&(!last?.urgent||last.id!==leader.id||tick-last.tick>=180))
      decisionNote('siegwarnung','Gegnerischer Siegfortschritt: '+
        leader.name+' '+leader.progress.toFixed(1)+'% / '+threshold+'%',
        ['Eigene Verteidigung und Angriffszulässigkeit bleiben verbindlich'],tick);
    return victoryThreat;
  }
  // Ranked team state still works without the relay. When the explicitly
  // configured PlayerID is connected AND the game itself confirms friendship,
  // relay state may break ties between otherwise legal/safe targets.
  // A joint attack uses two INDEPENDENTLY protected deployment budgets.
  // Neither browser treats a relay promise as a deployed friendly stack.
  // The shared target must touch both frontiers; the launch must be
  // acknowledged by both before a weaker individual assault is allowed.
  function duoJointOpportunity(me,items,s,item,tick,launch=false){
    const peer=duoTrustedPeer(),id=item?.id,p=peer?.player,info=peer?.state;
    const observedOn=(p?.outgoingAttacks?.()||[])
      .filter(a=>!a.retreating&&attackTargets(a.targetID,id))
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    if(!peer||!actualFriendly(p,me)||info?.allied!==true||
      !duoID(id)||!item?.tiles?.length||friendly(item.opponent,me)||
      !Array.isArray(info.fronts)||!info.fronts.includes(id)||
      !Number.isFinite(info.available)||!Number.isFinite(info.reserve)||
      !Number.isFinite(info.home)||!Number.isFinite(info.incoming)||
      info.incoming>0||s.incoming>0||(!info.ready&&observedOn<=0)||
      !Number.isInteger(info.tick)||Math.abs(info.tick-tick)>40||
      s.ratio<.38||s.activeEnemy||
      recentHostilePressure(tick)||
      (crisisTrend&&tick<crisisTrend.expires))return null;
    const observedHome=number(()=>p.troops?.(),NaN);
    if(!Number.isFinite(observedHome)||observedHome<=0||
      Math.abs(info.home-observedHome)>Math.max(3500,observedHome*.15)||
      info.available>Math.max(0,info.home-info.reserve)+2||
      info.available>observedHome*.8||
      (p.incomingAttacks?.()||[]).some(a=>!a.retreating&&a.troops>0))return null;
    const front=frontRiskPlan(items,s,id);
    if(front.danger||front.pressure||front.safeStrike<1000)return null;
    const own=Math.floor(Math.min(s.available*.72,front.safeStrike));
    const ally=Math.floor(Math.max(
      Math.min(info.available*.72,observedHome*.55),
      Math.min(observedOn*.55,observedHome*.75)));
    const enemyHome=number(()=>item.opponent?.troops?.(),NaN);
    if(!Number.isFinite(enemyHome)||enemyHome<0)return null;
    const enemyDeployed=(item.opponent?.outgoingAttacks?.()||[])
      .filter(a=>!a.retreating).reduce((n,a)=>
        n+Math.max(0,number(()=>a.troops,0)),0);
    const enemy=enemyHome+enemyDeployed;
    const needed=Math.max(2400,enemy*(hardMode()?1.35:1.22));
    if(own<Math.max(1000,enemy*.12)||
      ally<Math.max(1000,enemy*.12)||own+ally<needed)return null;
    if(launch&&(!duoPlan||duoPlan.target!==id||
      !Number.isInteger(duoPlan.strikeTick)||tick<duoPlan.strikeTick||
      tick>(Number.isInteger(duoPlan.expiresTick)?duoPlan.expiresTick:duoPlan.strikeTick+110)||
      (Number.isInteger(info.expiresTick)&&tick>info.expiresTick&&observedOn<=0)||
      // Both full bots agree to the same live plan before launching.
      !duoPlan.planId||info.ackPlanId!==duoPlan.planId||
      info.planId!==duoPlan.planId||
      info.target!==id||
      (info.strikeTick!==duoPlan.strikeTick&&observedOn<=0)))return null;
    return {target:id,own,ally,needed,enemy,front,
      strikeTick:duoPlan?.strikeTick??null};
  }
  function duoTeamDecision(v){
    const ownBudget=Math.max(0,Math.floor(Math.min(v.ownAvailable||0,
      (v.ownHome||0)*.72)));
    const partnerBudget=Math.max(0,Math.floor(Math.min(v.partnerAvailable||0,
      (v.partnerHome||0)*.55)));
    const role=v.invasion?(v.partnerNeeds?'support':'defend'):
      v.sharedJoint&&v.bothReady?'joint-attack':
      v.separatedFronts&&ownBudget>=Math.max(1200,(v.ownHome||0)*.12)?
        'independent-front':v.partnerWarning>0?'hold':'build';
    const reason=v.invasion?'observed-invasion':
      v.sharedJoint&&v.bothReady?'confirmed-common-front-and-budgets':
      v.separatedFronts?'confirmed-separated-fronts':
      v.partnerWarning>0?'partner-early-warning':'no-safe-joint-window';
    return Object.freeze({role,reason,ownBudget,partnerBudget,
      ownReserve:v.ownReserve||0,partnerReserve:v.partnerReserve||0,
      partnerIncoming:v.partnerIncoming||0,
      combinedBudget:ownBudget+partnerBudget,
      permission:'advisory-only-own-engine-check-required'});
  }
  function coordinateDuo(me,s,tick){
    if(duoPlan?.planId&&!duoPlan.partnerAck&&
      Number.isInteger(duoPlan.expiresTick)&&tick>duoPlan.expiresTick&&
      duoLocal.lastExpiredPlan!==duoPlan.planId){
      duoLocal.lastExpiredPlan=duoPlan.planId;duoLocal.ackTimeouts++;
    }
    let duo=rankedDuo(me);
    const connectedPeer=duoTrustedPeer();
    const local=connectedPeer&&actualFriendly(connectedPeer.player,me)?
      connectedPeer:null;
    if(local?.id)diagnosticV2.lastVerifiedPartnerId=local.id;
    if(!duo&&local){
      const enemies=(game.playerViews?.()||[]).filter(p=>p?.isPlayer?.()&&
        p.isAlive?.()&&!friendly(p,me));
      duo={partner:local.player,partnerID:local.id,enemies,team:null};
    }
    if(!duo){
      if(duoPlan)telemetry('duo_plan_abort','Duo-Plan abgebrochen',
        {planId:duoPlan.planId??null,target:duoPlan.target,
          reason:'no-trusted-allied-peer'});
      duoPlan=null;return null;
    }
    // No shared operation against a player protected by EITHER bot's
    // actual alliances; independent enemy scoring still checks friendly().
    duo.enemies=duo.enemies.filter(p=>!friendly(p,me));
    const partner=duo.partner;
    const observedIncoming=(partner.incomingAttacks?.()||[])
      .filter(a=>!a.retreating);
    const incoming=observedIncoming
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    const aggressor=duo.enemies.map(p=>({p,on:observedIncoming
      .filter(a=>String(a.attackerID)===safeID(p)||
        String(a.attackerID)===String(p.smallID?.()))
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0)}))
      .sort((a,b)=>b.on-a.on)[0];
    const partnerHome=Math.max(1,number(()=>partner.troops?.(),1));
    const active=duo.enemies.map(p=>({p,on:duoFocus(me,p)?.on||0}))
      .sort((a,b)=>b.on-a.on ||
        String(safeID(a.p)).localeCompare(String(safeID(b.p))))[0];
    const targets=[...duo.enemies].sort((a,b)=>
      number(()=>b.numTilesOwned(),0)-number(()=>a.numTilesOwned(),0) ||
      String(safeID(a)).localeCompare(String(safeID(b))));
    const announced=local?.state?.target&&duo.enemies.find(p=>
      safeID(p)===local.state.target);
    const common=(strategic.groups||[]).filter(x=>x.id!==null&&
      duo.enemies.some(p=>safeID(p)===x.id))
      .map(x=>({item:x,joint:duoJointOpportunity(me,strategic.groups,s,x,tick)}))
      .filter(x=>x.joint)
      .sort((a,b)=>a.joint.enemy-b.joint.enemy||
        b.item.tiles.length-a.item.tiles.length||
        String(a.item.id).localeCompare(String(b.item.id)));
    const danger=s.incoming>Math.max(1200,s.home*.08);
    const partnerWarning=Math.max(duoWarningLevel(
      {home:partnerHome,incoming,strongest:0},tick),
      local?.state?.warning||0);
    const partnerNeeds=incoming>Math.max(1200,partnerHome*.035)||
      local?.state?.earlyCrisis===true||local?.state?.warning===2;
    const invasion=danger||partnerNeeds||
      (crisisTrend&&tick<crisisTrend.expires&&
        (crisisTrend.lostLand>0||crisisTrend.lostAssets>0));
    // The lower PlayerID chooses the scheduled focus. A follower uses
    // that announcement only when paired with a valid strike tick.
    const follower=local&&String(safeID(me))>String(local.id);
    const jointTarget=common.find(x=>x.item.id===safeID(announced))||
      common[0];
    // A verified rendezvous remains the priority across harmless ECONOMY/
    // TECH/RECOVER posture changes. Real invasion, lost alliance, lost
    // common border or expired launch releases it without forcing an attack.
    const retained=duoPlan?.strikeTick!==null&&
      Number.isInteger(duoPlan?.strikeTick)&&
      tick<=duoPlan.strikeTick+110&&!invasion&&local&&
      Number.isInteger(local.state?.tick)&&Math.abs(local.state.tick-tick)<=40&&
      (local.state?.ready===true||
        (local.player?.outgoingAttacks?.()||[]).some(a=>
          !a.retreating&&attackTargets(a.targetID,duoPlan.target)))&&
      actualFriendly(local.player,me)&&local.state?.allied===true&&
      Array.isArray(local.state?.fronts)&&
      local.state.fronts.includes(duoPlan.target)&&
      (strategic.groups||[]).find(x=>x.id===duoPlan.target&&
        x.tiles?.length&&x.opponent?.isAlive?.()&&
        !friendly(x.opponent,me))?.opponent;
    const shared=invasion&&aggressor?.on>0?aggressor.p:
      retained||
      (partnerWarning>0&&aggressor?.on>0?aggressor.p:null)||
      (active?.on>0?active.p:null)||
      jointTarget?.item.opponent||
      (follower&&Number.isInteger(local?.state?.strikeTick)?announced:null)||
      targets[0];
    const bothReady=!!local?.state?.ready&&!danger&&
      s.incoming===0&&s.ratio>=.38&&!s.activeEnemy&&
      !recentHostilePressure(tick)&&
      !(crisisTrend&&tick<crisisTrend.expires)&&
      s.available>=Math.max(1200,s.home*.09);
    const sharedJoint=common.find(x=>x.item.id===safeID(shared))?.joint||null;
    const leader=local&&String(safeID(me))<String(local.id);
    // The lower PlayerID proposes a stable tick; the second adopts it
    // only while both are ready. Neither skips the game's action checks.
    const held=duoPlan?.target===safeID(shared)&&
      Number.isInteger(duoPlan.strikeTick)&&
      tick<=duoPlan.strikeTick+110?duoPlan.strikeTick:null;
    const offered=local?.state?.strikeTick;
    const strikeTick=retained&&held!==null&&!invasion?
      held:
      !local||!bothReady||!sharedJoint||invasion?null:leader?
      (held??tick+45):
      Number.isInteger(offered)&&offered>=tick-15&&offered<=tick+180&&
        local?.state?.target===safeID(shared)?offered:null;
    const ownFronts=(strategic.groups||[]).filter(g=>g.id!==null&&
      g.tiles?.length&&g.opponent?.isAlive?.()&&!friendly(g.opponent,me));
    const partnerFronts=Array.isArray(local?.state?.fronts)?local.state.fronts:[];
    const separatedFronts=!!local&&ownFronts.length>0&&partnerFronts.length>0&&
      !ownFronts.some(g=>partnerFronts.includes(g.id));
    // Advisory team allocator; never counts ally troops as our own budget.
    // Independent-front decisions cannot authorize an unsafe joint strike.
    const teamDecision=duoTeamDecision({invasion,partnerNeeds,bothReady,
      separatedFronts,sharedJoint,partnerWarning,ownAvailable:s.available,
      ownHome:s.home,ownReserve:s.reserve,partnerAvailable:local?.state?.available,
      partnerReserve:local?.state?.reserve,partnerHome,partnerIncoming:incoming});
    const role=danger?'Heimat verteidigen':
      partnerNeeds?'Partner unter Druck unterstützen':
      strikeTick!==null?(tick<strikeTick?'Gemeinsamen Angriff vorbereiten':
        leader?'Gemeinsamen Angriff anführen':'Gemeinsamen Angriff unterstützen'):
      partnerWarning>0?'Partnerfrühwarnung · Reserve schützen':
      active?.on>0?'Partnerfront unterstützen':
      separatedFronts&&s.available>=Math.max(1200,s.home*.12)?
        'Getrennte Front: eigene sichere Offensive oder Landung prüfen':
      separatedFronts?'Getrennte Front: aufbauen und Heimatreserve halten':
      bothReady?'Auf Partner-Zeitpunkt warten':
      s.home>partnerHome*1.25?'Angriff vorbereiten':'Aufbauen / Landung vorbereiten';
    const planId=strikeTick===null||!shared?null:
      String(safeID(shared)).slice(0,96)+':'+String(strikeTick);
    const roleOptions=[
      {type:'hold',legal:true,utility:danger||partnerWarning>0?90:28},
      {type:'invest',legal:!danger,utility:s.ratio<.65?58:24},
      {type:'attack',legal:!!sharedJoint,utility:sharedJoint?75:0},
      {type:'relieve',legal:partnerNeeds,utility:partnerNeeds?95:0},
      {type:'flank',legal:separatedFronts,utility:separatedFronts?64:0},
      {type:'land',legal:separatedFronts&&opts.boats,utility:separatedFronts&&opts.boats?52:0},
      {type:'targeted-aid',legal:partnerNeeds||partnerWarning>0,
        utility:partnerNeeds?88:partnerWarning>0?45:0}
    ].filter(x=>x.legal).sort((a,b)=>b.utility-a.utility);
    const plan={partner:duo.partnerID,target:shared?safeID(shared):null,
      targetName:shared?nameOf(shared):'Kein Gegner',role,
      partnerCommitted:active?.on||0,partnerIncoming:incoming,
      partnerHome,needHelp:partnerNeeds,partnerWarning,
      partnerEarlyCrisis:local?.state?.earlyCrisis===true,
      partnerLand:local?.state?.land??null,
      partnerReady:!!local?.state?.ready,separatedFronts,
      teamDecision,strikeTick,
      partnerAck:!!(planId&&local?.state?.ackPlanId===planId),
      planId,
      expiresTick:strikeTick===null?null:strikeTick+110,
      strikeStatus:strikeTick===null?(separatedFronts?'independent-fronts':'none'):
        !sharedJoint?'locked-awaiting-safe-budget':
        local?.state?.ackPlanId!==planId?'locked-awaiting-peer-ack':
        tick<strikeTick?'locked-preparing':'locked-launch-window',
      joint:sharedJoint?{own:sharedJoint.own,ally:sharedJoint.ally,
        needed:sharedJoint.needed}:null,
      options:roleOptions,ownBudget:sharedJoint?.own??Math.floor(s.available*.5),
      partnerBudget:sharedJoint?.ally??number(()=>local?.state?.ownBudget,0),
      abortOn:['relay-stale','alliance-lost','target-friendly','home-invasion',
        'reserve-breach','plan-expired'],
      ready:bothReady,peerAck:!!(planId&&local?.state?.ackPlanId===planId),
      ownReserve:s.reserve,tick,source:local?
        'lokaler Duo-Relay + bestätigter Spielzustand':
        'sichtbare Spielzustände (kein Relay)'};
    if(!duoPlan||duoPlan.target!==plan.target||duoPlan.role!==role||
      duoPlan.strikeTick!==plan.strikeTick)
      decisionNote('2v2','Gemeinsamer Fokus: '+plan.targetName+' · '+role+
        (strikeTick!==null?' · Tick '+strikeTick:''),
        [local?'Relay-Ziel ist nur Priorität; eigene Sicherheitsprüfung bleibt verbindlich':
          'Partner-Einsatz nur bei beobachteten Angriffen bestätigt'],tick);
    if(duoPlan?.planId&&(duoPlan.planId!==plan.planId||
      (duoPlan.partnerAck&&!plan.partnerAck))){
      telemetry('duo_plan_abort','Bisheriger Duo-Plan nicht mehr bestätigt',{
        planId:duoPlan.planId,target:duoPlan.target,
        previousStrikeTick:duoPlan.strikeTick,
        observedPartnerAck:duoPlan.partnerAck,
        reason:invasion?'own-or-partner-threat':
          !local?'relay-or-alliance-unavailable':
          !sharedJoint?'common-front-not-safe':
          duoPlan.partnerAck&&!plan.partnerAck?'partner-ack-lost':
          'target-or-strike-replanned',
        status:'plan-released-no-execution-claim'});
    }
    if(!duoPlan||duoPlan.planId!==plan.planId||
      duoPlan.strikeStatus!==plan.strikeStatus||
      duoPlan.role!==plan.role||
      duoPlan.needHelp!==plan.needHelp)
      telemetry('duo_plan_state','Duo-Planstatus beobachtet',{
        planId:plan.planId,partnerId:plan.partner,target:plan.target,
        strikeTick:plan.strikeTick,strikeStatus:plan.strikeStatus,
        partnerAck:plan.partnerAck,role:plan.role,
        ownBudget:plan.ownBudget,partnerBudget:plan.partnerBudget,
        ownReserve:plan.ownReserve,partnerIncoming:plan.partnerIncoming,
        needHelp:plan.needHelp,permission:plan.teamDecision.permission});
    duoPlan=plan;return plan;
  }
  function operationOptions(me,items,s,tick,current=operation){
    if(!current)return null;
    const active=(s.out||[]).filter(a=>!a.retreating&&
      attackTargets(a.targetID,current.target));
    const idle=tick-(current.lastProgressTick??current.since);
    const remaining=Math.max(0,current.budget-current.spent);
    const alternatives=(items||[]).filter(x=>x.id!==null&&x.id!==current.target&&
      x.opponent?.isAlive?.()&&!friendly(x.opponent,me)).map(x=>({
        id:x.id,name:nameOf(x.opponent),opportunity:2/Math.max(.5,
          enemyOpportunityRatio(x.opponent,lateGame(me),s.home)),
        safe:!frontRiskPlan(items,s,x.id).danger})).filter(x=>x.safe)
      .sort((a,b)=>b.opportunity-a.opportunity);
    const options=[
      {action:'continue',utility:active.length?70:idle<180?45:10,
        reason:active.length?'laufende Armee beobachtet':'kurzes Fortschrittsfenster'},
      {action:'reinforce',utility:remaining>Math.max(1000,s.home*.04)&&
        s.incoming===0&&idle<260?62:-100,
        reason:'Restbudget und Heimatreserve'},
      {action:'pause',utility:idle>260&&!active.length?68:15,
        reason:'kein beobachteter Fortschritt ohne aktive Armee'},
      {action:'retreat',utility:s.incoming>Math.max(1200,s.home*.10)?95:-100,
        reason:'Heimat unter Angriff'},
      {action:'switch',utility:alternatives[0]&&idle>300&&!active.length?
        72+Math.min(20,alternatives[0].opportunity*10):-100,
        reason:alternatives[0]?'bessere sichere Alternative '+alternatives[0].name:
          'keine sichere Alternative'}
    ].sort((a,b)=>b.utility-a.utility);
    return {tick,preferred:options[0].action,options,
      activeStacks:active.length,idleTicks:idle,remainingBudget:remaining,
      alternative:alternatives[0]||null,
      semantics:'observed-state comparison; no causal battle claim'};
  }
  function planOperation(me,items,s,tick){
    const danger=s.incoming>Math.max(1200,s.home*.10);
    if(operation){
      operation.review=operationOptions(me,items,s,tick,operation);
      const p=game.playerViews?.().find(x=>safeID(x)===operation.target);
      const reason=!p?.isAlive?.()?'Ziel ausgeschieden':
        friendly(p,me)||me.isOnSameTeam?.(p)?'Ziel jetzt verbündet':
        danger?'Heimat unter Angriff':
        operation.spent>=operation.budget &&
          !s.out.some(a=>attackTargets(a.targetID,operation.target))?
            'Truppenbudget ausgeschöpft':
        tick-operation.since>1100?'Operationsfrist erreicht':
        number(()=>p.numTilesOwned?.(),Infinity)<=operation.successLand?
          'Gebietsziel beobachtet':null;
      if(!reason&&p){
        const land=number(()=>p.numTilesOwned?.(),Infinity);
        if(Number.isFinite(land)&&
          land<(operation.lastObservedLand??operation.initialLand)){
          const gained=(operation.lastObservedLand??operation.initialLand)-land;
          operation.lastObservedLand=land;operation.lastProgressTick=tick;
          telemetry('operation_progress','Beobachteter Zielgebietsverlust',
            {target:operation.target,observedTiles:land,
              delta:gained,operationSince:operation.since,
              evidence:'observed-not-causal-proof'});
        }
      }
      // Release a genuinely idle operation after a bounded default timeout.
      // The experiment may replan sooner, but neither mode abandons an
      // observed active war or an endangered home merely to change targets.
      const stallAfter=opts.impossibleExperiment?440:900;
      const stall=!reason&&
        tick-(operation.lastProgressTick??operation.since)>stallAfter&&
        !s.out.some(a=>!a.retreating&&
          attackTargets(a.targetID,operation.target))&&
        !s.activeEnemy&&!pendingAttack&&s.incoming===0;
      if(reason||stall){
        const finishedReason=reason||(stall?'Operation ohne beobachteten Fortschritt':null);
        if(stall||reason==='Truppenbudget ausgeschöpft')
          operationCooldown.set(operation.target,tick+160);
        decisionNote('operation','Operation '+operation.type+' beendet: '+finishedReason,
          ['Nächste sichere Gelegenheit neu prüfen'],tick);
        operation=null;
      }
    }
    if(operation&&duoPlan?.joint&&operation.target!==duoPlan.target&&
      s.incoming===0&&!s.activeEnemy&&!pendingAttack&&
      tick-lastEnemySend>80){
      decisionNote('2v2','Inaktive Operation beendet für gemeinsame Front',[],tick);
      operation=null;
    }
    if(operation||danger||s.available<Math.max(1200,s.home*.09))return operation;
    const eligible=items.filter(x=>x.id!==null&&x.opponent?.isAlive?.()&&
      !friendly(x.opponent,me)&&tick>=(operationCooldown.get(x.id)||0)&&
      (targetOpportunity(me,items,s,x)||
        !!duoJointOpportunity(me,items,s,x,tick,true)));
    const shared=eligible.find(x=>duoPlan?.strikeTick!==null&&
      duoPlan?.target===x.id&&duoJointOpportunity(me,items,s,x,tick,true));
    const locked=eligible.find(x=>x.id===warState.id);
    const ally=eligible.find(x=>duoFocus(me,x.opponent)?.on>0);
    const alert=eligible.find(x=>victoryThreat?.urgent&&
      (victoryThreat.team!==null?x.opponent.team?.()===victoryThreat.team:
        x.id===victoryThreat.id));
    const chosen=locked||alert||shared||ally||
      eligible.sort((a,b)=>number(()=>b.opponent.numTilesOwned(),0)-
        number(()=>a.opponent.numTilesOwned(),0)).slice(0,8).find(x=>{
          const guard=frontRiskPlan(items,s,x.id);
          return Math.min(s.available*.72,guard.safeStrike)>=100;
        });
    if(!chosen)return null;
    const land=number(()=>chosen.opponent.numTilesOwned?.(),0);
    const type=alert?'Sieg verhindern':ally?'Partner entlasten':
      pendingBoat?'Brückenkopf sichern':
      land<=Math.max(250,number(()=>me.numTilesOwned(),0)*.25)?
        'Gegner ausschalten':'Front sichern';
    const guard=frontRiskPlan(items,s,chosen.id);
    const budget=Math.max(0,Math.floor(Math.min(s.available*.72,guard.safeStrike)));
    if(budget<100)return null;
    operation={type,target:chosen.id,targetName:nameOf(chosen.opponent),
      since:tick,until:tick+1100,initialLand:land,
      successLand:type==='Gegner ausschalten'?0:
        Math.max(0,Math.floor(land*.90)),
      budget,spent:0,lastObservedLand:land,lastProgressTick:tick,
      abort:'Verlust des Ziels, Heimatinvasion, Frist oder beobachteter Stillstand'};
    decisionNote('operation',type+' → '+operation.targetName+
      ' · Budget '+budget+' · Ziel ≤ '+operation.successLand+' Felder',
      eligible.filter(x=>x.id!==chosen.id).slice(0,3).map(x=>
        nameOf(x.opponent)+' zurückgestellt: Fokus und Reserveschutz'),tick);
    return operation;
  }

  function checkIncomeAttribution(me,tick){
    for(const sample of incomeAttribution){
      if(sample.finished||tick-sample.tick<120)continue;
      const train=number(()=>me.trainGold?.(),NaN),
        trade=number(()=>me.tradeGold?.(),NaN);
      sample.finished=true;sample.afterTick=tick;
      sample.trainDelta=Number.isFinite(train)&&
        Number.isFinite(sample.beforeTrain)?
        Math.max(0,train-sample.beforeTrain):null;
      sample.tradeDelta=Number.isFinite(trade)&&
        Number.isFinite(sample.beforeTrade)?
        Math.max(0,trade-sample.beforeTrade):null;
      sample.method='interval-income-observation-not-causal';
      telemetry('income_after_build',
        'Bahn-/Schiffseinkommen nach Bau gemessen (keine kausale Zuordnung)',
        {incomeSample:sample});
    }
  }
  function sampleIncome(me,tick){
    const cur={tick,gold:goldAmount(me),
      train:number(()=>me.trainGold?.(),NaN),trade:number(()=>me.tradeGold?.(),NaN)};
    const previous=goldSamples[goldSamples.length-1];
    if(previous&&tick>previous.tick&&tick-previous.tick>=80){
      const rate=(v)=>Number.isFinite(cur[v])&&Number.isFinite(previous[v])?
        Math.max(0,(cur[v]-previous[v])/(tick-previous.tick)*600):null;
      // Gold-stock movement includes purchases, donations and conquest:
      // it is a signed NET change, not gross income (negative != zero).
      const netGold=(cur.gold-previous.gold)/(tick-previous.tick)*600;
      const train=rate('train'),trade=rate('trade');
      incomeStatus={train,trade,gold:netGold,netGold,
        otherNetAfterTradeTrain:
          train!==null&&trade!==null?netGold-train-trade:null,
        // Residual includes spending and other receipts; NEVER assign it
        // to one building or label it as additional earned gold.
        observed:true};
      goldSamples.shift();
    }
    if(!goldSamples.length)goldSamples.push(cur);
    checkIncomeAttribution(me,tick);
  }
  // Look at *where a real player's army is committed*, not only the
  // player's headline troop count. An adversary fighting a third party has a
  // short-lived opening, but this never overrides our other-border reserve.
  function adversaryWindow(me,enemy) {
    if(!enemy || !me || friendly(enemy,me))return {
      elsewhere:0,incomingOthers:0,ratio:0,exposed:false,human:false};
    const home=Math.max(1,number(()=>enemy.troops?.(),0));
    const outgoing=(()=>{try{return enemy.outgoingAttacks?.()||[];}catch(_){return [];}})();
    const incoming=(()=>{try{return enemy.incomingAttacks?.()||[];}catch(_){return [];}})();
    const elsewhere=outgoing.filter(a=>!a.retreating && !attackTargets(a.targetID,me))
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    const incomingOthers=incoming.filter(a=>!a.retreating && !attackTargets(a.attackerID,me))
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    const ratio=elsewhere/home,underPressure=incomingOthers/home;
    return {elsewhere,incomingOthers,ratio,home,
      exposed:ratio>=.45 || underPressure>=.40,
      human:enemy.type?.()==='HUMAN'};
  }
  // Track visible troop/land trajectories. Only sustained third-party wars
  // justify a narrower opportunity window; snapshots never override legality.
  function observeOpponents(me,tick){
    for(const enemy of game.playerViews?.()||[]){
      const id=safeID(enemy);
      if(id===null||id===safeID(me)||!enemy.isAlive?.()||friendly(enemy,me))continue;
      const old=opponentHistory.get(id);
      const troops=Math.max(0,number(()=>enemy.troops(),0));
      const land=Math.max(0,number(()=>enemy.numTilesOwned(),0));
      const window=adversaryWindow(me,enemy);
      const exposed=window.exposed &&
        (window.elsewhere>=Math.max(500,window.home*.45) ||
         window.incomingOthers>=Math.max(500,window.home*.40));
      const since=exposed?(old?.exposedSince??tick):null;
      const resample=!old||tick-old.tick>=90;
      const previous=old&&resample?{tick:old.tick,troops:old.troops,land:old.land}:
        old?.previous||null;
      // Retain only actual, time-stamped observations: no guessed opponent
      // movement, no cross-match names, and a fixed per-opponent memory bound.
      const samples=(old?.samples||[]).filter(x=>tick>=x.tick&&tick-x.tick<=450);
      if(!samples.length||tick-samples[samples.length-1].tick>=80)
        samples.push({tick,troops,land});
      opponentHistory.set(id,{tick:resample?tick:old.tick,
        troops:resample?troops:old.troops,
        land:resample?land:old.land,previous,exposedSince:since,
        observedTick:tick,samples:samples.slice(-7)});
    }
    for(const [id,v] of opponentHistory)
      if(tick-v.observedTick>360)opponentHistory.delete(id);
    if(opponentHistory.size>64)
      for(const [id] of [...opponentHistory].sort((a,b)=>a[1].observedTick-b[1].observedTick)
        .slice(0,opponentHistory.size-64))opponentHistory.delete(id);
  }
  function opponentWindows(enemy,tick=number(()=>game.ticks(),0)){
    const record=opponentHistory.get(safeID(enemy));
    const empty=()=>Object.freeze({90:null,180:null,360:null});
    if(!record||tick<record.observedTick||tick-record.observedTick>120)
      return empty();
    const nowTroops=Math.max(0,number(()=>enemy.troops(),0));
    const nowLand=Math.max(0,number(()=>enemy.numTilesOwned(),0));
    const windows={};
    for(const span of [90,180,360]){
      // At least the requested history, at most one sampling interval older.
      // Missing observations remain null rather than fabricated trends.
      const sample=(record.samples||[]).slice().reverse().find(x=>
        tick-x.tick>=span&&tick-x.tick<=span+90);
      windows[span]=sample?Object.freeze({
        observedTicks:tick-sample.tick,
        troopsChange:(nowTroops-sample.troops)/Math.max(1,sample.troops),
        landChange:(nowLand-sample.land)/Math.max(1,sample.land)
      }):null;
    }
    return Object.freeze(windows);
  }
  function opponentTrend(enemy,tick=number(()=>game.ticks(),0)){
    const v=opponentHistory.get(safeID(enemy)),previous=v?.previous;
    if(!v||tick-v.observedTick>120||!previous||
      v.tick-previous.tick<75||v.tick-previous.tick>360)
      return {valid:false,falling:false,growing:false,sustained:false,change:0,landChange:0};
    const change=(v.troops-previous.troops)/Math.max(1,previous.troops);
    const landChange=(v.land-previous.land)/Math.max(1,previous.land);
    return {valid:true,change,landChange,
      falling:change<-.15||landChange<-.08,
      growing:change>.25&&landChange>=0,
      sustained:v.exposedSince!==null&&tick-v.exposedSince>=90};
  }
  function enemyUnderAttack(enemy){
    const own=number(()=>enemy.troops?.(),0);
    const ourSmall=number(()=>myPlayer()?.smallID?.(),-1);
    // Only a third-party assault is an opportunity. Our own attack against
    // this player cannot justify launching another underpriced offensive.
    const incoming=(enemy.incomingAttacks?.()||[]).filter(a=>
      !a.retreating && a.attackerID!==ourSmall)
      .reduce((n,a)=>n+number(()=>a.troops,0),0);
    return own>0 && incoming>=own*.50;
  }
  // An estimate driven by the official pure attackLogic when exposed
  // through the browser config. Not an exact future-tile path simulation.
  function attackForecast(me,item,troops){
    const enemy=item?.opponent,front=item?.tiles||[];
    if(!enemy||!front.length||troops<1)return null;
    const units=enemy.units?.()||[];
    const posts=units.filter(u=>u.type?.()==='Defense Post'&&!u.isUnderConstruction?.());
    const total=number(()=>game.numLandTiles?.(),0),fallout=number(()=>game.numTilesWithFallout?.(),0);
    let loss=0,time=0,count=0,engine=false;
    for(const tile of front.slice(0,12)){
      try{
        const mag=number(()=>game.terrainType(tile),0);
        const covered=posts.some(u=>{
          const dx=game.x(tile)-game.x(u.tile()),dy=game.y(tile)-game.y(u.tile());
          const radius=number(()=>game.config().defensePostRange?.(),30);
          return dx*dx+dy*dy<=radius*radius;
        });
        const result=game.config().attackLogic?.({
          terrain:mag,attackTroops:troops,
          attacker:{type:me.type?.()||'HUMAN',numTiles:Math.max(1,number(()=>me.numTilesOwned(),1))},
          defender:{type:enemy.type?.()||'NATION',numTiles:Math.max(1,number(()=>enemy.numTilesOwned(),1)),
            troops:number(()=>enemy.troops(),0),isTraitor:!!enemy.isTraitor?.(),
            isDisconnectedTeammate:false},
          defenderHasDefensePost:covered,
          falloutRatio:game.hasFallout?.(tile)&&total>0?fallout/total:null,
          borderSize:Math.max(1,item.front||1)
        });
        const fallback=({0:80,1:100,2:120})[mag]||100;
        const rough=(fallback/5)*(1+number(()=>enemy.troops(),0)/
          Math.max(1,number(()=>enemy.numTilesOwned(),1))*.07)*(covered?1.5:1)*
          Math.min(2,Math.max(.6,number(()=>enemy.troops(),0)/troops));
        const tileLoss=number(()=>result?.attackerTroopLoss,rough);
        loss+=Math.max(0,tileLoss);time+=number(()=>result?.tickFraction,1);
        engine=engine||Number.isFinite(result?.attackerTroopLoss);count++;
      }catch(_){}
    }
    if(!count)return null;
    strategicTelemetry.forecastCount++;
    if(engine)strategicTelemetry.engineForecasts++;
    else{
      strategicTelemetry.proxyForecasts++;
      if(!strategicTelemetry.forecastUnavailable++){
        telemetry('forecast_engine_unavailable',
          'Browser-Config liefert keinen gültigen attackLogic-Verlustwert; Näherung verwendet',
          {exposed:typeof game?.config?.().attackLogic==='function'});
      }
    }
    const sampleTiles=Math.min(80,Math.max(1,number(()=>enemy.numTilesOwned(),1)*.15));
    return {loss:loss/count*sampleTiles,time:time/count*sampleTiles,
      sample:count,engine,method:engine?'config.attackLogic':'rough-proxy'};
  }
  function targetsFromBorder(me,tiles) {
    const groups=new Map(), scratch=[], fallout=[], cap=2000;
    const stride=Math.max(1,Math.ceil(tiles.length/cap));
    const offset=borderOffset%stride;
    const ownID=safeID(me);
    for(let i=offset;i<tiles.length;i+=stride){
      const t=tiles[i];scratch.length=0;
      const count=game.neighbors4(t,scratch);
      for(let j=0;j<count;j++){
        const ref=scratch[j];
        if(!game.isLand(ref)||game.isImpassable(ref))continue;
        const opponent=game.owner(ref),id=safeID(opponent);
        if(id===null && game.hasFallout?.(ref)){
          strategicTelemetry.falloutSkipped++;
          if(!fallout.includes(ref)&&fallout.length<80)fallout.push(ref);
          continue;
        }
        if(id===ownID||(id!==null&&friendly(opponent,me)))continue;
        let g=groups.get(id);
        if(!g){g={id,opponent:id===null?null:opponent,tiles:[],front:0};groups.set(id,g);}
        g.front++;
        // Spread action probes across different local frontiers, not just the
        // first eight cells of a broad border that may all be blocked.
        if(g.tiles.length<20 && !g.tiles.includes(ref))g.tiles.push(ref);
        else if(g.tiles.length===20 && g.front%23===0)g.tiles[(g.front/23|0)%20]=ref;
      }
    }
    // The official AI prefers clean land, then falls back to nuked TN if
    // no clean neutral border remains. Do not make fallout a free land bonus.
    if(!groups.has(null)&&fallout.length){
      groups.set(null,{id:null,opponent:null,tiles:fallout.slice(0,20),
        front:fallout.length,fallout:true});
      strategicTelemetry.falloutFallback++;
    }
    return [...groups.values()];
  }
  // Unlike v1.2, use ALL troop commitments and incoming attacks. Home troops
  // alone are misleading: 5K at home with 20K already attacking is not 5K idle.
  function lateGame(me) {
    if(!opts.lateOffense)return false;
    const tick=number(()=>game?.ticks?.(),0),land=number(()=>me?.numTilesOwned?.(),0);
    return (tick>=1800 && land>=1000) || (tick>=3300 && land>=500);
  }
  // Recruitment slows near troop cap. Spend only a genuinely safe surplus:
  // incoming attacks and significant neighboring armies veto growth spending.
  function growthPressure(s) {
    return s.ratio>.74 && s.incoming===0 && s.activeEnemy===0 &&
      s.strongest<s.home*.70;
  }
  function exposedOpeningRisk(s){return s.incoming>s.home*.025 || s.strongest>s.home*.85;}
  function neutralAttackAmount(s,aggression) {
    const base=Math.max(130,s.home*(hardMode()?(.055+aggression*.035):(.09+aggression*.08)));
    const surplus=growthPressure(s)?Math.max(0,s.home-s.max*.48)*.46:0;
    const opening=number(()=>game?.ticks?.(),Infinity)<1000 && !exposedOpeningRisk(s);
    const fraction=growthPressure(s)?(hardMode()?.49:.55):opening?(hardMode()?.44:.68):(hardMode()?.31:.55);
    const exposed=s.strongest>=s.home*.85||s.incoming>=s.home*.10;
    // Cheap expansion may continue near a strong rival, but never consume
    // a third of the army immediately before a probable counterattack.
    const safeBudget=hardMode()&&exposed?
      Math.min(s.available*.14,s.home*.025):s.available*fraction;
    const amount=Math.min(safeBudget,Math.max(base,surplus));
    return Math.floor(Math.min(safeBudget,amount*
      (1+neuralChannel('neutralCommit',myPlayer(),s)*.35)));
  }
  // An alliance, team change or elimination invalidates a remembered threat
  // immediately, including when a border scan is temporarily missing.
  function pruneFrontMemory(me){
    if(typeof game?.playerViews!=='function')return;
    const players=new Map((game.playerViews()||[]).map(p=>[safeID(p),p]));
    for(const id of frontMemory.keys()){
      const p=players.get(id);
      if(!p?.isAlive?.()||friendly(p,me)||me.isOnSameTeam?.(p))
        frontMemory.delete(id);
    }
  }
  // A vanished front is remembered briefly, never treated as a current
  // 240-tick enemy peak. Current observed armies retain full priority.
  function rememberedFrontStrength(id,tick,observed=0){
    const old=frontMemory.get(id);
    if(!old)return observed;
    const age=Math.max(0,tick-old.lastTick);
    const tail=age>=90?0:old.peak*.72*(1-age/90);
    return Math.max(observed,tail);
  }
  // Retain short-lived border pressure across transient missing border scans.
  function observeFronts(me,items,tick){
    // Human multiplayer pressure must not disappear merely because native
    // Nation difficulty is Medium/Hard. Impossible keeps its existing logic.
    pruneFrontMemory(me);
    if(!hardMode()&&!multiplayerMatch(game)){frontMemory.clear();return;}
    for(const item of items){
      if(item.id===null||!item.opponent?.isAlive?.()||friendly(item.opponent,me)||
        me.isOnSameTeam?.(item.opponent)){
        if(item.id!==null)frontMemory.delete(item.id);
        continue;
      }
      const troops=Math.max(0,number(()=>item.opponent.troops(),0));
      const old=frontMemory.get(item.id);
      frontMemory.set(item.id,{troops,lastTick:tick,
        peak:old&&tick-old.lastTick<=180?Math.max(troops,old.peak*.94):troops,
        land:number(()=>item.opponent.numTilesOwned(),0)});
    }
    for(const [id,value] of frontMemory)
      if(tick-value.lastTick>360)frontMemory.delete(id);
    if(frontMemory.size>40){
      const ordered=[...frontMemory].sort((a,b)=>a[1].lastTick-b[1].lastTick);
      for(const [id] of ordered.slice(0,frontMemory.size-40))frontMemory.delete(id);
    }
  }
  // Predict immediate pressure from observable fronts and recent own losses.
  // This is a conservative safety envelope, NOT a claim about hidden armies.
  function frontPressureForecast(me,items=[],tick=number(()=>game?.ticks?.(),0)) {
    const home=Math.max(1,number(()=>me?.troops?.(),1));
    const fronts=items.filter(g=>g.id!==null&&g.opponent?.isAlive?.()&&
      !friendly(g.opponent,me)).map(g=>{
      const now=Math.max(0,number(()=>g.opponent.troops(),0));
      const prior=frontMemory.get(g.id);
      const recent=rememberedFrontStrength(g.id,tick,now);
      return {id:g.id,troops:recent};
    }).sort((a,b)=>b.troops-a.troops);
    const primary=fronts[0]?.troops||0,secondary=fronts[1]?.troops||0;
    const trend=armyTrend(tick),lost=trend&&trend.ticks>=80?
      Math.max(0,-trend.tiles):0;
    const incoming=(me?.incomingAttacks?.()||[]).filter(a=>!a.retreating)
      .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    const combined=primary+Math.min(secondary*.35,home*.4);
    const risk=Math.max(incoming/home,combined/home*(lost>100?1.15:1));
    return {primary,secondary,combined,incoming,lost,risk,
      pressured:incoming>home*.10 || (lost>100&&combined>home*.65)};
  }
  function military(me,items=[]) {
    const home=number(()=>me.troops());
    // Singleplayer's native infinite-troops option reports an artificial
    // 1-billion troop cap. Using it for the recovery ratio would make the
    // bot wait forever even while it can safely expand.
    const infiniteTroops=game.config().infiniteTroops?.()===true;
    const rawMax=Math.max(1,number(()=>game.config().maxTroops(me),home||1));
    const max=infiniteTroops?Math.max(1,home*1.35):rawMax;
    const out=(me.outgoingAttacks?.()||[]).filter(a=>!a.retreating&&a.troops>0);
    const inc=(me.incomingAttacks?.()||[]).filter(a=>!a.retreating&&a.troops>0);
    const committed=out.reduce((sum,a)=>sum+a.troops,0);
    const incoming=inc.reduce((sum,a)=>sum+a.troops,0);
    pruneFrontMemory(me);
    const hostile=items.filter(t=>t.id!==null && t.opponent?.isAlive?.() &&
      !friendly(t.opponent,me) && !me.isOnSameTeam?.(t.opponent));
    const tick=number(()=>game?.ticks?.(),0);
    const historical=[...frontMemory].reduce((v,[id,x])=>
      Math.max(v,rememberedFrontStrength(id,tick)),0);
    const strongest=Math.max(historical,
      hostile.reduce((v,t)=>Math.max(v,number(()=>t.opponent.troops())),0));
    const ratio=home/max;
    const adaptiveOffset=opts.autoStrategy?(strategic.mode==='RECOVER'||strategic.mode==='DEFEND'?8:
      strategic.mode==='EXPAND'&&!incoming&&!strongest?-5:0):0;
    const late=lateGame(me);
    const lateReduction=late && opts.lateOffense && !incoming && strongest<home*.65 ? (hardMode()?16:12) : 0;
    const growthRelease=ratio>.82&&!incoming&&strongest<home*.70&&!out.length?7:0;
    const baseline=home*clamp(setting('reserve')+adaptiveOffset-lateReduction-growthRelease,12,75)/100;
    // Hold meaningful troops while a larger neighbor or incoming offensive exists.
    // On Impossible, preserve a force against the largest OTHER neighbor even
    // while crushing our chosen target. Avoid permanent paralysis from maxTroops.
    const policyReserve=neuralChannel('reserve',me,{home,max,committed,incoming,strongest,ratio,
      available:Math.max(0,home-baseline)},tick);
    const policyBaseline=home*clamp(baseline/home*100+policyReserve*8,12,75)/100;
    // Publish each independently computed floor. High reserve with zero
    // incoming is often explained by a far larger bordering army.
    const activePressure=incoming>0||recentHostilePressure(tick,140)||
      !!(crisisTrend&&tick<crisisTrend.expires);
    const borderFloor=strongest>0?
      Math.min(home*(activePressure?.85:.63),strongest*(hardMode()?.59:.53)):0;
    const incomingFloor=incoming>0?Math.min(home*.94,incoming*1.3):0;
    const capFloor=strongest>0?
      Math.min(home*(activePressure?.78:.58),max*(hardMode()?.12:.14)):0;
    const defensiveFloor=Math.max(policyBaseline,borderFloor,incomingFloor,capFloor);
    const context=matchContext(me);
    const predicted=(hardMode()||context.multiplayer)?
      frontPressureForecast(me,items,tick):null;
    // Existing experimental Impossible coefficients remain opt-in. Public/
    // Private receive a narrower safety floor only when visible pressure or
    // own land loss exists; simple peaceful adjacency cannot trigger it.
    const forecastEnabled=(hardMode()&&opts.impossibleExperiment)||context.multiplayer;
    const forecastFloor=forecastEnabled&&predicted&&predicted.pressured?
      Math.min(home*(context.multiplayer?.88:.91),
        predicted.combined*(context.multiplayer?.52:.60)+incoming*.30):0;
    // Profiles only RAISE a border reserve, never relax the safety floor.
    const observedRaider=hostile.some(x=>{
      const p=opponentProfiles.get(x.id);
      return p?.profile==='Früher Angreifer'&&p.confidence>=.45;
    });
    const profileFloor=observedRaider?Math.min(home*.86,policyBaseline+home*.06):0;
    const crisisFloor=crisisTrend&&tick<crisisTrend.expires&&
      (incoming>0||strongest>home*.50)?Math.min(home*.90,home*.12+policyBaseline):0;
    const resolvedReserve=reserveResolutionKernel(home,{policyBaseline,borderFloor,
      incomingFloor,capFloor,forecastFloor,profileFloor,crisisFloor});
    const reserve=resolvedReserve.reserve,available=resolvedReserve.available;
    const total=home+committed;
    const activeEnemy=out.filter(a=>a.targetID!==0 && a.targetID!==null).length;
    const activeNeutral=out.filter(a=>a.targetID===0||a.targetID===null).length;
    const reserveFloors={ruleBaseline:baseline,neuralAdjustment:policyBaseline-baseline,
      policyBaseline,borderFloor,incomingFloor,capFloor,forecastFloor,
      profileFloor,crisisFloor,winningFloor:reserve};
    const reserveReason=resolvedReserve.reserveReason;
    return {home,max,committed,incoming,strongest,ratio,reserve,available,total,
      reserveFloors,reserveReason,reserveShare:home>0?reserve/home:0,
      growthPotential:Math.max(0,(10+Math.pow(home,.73)/4)*(1-ratio)),
      out,inc,activeEnemy,activeNeutral};
  }
  // Incoming stacks often disappear briefly between waves. Remember material
  // pressure so the bot cannot declare the coast clear and launch a large
  // offensive a few seconds after surviving an attack.
  function rememberHostilePressure(s,tick){
    const trend=armyTrend(tick);
    const unexpectedLoss=(hardMode()||multiplayerMatch(game)) &&
      s.strongest>s.home*.70 && trend && trend.ticks>=100 &&
      trend.tiles< -Math.max(140,s.home*.001);
    if(s.incoming>=Math.max(1200,Math.max(1,s.home)*.08)||unexpectedLoss){
      if(unexpectedLoss && tick-lastFrontWarning>150){
        lastFrontWarning=tick;
        telemetry('front_loss_warning','Gebietsverlust neben starkem Nachbarn: Wiederaufbau schützen',
          {lostTiles:trend.tiles,strongest:s.strongest,home:s.home});
      }
      lastHostilePressure=tick;
    }
    return tick-lastHostilePressure<220;
  }
  function recentHostilePressure(tick,window=220){
    return tick-lastHostilePressure<window;
  }
  // Correlation is evidence of a likely bot command, never proof of authorship.
  // In particular, an adopted outgoing attack can also originate elsewhere.
  function observeAttackOrigins(me,tick){
    const active=(me.outgoingAttacks?.()||[]).filter(a=>!a.retreating&&a.troops>0);
    const liveIds=new Set(active.map(a=>a.id));
    for(const id of observedAttacks.keys())if(!liveIds.has(id))observedAttacks.delete(id);
    const fresh=active.filter(a=>a.id!=null&&!observedAttacks.has(a.id));
    const matches=a=>attackCommands.filter(c=>c.matchedStack===null&&
      tick>=c.tick&&tick-c.tick<=120&&c.target===attackTargetID(a.targetID)&&
      !c.beforeIds.includes(a.id)&&c.amount>0&&a.troops<=c.amount*1.1);
    const candidates=new Map(fresh.map(a=>[a.id,matches(a)]));
    for(const a of fresh){
      const target=attackTargetID(a.targetID),possible=candidates.get(a.id);
      const command=possible.length===1&&fresh.filter(other=>
        candidates.get(other.id).includes(possible[0])).length===1?possible[0]:null;
      if(command)command.matchedStack=a.id;
      const observation={attackId:a.id,target,amount:a.troops,observedTick:tick,
        source:command?'correlated-bot-command':'unattributed',
        commandId:command?.commandId??null,
        evidence:command?'target-time-amount-correlation':'no-unique-command-match'};
      observedAttacks.set(a.id,observation);
      telemetry('attack_origin',command?'Angriff mit Bot-Befehl korreliert':'Angriffsherkunft ungeklärt',observation);
    }
  }
  function sampleTroops(tick,me) {
    if(troopSamples.length && tick<=troopSamples[troopSamples.length-1].tick)return;
    troopSamples.push({tick,home:number(()=>me.troops()),tiles:number(()=>me.numTilesOwned()),
      incoming:(me.incomingAttacks?.()||[]).filter(a=>!a.retreating&&a.troops>0)
        .reduce((sum,a)=>sum+a.troops,0),
      assets:ownStructures(me).filter(u=>['City','Factory','Port','Missile Silo'].includes(u.type?.()))
        .map(u=>u.id?.()??u.type()+':'+u.tile?.())});
    while(troopSamples.length>2&&tick-troopSamples[0].tick>900)troopSamples.shift();
    earlyCrisis(me,tick);
  }
  // Compare against a RECENT prior observation, not an all-time peak:
  // ancient expansion cannot permanently force defensive mode.
  function earlyCrisis(me,tick){
    const latest=troopSamples[troopSamples.length-1];
    const prior=[...troopSamples].reverse().find(v=>
      tick-v.tick>=100&&tick-v.tick<=360);
    if(!latest||!prior){
      if(crisisTrend&&tick>=crisisTrend.expires)crisisTrend=null;
      return crisisTrend;
    }
    const lostLand=Math.max(0,prior.tiles-latest.tiles);
    const lostAssets=prior.assets.filter(id=>!latest.assets.includes(id)).length;
    const material=lostLand>=Math.max(180,prior.tiles*.045)||lostAssets>=2||
      (lostAssets>=1&&lostLand>=Math.max(70,prior.tiles*.02));
    if(material){
      crisisTrend={tick,referenceTick:prior.tick,lostLand,lostAssets,
        land:latest.tiles,home:latest.home,
        incoming:latest.incoming,expires:tick+180};
      if(tick-lastCrisisReport>=120){
        lastCrisisReport=tick;
        telemetry('crisis_early_warning',
          'Früher Verlusttrend vor Zusammenbruch der Heimat',
          {crisis:crisisTrend,evidence:'observed-land-and-owned-structure-change'});
        decisionNote('fruehwarnung',
          'Landverlust '+lostLand+', Gebäude verloren '+lostAssets,
          ['Reserve und Verteidigung neu prüfen','Keine neue riskante Seeoffensive'],tick);
      }
    }else if(crisisTrend&&tick>=crisisTrend.expires)crisisTrend=null;
    return crisisTrend;
  }
  function armyTrend(tick) {
    const latest=troopSamples[troopSamples.length-1], earliest=troopSamples[0];
    if(!latest||!earliest||latest.tick-earliest.tick<80)return null;
    return {home:latest.home-earliest.home,tiles:latest.tiles-earliest.tiles,
      ticks:latest.tick-earliest.tick};
  }
  function evaluateLastBattle(tick,me) {
    if(!lastBattle || tick-lastBattle.tick<110)return;
    const record=lastBattle;
    // Only estimate stack attrition from an observed matching outgoing attack.
    // Never turn a disappeared stack into an asserted troop-loss number.
    const stacks=(me.outgoingAttacks?.()||[]).filter(a=>
      attackTargets(a.targetID,record.id)&&!a.retreating);
    if(stacks.length){
      const total=stacks.reduce((n,a)=>n+number(()=>a.troops,0),0);
      record.minimumObservedStack=Math.min(record.minimumObservedStack??Infinity,total);
    }
    const opponent=game.playerViews().find(p=>safeID(p)===record.id);
    if(!opponent || !opponent.isAlive?.()){lastBattle=null;return;}
    const active=(me.outgoingAttacks?.()||[]).some(a=>attackTargets(a.targetID,record.id)&&!a.retreating);
    // Don't attribute other battles, recruitment or construction to this war.
    // Evaluate only after the offensive ends or after a long front stalemate.
    if(active && tick-record.tick<620)return;
    const enemyLand=number(()=>opponent.numTilesOwned());
    const ownLand=number(()=>me.numTilesOwned());
    const captured=enemyLand<record.enemyLand && ownLand>record.ownLand;
    const stalled=!captured && enemyLand>=record.enemyLand*.99 &&
      ownLand<=record.ownLand && tick-record.tick>=260;
    if(captured){
      attackReceipts.territoryGained++;
      telemetry('war_progress','Gebietsgewinn gegen '+record.name,{enemyLandBefore:record.enemyLand,
        enemyLandAfter:enemyLand,ownLandBefore:record.ownLand,ownLandAfter:ownLand});
    } else if(stalled){
      blockedTargets.set(record.id,tick+(hardMode()?330:180));
      if(warState.id===record.id){warState.blockedUntil=tick+330;
        log('FRONT PAUSE: '+record.name+' · kein messbarer Gebietsgewinn');}
      telemetry('war_stall','Offensive ohne messbaren Gebietsgewinn',
        {enemyLandBefore:record.enemyLand,enemyLandAfter:enemyLand,
        ownLandBefore:record.ownLand,ownLandAfter:ownLand});
    } else telemetry('war_review','Ausgang nicht eindeutig: '+record.name,
      {enemyLandBefore:record.enemyLand,enemyLandAfter:enemyLand});
    if(record.forecast){
      const approxLoss=Number.isFinite(record.minimumObservedStack)?
        Math.max(0,record.amount-record.minimumObservedStack):null;
      const audit={tick,target:record.id,engine:record.forecast.engine,
        predictedLoss:record.forecast.loss,observedStackAttrition:approxLoss,
        evidence:approxLoss===null?'no-active-stack-sample':
          'outgoing-stack-net-change-not-causal',landGained:captured,
        observedTicks:tick-record.tick};
      forecastAudits.push(audit);if(forecastAudits.length>75)forecastAudits.shift();
      lastForecastAudit=audit;strategicTelemetry.forecastComparisons++;
      telemetry('forecast_audit','Angriffsprognose gegenüber sichtbarer Stack-Abnahme',
        {audit});
    }
    telemetry('attack_outcome_observed','Angriffsfenster nachträglich verglichen',{
      actionId:record.actionId??null,target:record.id,
      sentTick:record.tick,observedTick:tick,
      ownLandBefore:record.ownLand,ownLandAfter:ownLand,
      defenderLandBefore:record.enemyLand,defenderLandAfter:enemyLand,
      observedOutcome:captured?'territory-changed':
        stalled?'no-progress-observed':'unknown',
      attribution:'front-observation-not-causal-attack-result'});
    lastBattle=null;
  }
  function confirmAttack(me,tick){
    if(!pendingAttack)return;
    const p=pendingAttack;
    const out=(me.outgoingAttacks?.()||[]).filter(a=>!a.retreating && attackTargets(a.targetID,p.id));
    const newStack=out.some(a=>!p.beforeIds.includes(a.id)) ||
      out.reduce((sum,a)=>sum+a.troops,0)>p.beforeTroops+p.amount*.18;
    // A gain against neutral land must not falsely confirm an unrelated
    // player attack; require target-specific territory change for war.
    const landChanged=p.id===null ? number(()=>me.numTilesOwned())>p.ownLand :
      (number(()=>me.numTilesOwned())>p.ownLand &&
        game.playerViews().some(e=>safeID(e)===p.id &&
          number(()=>e.numTilesOwned())<p.enemyLand));
    if(newStack||landChanged){
      attackReceipts.confirmed++;
      telemetry('attack_confirmed','Angriff im Spielzustand erkannt: '+p.name,
        {actionId:p.actionId??null,target:p.id,troops:p.amount,
          ownLandBefore:p.ownLand,
          ownLandAtObservation:number(()=>me.numTilesOwned(),null),
          defenderLandBefore:p.enemyLand,
          defenderLandAtObservation:p.id===null?null:
            number(()=>game.playerViews().find(v=>safeID(v)===p.id)?.numTilesOwned?.(),null),
          observedStacks:out.map(a=>({id:a.id,troops:a.troops,
            targetID:a.targetID})),
          via:newStack?'active_stack':'territory',
          arrivalTick:null,arrivalEvidence:'not-exposed-in-attack-view',
          evidence:'observed-change-not-causal-proof'});
      if(p.id!==null){
        lastBattle={actionId:p.actionId??null,id:p.id,name:p.name,tick:p.tick,
          enemyLand:p.enemyLand,ownLand:p.ownLand,
          forecast:p.forecast||null,amount:p.amount,minimumObservedStack:null};
        if(coordinatedWar()&&warState.id===null){
          warState={id:p.id,name:p.name,since:tick,blockedUntil:-Infinity,
            origin:'confirmed-land-attack'};
          log('HAUPTKRIEGSZIEL BESTÄTIGT → '+p.name);
        }
      }
      pendingAttack=null;return;
    }
    // Terra-nullius expansion may complete between browser ticks; do not
    // declare a failed command without allowing the map to update.
    if(tick-p.tick<85)return;
    attackReceipts.unconfirmed++;
    telemetry('attack_unconfirmed','Kein Angriff/kein Gebiet nach Intent: '+p.name,
      {actionId:p.actionId??null,target:p.id,troops:p.amount,
        evidence:'unobserved-within-window'});
    log('ANGRIFF NICHT BESTÄTIGT: '+p.name+' · Ziel neu prüfen');
    blockedTargets.set(p.id,tick+90);
    if(warState.id===p.id && !out.length){
      warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};plan=null;
    }
    pendingAttack=null;
  }
  // State selection uses hysteresis: don't alternate between expansion and
  // economy every 400 ms merely because the troop ratio moved by 1%.
  function effectivePlan() {
    if(!opts.autoStrategy)return opts.plan;
    return strategic.mode==='ASSAULT'?'Blitz':strategic.mode==='ECONOMY'||strategic.mode==='RECOVER'?'Ökonomie':'Adaptiv';
  }
  function effectiveBuildStyle() {
    if(!opts.autoStrategy)return opts.buildStyle;
    return strategic.buildStyle;
  }
  // War director. A target lock stops the previous bot opening five fronts
  // in the first two minutes. All own outgoing attacks and incoming threats
  // are examined before committing to a new enemy.
  function manageWar(me,items,s,tick) {
    if(!coordinatedWar())return;
    if(pendingAttack && pendingAttack.id!==null)return;
    const foes=items.filter(x=>x.id!==null && x.opponent?.isAlive?.());
    const active=s.out.filter(a=>a.targetID!==null&&a.targetID!==0 && !a.retreating);
    if(warState.id!==null) {
      const original=game.playerViews().find(p=>safeID(p)===warState.id);
      if(!original?.isAlive?.() || friendly(original,me)) {
        log('KRIEGSZIEL ERLEDIGT: '+warState.name);
        warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};plan=null;
      } else if(tick<warState.blockedUntil) {
        // An inactive stalled war should not hold the entire nation hostage
        // while a different independently safe opportunity is available.
        const alternatives=foes.filter(x=>x.id!==warState.id&&
          targetOpportunity(me,items,s,x));
        // In Public/Private an observed, independently safe alternative
        // releases a stalled target even without the Impossible experiment.
        // Never open two fronts while a stack is still fighting or HOME is hit.
        if((opts.impossibleExperiment||!hardMode()) &&
          !active.some(a=>attackTargets(a.targetID,warState.id))&&
          tick-lastEnemySend>(hardMode()?110:260)&&alternatives.length&&
          s.incoming===0&&!recentHostilePressure(tick)){
          blockedTargets.set(warState.id,Math.max(warState.blockedUntil,tick+160));
          telemetry('war_replan','Festgefahrene Front freigegeben',
            {oldTarget:warState.id,warLockOrigin:warState.origin??'unknown',
              heldTicks:tick-warState.since,
              alternatives:alternatives.map(x=>x.id)});
          warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};plan=null;
        } else strategic.reason='Front nach Verlusten stabilisieren';
      } else if(!active.some(a=>attackTargets(a.targetID,warState.id)) &&
        ((tick-warState.since>550 && !foes.some(x=>x.id===warState.id)) ||
         (tick-warState.since>850 && tick-lastEnemySend>280 && s.incoming===0))) {
        // A once-successful war lock must not paralyze the bot forever after
        // its target becomes unreachable or too costly; allow a new front review.
        log('KRIEGSZIEL NEU BEWERTEN: '+warState.name);
        blockedTargets.set(warState.id,tick+200);lastWarReview=tick;
        warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};plan=null;
      }
    }
    // A mutually reachable joint front may replace an idle solo lock.
    // Do not replan while own stacks are out or an invasion is active.
    const shared=duoPlan?.joint&&items.find(x=>x.id===duoPlan.target);
    if(shared&&warState.id!==null&&warState.id!==shared.id&&
      !active.length&&!pendingAttack&&s.incoming===0&&
      !recentHostilePressure(tick)&&tick-lastEnemySend>80&&
      duoJointOpportunity(me,items,s,shared,tick)){
      decisionNote('2v2','Inaktive Solofront freigegeben für Duo-Ziel '+
        nameOf(shared.opponent),[],tick);
      warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};
      plan=null;
      if(operation?.target!==shared.id)operation=null;
    }
    // Two independent ranked clients can converge on a teammate's observed
    // live attack. Release an idle stale solo target lock, not an own active
    // attack or the worker/reserve checks used to authorize a new one.
    const duo=rankedDuo(me);
    if(duo&&warState.id!==null&&!active.length&&
      !(pendingAttack&&pendingAttack.id!==null)){
      const focus=duo.enemies.map(p=>({p,...duoFocus(me,p)}))
        .filter(x=>x.on>0).sort((a,b)=>b.on-a.on)[0];
      if(focus&&safeID(focus.p)!==warState.id&&
        tick-lastEnemySend>80){
        telemetry('duo_war_replan','Rangliste 2v2: inaktive Solofront zugunsten beobachteter Partnerfront freigegeben',
          {old:warState.id,partner:duo.partnerID,
            target:safeID(focus.p),partnerTroops:focus.on});
        warState={id:null,name:'—',since:tick,blockedUntil:-Infinity};
        plan=null;
      }
    }
    if(warState.id===null && active.length) {
      const a=active.sort((a,b)=>b.troops-a.troops)[0],p=attackTargetPlayer(a.targetID);
      if(p){warState={id:safeID(p),name:nameOf(p),since:tick,blockedUntil:-Infinity,
          origin:'observed-active-land-stack'};
        log('KRIEGSZIEL ÜBERNOMMEN: '+warState.name);}
    }
  }
  // Local target intelligence estimates reachable infrastructure and exposed
  // Defense Posts; the actual legality and combat outcome stay engine-owned.
  function targetEconomics(item,tick=number(()=>game.ticks(),0)) {
    const key=String(item.id),cached=targetIntelCache.get(key);
    if(cached && tick-cached.tick<24)return cached.value;
    const enemy=item.opponent,front=item.tiles||[];
    let units=[];
    try{units=enemy?.units?.()||[];}catch(_){}
    let prize=0,posts=0;
    for(const u of units.slice(0,100)){
      try{
        if(u.isActive?.()===false || !front.length)continue;
        const tile=u.tile?.();if(!Number.isInteger(tile))continue;
        const x=game.x(tile),y=game.y(tile);
        const near=front.some(t=>{const dx=x-game.x(t),dy=y-game.y(t);return dx*dx+dy*dy<=100*100;});
        if(!near)continue;
        const type=u.type?.(),level=Math.max(1,number(()=>u.level?.(),1));
        if(type==='City')prize+=5*level;
        else if(type==='Factory')prize+=6*level;
        else if(type==='Port')prize+=3*level;
        else if(type==='Defense Post' &&
          front.some(t=>{const dx=x-game.x(t),dy=y-game.y(t);return dx*dx+dy*dy<=35*35;}))posts++;
      }catch(_){}
    }
    const density=number(()=>enemy?.troops?.(),0)/Math.max(100,number(()=>enemy?.numTilesOwned?.(),0));
    const value={prize,posts,density};
    if(targetIntelCache.size>100)targetIntelCache.clear();
    targetIntelCache.set(key,{tick,value});
    return value;
  }
  // Compare the specific attack target with the OTHER neighboring threats.
  // A larger unrelated neighbor alone must not freeze every weak-front attack;
  // however the home force after the strike still must cover that neighbor.
  // AFK players can reconnect. Adjust only the opportunity ratio; the home
  // floor, other-front reserve and worker legality checks stay mandatory.
  function enemyOpportunityRatio(enemy,late,home,blitz=false){
    const normal=hardMode()?(late?1.34:1.75):
      (late?1.18:blitz?1.30:1.55);
    const learned=1-neuralChannel('warThreshold',myPlayer())*.12;
    if(enemyUnderAttack(enemy))return (hardMode()?(late?1.12:1.24):1.12)*learned;
    const trend=opponentTrend(enemy);
    if(trend.valid&&trend.sustained&&trend.falling)
      return Math.max(hardMode()?1.23:1.13,normal*.83)*learned;
    // Opportunity in a human FFA: their army is fighting someone else.
    // Never make this a blanket buff for an uncommitted player.
    const opening=adversaryWindow(myPlayer(),enemy);
    if(opening.exposed && opening.ratio>=.45 && opening.human)
      return Math.max(hardMode()?1.23:1.17,normal*.90)*learned;
    if(enemy?.isDisconnected?.()===true &&
      number(()=>enemy.troops(),Infinity)<home*1.2)
      return Math.max(1.15,normal*.86)*learned;
    return normal*learned;
  }
  function targetHomeRatio(enemy,late){
    const normal=hardMode()?(late?1.45:1.85):(late?1.24:1.45);
    const t=opponentTrend(enemy),window=adversaryWindow(myPlayer(),enemy);
    // Only the SPECIFIC target's verified decline can lower the home
    // threshold. Other-front reserve, incoming-defense and worker checks stay.
    return t.valid&&t.sustained&&t.falling&&window.exposed?
      hardMode()?(late?1.26:1.46):(late?1.16:1.32):normal;
  }
  // Ally-target marking is a preference, not an attack authorization.
  function allyAssistTarget(me,enemy){
    if(!enemy || friendly(enemy,me))return false;
    const allies=[...(me.allies?.()||[])];
    for(const teammate of game.playerViews?.()||[]){
      if(teammate!==me && me.isOnSameTeam?.(teammate) &&
        !allies.includes(teammate))allies.push(teammate);
    }
    return allies.some(ally=>ally?.isAlive?.() && friendly(ally,me) &&
      (ally.targets?.()||[]).some(target=>safeID(target)===safeID(enemy)));
  }
  // Attack budget against OTHER fronts, independent of the chosen victim.
  // These checks cannot be bypassed by target scores or AI suggestions.
  function frontRiskPlan(items,s,targetID=null) {
    const me=myPlayer();
    pruneFrontMemory(me);
    const other=items.filter(x=>x.id!==null&&x.id!==targetID&&
      x.opponent?.isAlive?.()&&!friendly(x.opponent,me)&&
      !me.isOnSameTeam?.(x.opponent)).reduce((v,x)=>Math.max(v,
      number(()=>x.opponent.troops(),0)),0);
    const tick=number(()=>game?.ticks?.(),0);
    const remembered=[...frontMemory].reduce((v,[id,x])=>
      id!==targetID&&tick-x.lastTick<=240?
        Math.max(v,x.peak*.72):v,0);
    const otherThreat=Math.max(other,remembered);
    const secondary=items.filter(x=>x.id!==null&&x.id!==targetID&&
      x.opponent?.isAlive?.()&&!friendly(x.opponent,me)&&
      !me.isOnSameTeam?.(x.opponent)).map(x=>number(()=>x.opponent.troops(),0))
      .sort((a,b)=>b-a)[1]||0;
    const combined=otherThreat+Math.min(secondary*.35,s.home*.4);
    const danger=otherThreat>s.home*1.15 ||
      (opts.impossibleExperiment&&hardMode()&&combined>s.home*1.27&&
       (s.incoming>s.home*.04 || (armyTrend(tick)?.tiles||0)< -100));
    const pressure=s.incoming>Math.max(1200,s.home*.08);
    const floor=Math.max(s.reserve,s.incoming*1.3,
      otherThreat>0?Math.min(s.home,otherThreat*(hardMode()?.63:.55)):0,
      opts.impossibleExperiment&&hardMode()&&secondary>0&&
      (s.incoming>s.home*.04 || (armyTrend(tick)?.tiles||0)< -100)?
        Math.min(s.home*.90,combined*.58):0);
    return {other:otherThreat,danger,pressure,floor,
      safeStrike:Math.max(0,Math.floor(s.home-floor)),
      emergency:danger||pressure};
  }
  // Major offensives must be defensible AFTER the army leaves home. The
  // target's remaining force and other observed fronts stay in the budget;
  // this never overrides attack legality, diplomacy or the existing reserve.
  function offensiveCommitment(items,s,item,requested){
    if(item.id===null||requested<Math.max(125000,s.home*.30))
      return {amount:requested,capped:false,reason:'small-attack'};
    const front=frontRiskPlan(items,s,item.id);
    const enemy=Math.max(0,number(()=>item.opponent?.troops?.(),0));
    const floor=Math.max(s.reserve,s.incoming*1.7,
      front.other*(hardMode()?.87:.80),
      Math.min(enemy*.35,s.home*.32));
    const amount=Math.floor(Math.min(requested,Math.max(0,s.home-floor)));
    const joint=duoJointOpportunity(myPlayer(),items,s,item,
      number(()=>game?.ticks?.(),0),true);
    const minimum=joint?Math.max(1000,joint.own*.75,
      joint.needed-joint.ally):Math.max(enemy*.45,
      enemy*(hardMode()?1.16:1.04)-duoBattleCredit(myPlayer(),item.opponent));
    return {amount:amount>=minimum?amount:0,capped:amount<requested,
      floor,other:front.other,minimum,reason:amount<minimum?
        'Verbleibende Truppen reichen nach Risikobegrenzung nicht für den Angriff':
        'Heimschutz nach Großangriff'};
  }
  function targetOpportunityCheck(me,items,s,item) {
    if(!item?.opponent?.isAlive?.()||friendly(item.opponent,me))
      return {ok:false,reason:'dead-or-friendly'};
    const late=lateGame(me);
    let rawTroops;
    try{rawTroops=item.opponent.troops?.();}catch(_){return {ok:false,reason:'unknown-troops'};}
    if(rawTroops===null||rawTroops===undefined)return {ok:false,reason:'unknown-troops'};
    const homeTroops=Number(rawTroops);
    if(!Number.isFinite(homeTroops)||homeTroops<0)return {ok:false,reason:'unknown-troops'};
    // An empty home army is attackable, but deployed enemy forces may return.
    const deployed=(item.opponent.outgoingAttacks?.()||[])
      .filter(a=>!a.retreating).reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
    const troops=homeTroops+deployed;
    if(s.incoming>s.home*(late?.15:.04))return {ok:false,reason:'incoming-attack'};
    if(s.ratio<(late?.29:.40))return {ok:false,reason:'low-home-ratio'};
    const minRatio=enemyOpportunityRatio(item.opponent,late,s.home);
    const credit=duoBattleCredit(me,item.opponent);
    const joint=duoJointOpportunity(me,items,s,item,
      number(()=>game?.ticks?.(),0),true);
    if(!joint&&s.available+credit<troops*minRatio)return {ok:false,reason:'insufficient-available',
      required:Math.ceil(troops*minRatio),available:s.available,credit};
    if(!joint&&s.home+credit<troops*targetHomeRatio(item.opponent,late))
      return {ok:false,reason:'home-versus-target',required:Math.ceil(troops*targetHomeRatio(item.opponent,late)),home:s.home};
    const front=frontRiskPlan(items,s,item.id);
    if(front.danger||front.pressure)return {ok:false,reason:'other-front-pressure',other:front.other};
    const strike=joint?joint.own:Math.min(s.available*(hardMode()?.76:.80),
      Math.max(troops*(hardMode()?1.57:1.40),s.available*.48));
    if(strike>front.safeStrike)return {ok:false,reason:'post-attack-home-guard',
      strike:Math.floor(strike),safeStrike:front.safeStrike};
    if(!joint&&strike+credit<troops*(hardMode()?1.18:1.08))
      return {ok:false,reason:'strike-below-target-force',strike:Math.floor(strike),credit};
    return {ok:true,reason:'candidate-safe',strike:Math.floor(strike)};
  }
  // Replay cR8SRtEEcR: a successful player repeatedly reinforced the SAME
  // active land front. Permit at most one guarded follow-up, never a new war,
  // and only with an independently sufficient home army and clear flank.
  function sameFrontFollowUp(me,items,s,item,tick){
    if(!item?.opponent?.isAlive?.()||friendly(item.opponent,me)||
      !isWar()||warState.id!==item.id||s.activeEnemy!==1||
      s.activeNeutral>0||s.incoming>0||recentHostilePressure(tick,180)||
      s.ratio<.70||s.committed>s.home*.35||
      tick-lastEnemySend<80)return false;
    const ownStacks=s.out.filter(a=>!a.retreating&&
      a.targetID!==null&&attackTargets(a.targetID,item.id));
    if(ownStacks.length!==1)return false;
    const enemyHome=number(()=>item.opponent.troops(),Infinity);
    if(!Number.isFinite(enemyHome)||enemyHome<0)return false;
    const flank=frontRiskPlan(items,s,item.id);
    if(flank.danger||flank.pressure)return false;
    const possible=Math.min(flank.safeStrike,s.available*.76,
      Math.max(0,s.home-s.reserve));
    return possible>=Math.max(1500,enemyHome*1.35);
  }
  function targetOpportunity(me,items,s,item){
    return targetOpportunityCheck(me,items,s,item).ok;
  }
  function warReadiness(me,items,s,tick,target=null) {
    if(!hardMode())return {ready:true,reason:'Normal'};
    const units=ownStructures(me),cities=units.filter(x=>x.type?.()==='City').length,
      factories=units.filter(x=>x.type?.()==='Factory').length,
      tiles=number(()=>me.numTilesOwned()),gold=goldAmount(me);
    const neutral=items.some(x=>x.id===null),late=lateGame(me);
    if(s.incoming>s.home*.085)return {ready:false,reason:'Eingehender Angriff'};
    if(s.activeEnemy && !isWar())return {ready:false,reason:'Laufende andere Offensive'};
    if(!late && neutral && !isWar() && (cities<2 || factories<2) && tick<2500 &&
      !game.config().infiniteGold?.()) {
      // Only defer war while basic construction is ACTUALLY advancing.
      // Expensive next-tier buildings, blocked land and insufficient gold
      // previously trapped the bot in this branch for thousands of ticks.
      const recentlyBuilt=tick-successfulEconomyTick<440;
      const underway=!!economicPending && tick-economicPending.tick<ECON_PENDING_TTL;
      const canInvest=gold>=180000 && failedEconomyProbes<5;
      if((underway || recentlyBuilt || canInvest) && tick<1750)
        return {ready:false,reason:'Grundaufbau läuft: Städte/Fabriken'};
      if(warWaitSince===-Infinity)warWaitSince=tick;
      if(tick-warWaitSince<200 && gold>=180000)
        return {ready:false,reason:'Bauplatzprüfung vor Kriegsfreigabe'};
    } else warWaitSince=-Infinity;
    const safeJoint=target&&duoJointOpportunity(me,items,s,target,tick,true);
    if(s.ratio<(late?.32:.47)&&!safeJoint)
      return {ready:false,reason:'Truppen auffüllen'};
    if(s.committed>Math.max(s.home*.70,s.max*.20))return {ready:false,reason:'Truppen bereits an Front gebunden'};
    if(s.home<Math.max(5500,s.strongest*(late?1.25:1.48))&&s.strongest>0){
      const candidates=target?[target]:items.filter(x=>x.id!==null);
      if(!safeJoint&&!candidates.some(x=>targetOpportunity(me,items,s,x)))
        return {ready:false,reason:'Keine sichere Hinterland-Reserve'};
    }
    return {ready:true,reason:'Kriegsfreigabe'};
  }
  function strategy(me,items,s) {
    const tick=number(()=>game.ticks());
    const coolingDown=recentHostilePressure(tick);
    const trend=armyTrend(tick), neutral=items.some(x=>x.id===null);
    const enemies=items.filter(x=>x.id!==null&&x.opponent?.isAlive?.());
    const gold=goldAmount(me),tiles=number(()=>me.numTilesOwned());
    const factoryCount=number(()=>me.units().filter(u=>u.isActive?.()&&u.type?.()==='Factory').length);
    const cityCount=number(()=>me.units().filter(u=>u.isActive?.()&&u.type?.()==='City').length);
    const danger=s.incoming>0 || s.strongest>s.home*.95 ||
      !!(crisisTrend&&tick<crisisTrend.expires&&s.strongest>s.home*.55);
    const rich=gold>900000 || game.config().infiniteGold?.()===true;
    const losing=!!(trend&&trend.home<-Math.max(2000,s.home*.21)&&trend.tiles<=0);
    const late=lateGame(me);
    const rebuilding=(s.ratio<(late?.17:.25) && (s.strongest>s.home*.52 || s.incoming>s.home*.12)) ||
      (losing&&(!late||s.incoming>s.home*.10)) || (s.incoming>s.home*.40);
    const readiness=warReadiness(me,items,s,tick);
    const jointReady=enemies.filter(x=>
      !!duoJointOpportunity(me,items,s,x,tick,true));
    const weak=enemies.filter(x=>
      jointReady.some(y=>y.id===x.id)||
      (hardMode()?targetOpportunity(me,items,s,x):
        s.available>number(()=>x.opponent.troops(),Infinity)*(late?1.17:1.5)));
    const fullLate=late&&s.ratio>.78&&!s.incoming&&enemies.length>0;
    const nuclearReady=opts.nukes && game.config().isUnitDisabled?.('Missile Silo')!==true &&
      game.config().isUnitDisabled?.('Atom Bomb')!==true;
    const hasSilo=ownStructures(me).some(u=>u.type?.()==='Missile Silo');

    const seriousAttack=s.incoming>s.home*(late?.15:.05)||
      !!(crisisTrend&&tick<crisisTrend.expires&&s.incoming>s.home*.08);
    let wanted,reason;
    if(rebuilding){wanted='RECOVER';reason='Truppenverlust oder geringe Reserve';}
    else if(coolingDown){wanted='RECOVER';reason='Nach Großangriff Heimatarmee stabilisieren';}
    else if(danger&&seriousAttack){wanted='DEFEND';reason='Erhebliche eingehende Angriffe';}
    else if(danger&&s.strongest>s.home*1.08 && !weak.length &&
      !(fullLate&&nuclearReady)){
      wanted='DEFEND';reason='Überlegener Nachbar: keine neue Kriegsfront';
    }
    else if(jointReady.length&&!seriousAttack&&!coolingDown&&
      !s.incoming&&readiness.ready){
      wanted='ASSAULT';
      reason='Bestätigte gemeinsame Duo-Front, getrennte Reserven gesichert';
    }
    else if(late && weak.length && s.ratio>.30 && !seriousAttack && readiness.ready){
      wanted='ASSAULT';reason='Late Game: günstige Offensivchance';
    }
    else if(fullLate && nuclearReady && (!hasSilo || s.strongest>s.available*.95)){
      wanted='TECH';reason='Late Game: Silo/Raketen finanzieren, statt defensiv festzufahren';
    }
    else if(neutral&&(tiles<900||s.ratio<.60||enemies.length===0)){
      wanted='EXPAND';reason='Unbesetzte Gebiete und Platz für Wachstum';
    }
    else if((factoryCount===0||cityCount===0)&&!rich){wanted='ECONOMY';reason='Wirtschaftlicher Engpass';}
    else if(weak.length && (s.ratio>.55||
      weak.some(x=>duoJointOpportunity(me,items,s,x,tick,true)))&&
      !s.activeEnemy&&!seriousAttack&&readiness.ready){
      wanted='ASSAULT';reason='Erreichbarer Gegner mit Kräftevorteil';
    }
    else if(danger){wanted='DEFEND';reason='Starker Nachbar an der Grenze';}
    else if(neutral){wanted='EXPAND';reason='Landnahme vor riskanter Offensive';}
    else {wanted='ECONOMY';reason='Aufbauen und auf sichere Angriffsgelegenheit warten';}
    if(!opts.autoStrategy){
      if(rebuilding)wanted='RECOVER';
      else if(seriousAttack)wanted='DEFEND';
      else if(opts.plan==='Ökonomie')wanted='ECONOMY';
      else if(opts.plan==='Blitz'&&weak.length)wanted='ASSAULT';
      reason='Manuelle Strategie: '+opts.plan;
    }
    if(wanted!==strategic.mode){
      const emergency=wanted==='RECOVER'||(wanted==='DEFEND'&&s.incoming>0)||
        (wanted==='ASSAULT'&&jointReady.length>0&&
          duoPlan?.strikeStatus==='locked-launch-window'&&
          s.incoming===0&&!coolingDown);
      if(emergency||tick-strategic.since>=65){
        strategic.mode=wanted;strategic.since=tick;strategic.reason=reason;
        log('STRATEGIE → '+wanted+' · '+reason);
      }
    } else strategic.reason=reason;
    strategic.buildStyle=(!opts.autoStrategy)?opts.buildStyle:
      ['RECOVER','ECONOMY','TECH'].includes(strategic.mode)?'Wirtschaft':
      strategic.mode==='DEFEND'?'Defensiv':'Ausgewogen';
    strategic.groups=items;
    lastRecoveryReason=rebuilding?'Truppen/Front stabilisieren':s.incoming?'Eingehende Angriffe abfangen':!readiness.ready?readiness.reason:'';
    return {wanted:strategic.mode,underAttack:s.incoming>0,neutral,foes:enemies.length,rebuilding,
      reason:strategic.reason,defensive:strategic.mode==='DEFEND'||strategic.mode==='RECOVER',readiness};
  }
  function rankedTargets(items,me,tick,s,context) {
    const available=s.available,aggression=clamp(setting('aggressive'),40,100)/100;
    const late=lateGame(me),bigLead=late&&s.strongest<s.home*.55;
    const ownTiles=number(()=>me.numTilesOwned());
    if(available<100)return [];
    return items.flatMap(item=>{
      const enemy=item.opponent,key=item.id===null?'neutral':String(item.id);
      if(enemy && !enemy.isAlive?.())return [];
      if(enemy&&operation?.target===item.id&&operation.spent>=operation.budget)return [];
      if(enemy && coordinatedWar() && (
        (pendingAttack?.id!==null && pendingAttack?.id!==undefined && pendingAttack.id!==item.id) ||
        (isWar() && item.id!==warState.id) || tick<warState.blockedUntil ||
        !context.readiness?.ready || !targetOpportunity(me,items,s,item)))return [];
      if(tick-(cooldowns.get(key)??-Infinity)<(item.id===null?22:80))return [];
      if(tick-(rejected.get(key)??-Infinity)<25 || tick<(blockedTargets.get(item.id)||0))return [];
      const isNeutral=item.id===null;
      // The game sends attacks from home troops; existing outgoing stacks
      // remain in motion. Don't spend the whole army on parallel attacks.
      if(isNeutral && (s.activeNeutral >= (s.ratio>.63 && !context.underAttack ? 2 : 1) || tick-lastNeutralSend<23))return [];
      if(!isNeutral && ((s.activeEnemy>=1&&
        !sameFrontFollowUp(me,items,s,item,tick)) ||
        tick-lastEnemySend<(hardMode()?(late?65:120):(late?35:68)) ||
        context.rebuilding))return [];
      // If pressured, never begin a fresh offensive -- defense is handled separately.
      if(!isNeutral && s.incoming>s.home*(late?.15:.04))return [];
      if(isNeutral && context.underAttack && s.incoming>s.home*.45)return [];
      const enemyTroops=enemy?number(()=>enemy.troops(),Infinity):0;
      // One target cannot be evaluated as isolated when other large enemies
      // still border our home. This was the main multi-front failure in 1.4.
      const front=enemy?frontRiskPlan(items,s,item.id):null;
      const enemyTiles=enemy?number(()=>enemy.numTilesOwned(),0):0;
      const joint=!isNeutral?duoJointOpportunity(me,items,s,item,tick,true):null;
      if(!isNeutral) {
        const minimumRatio=enemyOpportunityRatio(enemy,late,s.home,effectivePlan()==='Blitz');
        const partnerCredit=duoBattleCredit(me,enemy);
        if(s.ratio<(late?.29:.40) ||
          (!joint&&(available+partnerCredit<enemyTroops*minimumRatio||
            s.home+partnerCredit<enemyTroops*targetHomeRatio(enemy,late)))||
          front.danger||front.pressure||
          (joint?joint.own:
            Math.min(available*(hardMode()?.76:.80),
              Math.max(enemyTroops*(hardMode()?1.57:1.40),available*.48))
          )>front.safeStrike||
          enemyTroops<=0 && enemyTiles<=0)return [];
      }
      let score=isNeutral?75:52;
      score+=Math.min(20,Math.log2(item.front+1)*4.5);
      if(isNeutral) {
        if(item.fallout && (s.incoming>0 || s.strongest>s.home*.65 ||
          s.ratio<.60 || available<s.home*.30))return [];
        score+=Math.max(0,45-s.ratio*40)+(ownTiles<600?26:0);
        score+=neuralChannel('landPriority',me,s,tick)*28;
        if(item.fallout)score-=36;
        if(context.wanted==='EXPAND')score+=18;
        if(growthPressure(s))score+=Math.min(22,(s.ratio-.70)*90);
        if(late&&context.foes)score-=38;
      } else {
        score+=Math.max(-65,55-50*enemyTroops/Math.max(available,1));
        score+=neuralChannel('enemyCommit',me,s,tick)*28;
        score+=Math.min(16,enemyTiles/450);
        const local=targetEconomics(item,tick);
        score+=Math.min(29,local.prize*2.7)-
          Math.min(45,local.posts*12+Math.max(0,local.density-32)*.20);
        if(enemyTiles<300 && enemyTroops<available*.55)score+=14;
        const opening=adversaryWindow(me,enemy);
        // Capitalize on opponents fighting a *different* player, never on
        // allied attacks or their outgoing stacks aimed at us.
        if(opening.exposed && opening.human)score+=Math.min(33,
          Math.round(opening.ratio*23+opening.incomingOthers/opening.home*16));
        if(enemyUnderAttack(enemy) && (!isWar()||warState.id===item.id))score+=23;
        const trend=opponentTrend(enemy,tick);
        if(trend.valid){
          if(trend.sustained&&trend.falling)score+=18;
          if(trend.growing&&!opening.exposed)score-=Math.min(22,trend.change*25);
        }
        // Early human wars are expensive while clean free land remains.
        // A genuinely exposed player is the exception, not the default.
        if(enemy.type?.()==='HUMAN' && context.neutral && ownTiles<1100 &&
          !opening.exposed && !isWar())score-=35;
        if(enemy.isDisconnected?.()===true)score+=18;
        if(allyAssistTarget(me,enemy))score+=22;
        const focus=duoFocus(me,enemy);
        if(focus){
          if(focus.on>0)score+=Math.min(42,24+focus.on/
            Math.max(1,number(()=>enemy.troops(),1))*13);
          else if(focus.elsewhere>0)score-=12;
        }
        if(winStatus.urgent)score+=18;
        const profile=opponentProfiles.get(item.id);
        if(profile?.confidence>=.45&&profile.profile==='Gelegenheitsangreifer'&&
          opening.exposed)score+=12;
        if(operation?.target===item.id)score+=28;
        if(duoPlan?.target===item.id)score+=
          joint?72:duoPlan.partnerCommitted>0?25:10;
        if(victoryThreat?.urgent && (victoryThreat.team!==null?
          enemy.team?.()===victoryThreat.team:item.id===victoryThreat.id))score+=38;
        if(me.hasTransitiveTarget?.(enemy.smallID?.()))score+=12;
        if(plan?.id===item.id && tick<plan.until)score+=23;
        if(effectivePlan()==='Blitz')score+=12;
        if(late)score+=33;
      }
      const amount=isNeutral ?
        Math.floor(neutralAttackAmount(s,aggression)*(item.fallout?.48:1)) :
        joint?joint.own:
        Math.min(front.safeStrike,available*(hardMode()?.76:.80),
          Math.max(enemyTroops*(hardMode()?1.57:(1.25+aggression*.20)),available*.48)) *
          (1+neuralChannel('enemyCommit',me,s,tick)*.22);
      const forecast=!isNeutral?attackForecast(me,item,Math.floor(amount)):null;
      if(forecast){
        score-=Math.min(60,forecast.loss/Math.max(1,amount)*78);
        if(forecast.loss>amount*.78)score-=40;
      }
      if(isNeutral && winStatus.urgent)score+=24;
      const baseScore=score,neuralDelta=neuralActionDelta('attack',score,me,s,{
        magnitude:clamp(enemyTroops/Math.max(1,s.home)/3,0,1),
        opportunity:clamp(item.front/120,0,1),
        cost:clamp(amount/Math.max(1,s.home),0,1),
        risk:isNeutral?(item.fallout?1:0):
          clamp(enemyTroops/Math.max(1,s.home)/3,0,1)
      });
      return [{...item,key,score:score+neuralDelta,baseScore,neuralDelta,forecast,
        amount:Math.min(available,Math.floor(amount))}];
    }).sort((a,b)=>b.score-a.score);
  }
  // Explain why a visible front is absent from the ranked list. This is
  // observational: it cannot authorize any attack or relax safety gates.
  function reportAttackBlocks(me,items,s,context,ranked,tick){
    if(tick-lastAttackBlockReport<90)return attackBlockReport;
    lastAttackBlockReport=tick;
    const admitted=new Set(ranked.map(x=>x.id));
    const readiness=context.readiness||{ready:true,reason:'unknown'};
    const rows=items.filter(x=>x.id!==null).slice(0,16).map(x=>{
      let reason='unknown';
      if(!x.opponent?.isAlive?.()||friendly(x.opponent,me))reason='dead-or-friendly';
      else if(admitted.has(x.id))reason='admitted';
      else if(pendingAttack?.id!=null&&pendingAttack.id!==x.id)reason='pending-other-target';
      else if(isWar()&&warState.id!==x.id)reason='war-lock';
      else if(tick<warState.blockedUntil)reason='war-cooldown';
      else if(!readiness.ready)reason='war-readiness: '+readiness.reason;
      else if((blockedTargets.get(x.id)||0)>tick)reason='blocked-target-cooldown';
      else if(tick-(cooldowns.get(String(x.id))??-Infinity)<80)reason='attack-cooldown';
      else if(s.activeEnemy>=1)reason='outgoing-attack-active';
      else reason=targetOpportunityCheck(me,items,s,x).reason;
      return {target:x.id,name:nameOf(x.opponent),reason,
        home:Math.round(s.home),available:Math.round(s.available),
        enemyHome:number(()=>x.opponent?.troops?.(),null)};
    });
    const counts={};for(const row of rows)counts[row.reason]=(counts[row.reason]||0)+1;
    attackBlockReport={tick,ranked:ranked.length,
      lastEnemyAttackTick:Number.isFinite(lastEnemySend)?lastEnemySend:null,
      lastNeutralAttackTick:Number.isFinite(lastNeutralSend)?lastNeutralSend:null,
      lastAttackAgeTicks:tick-Math.max(lastEnemySend,lastNeutralSend),home:s.home,
      available:s.available,reserve:s.reserve,incoming:s.incoming,
      reserveShare:s.reserveShare??null,
      reserveReason:s.reserveReason??null,
      reserveFloors:s.reserveFloors??null,
      committed:s.committed,readiness:readiness.reason,counts,targets:rows.slice(0,8)};
    if(rows.length&&tick-Math.max(lastEnemySend,lastNeutralSend)>=240&&
      tick-lastOffenseDroughtReport>=180){
      lastOffenseDroughtReport=tick;
      telemetry('offense_drought','Keine neuen Angriffs-Intents trotz sichtbarer Front',{
        ...attackBlockReport,rankedTargets:ranked.slice(0,5).map(x=>({
          id:x.id,amount:x.amount,score:x.score,
          forecast:x.forecast??null})),
        blockers:counts,activeOutgoing:s.activeEnemy,
        pendingAttack:pendingAttack?.id??null,
        warLock:warState.id??null,warLockOrigin:warState.origin??null,
        warLockAgeTicks:warState.id===null?null:tick-warState.since,
        provisionalMarine:pendingBoat?.seen?{actionId:pendingBoat.actionId??null,
          target:pendingBoat.playerID??null,
          observationLostTick:pendingBoat.observationLostTick??null}:null,
        warWaitSince,
        safety:'observation-only-no-attack-permission',
        interpretation:'ranked-target-does-not-imply-safe-legal-send'});
    }
    if(!ranked.some(x=>x.id!==null)&&rows.length){
      telemetry('attack_block_report','Kein Landkriegsziel freigegeben',
        {attackBlockReport});
      decisionNote('ziel_verworfen','Landkrieg: '+Object.entries(counts)
        .sort((a,b)=>b[1]-a[1]).slice(0,2)
        .map(([k,v])=>k+' ('+v+')').join(', '),
        rows.slice(0,3).map(x=>x.name+': '+x.reason),tick);
    }
    return attackBlockReport;
  }
  // Shared investment posture; never bypasses worker building legality.
  function economyPosture(me,s,tick=number(()=>game.ticks(),0)){
    const units=ownStructures(me);
    if(!units.some(u=>u.type?.()==='City')||
       !units.some(u=>u.type?.()==='Factory'))return 'bootstrap';
    if(s.incoming>Math.max(1200,s.home*.10)||recentHostilePressure(tick))
      return 'defensive';
    const noNeutral=strategic.groups.every(g=>g.id!==null||g.fallout);
    if(opts.boats&&noNeutral&&tick-lastNeutralSend>=200&&
      tick-lastEnemySend>=200&&!isWar()&&!s.activeEnemy&&
      s.strongest<s.home*.85)return 'breakout';
    if(s.ratio>=.78&&!s.incoming&&s.strongest<s.home*.70)return 'recruit';
    return 'balanced';
  }
  // Shared strategic director: decide which existing LEGAL planner gets first
  // refusal. Never issues intents and never weakens any planner's safety gate.
  function strategicDirector(me,s,context,ranked,tick,planning=planningState) {
    const land=ranked.filter(x=>x.id===null);
    const enemy=ranked.filter(x=>x.id!==null);
    const threatened=s.incoming>0 || recentHostilePressure(tick,260) ||
      s.strongest>=s.home*.85;
    const recovering=context.wanted==='RECOVER'||context.wanted==='DEFEND';
    const canSail=opts.boats&&!!ctors.boat&&!pendingBoat&&!pendingAttack&&
      s.available>=1300&&s.activeEnemy===0&&!threatened&&
      tick>=navalBackoffUntil&&tick-lastBoat>=100;
    // A naval target is useful only when reachable territory may exist.
    // naval() performs the authoritative shoreline, worker and reserve checks.
    const rivals=game.playerViews?.()||[];
    const targetAtSea=rivals.some(p=>safeID(p)!==safeID(me)&&p.isAlive?.()&&
      !friendly(p,me)&&Number.isInteger(p.state?.spawnTile)&&
      (!coordinatedWar()||!isWar()||safeID(p)===warState.id));
    const noLandGrowth=!land.length;
    const stalledFront=!enemy.length && noLandGrowth &&
      tick-lastEnemySend>180 && s.ratio>=.52;
    const navalFirst=canSail && (stalledFront || (!land.length&&!enemy.length)) &&
      (targetAtSea || s.activeNeutral===0);
    const ruleOrder=navalFirst?['naval','land','hold']:
      enemy.length||land.length?['land','naval','hold']:
      ['naval','hold'];
    const learned=neuralStrategicSignals(me,s,tick);
    const planned=channel=>planning?.candidates?.filter(x=>x.channel===channel)
      .reduce((best,x)=>Math.max(best,x.utility),-1000)??-1000;
    const utility={
      land:(land.length||enemy.length?110:0)+((land.length||enemy.length)?learned?.landPriority||0:0)*65+
        clamp(planned('land'),-100,160)*.22,
      naval:(canSail?(navalFirst?120:80):-1000)+
        (canSail?(learned?.navalPriority||0)*65:0)+clamp(planned('naval'),-100,160)*.22,
      hold:(land.length||enemy.length||canSail?-25:35)+(learned?.holdPriority||0)*60+
        clamp(planned('hold'),-100,160)*.22
    };
    // Recover/defend is an absolute gate; priority values never grant legality.
    const hasLearnedPreference=learned&&
      ['landPriority','navalPriority','holdPriority'].some(k=>Math.abs(learned[k])>1e-8);
    // Zero weights / no model MUST reproduce v1.16.0 exactly. In particular,
    // naval() can refresh a stale preliminary canSail snapshot.
    const order=recovering?['hold']:
      !hasLearnedPreference?ruleOrder:
      [...new Set([...ruleOrder,'land','naval','hold'])].sort((a,b)=>
        utility[b]-utility[a]);
    const reason=recovering?'Heimtruppen und Grenzen stabilisieren':
      planning?.selected?.reason?'Planung: '+planning.selected.reason:
      navalFirst?'Keine sichere Landexpansion: Marineweg vor Landkrieg prüfen':
      enemy.length?'Sicheren Landkrieg vor Küstenoperation prüfen':
      land.length?'Freies Land vor teurer Küstenoperation':
      'Keine freigegebene Landaktion; Seeweg prüfen';
    return {order,reason,landCandidates:land.length,enemyCandidates:enemy.length,
      navalCandidate:canSail,threatened,economy:economyPosture(me,s,tick),
      planning:{selected:planning?.selected?.id||null,
        rejected:planning?.rejected?.id||null,durationMs:planning?.durationMs??null},
      neural:learned?{utility,weights:learned}:null};
  }
  async function legalTarget(me,item,serial) {
    // Four-at-a-time worker checks remove the old serialized waterfall.
    // A short negative cache prevents probing the same blocked frontier 50x/s.
    const now=number(()=>game.ticks(),0), probes=item.tiles.slice(0,Math.min(24,clamp(setting('maxTargets'),4,25)));
    if(legalNegative.size>500)for(const [k,expiry] of legalNegative)if(expiry<=now)legalNegative.delete(k);
    for(let offset=0;offset<probes.length;offset+=4){
      if(!live(serial))return null;
      const batch=probes.slice(offset,offset+4).filter(tile=>
        (legalNegative.get(String(item.id)+':'+tile)||0)<=now);
      if(!batch.length)continue;
      const results=await Promise.all(batch.map(async tile=>{
        runtime.attackProbes++;
        try{return {tile,allowed:!!(await me.actions(tile,null))?.canAttack};}
        catch(_){return {tile,allowed:false};}
      }));
      if(!live(serial))return null;
      for(const v of results){
        if(v.allowed && safeID(game.owner(v.tile))===item.id)return v.tile;
        legalNegative.set(String(item.id)+':'+v.tile,now+35);
      }
    }
    return null;
  }
  // OpenFront counters incoming attacks against the same opponent 1:1;
  // leaving troops at home usually preserves the Defense Post bonus.
  // Retreating a player attack costs 25% and returns after ~20 game ticks.
  function defenseAssessment(me,s,tick) {
    const hostile=s.inc.filter(a=>{
      try {const p=game.playerBySmallID?.(a.attackerID);
        return !p || !friendly(p,me);}catch(_){return true;}
    });
    const incoming=hostile.reduce((sum,a)=>sum+a.troops,0);
    const home=Math.max(1,s.home),ratio=incoming/home;
    const samples=troopSamples.filter(x=>tick-x.tick<=110);
    const prev=samples[0],land=number(()=>me.numTilesOwned(),0);
    const landLoss=prev&&prev.tiles>0?Math.max(0,(prev.tiles-land)/prev.tiles):0;
    const neuralWarning=neuralChannel('defensePriority',me,s,tick)>.7;
    return {incoming,ratio,landLoss,hostile,
      severe:ratio>=.43||(ratio>=.23&&landLoss>=.035)||
        (neuralWarning&&ratio>=.33),
      critical:ratio>=.80||(ratio>=.40&&landLoss>=.075)};
  }
  function refreshRetreats(me,tick) {
    // Use the UNFILTERED game snapshot: military().out excludes retreating
    // stacks, so disappearance there cannot prove that the retreat succeeded.
    const raw=(()=>{try{return me.outgoingAttacks?.()||[];}catch(_){return [];}})();
    const active=new Map(raw.map(a=>[a.id,a]));
    for(const [id,request] of retreatRequests){
      const a=active.get(id);
      if(a?.retreating){
        retreatRequests.delete(id);defenseStats.retreatsObserved++;
        telemetry('defense_retreat_confirmed','Rückzugsflag im Spielzustand gesehen',
          {attackID:id,target:request.target,troops:a.troops});
      } else if(!a){
        retreatRequests.delete(id);defenseStats.unknown++;
        telemetry('defense_retreat_unknown','Angriffsverband verschwunden: Rückzug oder Verlust unbekannt',
          {attackID:id,target:request.target,expected:request.recoverable});
      } else if(tick-request.tick>=65){
        retreatRequests.delete(id);defenseStats.unconfirmed++;
        telemetry('defense_retreat_unconfirmed','Rückzugsflag fehlt nach Timeout',
          {attackID:id,target:request.target});
      }
    }
  }
  function emergencyRetreat(me,tick,s) {
    refreshRetreats(me,tick);
    const threat=defenseAssessment(me,s,tick);
    if(!threat.incoming){defenseStatus='Keine eingehenden Angriffe';return false;}
    defenseStatus='Eingehend '+Math.floor(threat.incoming/10)+' · Heim '+
      Math.floor(s.home/10)+' · '+Math.round(threat.ratio*100)+'%';
    if(!opts.defense||!threat.severe)return false;
    if(!ctors.cancel){
      defenseStatus+=' · Rückzug-Event nicht gefunden';
      if(tick-lastDefenseLog>=100){lastDefenseLog=tick;
        telemetry('defense_unavailable',defenseStatus,{incoming:threat.incoming,committed:s.committed});}
      return false;
    }
    const candidates=s.out.filter(a=>typeof a.id==='string'&&a.troops>0&&
      !a.retreating&&!retreatRequests.has(a.id));
    if(!candidates.length){defenseStatus+=' · Keine rückrufbaren Angriffe';return false;}
    if(tick-lastEmergencyRetreat<6||retreatRequests.size>=5)return false;
    candidates.sort((a,b)=>{
      const rank=x=>x.targetID===null||x.targetID===0?0:
        (isWar()&&attackTargets(x.targetID,warState.id)?2:1);
      return rank(a)-rank(b)||b.troops-a.troops;
    });
    let issued=0;
    for(const a of candidates){
      const recoverable=a.troops*(a.targetID===null||a.targetID===0?1:.75);
      if(recoverable<Math.max(250,s.home*.025))continue;
      if(!send('cancel',[a.id],'NOT-RÜCKZUG → '+String(a.targetID??'neutral')+
          ' ('+Math.floor(recoverable/10)+' Tr. voraussichtlich zurück)',true))continue;
      retreatRequests.set(a.id,{id:a.id,target:a.targetID,tick,troops:a.troops,recoverable});
      defenseStats.retreatsOrdered++;issued++;
      telemetry('defense_retreat_ordered','Angriff wegen akuter Bedrohung zurückgerufen',
        {attackID:a.id,target:a.targetID,troops:a.troops,recoverable,
          incoming:threat.incoming,home:s.home,critical:threat.critical});
      if(issued>=(threat.critical?3:1)||retreatRequests.size>=5)break;
    }
    if(issued){lastEmergencyRetreat=tick;defenseStatus+=' · '+issued+' Rückzug/Rückzüge angefordert';}
    return issued>0;
  }
  async function defense(me,tick,serial,groups,s) {
    if(!opts.defense||!ctors.attack||!s.incoming||pendingAttack)return false;
    const threat=defenseAssessment(me,s,tick);
    // Do not forbid every counterattack merely because the invasion is serious.
    // A counteroffensive is allowed only if the home defense remains funded.
    if(threat.critical&&s.home<threat.incoming*1.35)return false;
    // Keep the home force against active stacks; a large incoming percentage
    // alone is not a reason to skip a safe raid on the attacker's weak home.
    if(s.activeEnemy||s.home<threat.incoming*1.35)return false;
    const attacks=threat.hostile.slice().sort((a,b)=>b.troops-a.troops);
    for(const a of attacks.slice(0,3)){
      let attacker;
      try{attacker=game.playerBySmallID?.(a.attackerID);}catch(_){continue;}
      if(!attacker?.isPlayer?.()||friendly(attacker,me))continue;
      const id=safeID(attacker),key=String(id),their=number(()=>attacker.troops(),Infinity);
      if(coordinatedWar()&&isWar()&&id!==warState.id)continue;
      if(!Number.isFinite(their)||their<0||
         tick-(cooldowns.get(key)??-Infinity)<160)continue;
      const candidate=groups.find(x=>x.id===id);
      if(!candidate||!await legalTarget(me,candidate,serial))continue;
      if(!live(serial))return false;
      // Alliances and troop numbers can change while me.actions() awaits.
      const current=game.playerViews?.().find(p=>safeID(p)===id);
      if(!current?.isAlive?.()||friendly(current,me)||
        (coordinatedWar()&&isWar()&&warState.id!==id)){
        telemetry('defense_allied_skip','Gegenangriff nach Allianz-/Frontwechsel verhindert',
          {target:id,friendly:!!current&&friendly(current,me)});
        continue;
      }
      const fresh=military(me,strategic.groups);
      const enemyHome=number(()=>current.troops(),Infinity);
      if(!Number.isFinite(enemyHome)||enemyHome<0||fresh.activeEnemy||
        fresh.home<fresh.incoming*1.35)continue;
      const homeFloor=Math.max(fresh.reserve,fresh.incoming*1.35);
      const spare=Math.max(0,Math.min(fresh.available,fresh.home-homeFloor));
      const amount=Math.floor(Math.min(spare*.84,fresh.home*.28));
      // Commit only a force capable of pressuring the remaining enemy home;
      // preserve our live incoming defense and dynamic reserve after dispatch.
      if(amount<Math.max(500,enemyHome*1.10)||fresh.home-amount<homeFloor)continue;
      if(send('attack',[id,amount],'KONTROLLIERTER GEGENANGRIFF → '+nameOf(current))){
        const out=fresh.out.filter(x=>attackTargets(x.targetID,id)&&!x.retreating);
        pendingAttack={actionId:lastActionId,id,name:nameOf(current),tick,amount,ownLand:number(()=>me.numTilesOwned()),
          enemyLand:number(()=>current.numTilesOwned()),beforeIds:out.map(x=>x.id),
          beforeTroops:out.reduce((v,x)=>v+x.troops,0)};
        cooldowns.set(key,tick);lastEnemySend=tick;return true;
      }
    }
    return false;
  }
  async function attack(me,tick,serial,ranked,s) {
    if(!ctors.attack||pendingAttack)return false;
    for(const item of ranked.slice(0,clamp(setting('maxTargets'),4,25))){
      if(!live(serial)||!actionBudget('combat'))return false;
      // Rendezvous delay cannot block emergency defence or an active war.
      if(item.id!==null&&duoPlan?.target===item.id&&
        Number.isInteger(duoPlan.strikeTick)&&tick<duoPlan.strikeTick&&
        s.incoming===0&&warState.id!==item.id&&
        !(duoFocus(me,item.opponent)?.on>0))continue;
      const tile=await legalTarget(me,item,serial);
      if(tile===null){rejected.set(item.key,tick);
        decisionNote('ziel_verworfen','Ziel '+(item.opponent?nameOf(item.opponent):'Neutralland')+
          ': keine bestätigte legale Angriffsposition',[
            'Nächster Schritt: andere Grenze oder Marine prüfen'],tick);
        continue;}
      // Re-read the live relation after the async worker legality probe.
      if(item.id!==null){
        const current=game.playerViews?.().find(p=>safeID(p)===item.id);
        if(!current?.isAlive?.()||friendly(current,me)||
          (coordinatedWar()&&isWar()&&warState.id!==item.id)){
          telemetry('attack_allied_skip','Angriff nach Allianz-/Frontwechsel verhindert',
            {target:item.id,friendly:!!current&&friendly(current,me)});
          decisionNote('ziel_verworfen','Ziel '+item.id+
            ': Allianz oder Front nach Worker-Abfrage gewechselt',[],tick);
          continue;
        }
      }
      // The game state may advance during the async worker legality probe.
      const fresh=military(me,strategic.groups); // Never forget stronger OTHER neighbors on recheck.
      const freshJoint=item.id!==null?duoJointOpportunity(me,strategic.groups,
        fresh,item,number(()=>game.ticks(),tick),true):null;
      const freshFront=item.id!==null?frontRiskPlan(strategic.groups,fresh,item.id):null;
      if(item.id!==null && (freshFront.danger||freshFront.pressure||
        fresh.incoming>fresh.home*(lateGame(me)?.15:.04) ||
        (fresh.activeEnemy>=(lateGame(me)&&fresh.strongest<fresh.home*.55?2:1)&&
          !sameFrontFollowUp(me,strategic.groups,fresh,item,
            number(()=>game.ticks(),tick))) ||
        (!freshJoint&&fresh.available+duoBattleCredit(me,item.opponent)<
          Math.max(100,number(()=>item.opponent.troops(),Infinity)*
            (lateGame(me)?1.15:1.3)))))continue;
      if(item.id===null && fresh.activeNeutral>=1)continue;
      if(item.fallout && (fresh.incoming>0 ||
        fresh.strongest>fresh.home*.65 || fresh.ratio<.60 ||
        fresh.available<fresh.home*.30))continue;
      if(item.id!==null && coordinatedWar() && (!warReadiness(me,strategic.groups,fresh,tick,item).ready ||
        !targetOpportunity(me,strategic.groups,fresh,item) ||
        (isWar()&&warState.id!==item.id)))continue;
      let amount=Math.min(item.amount,fresh.available,
        item.id===null ? neutralAttackAmount(fresh,clamp(setting('aggressive'),40,100)/100) :
        Math.min(freshFront.safeStrike,Math.floor(fresh.available*(hardMode()?.76:.8))));
      if(item.id!==null){
        const protectedStrike=offensiveCommitment(strategic.groups,fresh,item,amount);
        if(protectedStrike.capped){
          telemetry('offensive_guard','Großangriff nach verbleibendem Heimschutz begrenzt',
            {target:item.id,requested:amount,allowed:protectedStrike.amount,
              floor:protectedStrike.floor,other:protectedStrike.other,
              reason:protectedStrike.reason});
          if(!protectedStrike.amount){
            blockedTargets.set(item.id,tick+110);
            continue;
          }
        }
        amount=protectedStrike.amount;
        if(operation?.target===item.id)
          amount=Math.min(amount,Math.max(0,operation.budget-operation.spent));
        if(freshJoint&&amount+freshJoint.ally<freshJoint.needed){
          telemetry('duo_strike_veto',
            'Duo-Angriff gestoppt: eigener Einsatz plus Partnerbudget reicht nicht',
            {target:item.id,own:amount,ally:freshJoint.ally,
              required:freshJoint.needed});
          continue;
        }
      }
      if(amount<100){
        decisionNote('ziel_verworfen','Ziel '+(item.opponent?nameOf(item.opponent):'Neutralland')+
          ': Truppenbudget oder Heimschutz begrenzt',[],tick);
        continue;
      }
      const label=item.opponent?nameOf(item.opponent):'neutrales Land';
      if(send('attack',[item.id,amount],`ANGRIFF → ${label} (${Math.floor(amount/10)} Tr.)`)){
        cooldowns.set(item.key,tick);
        if(item.id===null)lastNeutralSend=tick;
        else {
          lastEnemySend=tick;
          plan={id:item.id,until:tick+(hardMode()?1000:300),name:label};
          if(operation?.target===item.id){operation.spent+=amount;
            decisionNote('operation','Einsatz '+amount+' / '+operation.budget+
              ' für '+operation.targetName,[],tick);}
        }
        const before=s.out.filter(a=>attackTargets(a.targetID,item.id)&&!a.retreating);
        pendingAttack={actionId:lastActionId,id:item.id,name:label,tick,amount,ownLand:number(()=>me.numTilesOwned()),
          enemyLand:item.opponent?number(()=>item.opponent.numTilesOwned()):0,
          beforeIds:before.map(a=>a.id),beforeTroops:before.reduce((v,a)=>v+a.troops,0),
          forecast:item.forecast||null};
        if(item.opponent?.isDisconnected?.()===true)strategicTelemetry.afkTargets++;
        if(item.opponent && adversaryWindow(me,item.opponent).exposed)
          telemetry('opportunity_attack','Angriff im gegnerischen Mehrfront-Konflikt',
            {target:item.id,window:adversaryWindow(me,item.opponent)});
        if(item.opponent&&allyAssistTarget(me,item.opponent))strategicTelemetry.assists++;
        lastSelection=label+' · score '+item.score.toFixed(0)+
          (item.fallout?' · Fallout-Fallback':'');
        telemetry('attack_intent','Angriff angefordert – wartet auf Bestätigung',
          {target:item.id,troops:amount,baseScore:item.baseScore,
            neuralDelta:item.neuralDelta,chosenScore:item.score,
            kind:item.id===null?'neutral':'enemy'});
        return true;
      }
    }
    return false;
  }
  // canBuild predicts the resulting building tile; the intent retains the queried
  // request tile so the engine resolves it once. canUpgrade is a unit ID, not
  // interchangeable. Own tiles INSIDE the country matter more than border-only probes.
  const STRUCTURE_TYPES=['City','Factory','Port','Defense Post','SAM Launcher','Missile Silo'];
  const ECON_PENDING_TTL=100; // 10 game seconds; new builds appear before construction completes.
  const confirmedBuiltSilos=new Set(); // match-scoped, observed own construction only
  function ownStructures(me) {
    try {return me.units().filter(u=>u?.isActive?.()&&STRUCTURE_TYPES.includes(u.type?.()));}
    catch (_) {return [];}
  }
  function economicUnitsByType(units,type) {return units.filter(u=>u.type?.()===type);}
  function ownedTile(ref,me) {
    try {
      if(!Number.isInteger(ref)||(typeof game.isValidRef==='function'&&!game.isValidRef(ref))||!game.isLand(ref)||game.isImpassable(ref))return false;
      if(typeof game.ownerID==='function' && typeof me.smallID==='function')return game.ownerID(ref)===me.smallID();
      return safeID(game.owner(ref))===safeID(me);
    }catch(_){return false;}
  }
  function buildObserved(pending,units) {
    if(pending.kind==='upgrade')return units.some(u=>u.id?.()===pending.unitId &&
      u.type?.()===pending.type && number(()=>u.level(),0)>pending.level);
    return units.some(u=>u.type?.()===pending.type && number(()=>u.tile(),-9999)===pending.tile);
  }
  function pendingEconomy(tick,units) {
    if(!economicPending)return false;
    if(buildObserved(economicPending,units)){
      economicStatus='Bestätigt: '+economicPending.type;
      successfulEconomyTick=tick;failedEconomyProbes=0;
      telemetry('build_confirmed',economicStatus,
        {actionId:economicPending.actionId??null,type:economicPending.type,
          kind:economicPending.kind,evidence:'structure-or-level-observed'});
      if(economicPending.type==='Missile Silo'&&economicPending.kind==='build'){
        const built=units.find(u=>u.type?.()==='Missile Silo'&&
          u.tile?.()===economicPending.tile);
        if(built){
          const id=String(built.id?.()??'tile:'+built.tile?.());
          confirmedBuiltSilos.add(monitorSession+':'+id);
          telemetry('silo_origin','Eigener Raketensilobau bestaetigt',
            {actionId:economicPending.actionId??null,siloId:id,
              tile:built.tile?.()??null,origin:'own-build-observed'});
        }
      }
      if(economicPending.type==='Port')telemetry('port_confirmed','Hafen im Spielzustand bestätigt',
        {tile:economicPending.tile,buildKind:economicPending.kind});
      if(['City','Factory','Port'].includes(economicPending.type)){
        const me=myPlayer();
        const sample={tick,type:economicPending.type,
          tile:economicPending.tile,buildKind:economicPending.kind,
          beforeTrain:number(()=>me?.trainGold?.(),NaN),
          beforeTrade:number(()=>me?.tradeGold?.(),NaN),finished:false};
        incomeAttribution.push(sample);
        if(incomeAttribution.length>40)incomeAttribution.shift();
      }
      economicPending=null;
      return false;
    }
    if(tick-economicPending.tick<ECON_PENDING_TTL){
      economicStatus='Warte auf '+economicPending.type+'-Bestätigung';
      return true;
    }
    const k=economicPending.kind+':'+economicPending.type+':'+economicPending.tile;
    economicBlocked.set(k,tick+220);
    failedEconomyProbes++;
    log('BAU nicht bestätigt: '+economicPending.type+' · neuen Standort suchen');
    telemetry('build_unconfirmed','Bauauftrag nicht im Spielzustand bestätigt',
      {actionId:economicPending.actionId??null,type:economicPending.type,
        tile:economicPending.tile,evidence:'unobserved-within-window'});
    economicPending=null;return false;
  }
  // Cheap, cached strategic view of visible missiles, silos, structures and SAM coverage.
  // SAMs automatically intercept in the engine; the bot only builds/positions them.
  function nuclearIntel(me,ourUnits=ownStructures(me)) {
    const tick=number(()=>game?.ticks?.(),0);
    if(nuclearCache && tick-nuclearCacheTick<24)return nuclearCache;
    const units=(()=>{try{return game.units();}catch(_){return [];}})();
    const myID=safeID(me);
    const enemy=[],friendlyUnits=[],enemySilos=[],enemySAM=[],incomingNukes=[];
    for(const u of units){
      const owner=u.owner?.(),id=safeID(owner),type=u.type?.();
      if(!type||!u.isActive?.())continue;
      if(id===myID || (owner?.isPlayer?.()&&friendly(owner,me))){
        if(STRUCTURE_TYPES.includes(type))friendlyUnits.push(u);
        continue;
      }
      if(type==='Missile Silo')enemySilos.push(u);
      if(type==='SAM Launcher')enemySAM.push(u);
      if(STRUCTURE_TYPES.includes(type)&&owner?.isPlayer?.())enemy.push(u);
      if(['Atom Bomb','Hydrogen Bomb','MIRV','MIRV Warhead'].includes(type)){
        const target=u.targetTile?.();
        if(Number.isInteger(target) && (ownedTile(target,me)||ourUnits.some(o=>{
          const t=number(()=>o.tile?.(),-1);return t>=0 && Math.hypot(game.x(t)-game.x(target),game.y(t)-game.y(target))<115;
        })))incomingNukes.push(u);
      }
    }
    // Buildable own territory is the primary SAM task. Allied infrastructure
    // is optional collateral coverage, not an impossible own-site obligation.
    // Retain the ownStructures fallback when game.units() is not exposed.
    const ourStructures=ourUnits.filter(u=>STRUCTURE_TYPES.includes(u.type?.()));
    const allyStructures=friendlyUnits.filter(u=>safeID(u.owner?.())!==myID);
    const protectedUnits=ourStructures.concat(allyStructures);
    const sams=protectedUnits.filter(u=>u.type?.()==='SAM Launcher');
    const assetType=u=>['City','Factory','Port','Missile Silo'].includes(u.type?.());
    const allyAssets=allyStructures.filter(assetType);
    // Shared allied SAM coverage counts, but allied buildings alone must
    // never trigger an own-territory launcher purchase, including Impossible.
    const assets=ourStructures.filter(assetType);
    const range=s=>number(()=>game.config().samRange(s.level?.()||1),70);
    const covered=a=>sams.some(s=>{
      const r=range(s),x=game.x(a.tile())-game.x(s.tile()),y=game.y(a.tile())-game.y(s.tile());
      return x*x+y*y<=r*r;
    });
    const uncovered=assets.filter(a=>!covered(a));
    const allyUncovered=hardMode()?[]:allyAssets.filter(a=>!covered(a));
    nuclearCache={enemy,enemySilos,enemySAM,incomingNukes,sams,assets,uncovered,
      allyAssets,allyUncovered,protectedUnits};
    nuclearCacheTick=tick;return nuclearCache;
  }
  function assetValue(type) {return {'City':5,'Factory':5,'Missile Silo':8,'Port':3,'SAM Launcher':7,'Defense Post':2}[type]||1;}
  function samCoverageValue(tile,units,intel) {
    const x=game.x(tile),y=game.y(tile),near=(a,r)=>{
      const dx=x-game.x(a.tile()),dy=y-game.y(a.tile());return dx*dx+dy*dy<=r*r;
    };
    let score=0;
    const radius=number(()=>game.config().samRange?.(1),70);
    for(const u of intel.assets){
      if(!near(u,radius))continue;
      const covered=intel.sams.some(s=>nearSAM(s,u));
      score+=assetValue(u.type?.())*(covered?0.22:2.25);
    }
    // An own asset must benefit before optional allied overlap adds value.
    if(score>0)for(const u of intel.allyUncovered||[]){
      if(near(u,radius))score+=assetValue(u.type?.())*.35;
    }
    for(const sam of intel.sams){if(near(sam,45))score-=65;else if(near(sam,75))score-=22;}
    return score;
  }
  function nearSAM(sam,asset) {
    const r=number(()=>game.config().samRange(sam.level?.()||1),70);
    const dx=game.x(asset.tile())-game.x(sam.tile()),dy=game.y(asset.tile())-game.y(sam.tile());
    return dx*dx+dy*dy<=r*r;
  }
  // Dedicated coast discovery, independent from the 190 generic inland
  // anchors. The worker remains the authority for an actual Port build tile.
  function portCoastalAnchors(me,tiles,tick,limit=40){
    if(!game?.isShore || !opts.boats)return [];
    const result=[],seen=new Set(),w=game.width(),h=game.height();
    const add=t=>{
      if(result.length>=limit || seen.has(t))return;
      seen.add(t);
      if(ownedTile(t,me)&&shoreNear(t))result.push(t);
    };
    const addNear=t=>{
      if(!Number.isInteger(t) || result.length>=limit)return;
      add(t);
      const x=game.x(t),y=game.y(t);
      for(const [dx,dy] of [[5,0],[-5,0],[0,5],[0,-5],
        [10,0],[-10,0],[0,10],[0,-10]]){
        if(result.length>=limit)break;
        if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)add(game.ref(x+dx,y+dy));
      }
    };
    const coastTiles=tiles||[];
    const stride=Math.max(1,Math.ceil(coastTiles.length/650));
    const phase=Math.floor(tick/40)%stride;
    for(let i=phase;i<coastTiles.length&&result.length<limit;i+=stride){
      const t=coastTiles[i];
      if(ownedTile(t,me) && shoreNear(t))addNear(t);
    }
    // A long inland/hostile front need not contain a coastline: rotate a
    // second bounded grid through the whole map as a fallback.
    if(result.length<8){
      const spacing=Math.max(9,Math.ceil(Math.sqrt(w*h/420)));
      const phase2=Math.floor(tick/60)%4,dx=phase2%2?Math.floor(spacing/2):0,
        dy=phase2>=2?Math.floor(spacing/2):0;
      for(let y=Math.floor(spacing/2)+dy;y<h&&result.length<limit;y+=spacing)
        for(let x=Math.floor(spacing/2)+dx;x<w&&result.length<limit;x+=spacing){
          const t=game.ref(x,y);
          if(ownedTile(t,me)&&shoreNear(t))addNear(t);
        }
    }
    return result;
  }
  // SAMs need a dedicated asset-centered grid. Generic city/front anchors
  // can fill their quota before an asset has a safe launcher position.
  function samBuildAnchors(me,intel,tick,limit=180){
    if(!opts.antiNuke||!intel?.uncovered?.length)return [];
    const sites=[],seen=new Set(),w=game.width(),h=game.height();
    const assets=intel.uncovered.filter(u=>Number.isInteger(u.tile?.())&&
      ownedTile(u.tile(),me)).sort((a,b)=>assetValue(b.type?.())-assetValue(a.type?.()));
    const start=assets.length?Math.floor(tick/70)*5%assets.length:0;
    const sampled=assets.slice(start).concat(assets.slice(0,start));
    const add=(x,y)=>{
      if(sites.length>=limit||x<0||y<0||x>=w||y>=h)return;
      const ref=game.ref(x,y);
      if(!seen.has(ref)&&ownedTile(ref,me)){seen.add(ref);sites.push(ref);}
    };
    const phase=Math.floor(tick/45)%8;
    for(const u of sampled.slice(0,18)){
      if(sites.length>=limit)break;
      const x=game.x(u.tile()),y=game.y(u.tile());
      add(x,y);
      for(const radius of [20,34,48,58]){
        for(let k=0;k<8;k++){
          const angle=Math.PI*(k+phase%2*.5)/4;
          add(Math.round(x+radius*Math.cos(angle)),
            Math.round(y+radius*Math.sin(angle)));
        }
      }
    }
    return sites;
  }
  // P2 multi-horizon investment evidence. Values are comparative estimates,
  // not claims about exact engine yield and never create build authorization.
  function investmentAssessment(item,cost,requirements,units){
    const income=incomeStatus.observed?incomeStatus:null;
    const horizons=[120,600],gold=Math.max(1,requirements.gold),base={
      type:item.type,cost:Number.isFinite(cost)?cost:null,horizons,
      priceSource:'worker',siteConfirmed:true,expiresTick:number(()=>game.ticks(),0)+120,
      marginal:{short:0,long:0},paybackTicks:null,risk:0,score:0};
    if(item.type==='SAM Launcher'&&requirements.nuclearThreat){
      base.score=requirements.intel.uncovered.length?46:9;
      base.marginal={short:requirements.incomingNukes?90:35,long:55};
      base.risk=requirements.intel.uncovered.length?0.15:.55;return base;
    }
    if(item.type==='Defense Post'&&requirements.immediate){
      base.score=35;base.marginal={short:70,long:20};base.risk=.2;return base;
    }
    if(item.type==='City'){
      base.score=(requirements.pressure>.70?28:0)+(requirements.capStalled?35:0);
      base.marginal={short:requirements.capStalled?65:18,long:requirements.capStalled?85:42};
      base.risk=requirements.immediate?.65:.2;return base;
    }
    if(item.type==='Factory'&&income?.train>0){
      // Total observed train income is not the marginal return of one new
      // Factory. Attribute only a conservative per-completed-unit proxy.
      const completed=units.filter(u=>u.type?.()==='Factory'&&
        !u.isUnderConstruction?.()).length;
      const marginal=completed>0?income.train/completed:0;
      const perTick=marginal/120;base.paybackTicks=cost/Math.max(1,perTick);
      base.score=Math.min(24,marginal/Math.max(1,cost)*18);
      base.marginal={short:Math.min(60,marginal/cost*20),long:Math.min(100,marginal/cost*80)};
      base.risk=requirements.immediate?.7:.25;return base;
    }
    if(item.type==='Port'){
      const completed=units.filter(u=>u.type?.()==='Port'&&!u.isUnderConstruction?.()).length;
      if(completed===0){base.score=requirements.portMilestone?35:12;
        base.marginal={short:requirements.portMilestone?25:5,long:requirements.portMilestone?70:20};
        base.risk=requirements.coastSites?0.3:.9;return base;}
      if(income?.trade===0){base.score=-70;base.risk=.8;return base;}
      if(income?.trade>0){const marginal=income.trade/completed;
        base.score=Math.min(28,marginal/Math.max(1,cost)*14);
        base.paybackTicks=cost/Math.max(1,marginal/120);
        base.marginal={short:Math.min(50,marginal/cost*18),long:Math.min(100,marginal/cost*70)};
        base.risk=.3;return base;}
    }
    base.risk=cost/gold;base.score=0;return base;
  }
  function investmentValue(item,cost,requirements,units){
    return investmentAssessment(item,cost,requirements,units).score;
  }
  function economicDefensePressure(me,s,tick=number(()=>game.ticks())){
    const home=Math.max(1,number(()=>me.troops()));
    if(s.incoming>home*.18)return true;
    if(!(s.incoming>=home*.08))return false; // Ignore small probes.
    const recent=troopSamples.filter(x=>x.tick<=tick&&tick-x.tick<=120);
    const peak=Math.max(number(()=>me.numTilesOwned()),...recent.map(x=>x.tiles));
    const losing=peak-number(()=>me.numTilesOwned())>=Math.max(100,peak*.03);
    // Require consecutive observations; stale/gapped samples cannot prove pressure.
    let since=tick,previous=tick;
    for(let i=recent.length-1;i>=0;i--){
      const x=recent[i];
      if(previous-x.tick>40||!(x.incoming>=Math.max(1,x.home)*.08))break;
      since=x.tick;previous=x.tick;
    }
    return s.strongest>=home*.85||losing||tick-since>=40;
  }
  function economicNeeds(me,units,tiles) {
    const mine=number(()=>me.numTilesOwned(),0);
    const gold=goldAmount(me);
    const cap=Math.max(1,troopSnapshot.max||number(()=>game.config().maxTroops(me),1));
    const troops=number(()=>me.troops(),0);
    const threatened=troopSnapshot.incoming>0 || troopSnapshot.strongest>troops*.6;
    const hostileFronts=strategic.groups.filter(g=>g.id!==null&&g.opponent?.isAlive?.()).length;
    const count=type=>economicUnitsByType(units,type).length;
    const cities=count('City'),factories=count('Factory'),ports=count('Port');
    const cityEnabled=game.config().isUnitDisabled?.('City')!==true;
    const factoryEnabled=game.config().isUnitDisabled?.('Factory')!==true;
    const portEnabled=game.config().isUnitDisabled?.('Port')!==true;
    const wantedCity=cityEnabled?(hardMode()?Math.min(13,Math.max(2,2+Math.floor(mine/600))):Math.min(9,Math.max(1,1+Math.floor(mine/900)))):0;
    const wantedFactory=factoryEnabled?(hardMode()?Math.min(11,Math.max(2,2+Math.floor(mine/900))):Math.min(8,Math.max(1,1+Math.floor(mine/1350)))):0;
    const wantedPort=!portEnabled?0:opts.boats?Math.min(5,Math.max(1,Math.floor(mine/1050)+1)):
      (factories>=1 && mine>600?Math.min(2,Math.floor(mine/2700)+1):0);
    const nowTick=number(()=>game.ticks(),0);
    const startup=(cityEnabled&&cities<1)||(factoryEnabled&&factories<1);
    // After losing the last productive buildings, do not keep the former
    // Warship/Port/SAM savings target ahead of a legal, affordable core.
    // An observed incoming nuke or currently active invasion keeps priority.
    // A still-standing City/Factory is not proof that the economy can
    // recover: prolonged observed train+trade income collapse needs a
    // productive rebuild too. Do not override active attacks or nukes.
    const recoverySeed=economyRecoveryKernel({
      observed:incomeStatus.observed,train:incomeStatus.train,trade:incomeStatus.trade,
      cities,factories,failedEconomyProbes,startup,land:mine,
      incoming:troopSnapshot.incoming,nuclearThreat:false});
    const incomeCollapse=recoverySeed.incomeCollapse;
    let coreRecovery=recoverySeed.coreRecovery;
    // Eight failed coast scans used to disable first-port planning forever.
    // Retry after a bounded pause: territory and legal build sites can change.
    if(portProbeFailures>=8 && Number.isFinite(lastPortRetryTick) &&
      nowTick-lastPortRetryTick>=180){
      portProbeFailures=0;lastPortRetryTick=nowTick;
    }
    const coastSites=ports===0&&opts.boats?
      portCoastalAnchors(me,tiles,nowTick,24):[];
    const tradePeer=duoTrustedPeer()?.player;
    const peerPorts=tradePeer&&actualFriendly(tradePeer,me)?
      (tradePeer.units?.()||[]).filter(u=>u.isActive?.()&&
        u.type?.()==='Port'&&!u.isUnderConstruction?.()).length:0;
    const duoTradeReady=ports===0&&peerPorts>0;
    // A Port used to outrank the SECOND Factory by hundreds of score points.
    // Finish the first two productive units of each type before this
    // discretionary harbor milestone; after repeated real site failures,
    // allow a harbor so a blocked core cannot freeze the entire economy.
    const coreComplete=(!cityEnabled||cities>=2)&&(!factoryEnabled||factories>=2);
    const portMilestone=!!(opts.boats&&portEnabled&&ports===0&&!startup&&
      (coreComplete||failedEconomyProbes>=8)&&
      coastSites.length&&portProbeFailures<8);
    const tradePortMilestone=portMilestone&&duoTradeReady;
    const basic=(cityEnabled&&cities<2)||(factoryEnabled&&factories<2);
    // Never buy decorative defense posts while the first city/factory are still
    // unaffordable. Only a *real* incoming offensive can override the basics.
    const immediate=economicDefensePressure(me,troopSnapshot,nowTick);
    const emergency=immediate||(troopSnapshot.strongest>troops*1.25&&
      (troopSnapshot.ratio<.75||hostileFronts>=2));
    // The first Public game purchased 24 defense posts with little economy.
    // Cap non-emergency posts separately from urgent defensive construction.
    const wantedDefense=!threatened||(startup&&!immediate)?0:
      immediate?Math.min(10,Math.max(3,Math.ceil((tiles?.length||0)/165),hostileFronts*2)):
      Math.min(7,Math.max(2,Math.ceil((tiles?.length||0)/310),hostileFronts),
        Math.max(2,(cities+factories)*2));
    const intel=nuclearIntel(me,units);
    const enemySilos=intel.enemySilos.length,enemyNukes=intel.incomingNukes.length;
    const late=lateGame(me),siloCount=count('Missile Silo');
    // Begin anti-nuclear coverage before the late game, especially when a
    // nearby opponent has a silo; keep the first City/Factory affordable.
    const proactiveSAM=!basic&&!(crisisTrend&&nowTick<crisisTrend.expires)&&
      intel.uncovered.length>0&&
      intel.assets.length>=2&&gold>=350000&&
      troopSnapshot.incoming<troops*.10&&
      (hostileFronts>0||late);
    const threat=!!(enemySilos||enemyNukes);
    // A confirmed nuclear threat keeps SAM funding ahead of an income-collapse
    // rebuild. Preserve the existing first-core startup path separately.
    coreRecovery=economyRecoveryKernel({
      observed:incomeStatus.observed,train:incomeStatus.train,trade:incomeStatus.trade,
      cities,factories,failedEconomyProbes,startup,land:mine,
      incoming:troopSnapshot.incoming,nuclearThreat:threat}).coreRecovery;
    const siloAllowed=opts.nukes && game.config().isUnitDisabled?.('Missile Silo')!==true &&
      ['Atom Bomb','Hydrogen Bomb','MIRV'].some(t=>game.config().isUnitDisabled?.(t)!==true);
    const samSearchBlocked=samAffordableFailureSince!==null&&nowTick-samAffordableFailureSince>=180;
    const trusted=duoTrustedPeer();
    const peer=trusted&&actualFriendly(trusted.player,me)?trusted:null;
    const peerUnits=peer?(peer.player.units?.()||[]):[];
    const duoNuclear=duoNuclearInvestmentKernel({
      ownId:safeID(me),peerId:peer?.id,peerValid:!!peer,
      peerNuclearProtocol:peer?.state?.nuclearProtocol??null,
      peerCoreReady:peer?.state?.coreReady===true,
      peerSiloReady:peer?.state?.siloReady===true,
      siloSiteBlocked:nowTick<duoSiloBlockedUntil,
      peerSilos:peerUnits.filter(u=>u.isActive?.()&&u.type?.()==='Missile Silo').length,
      coreReady:coreComplete,
      siloAllowed,late,land:mine,silos:siloCount,nukeShots,
      ownSAM:count('SAM Launcher'),
      antiNuke:opts.antiNuke&&game.config().isUnitDisabled?.('SAM Launcher')!==true,
      enemySilos,incomingNukes:enemyNukes,uncovered:intel.uncovered.length,
      proactiveSAM,samSearchBlocked,urgentVictory:winStatus.urgent});
    const wantedSAM=duoNuclear.wantedSAM;
    // Both teammates build an initial guard when needed. Only the designated
    // partner funds a first silo until that partner actually owns a silo;
    // stale/untrusted relay state falls back to independent solo planning.
    const wantedSilo=duoNuclear.firstSiloWindow?
      (siloCount===0?1:nukeShots>0&&gold>2500000?
        Math.min(3,1+Math.floor(mine/18000)):1):0;
    const pressure=troops/cap;
    // Only territory and COMPLETED City levels increase maxTroops in the
    // pinned OpenFront engine. A Factory is evaluated for economic returns,
    // never treated as troop-cap relief.
    const capStalled=pressure>=.85&&cityEnabled&&
      troopSnapshot.incoming<troops*.08&&!immediate;
    const capacityCityDesired=capStalled?
      Math.max(wantedCity,cities+1):wantedCity;
    const posture=economyPosture(me,troopSnapshot,nowTick);
    const style=effectiveBuildStyle() || 'Ausgewogen';
    const defBoost=style==='Defensiv'?22:0,econBoost=style==='Wirtschaft'?24:0;
    // Repeated failed location/quote probes must not postpone the first
    // productive buildings forever. This changes priority, never worker legality.
    const productiveStall=failedEconomyProbes>=5&&!immediate&&!threat&&
      ((cityEnabled&&cities<3)||(factoryEnabled&&factories<3));
    const neural=neuralStrategicSignals(me,troopSnapshot,nowTick);
    const list=[
      {type:'City',desired:capacityCityDesired,score:92+
        (coreRecovery&&cities<2?530:0)+(cities<2&&basic?310:0)+
        (productiveStall&&cities<3?110:0)+(neural?.cityPriority||0)*90+econBoost/2+(posture==='recruit'?38:0)+Math.max(0,pressure-.35)*75+
          (pressure>.80&&!immediate?30:0)+(cities===0?115:hardMode()&&cities<2?80:0)+
          (capStalled?pressure>=.98?355:pressure>=.95?295:pressure>=.90?230:135:0)},
      {type:'Factory',desired:wantedFactory,score:91+
        (coreRecovery&&factories<2?520:0)+(factories<2&&basic?340:0)+
        (productiveStall&&factories<3?110:0)+(neural?.factoryPriority||0)*90+econBoost+(posture==='bootstrap'?20:0)+
          (factories===0?100:hardMode()&&factories<2?85:0)+
          (gold<450000?15:0)+(pressure<.60&&factories>0?10:0)+
          (factories<2&&cities>=2?24:0)-
          (incomeStatus.observed&&incomeStatus.train===0&&factories>=2?26:0)},
      {type:'Port',desired:wantedPort,score:tradePortMilestone?485:portMilestone?430:
        59+(neural?.portPriority||0)*90+econBoost/2+(posture==='breakout'?115:0)+(ports===0&&wantedPort?12:0)+
        (incomeStatus.observed&&incomeStatus.trade===0&&ports===0?35:0)+
        (duoTradeReady?55:0)+(ports<2&&coastSites.length?22:0)},
      {type:'Defense Post',desired:wantedDefense,score:immediate?310+defBoost:threatened?(basic?36:77)+(neural?.defensePriority||0)*90+defBoost+(posture==='defensive'?24:0):20},
      {type:'SAM Launcher',desired:wantedSAM,score:enemyNukes?510+defBoost:
        duoNuclear.firstGuard?465+defBoost:threat?175+defBoost:proactiveSAM?155+defBoost:40},
      {type:'Missile Silo',desired:wantedSilo,score:siloCount===0?410:opts.nukes?(late?131:94)+(neural?.nuclearPriority||0)*75+(gold>6000000?13:0):0}
    ];
    const crisisAllowed=type=>!immediate||
      ['Defense Post','SAM Launcher'].includes(type)||
      coreRecovery&&!enemyNukes&&['City','Factory'].includes(type);
    const value=list.filter(x=>crisisAllowed(x.type)&&x.desired>count(x.type)).map(x=>({...x,count:count(x.type),
      urgency:x.score+Math.min(50,35*(x.desired-count(x.type))/x.desired)}));
    // Upgrades become useful when expansion is tight or troop cap is near.
    if(opts.upgrades){
      for(const x of list.filter(x=>crisisAllowed(x.type)&&['City','Factory','Port','SAM Launcher','Missile Silo'].includes(x.type)&&count(x.type)>0 &&
        (x.type!=='SAM Launcher'||opts.antiNuke&&duoNuclear.samUpgradeAllowed) && (x.type!=='Missile Silo'||opts.nukes))){
        const upgradeScore=x.score-(count(x.type)<x.desired?17:36)+
          (x.type==='City'&&pressure>.75?27:0)+
          (x.type==='City'&&capStalled?35:0)+
          (x.type==='SAM Launcher'&&threat?32:0)+
          (x.type==='Missile Silo'&&late&&opts.nukes?22:0);
        value.push({...x,count:count(x.type),upgrade:true,urgency:upgradeScore});
      }
    }
    // Deduplicate type list for game actions, but keep separate build/upgrade priorities.
    value.sort((a,b)=>b.urgency-a.urgency);
    const saveForSilo=duoNuclear.siloFundActive&&!basic;
    const saveForNuke=siloAllowed && late && siloCount>0 &&
      intel.enemy.length>0 && nukeShots===0;
    const firstRocketFund=game.config().isUnitDisabled?.('Atom Bomb')===true?
      (game.config().isUnitDisabled?.('Hydrogen Bomb')===true?
        (game.config().isUnitDisabled?.('MIRV')===true?0:26000000):6400000):1100000;
    // A former legal quote is useful for funding, but must not freeze other
    // production forever after the front or shoreline changes.
    const samFund=duoNuclear.samFundingUrgent&&intel.uncovered.length>0&&
      wantedSAM>count('SAM Launcher')&&!samSearchBlocked&&
      nowTick-samQuotedTick<=300?samQuotedCost:0;
    // On Public Europe this first Port cost 500k, but a worker may omit a
    // buildable option while funds are low. Use an explicitly provisional
    // floor until a real, current worker quote replaces it.
    const portFund=portMilestone?
      (nowTick-portQuotedTick<=210&&portQuotedCost>0?portQuotedCost:
        // Provisional saving begins only after a productive core exists;
        // otherwise early harbor hoarding delays essential income buildings.
        cities>=2&&factories>=2&&!hardMode()?500000:0):0;
    const firstPortWindow=portMilestone&&(!capStalled||pressure<.95);
    const savingsTarget=immediate||coreRecovery?0:samFund>0?samFund:
      capStalled&&!firstPortWindow&&!enemyNukes?0:portFund>0?portFund:
      portMilestone||(threat&&intel.uncovered.length>0&&wantedSAM>0)?0:
      saveForSilo?1150000:saveForNuke?firstRocketFund:0;
    investmentStatus=immediate?'Verteidigung vor Investitionen':startup?'Erste Stadt/Fabrik':
      samFund>0&&gold<samFund?'SAM-Schutz '+Math.round(samFund).toLocaleString()+' Gold':
      duoNuclear.samFundingUrgent&&intel.uncovered.length>0&&
        wantedSAM>count('SAM Launcher')?'SAM-Schutz vor Raketenfonds':
      capStalled&&!firstPortWindow&&!enemyNukes?'Truppenlimit: Stadt/City-Upgrade oder Landgewinn priorisiert':
      portFund>0&&gold<portFund?'Hafen-Fonds '+Math.round(portFund).toLocaleString()+' Gold':
      portMilestone?'Hafen vor Silo':basic?'Zwei Städte und zwei Fabriken':
      saveForSilo?'Silo-Fonds 1,15 Mio.':saveForNuke?'Raketen-Fonds '+firstRocketFund.toLocaleString():'Wirtschaft & Offensive';
    const policyBiases={City:(neural?.cityPriority||0)*90,
      Factory:(neural?.factoryPriority||0)*90,
      Port:(neural?.portPriority||0)*90,
      'Defense Post':(neural?.defensePriority||0)*90,
      'SAM Launcher':0,
      'Missile Silo':(neural?.nuclearPriority||0)*75};
    return {list:value,policyBiases,threatened,gold,cities,factories,mine,pressure,nuclearThreat:threat,incomingNukes:enemyNukes,intel,
      startup,coreRecovery,incomeCollapse,basic,emergency,immediate,capStalled,firstPortWindow,savingsTarget,saveForSilo,saveForNuke,siloCount,
      enemySilos,proactiveSAM,wantedDefense,wantedSAM,portMilestone,coastSites:coastSites.length,portProbeFailures,
      samQuotedCost,portQuotedCost,posture,samSearchBlocked,
      duoNuclear, samFundingUrgent:duoNuclear.samFundingUrgent};
  }
  // Only actual worker quotes can establish a core funding target. A quote
  // when canBuild=false due to insufficient gold proves PRICE, not SITE.
  function coreFundingStatus(me,units=ownStructures(me),tick=number(()=>game.ticks(),0)){
    const missing=['City','Factory'].filter(type=>
      game.config().isUnitDisabled?.(type)!==true&&
      !units.some(u=>u.type?.()===type&&!u.isUnderConstruction?.()));
    for(const type of [...coreQuotes.keys()])
      if(!missing.includes(type))coreQuotes.delete(type);
    const live=[...coreQuotes].filter(([type,q])=>missing.includes(type)&&
      Number.isFinite(q.cost)&&q.cost>0&&tick-q.tick<=300);
    const gold=goldAmount(me);
    const price=live.length?Math.min(...live.map(([,q])=>q.cost)):null;
    coreFunding={tick,missing,gold,quotes:Object.fromEntries(coreQuotes),
      needed:price,shortfall:price===null?null:Math.max(0,price-gold),
      status:!missing.length?'core-ready':price===null?'price-unknown':
        gold>=price?'funded-recheck-worker':'saving-known-worker-price'};
    return coreFunding;
  }
  // One shared, short-lived spending ledger across economy, ships, missiles
  // and donations. Worker quotes are checked against current gold immediately
  // before send; unconfirmed overlapping intents cannot spend the same money.
  const goldBudgetBlockedSeen=new Map();
  function reportGoldBudgetBlocked(tick,purpose,data){
    const key=String(monitorSession)+'|'+purpose+'|'+data.floor+'|'+data.samFund+
      '|'+data.emergency;
    const prev=goldBudgetBlockedSeen.get(key);
    if(prev&&tick-prev.tick<80){prev.suppressed++;return;}
    const suppressed=prev?.suppressed||0;
    goldBudgetBlockedSeen.set(key,{tick,suppressed:0});
    if(goldBudgetBlockedSeen.size>120){
      for(const [k,v] of goldBudgetBlockedSeen)
        if(tick-v.tick>600)goldBudgetBlockedSeen.delete(k);
    }
    telemetry('gold_budget_blocked','Gemeinsamer Goldfonds schützt '+purpose,
      {...data,suppressedSinceLast:suppressed});
  }
  function spendBudget(me,cost,purpose,emergency=false,tiles=[]){
    const infinite=game.config().infiniteGold?.()===true;
    if(infinite)return true;
    const cash=goldAmount(me,NaN);
    if(!Number.isFinite(cash)||!Number.isFinite(cost)||cost<0)return false;
    const tick=number(()=>game.ticks(),0);
    budgetCommitments=budgetCommitments.filter(c=>
      tick-c.tick<=35&&cash>c.startGold-c.cost+1);
    const pending=budgetCommitments.reduce((n,c)=>n+c.cost,0);
    const units=ownStructures(me);
    const needs=economicNeeds(me,units,tiles);
    const core=coreFundingStatus(me,units,tick);
    // A real, still-required SAM quote outranks discretionary fleet/nukes.
    const samFund=needs.samFundingUrgent&&needs.wantedSAM>0&&
      needs.intel.uncovered.length>0&&!needs.samSearchBlocked&&
      Number.isFinite(needs.samQuotedCost)&&needs.samQuotedCost>0&&
      tick-samQuotedTick<=300?needs.samQuotedCost:0;
    let floor=needs.savingsTarget;
    if(purpose==='Warship')floor=needs.saveForSilo||needs.saveForNuke?
      Math.max(needs.savingsTarget,samFund):samFund;
    if(needs.coreRecovery&&['City','Factory'].includes(purpose)){
      // Only when no current troop invasion exists; final worker legality,
      // real quote and shared pending-gold checks still apply below.
      floor=0;
    }
    if(purpose==='SAM Launcher'&&needs.samFundingUrgent||
      purpose==='Port'&&needs.portMilestone&&
      needs.savingsTarget===needs.portQuotedCost||
      purpose==='Missile Silo'&&needs.saveForSilo||
      ['Atom Bomb','Hydrogen Bomb','MIRV'].includes(purpose)&&needs.saveForNuke&&
        !samFund)floor=0;
    if(emergency&&purpose==='Warship')floor=0;
    // A provisional first-Port estimate is not a permanent spending lock
    // once that estimate is funded but the worker offers no legal harbor.
    // The economy may then buy productive City/Factory alternatives.
    if(!samFund&&needs.portMilestone&&needs.portQuotedCost===0&&
      needs.savingsTarget>0&&cash>=needs.savingsTarget&&
      ['City','Factory'].includes(purpose))floor=0;
    // After repeated unsuccessful builds, release ONLY speculative silo/nuke
    // savings for a productive core. Never consume the observed SAM quote.
    if(needs.capStalled&&purpose==='City'&&!needs.incomingNukes&&!samFund)floor=0;
    if(!samFund&&!needs.nuclearThreat&&failedEconomyProbes>=5&&
      ['City','Factory'].includes(purpose)&&
      (needs.cities<3||needs.factories<3)&&
      (needs.saveForSilo||needs.saveForNuke))floor=0;
    // Do not spend the known price of the first productive building on
    // ships, nukes or donations. This never blocks actual emergency defense.
    const productive=purpose==='City'||purpose==='Factory';
    const urgent=purpose==='Defense Post'||
      purpose==='SAM Launcher'&&needs.samFundingUrgent||
      emergency&&purpose==='Warship';
    // Unknown prices are never invented. Preserve unrelated legal actions
    // until the worker supplies a real price, then protect that quote.
    if(core.missing.length&&!productive&&!urgent&&core.needed!==null)
      floor=Math.max(floor,core.needed);
    if(cash-pending-cost>=floor)return true;
    reportGoldBudgetBlocked(tick,purpose,
      {purpose,cost,cash,pending,floor,samFund,emergency});
    return false;
  }
  function commitGoldSpend(me,cost,purpose){
    if(game.config().infiniteGold?.()===true)return;
    budgetCommitments.push({tick:number(()=>game.ticks(),0),
      startGold:goldAmount(me),cost,purpose});
  }
  function economicAnchors(me,tiles,units,tick) {
    const w=game.width(),h=game.height(),anchors=[],seen=new Set();
    const add=ref=>{
      if(anchors.length>=190 || !Number.isInteger(ref)||seen.has(ref))return;
      seen.add(ref);
      if(ownedTile(ref,me))anchors.push(ref);
    };
    const addXY=(x,y)=>{if(x>=0&&y>=0&&x<w&&y<h)add(game.ref(x,y));};
    // Reserve early worker probes for SAMs around uncovered structures.
    // This must happen BEFORE interior/front samples fill the anchor cap.
    if(opts.antiNuke){
      const intel=nuclearIntel(me,units);
      for(const u of intel.uncovered.slice(0,8)){
        const t=number(()=>u.tile(),NaN);
        if(!Number.isInteger(t))continue;
        const x=game.x(t),y=game.y(t);
        for(const [dx,dy] of [[0,0],[25,0],[-25,0],[0,25],[0,-25],
          [45,0],[-45,0],[0,45],[0,-45],[25,25],[-25,-25]])
          addXY(x+dx,y+dy);
      }
    }
    // City/factory upgrades are anchored at existing units; relying on border
    // offsets makes these upgrades almost impossible on large maps.
    for(const u of units){const t=number(()=>u.tile(),NaN);if(!Number.isInteger(t))continue;
      add(t);const x=game.x(t),y=game.y(t);
      for(const [dx,dy] of [[18,0],[-18,0],[0,18],[0,-18],[40,0],[-40,0],[0,40],[0,-40]])addXY(x+dx,y+dy);
      if(anchors.length>=120)break;
    }
    const spawn=me.state?.spawnTile;
    if(Number.isInteger(spawn)){
      const sx=game.x(spawn),sy=game.y(spawn);add(spawn);
      for(const [dx,dy] of [[0,0],[20,0],[-20,0],[0,20],[0,-20],[50,0],[-50,0],[0,50],[0,-50],[80,0],[-80,0],[0,80],[0,-80]])addXY(sx+dx,sy+dy);
    }
    // Sample ALL owned regions, including the interior of a giant country.
    const spacing=Math.max(18,Math.ceil(Math.sqrt(w*h/750)));
    const phase=Math.floor(tick/90)%3;
    for(let y=Math.floor(spacing/2)+phase*3;y<h&&anchors.length<145;y+=spacing)
      for(let x=Math.floor(spacing/2)+phase*3;x<w&&anchors.length<145;x+=spacing)addXY(x,y);
    // Frontline anchors for defensive posts/ports; do not let them crowd out core tiles.
    if(tiles?.length){const step=Math.max(1,Math.floor(tiles.length/55));
      const offset=Math.floor(tick/90)%step;
      for(let i=offset;i<tiles.length&&anchors.length<190;i+=step){const t=tiles[i],x=game.x(t),y=game.y(t);
        add(t);for(const [dx,dy] of [[0,0],[15,0],[-15,0],[0,15],[0,-15],[38,0],[-38,0],[0,38],[0,-38]])addXY(x+dx,y+dy);
      }
    }
    return anchors;
  }
  function frontDistance(ref,fronts) {
    if(!fronts.length)return Infinity;
    const x=game.x(ref),y=game.y(ref);let closest=Infinity;
    for(const t of fronts){const dx=x-game.x(t),dy=y-game.y(t);
      const d=dx*dx+dy*dy;if(d<closest)closest=d;
    }
    return Math.sqrt(closest);
  }
  function shoreNear(ref) {
    if(typeof game.isShore!=='function')return false;
    const x=game.x(ref),y=game.y(ref),w=game.width(),h=game.height();
    for(const [dx,dy] of [[0,0],[8,0],[-8,0],[0,8],[0,-8],[15,0],[-15,0],[0,15],[0,-15]]){
      if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
      try{if(game.isShore(game.ref(x+dx,y+dy)))return true;}catch(_){}
    }
    return false;
  }
  // The browser GameView does not expose the server's RailNetwork.findStationsPath.
  // Probe ownership/terrain along bounded potential corridors instead of
  // assuming that every station within maxRange can actually connect.
  function railCorridor(from,to){
    const ax=game.x(from),ay=game.y(from),bx=game.x(to),by=game.y(to),
      dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    if(len<1)return 1;
    const steps=Math.min(140,Math.max(4,Math.ceil(len/2)));
    const pass=(x,y)=>{
      const xx=Math.round(x),yy=Math.round(y);
      if(typeof game.isValidCoord==='function'&&!game.isValidCoord(xx,yy))
        return false;
      if(xx<0||yy<0||xx>=game.width()||yy>=game.height())return false;
      const tile=game.ref(xx,yy);
      return ownedTile(tile,myPlayer())&&game.isLand?.(tile)!==false &&
        game.isImpassable?.(tile)!==true;
    };
    let best=0;
    // Try direct path and two mild bends; this is NOT a verified rail route.
    for(const bend of [0,.12,-.12]){
      let passed=0,longest=0,run=0;
      for(let i=0;i<=steps;i++){
        const t=i/steps,offset=bend*Math.sin(Math.PI*t);
        const x=ax+dx*t-dy*offset,y=ay+dy*t+dx*offset;
        if(pass(x,y)){passed++;run++;longest=Math.max(longest,run);}
        else run=0;
      }
      best=Math.max(best,(passed/(steps+1))*.35+
        (longest/(steps+1))*.65);
    }
    return best;
  }
  function railStationScore(ref,units){
    const cfg=game.config(),min=number(()=>cfg.trainStationMinRange?.(),12);
    const max=number(()=>cfg.trainStationMaxRange?.(),110);
    const x=game.x(ref),y=game.y(ref);
    const stations=units.filter(u=>['City','Factory','Port'].includes(u.type?.()) &&
      !u.isUnderConstruction?.() && u.hasTrainStation?.()!==false);
    let reachable=0,tooClose=0,blocked=0;
    for(const u of stations){
      const tile=number(()=>u.tile(),-1);
      if(tile<0)continue;
      const d=Math.hypot(x-game.x(tile),y-game.y(tile));
      if(d>=min&&d<=max){
        const likelihood=railCorridor(ref,tile);
        if(likelihood>=.83)reachable++;
        else blocked++;
      }
      if(d<min)tooClose++;
    }
    return {reachable,blocked,method:'owned-corridor-proxy',
      score:Math.min(40,reachable*15)-tooClose*30-blocked*7-
        (stations.length>1&&reachable===0?25:0)};
  }
  function siteScore(type,ref,fronts,units,priority,alreadyCoastal,precomputedDist) {
    const distance=precomputedDist===undefined?frontDistance(ref,fronts):precomputedDist;
    const coast=alreadyCoastal ?? shoreNear(ref);
    if(type==='Port'&&!coast)return -Infinity;
    let value=priority;
    if(type==='Defense Post'){
      const range=number(()=>game.config().defensePostRange?.(),30);
      // A post must finish construction BEHIND the frontier while still
      // protecting it. With an incoming attack, move the safe band deeper.
      const lost=armyTrend(number(()=>game.ticks(),0))?.tiles||0;
      const standoff=range*(troopSnapshot.incoming>0?.78:.65)+
        (opts.impossibleExperiment&&lost< -100?range*.08:0);
      if(fronts.length && (distance<standoff || distance>range-2))return -Infinity;
      if(!fronts.length)value-=75;
      else {
        let covered=0,uncovered=0;
        const x=game.x(ref),y=game.y(ref);
        const posts=units.filter(u=>u.type?.()==='Defense Post'&&!u.isUnderConstruction?.());
        for(const ft of fronts){const fx=game.x(ft),fy=game.y(ft);
          if((fx-x)**2+(fy-y)**2>(range-2)**2)continue;
          if(posts.some(p=>{const px=game.x(p.tile()),py=game.y(p.tile());
            return (fx-px)**2+(fy-py)**2<=range**2;}))covered++;
          else uncovered++;
        }
        value+=Math.min(95,uncovered*8)+Math.min(12,covered)-Math.abs(distance-range*.86)*1.4;
        if(uncovered===0)value-=75;
      }
    }
    else if(type==='SAM Launcher'){
      // SAMs belong near protected assets, but not where an advancing army
      // can capture them before the launcher is finished.
      if(fronts.length && distance<Math.max(34,number(()=>game.config().samRange?.(1),70)*.52))return -Infinity;
      const intel=nuclearIntel(myPlayer(),units);
      const coverage=samCoverageValue(ref,units,intel);
      if(intel.uncovered.length && coverage<=0)return -Infinity;
      value+=coverage*1.8+Math.min(10,distance*.05);
    }
    else {
      const lost=armyTrend(number(()=>game.ticks(),0))?.tiles||0;
      const safety=troopSnapshot.incoming>0||
        (opts.impossibleExperiment&&lost< -100)?36:20;
      if(fronts.length && distance<safety)return -Infinity;
      value+=Number.isFinite(distance)?Math.min(50,distance*.24)-Math.max(0,80-distance)*1.2:30;
      // Repeated zero ship revenue after a completed harbor is not a reason
      // to buy yet another idle harbor ahead of productive core buildings.
      if(type==='Port'&&units.some(u=>u.type?.()==='Port'&&
        !u.isUnderConstruction?.())&&incomeStatus.observed&&
        incomeStatus.trade===0)value-=65;
      if(['City','Factory','Port'].includes(type))value+=railStationScore(ref,units).score;
      if(type==='Factory'){
        // Favor nearby City/Port infrastructure without assuming rail connectivity.
        const hubs=units.filter(u=>['City','Port'].includes(u.type?.()) &&
          u.isUnderConstruction?.()!==true);
        if(hubs.length){
          const x=game.x(ref),y=game.y(ref);
          const nearest=Math.min(...hubs.map(u=>Math.hypot(x-game.x(u.tile()),y-game.y(u.tile()))));
          value+=nearest>=18&&nearest<=105?22:nearest>160?-20:0;
        }
      }
    }
    const same=units.filter(u=>u.type?.()===type).map(u=>number(()=>u.tile(),-1)).filter(t=>t>=0);
    if(same.length){const x=game.x(ref),y=game.y(ref);
      let nearest=Infinity;
      for(const t of same){const d=Math.hypot(x-game.x(t),y-game.y(t));if(d<nearest)nearest=d;}
      if(nearest<30)value-=33;
      else value+=Math.min(16,nearest*.08);
    }
    return value;
  }
  async function economy(me,tick,serial,tiles) {
    if(!opts.economy || (!ctors.build&&!ctors.upgrade))return false;
    const units=ownStructures(me);
    if(pendingEconomy(tick,units))return false;
    if(tick-lastEconomy<35 || tick-lastEconomyProbe<18)return false;
    lastEconomyProbe=tick;
    for(const [k,expiry] of economicBlocked)if(tick>=expiry)economicBlocked.delete(k);
    for(const [k,expiry] of economicNegative)if(tick>=expiry)economicNegative.delete(k);
    const requirements=economicNeeds(me,units,tiles);
    const funding=coreFundingStatus(me,units,tick);
    // Read-only snapshot from the actual economy planner, never recomputed in paint().
    economyBudgetEvidence={tick,gold:requirements.gold,
      capUse:troopSnapshot.max>0?troopSnapshot.home/troopSnapshot.max:null,
      cityWanted:requirements.capStalled||requirements.list.some(x=>x.type==='City'),
      cityCount:requirements.cities,capStalled:requirements.capStalled,
      wantedSAM:requirements.wantedSAM,nuclearThreat:requirements.nuclearThreat,
      incomingNukes:requirements.incomingNukes,
      duoNuclear:requirements.duoNuclear,
      samQuote:tick-samQuotedTick<=300&&samQuotedCost>0?samQuotedCost:null,
      portMilestone:requirements.portMilestone,
      portQuote:tick-portQuotedTick<=210&&portQuotedCost>0?portQuotedCost:null,
      goldFloor:requirements.savingsTarget,coreQuote:funding.needed,
      coreRecovery:requirements.coreRecovery,
      semantics:'shared savings target; individual build exceptions still apply'};
    // A cached price saves worker traffic while underfunded; refresh once
    // the price is funded or quotes age. Never assert a legal site from it.
    if(!requirements.immediate&&!requirements.samFundingUrgent&&
      funding.missing.length&&funding.needed!==null&&
      requirements.gold<funding.needed&&
      tick-Math.min(...[...coreQuotes.values()].map(q=>q.tick))<130){
      economicStatus='Spare auf ersten Kernbau: '+Math.floor(requirements.gold).toLocaleString()+
        '/'+funding.needed.toLocaleString()+' Gold (Worker-Preis, Standort offen)';
      if(tick-lastCoreFundingReport>=100){
        lastCoreFundingReport=tick;
        telemetry('core_funding_wait',economicStatus,{coreFunding:funding,
          evidence:'price-observed-not-legal-build'});
      }
      return false;
    }
    if(requirements.samSearchBlocked)decisionNote('sam-blockiert',
      'SAM bezahlbar, aber wiederholt kein Bauplatz bestätigt; andere Bauten freigegeben',
      ['Standortsuche wird fortgesetzt; Spielregeln und Platzierung bleiben ungeklärt'],tick);
    investmentAssessments=[];
    const entries=requirements.list;
    if(lastEconomyPosture!==requirements.posture){
      lastEconomyPosture=requirements.posture;
      telemetry('economy_posture','Investitionsziel: '+requirements.posture,
        {posture:requirements.posture,priorities:entries.slice(0,3).map(e=>e.type)});
    }
    // Do not waste worker queries or count failed builds while deliberately
    // accumulating funds for the first silo / first atomic strike.
    if(requirements.savingsTarget>0 && !requirements.coreRecovery &&
      !requirements.immediate && !requirements.samFundingUrgent &&
      !requirements.portMilestone && !game.config().infiniteGold?.() &&
      requirements.gold<requirements.savingsTarget){
      economicStatus='Spare: '+investmentStatus+' ('+Math.floor(requirements.gold).toLocaleString()+
        '/'+requirements.savingsTarget.toLocaleString()+' Gold)';
      return false;
    }
    if(!entries.length){economicStatus='Gebäudeziele erreicht · '+investmentStatus;return false;}
    const anchors=economicAnchors(me,tiles,units,tick);
    const coastal=opts.boats&&entries.some(e=>e.type==='Port'&&!e.upgrade)?
      portCoastalAnchors(me,tiles,tick,72):[];
    if(!anchors.length && !coastal.length){
      economicStatus='Kein eigenes Bauland gefunden';
      if(requirements.coreRecovery)telemetry('core_recovery_block',economicStatus,{
        missing:funding.missing,gold:requirements.gold,
        cause:'no-owned-anchor-not-gold',
        evidence:'candidate-search-no-worker-build-receipt'});
      return false;
    }
    const meID=safeID(me),all=game.playerViews?.()||[];
    const fronts=[];
    const borderStride=Math.max(1,Math.floor((tiles?.length||0)/220));
    for(let i=0;i<(tiles?.length||0);i+=borderStride){
      const tile=tiles[i];if(fronts.length>=160)break;
      const scratch=[];const count=game.neighbors4(tile,scratch);
      for(let n=0;n<count;n++){const owner=game.owner(scratch[n]);
        if(safeID(owner)!==null&&safeID(owner)!==meID&&!friendly(owner,me)){
          fronts.push(tile);break;
        }
      }
    }
    // Supplement sparse sampled border cells with observed hostile target
    // tiles; never mistake an arbitrary friendly border for an enemy front.
    for(const group of strategic.groups){
      if(fronts.length>=180)break;
      if(group.id===null || !group.opponent?.isAlive?.()||friendly(group.opponent,me))continue;
      for(const tile of group.tiles||[]){
        if(fronts.length>=180)break;
        if(safeID(game.owner(tile))===safeID(group.opponent))fronts.push(tile);
      }
    }
    const rankedAnchors=anchors.map(ref=>({ref,coast:shoreNear(ref),dist:frontDistance(ref,fronts)}));
    const rankedCoast=coastal.map(ref=>({
      ref,coast:true,dist:frontDistance(ref,fronts)}));
    const siteCache=new Map();
    const score=(entry,site)=>{
      const key=entry.type+':'+site.ref;
      if(!siteCache.has(key))siteCache.set(key,siteScore(entry.type,site.ref,fronts,units,0,site.coast,site.dist));
      return entry.urgency+siteCache.get(key);
    };
    const recovery=failedEconomyProbes>=5;
    const slots=[];
    for(const entry of entries.slice(0,8)){
      if(entry.upgrade && !ctors.upgrade)continue;
      if(!entry.upgrade && !ctors.build)continue;
      // Upgrades must probe existing structures, whereas new buildings probe free land.
      const valid=entry.upgrade?rankedAnchors.filter(a=>units.some(u=>u.type?.()===entry.type && number(()=>u.tile(),-1)===a.ref)):
        entry.type==='Port'?rankedCoast:rankedAnchors;
      valid.sort((a,b)=>score(entry,b)-score(entry,a));
      let ordered=valid;
      if(entry.type==='Port'&&!entry.upgrade&&valid.length>1){
        // Keep the strongest safe harbors AND explore the rest of the coast.
        // The old top-12-only rotation repeatedly tested illegal shore cells.
        const best=valid.slice(0,Math.min(valid.length,4));
        const remainder=valid.slice(best.length);
        const offset=remainder.length?Math.floor(tick/40)*11%remainder.length:0;
        ordered=best.concat(remainder.slice(offset),remainder.slice(0,offset));
        buildCursor=(buildCursor+7)%valid.length;
      }
      for(const site of ordered.slice(0,entry.upgrade?4:
        entry.type==='Port'?recovery?24:18:recovery?12:6))slots.push({entry,site});
    }
    // Probe best geographic options across building types; never sequentially
    // spend the entire time budget on the first City anchor.
    slots.sort((a,b)=>score(b.entry,b.site)-score(a.entry,a.site));
    const seen=new Set(), proposals=[],perKind=new Map();
    const probe={queries:0,errors:0,legal:0,unaffordable:0,invalidSite:0,
      lowestCost:Infinity,quoteByType:{},underfundedByType:{},workerNoOfferByType:{},
      budgetRejected:0,siteRejected:0,priorityRejected:0,
      lowestCore:Infinity,portQueries:0,portLegal:0,samQueries:0,
      siloQueries:0,siloLegal:0,siloUnderfunded:0,
      samLegal:0,samUnaffordable:0,samUnsafe:0,samNoWorkerBuild:0,
      samSites:0};
    const work=[];
    // A dozen City anchors must not evict every Factory / SAM / silo query.
    for(const slot of slots){
      if(work.length>=(recovery?30:21))break;
      const kind=slot.entry.type+':'+!!slot.entry.upgrade;
      if((perKind.get(kind)||0)>(slot.entry.type==='Port'?(recovery?15:10):(recovery?5:3)))continue;
      const key=kind+':'+slot.site.ref;
      if(seen.has(key)||(economicNegative.get(key)??0)>tick)continue;
      seen.add(key);work.push(slot);
      perKind.set(kind,(perKind.get(kind)||0)+1);
    }
    // Keep an independent rotation of safe SAM sites, including sites that
    // never appear in generic inland probes or their short negative cache.
    const samEntry=entries.find(x=>x.type==='SAM Launcher'&&!x.upgrade);
    if(samEntry&&requirements.intel.uncovered.length){
      const samRefs=samBuildAnchors(me,requirements.intel,tick);
      probe.samSites=samRefs.length;
      const ranked=samRefs.map(ref=>({ref,coast:shoreNear(ref),dist:frontDistance(ref,fronts)}))
        .filter(site=>Number.isFinite(score(samEntry,site)))
        .sort((a,b)=>score(samEntry,b)-score(samEntry,a));
      const top=ranked.slice(0,6),remainder=ranked.slice(6);
      const offset=remainder.length?Math.floor(tick/40)*13%remainder.length:0;
      const rotated=top.concat(remainder.slice(offset),remainder.slice(0,offset));
      const extra=[];
      for(const site of rotated){
        if(extra.length>=18)break;
        const key='SAM Launcher:false:'+site.ref;
        if((economicNegative.get(key)??0)>tick ||
          work.some(x=>x.entry.type==='SAM Launcher'&&!x.entry.upgrade&&x.site.ref===site.ref))continue;
        extra.push({entry:samEntry,site});
      }
      work.unshift(...extra);
    }
    // Nuclear emergency and immediate land defense have their own lane.
    // Never discard legal SAM/defense candidates merely because the first
    // harbor also has high priority. Harbor-only probes apply only when safe.
    const urgentSAM=requirements.samFundingUrgent&&requirements.wantedSAM>0&&
      requirements.intel.uncovered.length>0;
    const urgentLand=requirements.immediate&&requirements.wantedDefense>0;
    if(requirements.capStalled&&!requirements.firstPortWindow&&!urgentSAM&&!urgentLand){
      // The worker loop stops as soon as any legal proposal appears.
      // Without a City-first probe, a cheaper Port can win before a legal
      // capacity-building City is ever examined.
      const citySlots=slots.filter(x=>x.entry.type==='City'&&
        (economicNegative.get(x.entry.type+':'+!!x.entry.upgrade+':'+x.site.ref)??0)<=tick);
      const cityWork=work.filter(x=>x.entry.type==='City');
      if(!cityWork.length&&citySlots.length)
        work.unshift(...citySlots.slice(0,Math.min(3,citySlots.length)));
      work.sort((a,b)=>(b.entry.type==='City'?1:0)-
        (a.entry.type==='City'?1:0));
    }
    if(requirements.firstPortWindow&&!urgentSAM&&!urgentLand){
      const portWork=work.filter(x=>x.entry.type==='Port'&&!x.entry.upgrade);
      if(portWork.length)work.splice(0,work.length,...portWork,
        ...work.filter(x=>x.entry.type!=='Port'||x.entry.upgrade));
    }
    if(requirements.firstPortWindow && !urgentSAM && !urgentLand && coastal.length &&
      !work.some(x=>x.entry.type==='Port'&&!x.entry.upgrade)){
      const portEntry=entries.find(x=>x.type==='Port'&&!x.upgrade);
      const portSite=portEntry&&rankedCoast.filter(x=>
        (economicNegative.get('Port:false:'+x.ref)??0)<=tick)
        .sort((a,b)=>score(portEntry,b)-score(portEntry,a))[0];
      if(portSite)work.unshift({entry:portEntry,site:portSite});
    }
    // Worker probes stay bounded; record individual negative site/type checks.
    for(let offset=0;offset<work.length;offset+=3){
      if(!live(serial))return false;
      const batch=work.slice(offset,offset+3);
      const answers=await Promise.all(batch.map(async slot=>{
        runtime.buildProbes++;probe.queries++;
        if(slot.entry.type==='Port')probe.portQueries++;
        if(slot.entry.type==='SAM Launcher')probe.samQueries++;
        if(slot.entry.type==='Missile Silo'&&!slot.entry.upgrade)probe.siloQueries++;
        try{return {slot,legal:await me.actions(slot.site.ref,[slot.entry.type])};}
        catch(_){probe.errors++;return {slot,legal:null};}
      }));
      if(!live(serial))return false;
      for(const {slot,legal} of answers){
        if(!legal)continue;
        const {entry,site}=slot;
        // The worker supplies a price even when insufficient gold makes
        // canBuild false. Read it BEFORE testing legality; price is not a
        // build authorization, and an upgrade quote is not a new-site price.
        const quote=legal.buildableUnits?.find(u=>u.type===entry.type);
        const quoted=Number(quote?.cost);
        if(!quote)probe.workerNoOfferByType[entry.type]=
          (probe.workerNoOfferByType[entry.type]||0)+1;
        const funds=goldAmount(me);
        if(['City','Factory'].includes(entry.type)&&!entry.upgrade&&
          Number.isFinite(quoted)&&quoted>0){
          const old=probe.quoteByType[entry.type];
          probe.quoteByType[entry.type]=Math.min(old??Infinity,quoted);
          probe.lowestCore=Math.min(probe.lowestCore,quoted);
          const existing=coreQuotes.get(entry.type);
          if(!existing||quoted<=existing.cost||tick-existing.tick>=90)
            coreQuotes.set(entry.type,{cost:quoted,tick});
        }
        const priceBlocked=!game.config().infiniteGold?.()&&Number.isFinite(quoted)&&quoted>funds;
        if(!entry.upgrade&&Number.isFinite(quoted)&&quoted>0){
          if(entry.type==='SAM Launcher'){
            samQuotedCost=quoted;samQuotedTick=tick;
            if(priceBlocked)samAffordableFailureSince=null;
            else if(Number.isInteger(quote.canBuild))samAffordableFailureSince=null;
            else if(samAffordableFailureSince===null)samAffordableFailureSince=tick;
            if(requirements.nuclearThreat&&!requirements.samSearchBlocked)
              requirements.savingsTarget=quoted;
          }
          if(entry.type==='Port'&&requirements.portMilestone){
            portQuotedCost=quoted;portQuotedTick=tick;
          }
        }
        if(priceBlocked){
          if(entry.type==='Missile Silo'&&!entry.upgrade)probe.siloUnderfunded++;
          probe.underfundedByType[entry.type]=
            (probe.underfundedByType[entry.type]||0)+1;
          probe.unaffordable++;
          if(entry.type==='SAM Launcher')probe.samUnaffordable++;
          probe.lowestCost=Math.min(probe.lowestCost,quoted);
          // Low funds are not an invalid site: retry immediately when funded.
          continue;
        }
        if(entry.type==='SAM Launcher' && !legal.buildableUnits?.some(u=>
          u.type==='SAM Launcher'&&Number.isInteger(u.canBuild)))probe.samNoWorkerBuild++;
        if(entry.type!=='Port' && !legal.buildableUnits?.some(u=>u.type===entry.type &&
          (entry.upgrade?u.canUpgrade!==false&&u.canUpgrade!==undefined:
            Number.isInteger(u.canBuild)))){
          const key=entry.type+':'+!!entry.upgrade+':'+site.ref;
          if(economicNegative.size>500)economicNegative.clear();
          economicNegative.set(key,tick+100);
        }
        for(const item of entries.slice(0,8)){
          // The answer belongs to THIS build/upgrade candidate only; otherwise
          // low-priority buildings steal time and sites from high-priority ones.
          if(item!==slot.entry)continue;
          const b=legal?.buildableUnits?.find(u=>u.type===item.type);
          if(!b)continue;
          const isUpgrade=!!item.upgrade;
          if(isUpgrade&&!ctors.upgrade || !isUpgrade&&!ctors.build)continue;
          if(isUpgrade ? (b.canUpgrade===false || b.canUpgrade===undefined) : (b.canBuild===false || (b.canUpgrade!==false && b.canUpgrade!==undefined)))continue;
          probe.legal++;
          if(item.type==='Port')probe.portLegal++;
          if(item.type==='SAM Launcher')probe.samLegal++;
          const tile=isUpgrade?site.ref:b.canBuild;
          if(!Number.isInteger(tile) || !ownedTile(tile,me)){
            probe.invalidSite++;probe.siteRejected++;continue;
          }
          if(item.type==='Missile Silo'&&!isUpgrade)probe.siloLegal++;
          const key=(isUpgrade?'upgrade':'build')+':'+item.type+':'+tile;
          if((economicBlocked.get(key)??0)>tick)continue;
          const cost=Number(isUpgrade?(b.upgradeCosts?.[0]??b.cost):b.cost);
          const gold=goldAmount(me);
          const infinite=game.config().infiniteGold?.()===true;
          if(Number.isFinite(cost))probe.lowestCost=Math.min(probe.lowestCost,cost);
          if(Number.isFinite(cost)&&cost>0){
            if(item.type==='SAM Launcher'&&!isUpgrade){
              samQuotedCost=cost;samQuotedTick=tick;
            }
            if(item.type==='Port'&&!isUpgrade&&requirements.portMilestone){
              portQuotedCost=cost;portQuotedTick=tick;
            }
          }
          if(!infinite && (!Number.isFinite(cost)||cost>gold)){
            probe.unaffordable++;
            if(item.type==='SAM Launcher')probe.samUnaffordable++;
            continue;
          }
          const essential=(item.type==='City'&&requirements.cities===0)||
            (item.type==='Factory'&&requirements.factories===0)||
            (item.type==='Defense Post'&&requirements.immediate)||
            (item.type==='SAM Launcher'&&requirements.samFundingUrgent)||
            (item.type==='Missile Silo'&&opts.nukes&&lateGame(me));
          const economicCore=item.type==='City'||item.type==='Factory';
          // Fund the first economic structures before buying defensive posts,
          // ports or upgrades. Emergency SAM / defense remain possible.
          if(requirements.startup && (!economicCore || isUpgrade) && !essential)continue;
          if(requirements.firstPortWindow&&!requirements.immediate&&
            probe.portLegal>0 && item.type!=='Port' &&
            !(item.type==='SAM Launcher'&&requirements.samFundingUrgent))
            continue;
          if(item.type==='Defense Post' && !requirements.immediate &&
            !requirements.incomingNukes && requirements.basic)continue;
          // While saving for a silo / first atomic strike, do not repeatedly
          // spend the whole treasury on expandable city/factory goals.
          if(!infinite && requirements.savingsTarget>0 && !requirements.immediate &&
            !(item.type==='SAM Launcher'&&requirements.samFundingUrgent) &&
            !(item.type==='Defense Post'&&requirements.immediate) &&
            !(item.type==='Missile Silo'&&requirements.saveForSilo) &&
            !(item.type==='Port'&&requirements.portMilestone&&!requirements.nuclearThreat) &&
            // After fully funding the first harbor, no worker-offered Port
            // should stall all other productive buildings this cycle.
            !(requirements.portMilestone&&!hardMode()&&!requirements.nuclearThreat&&
              probe.portQueries>0&&probe.portLegal===0&&
              gold>=requirements.savingsTarget) &&
            gold-cost<requirements.savingsTarget){probe.budgetRejected++;continue;}
          const reserve=gold>650000?Math.min(220000,gold*.12):0;
          if(!infinite&&!essential&&
            !(requirements.capStalled&&item.type==='City'&&!requirements.incomingNukes)&&
            gold-cost<reserve){probe.budgetRejected++;continue;}
          let siteValue=siteScore(item.type,tile,fronts,units,item.urgency);
          if(!Number.isFinite(siteValue)){
            if(item.type==='SAM Launcher')probe.samUnsafe++;
            continue;
          }
          if(!infinite && gold>0)siteValue-=Math.min(36,(cost/gold)*26);
          const assessment=investmentAssessment(item,cost,requirements,units);
          siteValue+=assessment.score;
          if(isUpgrade)siteValue-=Math.max(0,number(()=>units.find(u=>u.id?.()===b.canUpgrade)?.level(),1)-2)*6;
          if(!isUpgrade && item.count>=item.desired)continue;
          const old=units.find(u=>u.id?.()===b.canUpgrade);
          proposals.push({kind:isUpgrade?'upgrade':'build',type:item.type,tile,requestTile:site.ref,
            unitId:b.canUpgrade,level:number(()=>old?.level(),0),cost,siteValue,assessment});
          if(!investmentAssessments.some(x=>x.type===assessment.type&&x.cost===assessment.cost))
            investmentAssessments.push(assessment);
        }
      }
      if(proposals.length)break;
    }
    // Only an actually attempted funded scan without a legal site yields
    // first-silo lead. Low gold and worker errors never prove unbuildability.
    if(requirements.duoNuclear.firstSiloWindow&&requirements.siloCount===0&&
      probe.siloQueries>=2&&probe.siloLegal===0&&
      probe.siloUnderfunded===0&&probe.errors===0&&
      (game.config().infiniteGold?.()||requirements.gold>=1150000)){
      duoSiloBlockedUntil=Math.max(duoSiloBlockedUntil,tick+180);
      telemetry('duo_silo_site_blocked','Erster Silo: kein legaler Worker-Standort',{
        probes:probe.siloQueries,untilTick:duoSiloBlockedUntil,
        evidence:'attempted-no-legal-site-not-underfunded'});
    }
    if(!proposals.length){
      // Waiting for a documented price is not a worker/site failure.
      const underfundedCore=(probe.quoteByType.City!==undefined||
        probe.quoteByType.Factory!==undefined)&&
        probe.legal===0&&probe.errors===0&&
        probe.unaffordable===probe.queries;
      if(!underfundedCore)failedEconomyProbes++;
      else lastCoreFundingReport=tick;

      if(requirements.wantedSAM>0&&requirements.intel.uncovered.length&&
        (failedEconomyProbes===1||failedEconomyProbes%4===0))
        telemetry('sam_probe','SAM-Standorte / Budget geprüft',
          {enemySilos:requirements.enemySilos,uncovered:requirements.intel.uncovered.length,
            alliedUncovered:requirements.intel.allyUncovered.length,
            candidates:probe.samSites,queries:probe.samQueries,legal:probe.samLegal,
            unaffordable:probe.samUnaffordable,unsafe:probe.samUnsafe,
            unavailable:probe.samNoWorkerBuild,gold:requirements.gold,
            workerNoOfferCause:probe.samUnaffordable?'insufficient-gold':
              probe.samNoWorkerBuild?'unresolved: game rules or location':null,
            unitDisabled:game.config().isUnitDisabled?.('SAM Launcher')===true,
            quotedCost:samQuotedCost,lowestCost:Number.isFinite(probe.lowestCost)?probe.lowestCost:null});
      if(requirements.portMilestone && probe.portQueries>0 &&
        probe.portLegal===0 && (hardMode() || game.config().infiniteGold?.()||
          requirements.gold>=requirements.portQuotedCost&&requirements.portQuotedCost>0 ||
          requirements.gold>=500000)){
        portProbeFailures++;
        if(portProbeFailures===8)lastPortRetryTick=tick;
      }
      if(requirements.portMilestone && probe.portQueries>0 &&
        (portProbeFailures===1||portProbeFailures===4||portProbeFailures===8))
        telemetry('port_probe','Hafen-Bauplätze im Worker geprüft',
          {coastCandidates:coastal.length,queries:probe.portQueries,
            legal:probe.portLegal,unaffordable:probe.unaffordable,
            fundingEstimate:requirements.portQuotedCost||500000,
            fundingUncertain:requirements.portQuotedCost===0,
            failures:portProbeFailures});
      const lastPrice=coreFundingStatus(me,units,tick);
      lastEconomyProbeReport={tick,gold:requirements.gold,
        queries:probe.queries,workerErrors:probe.errors,legal:probe.legal,
        coreFunding:lastPrice,quoteByType:probe.quoteByType,
        underfundedByType:probe.underfundedByType,
        workerNoOfferByType:probe.workerNoOfferByType,
        budgetRejected:probe.budgetRejected,siteRejected:probe.siteRejected,
        invalidSite:probe.invalidSite,priorityRejected:probe.priorityRejected,
        lowestCost:Number.isFinite(probe.lowestCost)?probe.lowestCost:null};
      const reason=probe.samUnaffordable>0&&requirements.nuclearThreat?
        'Spare auf SAM: '+samQuotedCost.toLocaleString()+' Gold':probe.unaffordable>0&&probe.legal===0?
        'Gold für Bauoption fehlt; Standort noch ungeprüft':probe.invalidSite>0?
        'Bauplatz-Eigentum/Referenz ungültig':probe.legal===0?
        'Keine legalen Bauoptionen im geprüften Gebiet':'Baukandidaten durch Priorität oder Reserve gesperrt';
      economicStatus=underfundedCore&&lastPrice.needed!==null?
        'Spare auf ersten Kernbau: '+requirements.gold.toLocaleString()+
        '/'+lastPrice.needed.toLocaleString()+' Gold (Standort noch unbestätigt)':reason;
      if(underfundedCore || failedEconomyProbes===5 || failedEconomyProbes%10===0)
        telemetry('build_stalled',reason,{attempts:failedEconomyProbes,
          probe: lastEconomyProbeReport,
          gold:requirements.gold,investment:investmentStatus,priorities:entries.slice(0,4).map(e=>e.type),
          nuclear:{enemySilos:requirements.enemySilos,incomingNukes:requirements.incomingNukes,
            uncovered:requirements.intel.uncovered.length,
            alliedUncovered:requirements.intel.allyUncovered.length,
            wantedSAM:requirements.wantedSAM,
            proactiveSAM:requirements.proactiveSAM},
          queries:probe.queries,workerErrors:probe.errors,legal:probe.legal,
          port:{coastCandidates:coastal.length,queries:probe.portQueries,
            legal:probe.portLegal,failures:portProbeFailures,
            quotedCost:portQuotedCost},
          sam:{candidates:probe.samSites,queries:probe.samQueries,
            legal:probe.samLegal,unaffordable:probe.samUnaffordable,
            unsafe:probe.samUnsafe,unavailable:probe.samNoWorkerBuild,
            workerNoOfferCause:probe.samUnaffordable?'insufficient-gold':
              probe.samNoWorkerBuild?'unresolved: game rules or location':null,
            unitDisabled:game.config().isUnitDisabled?.('SAM Launcher')===true,
            quotedCost:samQuotedCost},
          unaffordable:probe.unaffordable,invalidSite:probe.invalidSite,
          lowestCost:Number.isFinite(probe.lowestCost)?probe.lowestCost:null});
      economicLastPlan=entries.slice(0,3).map(x=>x.type).join(' › ');return false;}
    // Economy has its own async scheduler. Its action ranking must use the
    // currently observed army, not a potentially uninitialized combat tick.
    const rankingMilitary=military(me,strategic.groups);
    for(const item of proposals){
      item.baseScore=item.siteValue;
      item.neuralDelta=neuralActionDelta('economy',item.siteValue,me,rankingMilitary,{
        type:item.type,
        magnitude:clamp((STRUCTURE_TYPES.indexOf(item.type)+1)/STRUCTURE_TYPES.length,0,1),
        opportunity:clamp(item.siteValue/150,0,1),
        cost:clamp(item.cost/Math.max(1,goldAmount(me)),0,1),
        risk:item.kind==='upgrade'?0.25:0
      });
      item.siteValue+=item.neuralDelta;
    }
    proposals.sort((a,b)=>b.siteValue-a.siteValue);
    // Near the troop cap, prioritize a worker-confirmed City or City upgrade,
    // not a Factory; the legal site, cost and invasion vetoes still apply.
    const urgentSAMChoice=requirements.samFundingUrgent&&
      requirements.wantedSAM>0&&requirements.intel.uncovered.length>0?
      proposals.find(x=>x.type==='SAM Launcher'):null;
    const legalFirstPort=!urgentSAMChoice&&requirements.firstPortWindow?
      proposals.find(x=>x.type==='Port'&&x.kind==='build'):null;
    const capCity=requirements.capStalled&&!requirements.incomingNukes&&
      !urgentSAMChoice&&!legalFirstPort?
      proposals.find(x=>x.type==='City'&&x.kind==='upgrade')||
      proposals.find(x=>x.type==='City'):null;
    const chosen=urgentSAMChoice||legalFirstPort||capCity||proposals[0];
    const withoutPolicy=[...proposals].sort((a,b)=>
      (b.baseScore-(requirements.policyBiases[b.type]||0))-
      (a.baseScore-(requirements.policyBiases[a.type]||0)))[0];
    neuralDecisionEvidence={tick,kind:'economy',
      model:neuralModelInfo(),headBiasByType:requirements.policyBiases,
      ruleChoice:withoutPolicy?{type:withoutPolicy.type,
        score:withoutPolicy.baseScore-(requirements.policyBiases[withoutPolicy.type]||0)}:null,
      policyChoice:{type:chosen.type,score:chosen.baseScore},
      actionDelta:chosen.neuralDelta,
      finalScore:chosen.siteValue,
      changedChoice:!!withoutPolicy&&withoutPolicy!==chosen,
      evidence:'ranking-only-worker-legality-preserved'};
    lastEconomyProbeReport={tick,gold:requirements.gold,
      queries:probe.queries,workerErrors:probe.errors,legal:probe.legal,
      quoteByType:probe.quoteByType,underfundedByType:probe.underfundedByType,
      workerNoOfferByType:probe.workerNoOfferByType,
      budgetRejected:probe.budgetRejected,siteRejected:probe.siteRejected,
      priorityRejected:probe.priorityRejected,
      lowestCost:Number.isFinite(probe.lowestCost)?probe.lowestCost:null,
      selected:chosen.type,coreFunding:coreFundingStatus(me,units,tick)};
    if(!live(serial))return false;
    // Revalidate the *selected* worker option after the async site scan.
    // A candidate may have lost its tile, upgrade ID or price meanwhile.
    const freshTick=number(()=>game.ticks(),tick);
    if(freshTick<tick||freshTick-tick>12){
      telemetry('build_stale_skip','Bauplan zu alt; frischen Worker-Zustand abwarten',
        {type:chosen.type,plannedTick:tick,freshTick});return false;
    }
    const currentMilitary=military(me,strategic.groups);
    if(economicDefensePressure(me,currentMilitary)&&
      !['Defense Post','SAM Launcher'].includes(chosen.type)){
      telemetry('build_crisis_skip','Wirtschaftsbau wegen aktuellem Angriff zurückgestellt',
        {type:chosen.type,incoming:currentMilitary.incoming,home:currentMilitary.home});
      return false;
    }
    const liveNeeds=economicNeeds(me,ownStructures(me),tiles);
    if(chosen.type!=='SAM Launcher'&&chosen.type!=='Defense Post'&&
      liveNeeds.samFundingUrgent&&liveNeeds.wantedSAM>0&&liveNeeds.intel.uncovered.length>0&&
      !requirements.samFundingUrgent){
      telemetry('build_stale_skip','Neue Nuklearbedrohung: Bau neu priorisieren',
        {type:chosen.type,plannedTick:tick,freshTick});return false;
    }
    let verified;
    try{verified=await me.actions(chosen.requestTile,[chosen.type]);}
    catch(e){telemetry('build_stale_skip','Worker-Verifikation fehlgeschlagen',
      {type:chosen.type,error:String(e?.message||e).slice(0,90)});return false;}
    if(!live(serial)||number(()=>game.ticks(),tick)-tick>12)return false;
    const finalMilitary=military(me,strategic.groups);
    if(economicDefensePressure(me,finalMilitary)&&
      !['Defense Post','SAM Launcher'].includes(chosen.type)){
      telemetry('build_crisis_skip','Angriff waehrend finaler Worker-Pruefung',
        {type:chosen.type,incoming:finalMilitary.incoming,home:finalMilitary.home});
      return false;
    }
    const worker=verified?.buildableUnits?.find(x=>x.type===chosen.type);
    const isUpgrade=chosen.kind==='upgrade';
    const freshCost=Number(isUpgrade?(worker?.upgradeCosts?.[0]??worker?.cost):worker?.cost);
    const actualTile=isUpgrade?chosen.requestTile:worker?.canBuild;
    const validWorker=worker&&(isUpgrade?
      worker.canUpgrade!==false&&worker.canUpgrade!==undefined&&
        worker.canUpgrade===chosen.unitId:
      Number.isInteger(worker.canBuild)&&
        (worker.canUpgrade===false||worker.canUpgrade===undefined));
    if(!validWorker||!Number.isFinite(freshCost)||freshCost<0||
      actualTile!==chosen.tile||!ownedTile(chosen.tile,me)){
      telemetry('build_stale_skip','Bauplatz, Upgrade oder Preis nicht mehr bestätigt',
        {type:chosen.type,tile:chosen.tile,plannedCost:chosen.cost,freshCost});
      return false;
    }
    chosen.cost=freshCost;
    if(!spendBudget(me,chosen.cost,chosen.type,false,tiles))return false;
    const args=isUpgrade?[chosen.unitId,chosen.type,1]:[chosen.type,chosen.requestTile];
    if(send(chosen.kind,args,`${chosen.kind==='upgrade'?'UPGRADE':'BAU'} ${chosen.type} · ${chosen.cost.toLocaleString()} Gold`)){
      commitGoldSpend(me,chosen.cost,chosen.type);
      economicPending={...chosen,tick,actionId:lastActionId};
      const issued=actionLedger.find(x=>x.actionId===lastActionId);
      if(issued)issued.quotedCost=chosen.cost;
      telemetry('build_quote','Baukosten aus Worker-Angebot',{
        actionId:lastActionId,type:chosen.type,quotedCost:chosen.cost,
        evidence:'worker-quote-not-observed-spending'});
      failedEconomyProbes=0;lastEconomy=tick;lastEconomicAction=tick;
      if(chosen.type==='SAM Launcher')telemetry('sam_intent','SAM-Bau angefordert',
        {tile:chosen.tile,gold:requirements.gold,cost:chosen.cost,
          uncovered:requirements.intel.uncovered.length,
          duoNuclear:requirements.duoNuclear});
      if(chosen.type==='Port'){
        portProbeFailures=0;
        telemetry('port_intent','Hafenbau angefordert',
          {tile:chosen.tile,gold:requirements.gold,cost:chosen.cost,
            coastCandidates:coastal.length});
      }
      telemetry('neural_economy_choice','Gepruefte Bauoption gewaehlt',
        {actionId:lastActionId,decisionId:monitorSession+':t'+tick,
          kind:chosen.kind,type:chosen.type,baseScore:chosen.baseScore,
          neuralDelta:chosen.neuralDelta,chosenScore:chosen.siteValue,
          neuralDecision:neuralDecisionEvidence});
      economicStatus='Anfrage: '+chosen.type+(chosen.kind==='upgrade'?' (Upgrade)':'');
      economicLastPlan=entries.slice(0,3).map(x=>x.type).join(' › ');
      return true;
    }
    return false;
  }
  // This is deliberately uncached and runs AFTER the async worker check.
  // Sampled ring checks in nukeTargets are only a planning optimization;
  // the final launch gate must cover every tile and allied structure.
  function nukeCollateralSafe(me,tile,kind){
    try{
      const owner=game.owner(tile);
      if(!owner?.isPlayer?.()||friendly(owner,me)||me.isOnSameTeam?.(owner))return false;
      const radius=number(()=>game.config().nukeMagnitudes?.(kind).outer,
        kind==='Hydrogen Bomb'||kind==='MIRV'?100:30)+5;
      const tx=game.x(tile),ty=game.y(tile),r2=radius*radius;
      const width=game.width(),height=game.height();
      if(!Number.isInteger(width)||!Number.isInteger(height)||
        !Number.isFinite(tx)||!Number.isFinite(ty))return false;
      for(const u of game.units()){
        if(!STRUCTURE_TYPES.includes(u.type?.())||!u.isActive?.())continue;
        const p=u.owner?.();
        if(!p?.isPlayer?.()||(!friendly(p,me)&&!me.isOnSameTeam?.(p)))continue;
        const ut=u.tile?.();
        if(!Number.isInteger(ut))return false;
        const dx=tx-game.x(ut),dy=ty-game.y(ut);
        if(dx*dx+dy*dy<=r2)return false;
      }
      for(let y=Math.max(0,Math.ceil(ty-radius));y<=Math.min(height-1,Math.floor(ty+radius));y++)
        for(let x=Math.max(0,Math.ceil(tx-radius));x<=Math.min(width-1,Math.floor(tx+radius));x++){
          const dx=x-tx,dy=y-ty;
          if(dx*dx+dy*dy>r2)continue;
          const p=game.owner(game.ref(x,y));
          if(p?.isPlayer?.()&&(friendly(p,me)||me.isOnSameTeam?.(p)))return false;
        }
      return true;
    }catch(_){return false;}
  }
  // Launcher uses the SAME BuildUnitIntentEvent the game's build menu uses.
  // For nukes, tile is the ENEMY TARGET, not the launching silo location.
  function nukeTargets(me,intel,kind) {
    const radius=number(()=>game.config().nukeMagnitudes?.(kind).outer,
      kind==='Hydrogen Bomb'||kind==='MIRV'?100:30);
    const players=game.playerViews?.().filter(p=>p?.isAlive?.() && safeID(p)!==safeID(me) && !friendly(p,me))||[];
    const targets=new Set();
    for(const u of intel.enemy){const t=number(()=>u.tile?.(),NaN);if(Number.isInteger(t))targets.add(t);}
    for(const p of players){
      const spawn=p.state?.spawnTile;
      if(Number.isInteger(spawn))targets.add(spawn);
      if(targets.size>95)break;
    }
    const ownAssets=intel.protectedUnits;
    const already=(()=>{try{return game.units().filter(u=>safeID(u.owner?.())===safeID(me) &&
      ['Atom Bomb','Hydrogen Bomb','MIRV'].includes(u.type?.()));}catch(_){return [];}})();
    const proposed=[];
    for(const tile of targets){
      if(!game.isValidRef?.(tile) || game.isImpassable?.(tile))continue;
      const owner=game.owner?.(tile);
      if(!owner?.isPlayer?.() || friendly(owner,me))continue;
      const tx=game.x(tile),ty=game.y(tile);
      const distance=u=>Math.hypot(tx-game.x(u.tile()),ty-game.y(u.tile()));
      // Protect own/allied structures and conservatively sample friendly
      // territory within the blast, not only tiles carrying structures.
      if(ownAssets.some(u=>distance(u)<radius+5))continue;
      let collateral=false;
      if(typeof game.isValidCoord==='function'){
        for(const rr of [radius*.5,radius*.88]){
          for(let angle=0;angle<8;angle++){
            const x=Math.round(tx+Math.cos(angle*Math.PI/4)*rr),
              y=Math.round(ty+Math.sin(angle*Math.PI/4)*rr);
            if(!game.isValidCoord(x,y))continue;
            const p=game.owner(game.ref(x,y));
            if(p?.isPlayer?.()&&friendly(p,me)){collateral=true;break;}
          }
          if(collateral)break;
        }
      }
      if(collateral)continue;
      if(already.some(u=>Number.isInteger(u.targetTile?.()) &&
        Math.hypot(tx-game.x(u.targetTile()),ty-game.y(u.targetTile()))<radius*.9))continue;
      if(nukePending && Math.hypot(tx-game.x(nukePending.tile),ty-game.y(nukePending.tile))<radius)continue;
      let value=0,hit=0;
      for(const u of intel.enemy){
        const d=distance(u);
        if(d<radius){value+=assetValue(u.type?.())*(d<radius*.55?1:.55);hit++;}
      }
      const troops=number(()=>owner.troops?.(),0),tiles=Math.max(1,number(()=>owner.numTilesOwned?.(),1));
      value+=Math.min(8,troops/tiles/1000);
      if(plan?.id===safeID(owner))value+=7;
      if(isWar())value+=safeID(owner)===warState.id?18:-9;
      if(kind==='MIRV' && number(()=>owner.numTilesOwned(),0)>
        Math.max(900,number(()=>game.numLandTiles?.(),0)*.30))value+=25;
      if(hit===0)value-=18;
      const sams=intel.enemySAM.filter(s=>distance(s)<number(()=>game.config().samRange(s.level?.()||1),70));
      // Launching blindly into a SAM bubble wastes expensive rockets.
      value-=sams.reduce((sum,u)=>sum+9+number(()=>u.level?.(),1)*2,0);
      if(sams.length && kind==='Hydrogen Bomb')value-=9;
      if(value>=(kind==='Hydrogen Bomb'||kind==='MIRV'?(lateGame(me)?11:13):(lateGame(me)?5:8))-
        neuralChannel('nuclearPriority',me)*3)
        proposed.push({tile,value,hit,sams:sams.length,owner});
    }
    return proposed.sort((a,b)=>b.value-a.value).slice(0,10);
  }
  // Mirror OpenFront PathFinder.Parabola.getParabolaControlPoints:
  // p1/p2 lie at 1/4,3/4 of x and rise max(distance/3,50) in y,
  // clamped to map bounds. The server may choose either rocketDirectionUp,
  // so cover both curves; a trajectory risk is not a certain interception.
  function nukeBezierPoints(spawn,target,up=true){
    const ax=game.x(spawn),ay=game.y(spawn),bx=game.x(target),by=game.y(target),
      dx=bx-ax,dy=by-ay,height=Math.max(Math.hypot(dx,dy)/3,50),
      bound=number(()=>game.height(),Math.max(ay,by)+height+1)-1,
      clampY=y=>Math.min(bound,Math.max(0,y)),sign=up?-1:1;
    return [{x:ax,y:ay},
      {x:ax+dx/4,y:clampY(ay+dy/4+sign*height)},
      {x:ax+dx*3/4,y:clampY(ay+dy*3/4+sign*height)},
      {x:bx,y:by}];
  }
  function nukeBezierPoint(points,t){
    const q=1-t;
    return {x:q*q*q*points[0].x+3*q*q*t*points[1].x+
      3*q*t*t*points[2].x+t*t*t*points[3].x,
      y:q*q*q*points[0].y+3*q*q*t*points[1].y+
      3*q*t*t*points[2].y+t*t*t*points[3].y};
  }
  function nukeTrajectoryRisk(spawn,target,sams){
    if(!Number.isInteger(spawn)||!Number.isInteger(target))return 0;
    const points=[nukeBezierPoints(spawn,target,true),
      nukeBezierPoints(spawn,target,false)];
    const dist=Math.hypot(game.x(target)-game.x(spawn),
      game.y(target)-game.y(spawn));
    const samples=Math.min(160,Math.max(32,Math.ceil(dist/7)));
    return sams.filter(s=>{
      if(s.isActive?.()===false || s.isUnderConstruction?.())return false;
      const x=game.x(s.tile()),y=game.y(s.tile());
      // Tile rounding and the actual engine speed are not a proof of safety:
      // add a small margin, and sample both allowed orientations.
      const rad=number(()=>game.config().samRange(s.level?.()||1),70)+4;
      for(const path of points){
        for(let i=0;i<=samples;i++){
          const p=nukeBezierPoint(path,i/samples);
          if((p.x-x)**2+(p.y-y)**2<=rad*rad)return true;
        }
      }
      return false;
    }).length;
  }
  function rocketReadiness(silos,me){
    const observed=number(()=>me.readyMissileCount?.(),NaN);
    if(Number.isFinite(observed))return Math.max(0,Math.floor(observed));
    return silos.reduce((n,u)=>n+Math.max(0,number(()=>u.level?.(),1)-
      number(()=>u.missileTimerQueue?.().length,0)),0);
  }
  function nukeSalvoPlan(kind,candidate,silos,me,cost,gold,infinite){
    const ready=rocketReadiness(silos,me);
    if(ready<1)return {amount:0,ready};
    if(kind!=='Atom Bomb'||candidate.sams===0||
      candidate.hit<2||candidate.value<20)
      return {amount:1,ready};
    if(ready<2)return {amount:0,ready};
    const x=game.x(candidate.tile),y=game.y(candidate.tile);
    const covering=nuclearIntel(me).enemySAM.filter(u=>{
      const dx=x-game.x(u.tile()),dy=y-game.y(u.tile());
      const r=number(()=>game.config().samRange(u.level?.()||1),70);
      return dx*dx+dy*dy<=r*r;
    });
    const amount=Math.min(6,covering.reduce((n,u)=>
      n+Math.max(1,number(()=>u.level?.(),1)),0)+1);
    const affordable=infinite||gold-cost*amount>=250000;
    return {amount:ready>=amount&&affordable?amount:0,ready};
  }
  function ownMissiles(me) {
    try{return game.units().filter(u=>safeID(u.owner?.())===safeID(me) &&
      ['Atom Bomb','Hydrogen Bomb','MIRV'].includes(u.type?.()));}
    catch(_){return [];}
  }
  function inspectNukeLaunch(me,tick) {
    if(!nukePending)return false;
    const p=nukePending;
    const matches=ownMissiles(me).filter(u=>u.type?.()===p.type && Number.isInteger(u.targetTile?.()) &&
      Math.hypot(game.x(u.targetTile())-game.x(p.tile),game.y(u.targetTile())-game.y(p.tile))<15);
    // An existing missile at the same destination must NOT confirm a second
    // launch. Prefer stable unit IDs, falling back to target-matched counts.
    const unseen=matches.filter(u=>{
      const id=u.id?.();
      return id!==undefined && id!==null && !p.beforeIds.includes(String(id));
    }).length;
    const confirmed=Math.min(p.amount||1,Math.max(unseen,
      matches.length-(p.beforeMatches||0)));
    const added=confirmed-(p.confirmed||0);
    if(added>0){
      nukeShots+=added;p.confirmed=confirmed;
      nukeStatus='Raketenstart bestätigt: '+p.type+' '+confirmed+'/'+(p.amount||1);
      telemetry('nuke_confirmed',nukeStatus,{tile:p.tile,attempt:p.attempt,
        confirmed:nukeShots,partial:confirmed<(p.amount||1),
        launchSiloIds:p.siloIds??[],siloOrigin:'unknown-unless-build-confirmed'});
      if(confirmed>=(p.amount||1)){nukePending=null;return false;}
      return true;
    }
    if(tick-p.tick>=55){
      nukeUnconfirmed++;
      nukeStatus='Raketenstart NICHT bestätigt – weiter sparen';
      telemetry('nuke_unconfirmed',nukeStatus,{tile:p.tile,type:p.type,attempt:p.attempt});
      nukePending=null;return false;
    }
    return true;
  }
  const siloFirstSeen=new Set();
  async function nukeStep() {
    if(nukeBusy||!opts.enabled||!opts.nukes||!connected()||!ctors.build)return;
    const me=myPlayer(),tick=number(()=>game.ticks(),-1);
    if(!me?.isAlive?.()||!me.hasSpawned?.()||game.inSpawnPhase?.()||tick<0)return;
    if(inspectNukeLaunch(me,tick))return;
    if(tick-lastNuke<clamp(65-Math.round(neuralChannel('nuclearPriority',me)*18),45,90) ||
      !actionBudget())return;
    const intel=nuclearIntel(me),ownedSilos=ownStructures(me).filter(u=>
      u.type?.()==='Missile Silo');
    for(const silo of ownedSilos){
      const id=String(silo.id?.()??'tile:'+silo.tile?.());
      const key=monitorSession+':'+id;
      if(siloFirstSeen.has(key))continue;
      siloFirstSeen.add(key);
      telemetry('silo_seen','Eigenes Raketensilo im Spielzustand sichtbar',
        {siloId:id,tile:silo.tile?.()??null,level:silo.level?.()??null,
          origin:confirmedBuiltSilos.has(key)?'own-build-observed':
            'unresolved: captured, preexisting, or missing build receipt'});
    }
    const silos=ownedSilos.filter(u=>!u.isUnderConstruction?.()&&!u.isInCooldown?.());
    if(!silos.length){nukeStatus='Kein geladener Silo';return;}
    const gold=goldAmount(me),infinite=game.config().infiniteGold?.()===true;
    // Hold funds for defensive anti-nuke infrastructure unless already rich.
    const choices=['MIRV','Hydrogen Bomb','Atom Bomb'].filter(t=>!game.config().isUnitDisabled?.(t) &&
      (infinite||gold>=(t==='MIRV'?26000000:t==='Hydrogen Bomb'?6400000:1100000)));
    if(!choices.length){nukeStatus='Gold für Raketen sparen';return;}
    nukeBusy=true;const serial=generation;
    try {
      for(const kind of choices){
        const candidates=nukeTargets(me,intel,kind);
        for(const candidate of candidates.slice(0,6)){
          if(!live(serial))return;
          let legal;
          try{legal=await me.actions(candidate.tile,[kind]);}catch(_){continue;}
          if(!live(serial))return;
          const built=legal?.buildableUnits?.find(b=>b.type===kind);
          if(!built||built.canBuild===false||!Number.isInteger(built.canBuild))continue;
          const cost=Number(built.cost);
          if(!infinite&&(!Number.isFinite(cost)||gold-cost<
            (kind==='Hydrogen Bomb'||kind==='MIRV'?800000:250000)))continue;
          const routeRisk=nukeTrajectoryRisk(built.canBuild,candidate.tile,intel.enemySAM);
          if(routeRisk>0 && candidate.sams===0 && kind!=='MIRV')continue;
          const salvo=nukeSalvoPlan(kind,candidate,silos,me,cost,gold,infinite);
          if(salvo.amount<1)continue;
          if(!infinite&&gold-cost*salvo.amount<250000)continue;
          if(!spendBudget(me,cost*salvo.amount,kind))continue;
          // Target may have changed owner while worker checked its legality.
          const o=game.owner(candidate.tile);
          if(!o?.isPlayer?.() || friendly(o,me)||me.isOnSameTeam?.(o))continue;
          if(!nukeCollateralSafe(me,candidate.tile,kind))continue;
          const prior=ownMissiles(me).filter(u=>u.type?.()===kind &&
            Number.isInteger(u.targetTile?.()) &&
            Math.hypot(game.x(u.targetTile())-game.x(candidate.tile),
              game.y(u.targetTile())-game.y(candidate.tile))<15);
          const beforeIds=prior.map(u=>u.id?.()).filter(id=>id!==undefined&&id!==null).map(String);
          const args=salvo.amount>1?[kind,candidate.tile,undefined,salvo.amount]:[kind,candidate.tile];
          if(send('build',args,`NUKE ${kind} x${salvo.amount} → ${nameOf(o)} (${candidate.hit} Gebäude · ${candidate.value.toFixed(0)} Punkte)`)){
            commitGoldSpend(me,cost*salvo.amount,kind);
            lastNuke=tick;nukeAttempts++;
            const siloIds=silos.map(u=>String(u.id?.()??'tile:'+u.tile?.()));
            nukePending={tile:candidate.tile,type:kind,tick,beforeIds,amount:salvo.amount,
              beforeMatches:prior.length,attempt:nukeAttempts,siloIds};
            telemetry('nuke_attempt','Raketen-Befehl abgesendet, noch nicht bestätigt',
              {tile:candidate.tile,type:kind,attempt:nukeAttempts,siloIds});
            nukeStatus='Start angefordert: '+kind+' · wartet auf Bestätigung';return;
          }
        }
      }
      nukeStatus='Keine rentable, legale Raketenposition';
    }catch(e){nukeStatus='Raketenplanung: '+String(e.message).slice(0,70);}
    finally{nukeBusy=false;paint();}
  }
  // The live game already holds ACCEPT and DECLINE callbacks on the incoming
  // alliance-request card. Prefer these: they close over the *real* game event
  // constructors, even if production minification hides/merges class names.
  // Never invoke a generic card just because it has buttons: verify requester
  // small ID, the three-button request layout, game ownership and expiry.
  function incomingAllianceCards(tick) {
    const cards=new Map();
    const widget=document.querySelector('actionable-events');
    if(!widget || widget.game!==game || !Array.isArray(widget.events)) return cards;
    for(const e of widget.events) {
      if(!Number.isInteger(e.requestorID) || e.focusID!==e.requestorID ||
        !Array.isArray(e.buttons) || e.buttons.length!==3 ||
        typeof e.buttons[1]?.action!=='function' || typeof e.buttons[2]?.action!=='function' ||
        (Number.isFinite(e.createdAt) && Number.isFinite(e.duration) &&
        tick-e.createdAt>=e.duration))continue;
      const p=game.playerBySmallID?.(e.requestorID);
      if(p?.isAlive?.())cards.set(safeID(p),{player:p,card:e});
    }
    return cards;
  }
  function diplomacyScore(me,p,s,offered=false,incomingOffer=false) {
    if(!p?.isAlive?.() || safeID(p)===safeID(me) || friendly(p,me))
      return {score:-999,reason:'Ungültiger / verbündeter Spieler'};
    if(p.isTraitor?.())return {score:-999,reason:'Verräter'};
    const locked=safeID(p)===warState.id || safeID(p)===plan?.id;
    const their=Math.max(0,number(()=>p.troops()));
    const own=Math.max(1,number(()=>me.troops()));
    const territory=Math.max(0,number(()=>p.numTilesOwned()));
    const mine=Math.max(1,number(()=>me.numTilesOwned()));
    const hostileIncoming=s.inc?.some(a=>
      a.attackerID===p.smallID?.() || attackTargetID(a.attackerID)===safeID(p));
    const hostileOutgoing=s.out?.some(a=>attackTargets(a.targetID,p));
    const tick=number(()=>game.ticks());
    const recent=troopSamples.filter(x=>x.tick<=tick&&tick-x.tick<=300);
    const peak=Math.max(mine,...recent.map(x=>x.tiles));
    const losing=peak-mine>=Math.max(100,peak*.05);
    const pressured=(s.incoming>=own*.10&&their>=own*.75)||
      (losing&&(their>=own*.75||s.strongest>=own))||
      (their>=own*1.25&&territory>=mine);
    // Only an actual incoming offer may override a conflict veto under pressure.
    // Keep the war lock until the alliance is observed as confirmed.
    if(incomingOffer&&(locked||hostileIncoming||hostileOutgoing)&&pressured)
      return {score:95,reason:'Friedensangebot bei militärischem Druck',peace:true};
    if(locked)return {score:-999,reason:'Aktuelles Kriegsziel'};
    if(hostileIncoming||hostileOutgoing)return {score:-999,reason:'Aktiver Konflikt'};
    if(opts.autoStrategy && strategic.mode==='ASSAULT'&&plan?.id===safeID(p))
      return {score:-100,reason:'Aktuelles Angriffsziel'};
    let score=38;
    score+=Math.min(27,Math.log2(1+their/own)*18);
    score+=Math.min(15,Math.log2(1+territory/mine)*10);
    if(s.incoming>own*.12)score+=23;
    if(s.strongest>own*.8)score+=13;
    if(their<own*.22 && s.incoming===0)score-=26;
    if(territory<mine*.15 && s.incoming===0)score-=12;
    // In the opening, ally with useful neighbours instead of inviting a
    // second war; never override conflict, traitor or current-target vetoes.
    if(number(()=>game?.ticks?.(),Infinity)<1100 && their>=own*.45 &&
      territory>=mine*.3 && warState.id!==safeID(p))score+=14;
    if(safeID(p)===plan?.id)score-=70;
    const alliances=number(()=>me.alliances?.().length);
    if(alliances>=3)score-=36;
    if(offered && strategic.mode==='ASSAULT' && their<own*.75)score-=18;
    // Strategic offers can secure a major border before/while fighting a
    // different nation. Never reward alliance with our active war target.
    if(offered && their>=own*.85 && !hostileIncoming && !hostileOutgoing &&
      warState.id!==safeID(p))score+=22;
    score+=neuralChannel('diplomacyPriority',me,s)*28;
    return {score,reason:score>=58?'Schutz/Kooperation nützlich':'Strategischer Nutzen gering'};
  }
  // Diplomacy is a priority channel. The normal minute and attack-burst limits
  // must not prevent a timely reply; a separate 700-ms limiter prevents spam.
  function answerAlliance(me,p,accept,card,tick,reason,tryCount) {
    if(!opts.enabled || !opts.diplomacy || !connected() || !permittedMatch(game) ||
      Date.now()-lastDiplomaticEmit<700)return false;
    const label=nameOf(p),key=accept?'alliance':'reject';
    let path='';
    if(card?.buttons?.[accept?1:2]?.action) {
      try {
        card.buttons[accept?1:2].action();
        actions.push(Date.now());lastEmission=Date.now();totalSent++;
        path='Spiel-UI';
        log('ALLIANZ '+(accept?'ANNAHME':'ABLEHNUNG')+' GESENDET: '+label+' · '+reason+' (Spiel-UI)');
      } catch(e){totalFailed++;log('Allianz-UI antwortet nicht: '+String(e.message));}
    }
    if(!path) {
      if(!ctors[key]) {
        diplomacyStatus='Anfrage von '+label+': keine Antwortaktion gefunden';
        const marker=String(safeID(p));
        if(!diplomacyMissingLogged.has(marker)) {
          diplomacyMissingLogged.add(marker);
          telemetry('alliance_missing_action',diplomacyStatus,
            {availableIntents:Object.keys(ctors),hasUI:!!card});
          console.warn(PREFIX,diplomacyStatus,'(bei fehlendem Konstruktor: actionable-events prüfen)');
        }
        return false;
      }
      if(!send(key,accept?[me,p]:[p],
        'ALLIANZ '+(accept?'ANNAHME':'ABLEHNUNG')+' GESENDET: '+label+' · '+reason+' (Intent)',true))return false;
      path='Intent';
    }
    lastDiplomaticEmit=Date.now();
    diplomacyPending.set(safeID(p),{accept,sentTick:tick,tries:tryCount,
      name:label,reason,path});
    diplomacyStatus=(accept?'Annahme':'Ablehnung')+' gesendet: '+label+' · Bestätigung ausstehend';
    telemetry('alliance_reply_sent',diplomacyStatus,
      {requestor:safeID(p),accept,method:path,tries:tryCount});
    return true;
  }
  function diplomacyTick() {
    try {diplomacyTickSafe();}
    catch(e){diplomacyStatus='Diplomatie-Fehler: '+String(e?.message||e).slice(0,95);
      console.warn(PREFIX,'Diplomatie:',e);
      telemetry('alliance_error',diplomacyStatus);paint();}
  }
  // All outgoing requests (including Duo offers) use a verified engine
  // action first. A trusted official PlayerPanel fallback can emit the
  // event if production minification hides its constructor in bus.listeners.
  function sendAllianceOffer(me,p,label,force=false){
    if(!opts.enabled||!opts.diplomacy||!opts.offerAlliances||
      !connected()||game.config().disableAlliances?.()===true||
      !p?.isAlive?.()||p.isTraitor?.()||
      (friendly(p,me)&&!((duoTrustedPeer()?.id===safeID(p)||
        duoPeerAlly(p))&&!actualFriendly(p,me)))||
      safeID(me)!==safeID(myPlayer()))return false;
    const path=allianceOfferPath();
    if(path==='intent')return send('alliance',[me,p],label,force);
    if(path!=='player-panel')return false;
    const panel=document.querySelector('player-panel');
    if(panel?.g!==game||panel?.eventBus!==bus||
      typeof panel.handleAllianceClick!=='function')return false;
    try{
      panel.handleAllianceClick({stopPropagation(){}},me,p);
      actions.push(Date.now());lastEmission=Date.now();totalSent++;
      log(label+' (offizieller Spielerpanel-Intent)');
      telemetry('alliance_offer_ui_fallback',label,
        {recipient:safeID(p),path:'player-panel'});
      return true;
    }catch(e){
      totalFailed++;
      telemetry('alliance_offer_ui_error',
        'Spielerpanel-Intent: '+String(e?.message||e).slice(0,90));
      return false;
    }
  }
  function diplomacyTickSafe() {
    if(!opts.enabled)return;
    if(!opts.diplomacy){diplomacyStatus='Diplomatie im Menü AUS';return;}
    if(!connected()){diplomacyStatus='Diplomatie wartet auf aktive Partie';return;}
    if(game.config().disableAlliances?.()===true){diplomacyStatus='Allianzen in Spieleinstellungen deaktiviert';return;}
    if(game.inSpawnPhase?.())return;
    const me=myPlayer(),tick=number(()=>game.ticks(),-1);
    if(!me?.hasSpawned?.()||!me?.isAlive?.()||tick<0||tick-lastDiplomacyTick<8)return;
    lastDiplomacyTick=tick;
    for(const [id,until] of diplomacyHandled)if(tick>=until)diplomacyHandled.delete(id);
    const cards=incomingAllianceCards(tick);
    const players=game.playerViews().filter(p=>safeID(p)!==safeID(me)&&p.isAlive?.());
    // Pending replies are checked against *observable game state*, not counted
    // as successful merely because EventBus.emit/callback returned normally.
    for(const [id,pending] of diplomacyPending) {
      const p=players.find(x=>safeID(x)===id);
      if(!p){diplomacyPending.delete(id);continue;}
      const allied=actualFriendly(p,me),requesting=!!p.isRequestingAllianceWith?.(me);
      const visible=cards.has(id);
      if(allied || (!requesting && !visible)) {
        const confirmed=pending.accept?allied:!allied;
        const result=confirmed?'Bestätigt':'Nicht bestätigt';
        diplomacyStatus=(pending.accept?'Annahme':'Ablehnung')+' '+result+': '+pending.name;
        if(confirmed)diplomacyStats[pending.accept?'accepted':'rejected']++;
        telemetry('alliance_reply_result',diplomacyStatus,
          {requestor:id,confirmed,accept:pending.accept,tries:pending.tries});
        log('ALLIANZ '+diplomacyStatus);
        diplomacyPending.delete(id);
        diplomacyHandled.set(id,tick+220);
        if(allied){
          if(warState.id===id)warState={id:null,name:'—',since:-Infinity,blockedUntil:-Infinity};
          if(plan?.id===id)plan=null;
          if(operation?.target===id)operation=null;
          frontMemory.delete(id);
        }
        continue;
      }
      if(tick-pending.sentTick<45)continue;
      if(pending.tries>=3) {
        diplomacyPending.delete(id);diplomacyHandled.set(id,tick+140);
        diplomacyStatus='Allianzantwort nicht bestätigt: '+pending.name;
        telemetry('alliance_reply_timeout',diplomacyStatus,
          {requestor:id,accept:pending.accept,tries:pending.tries});
        continue;
      }
      // Retain the attempt counter; the incoming pass below retries after the wait.
    }
    // Mutual PlayerIDs get the first alliance lane. The relay never confirms
    // friendship: only GameView/team state can do that.
    const duo=duoTrustedPeer();
    if(duo){
      const partner=duo.player,id=safeID(partner);
      if(actualFriendly(partner,me)){
        duoLocal.status='Verbunden · Bündnis/Team im Spiel bestätigt';
        if(warState.id===id)
          warState={id:null,name:'—',since:-Infinity,blockedUntil:-Infinity};
        frontMemory.delete(id);
      }else if(partner.isTraitor?.()){
        duoLocal.status='Partner als Verräter markiert: kein Bündnisbefehl';
      }else if(partner.isRequestingAllianceWith?.(me)||cards.has(id)){
        const previous=diplomacyPending.get(id);
        if(!previous||tick-previous.sentTick>=45){
          answerAlliance(me,partner,true,cards.get(id)?.card,tick,
            'Duo-Partner-ID bestätigt',previous?.tries||1);
          return;
        }
      }else if(allianceOfferPath()&&!me.isRequestingAllianceWith?.(partner)&&
        !diplomacyHandled.has(id)&&tick-lastProposalTick>=55){
        const anchor=(strategic.groups.find(g=>g.id===id)?.tiles||[])[0]??
          partner.state?.spawnTile;
        if(Number.isInteger(anchor)&&safeID(game.owner(anchor))===id){
          const serial=generation;lastProposalTick=tick;
          Promise.resolve(me.actions(anchor,null)).then(a=>{
            if(!live(serial)||!duoTrustedPeer()||
              game.config().disableAlliances?.()===true||
              !opts.duoEnabled||!opts.diplomacy||
              me.isRequestingAllianceWith?.(partner)||
              actualFriendly(partner,me)||partner.isTraitor?.()||
              safeID(game.owner(anchor))!==id||
              !a?.interaction?.canSendAllianceRequest)return;
            if(sendAllianceOffer(me,partner,
              'DUO ALLIANZ ANGEFRAGT: '+nameOf(partner),true)){
              diplomacyStatus='Duo-Bündnis angefragt · Bestätigung ausstehend';
              diplomacyHandled.set(id,tick+85);diplomacyStats.offered++;
              telemetry('duo_alliance_offer',diplomacyStatus,{partnerID:id});
            }
          }).catch(e=>{
            duoLocal.status='Allianz-Worker: '+String(e?.message||e).slice(0,55);
          });
        }
      }
    }
    const incoming=players.filter(p=>!actualFriendly(p,me)&&
      (p.isRequestingAllianceWith?.(me)||cards.has(safeID(p))));
    if(incoming.length) {
      const s=military(me,strategic.groups);
      for(const p of incoming) {
        const id=safeID(p);
        const previous=diplomacyPending.get(id);
        if(diplomacyHandled.has(id)|| (previous && tick-previous.sentTick<45))continue;
        const peer=duoTrustedPeer();
        const allyOfPeer=peer&&actualFriendly(peer.player,me)&&duoPeerAlly(p);
        const fighting=safeID(p)===warState.id||
          (me.outgoingAttacks?.()||[]).some(a=>!a.retreating&&attackTargets(a.targetID,p))||
          (me.incomingAttacks?.()||[]).some(a=>!a.retreating&&
            attackTargetID(a.attackerID)===safeID(p));
        const judgement=peer?
          {score:allyOfPeer&&!fighting&&!p.isTraitor?.()?100:-999,
            reason:allyOfPeer&&!fighting?
              'Duo: bestätigtes Partnerbündnis angleichen':
              'Duo: fremdes Bündnis vermeiden / laufenden Konflikt schützen'}:
          diplomacyScore(me,p,s,false,true);
        const accept=judgement.score>=58;
        const oldTry=previous?.tries||0;
        diplomacyPending.delete(id);
        telemetry('alliance_detected','Anfrage von '+nameOf(p),
          {requestor:id,score:judgement.score,accept,reason:judgement.reason,
            viaCard:cards.has(id),acceptCtor:!!ctors.alliance,rejectCtor:!!ctors.reject});
        answerAlliance(me,p,accept,cards.get(id)?.card,tick,judgement.reason,oldTry+1);
        paint();return; // Incoming diplomacy has priority over outgoing offers.
      }
      return;
    }
    if(renewAlliances(me,tick))return;
    // A Duo can actively form NEW outside alliances: lower PlayerID makes
    // the initial offer and the follower later proposes the same alliance
    // only after the first is genuinely confirmed by OpenFront.
    const paired=duoTrustedPeer();
    if(!opts.offerAlliances||!allianceOfferPath()||!actionBudget()){
      if(!allianceOfferPath()&&opts.offerAlliances)
        diplomacyStatus='Eigene Angebote: Allianz-Intent / Spielerpanel noch nicht verfügbar';
      return;
    }
    if(paired&&!actualFriendly(paired.player,me))return;
    if(tick-lastProposalTick<(paired?90:450))return;
    const peerWar=paired?.state?.warTarget,peerTarget=paired?.state?.target;
    const safeOffer=(p)=>p&&p.isAlive?.()&&!actualFriendly(p,me)&&
      safeID(p)!==paired?.id&&
      !p.isTraitor?.()&&!diplomacyHandled.has(safeID(p))&&
      !diplomacyPending.has(safeID(p))&&
      safeID(p)!==warState.id&&safeID(p)!==plan?.id&&
      safeID(p)!==peerWar&&safeID(p)!==peerTarget&&
      !me.isRequestingAllianceWith?.(p)&&
      !(me.outgoingAttacks?.()||[]).some(a=>!a.retreating&&
        attackTargets(a.targetID,p))&&
      !(me.incomingAttacks?.()||[]).some(a=>!a.retreating&&
        attackTargetID(a.attackerID)===safeID(p))&&
      !(paired?.player.outgoingAttacks?.()||[]).some(a=>!a.retreating&&
        attackTargets(a.targetID,p));
    const inherited=paired?players.filter(p=>
      duoPeerAlly(p)&&safeOffer(p)):[],follow=inherited[0]||null;
    // Without an inherited third-party friend, only the leader starts a
    // new offer: two independent browsers must not recruit enemies of
    // their respective partner by accident.
    const leader=!paired||String(safeID(me))<String(paired.id);
    if(paired&&!follow&&!leader)return;
    const army=military(me,strategic.groups);
    const candidates=strategic.groups.filter(g=>g.id!==null&&
      g.opponent&&g.tiles?.length&&safeOffer(g.opponent)&&
      (!['ASSAULT','EXPAND'].includes(strategic.mode)||
        number(()=>g.opponent.troops(),0)>=number(()=>me.troops(),1)*.85))
      .map(g=>({g,...diplomacyScore(me,g.opponent,army,true)}))
      .filter(x=>x.score>=72)
      .sort((a,b)=>b.score-a.score||
        String(a.g.id).localeCompare(String(b.g.id)));
    const chosen=follow?null:candidates[0];
    if(!follow&&!chosen)return;
    const target=follow||chosen.g.opponent,id=safeID(target);
    const anchor=(strategic.groups.find(g=>g.id===id)?.tiles||[])[0]??
      target.state?.spawnTile;
    if(!Number.isInteger(anchor)||safeID(game.owner(anchor))!==id)return;
    const serial=generation,peerID=paired?.id??null;
    lastProposalTick=tick;
    Promise.resolve(me.actions(anchor,null)).then(a=>{
      const connectedPair=duoTrustedPeer();
      if(!live(serial)||game.inSpawnPhase?.()||!opts.diplomacy||
        !opts.offerAlliances||game.config().disableAlliances?.()===true||
        !a?.interaction?.canSendAllianceRequest||
        safeID(game.owner(anchor))!==id||!safeOffer(target)||
        (peerID!==null&&(!connectedPair||connectedPair.id!==peerID||
          !actualFriendly(connectedPair.player,me)))||
        (follow&&!duoPeerAlly(target))||
        (!follow&&connectedPair&&
          String(safeID(me))>=String(connectedPair.id)))return;
      const label=follow?'DUO · PARTNERBÜNDNIS ANFRAGEN: ':
        paired?'DUO · GEMEINSAMES BÜNDNIS ANFRAGEN: ':
          'ALLIANZ ANGEBOTEN: ';
      if(sendAllianceOffer(me,target,label+nameOf(target),!!paired)){
        diplomacyHandled.set(id,tick+(paired?220:1050));
        diplomacyStats.offered++;
        diplomacyStatus='Bündnis angeboten: '+nameOf(target)+
          ' · Bestätigung durch Spiel ausstehend';
        telemetry('alliance_offer_sent',diplomacyStatus,
          {requestor:id,path:allianceOfferPath(),
            duo:!!paired,inherited:!!follow});
      }
    }).catch(e=>{diplomacyStatus='Allianzangebot fehlgeschlagen: '+
      String(e?.message||e).slice(0,90);});
  }
  function landingFailure(boat,tick,tile,reason){
    const key=boat.key||String(boat.dest),prior=landingFailures.get(key);
    const count=prior&&tick-prior.tick<1800?Math.min(5,prior.count+1):1;
    landingFailures.set(key,{count,tick,tile,reason});
    if(landingFailures.size>60)for(const [k,v] of landingFailures)
      if(tick-v.tick>1800)landingFailures.delete(k);
    const until=tick+Math.min(1200,280+count*180);
    navalCooldown.set(key,Math.max(navalCooldown.get(key)||0,until));
    navalSiteNegative.set(tile,Math.max(navalSiteNegative.get(tile)||0,
      tick+Math.min(1600,750+count*200)));
    navalBackoffUntil=Math.max(navalBackoffUntil,tick+Math.min(480,120+count*100));
    telemetry('landing_failure_guard','Landungsziel nach unbestätigter Landung vorübergehend gesperrt',
      {key,tile,count,until,reason,evidence:'observed-no-confirmed-arrival'});
  }
  // Prefer the visible, engine-produced grid MotionPlan for an active ship.
  // This path and ticksPerStep come from the official GameView (not BFS).
  // This projects movement only; retreat, interception and re-path can change it.
  function observedTransportETA(ship,tick=number(()=>game?.ticks?.(),0)){
    const id=ship?.id?.();
    const plan=Number.isInteger(id)?game?.motionPlans?.()?.get(id):null;
    if(!plan||!Number.isInteger(plan.startTick)||
      !Number.isInteger(plan.ticksPerStep)||plan.ticksPerStep<1||
      !plan.path?.length)return null;
    const arrivalTick=plan.startTick+
      (plan.path.length-1)*plan.ticksPerStep;
    return {source:'official-visible-motion-plan',
      etaTicksEstimate:Math.max(0,arrivalTick-tick),
      arrivalTick,steps:plan.path.length-1,
      ticksPerMove:plan.ticksPerStep,planId:plan.planId,
      etaExact:false};
  }
  function inspectMarine(me,tick){
    const units=(()=>{try{return game.units?.()||[];}catch(_){return [];}})();
    const mine=safeID(me),own=type=>units.filter(u=>
      u.type?.()===type&&safeID(u.owner?.())===mine&&u.isActive?.());
    marineUnresolvedWatches=marineUnresolvedWatches.filter(a=>{
      // This is a later coast observation, never proof that the missing boat
      // arrived or was destroyed. Keep it separate from confirmed landing
      // and the original unresolved/censored transport count.
      if(ownedTile(a.tile,me)){
        telemetry('boat_late_coast_observed',
          'Küste nach ungeklärtem Transport später im eigenen Besitz',{
            actionId:a.actionId,shipIds:a.shipIds,tile:a.tile,
            elapsed:tick-a.lostTick,eta:a.eta,
            evidence:'later-coast-ownership-not-causal'});
        return false;
      }
      if(tick>=a.watchUntil){
        telemetry('boat_late_coast_unobserved',
          'Nachbeobachtung der ungeklärten Küste beendet',{
            actionId:a.actionId,shipIds:a.shipIds,tile:a.tile,
            eta:a.eta,evidence:'no-observed-coast-not-proven-loss'});
        return false;
      }
      return true;
    });
    landingAudits=landingAudits.filter(a=>{
      const held=ownedTile(a.tile,me),age=tick-a.tick;
      a.checkpoints=Array.isArray(a.checkpoints)?a.checkpoints:[];
      if(!held){
        marineStats.bridgeheadLost++;
        telemetry('bridgehead_lost','Landungsziel vor Abschluss der Wirkungsbeobachtung verloren',
          {actionId:a.actionId??null,shipIds:a.shipIds??[],
            tile:a.tile,target:a.target,observedTicks:age,
            checkpoints:a.checkpoints,evidence:'destination-ownership-not-causal'});
        navalCooldown.set(a.key,tick+350);navalSiteNegative.set(a.tile,tick+900);
        return false;
      }
      for(const horizon of [120,600])if(age>=horizon&&!a.checkpoints.includes(horizon)){
        a.checkpoints.push(horizon);
        marineStats['bridgeheadHeld'+horizon]++;
        if(horizon===120)marineStats.bridgeheadHeld++;
        telemetry('bridgehead_held_'+horizon,'Landungsziel am '+horizon+'-Tick-Horizont gehalten',
          {actionId:a.actionId??null,shipIds:a.shipIds??[],
            tile:a.tile,target:a.target,observedTicks:age,horizon,
            evidence:'destination-ownership-not-causal'});
      }
      return age<600;
    });
    if(pendingBoat){
      const boat=pendingBoat,ships=own('Transport');
      const isNew=u=>{
        const id=u.id?.();
        return id!==undefined&&!boat.beforeIds.includes(id);
      };
      // Player targets may be inland. OpenFront resolves the intent to the
      // nearest reachable shore, so accept the new own transport even when
      // its real target differs from the originally queried tile.
      const freshShips=ships.filter(isNew);
      // Prefer the observed destination, including the server's coastal
      // redirect. A pre-existing boat cannot satisfy this pending order.
      const observed=freshShips.find(u=>u.targetTile?.()===boat.dest)||
        (freshShips.length===1?freshShips[0]:null);
      if(observed){
        const position=number(()=>observed.tile?.(),NaN);
        if(Number.isInteger(position)&&position!==boat.lastShipTile){
          boat.lastShipTile=position;boat.lastProgressTick=tick;
        }
        const id=observed.id?.();
        const observedETA=observedTransportETA(observed,tick);
        if(observedETA)boat.eta=observedETA;
        const resolved=observed.targetTile?.();
        if(Number.isInteger(resolved))boat.resolvedDest=resolved;
        if(!boat.shipIds.includes(id))boat.shipIds.push(id);
        if(boat.observationLostTick!=null){
          telemetry('boat_observation_resumed','Transport wieder sichtbar',{
            actionId:boat.actionId??null,ship:id,
            lostTicks:tick-boat.observationLostTick});
          boat.observationLostTick=null;
        }
        if(!boat.seen){
          boat.seen=true;marineStats.transportConfirmed++;
          fleetStatus='Transport im Spiel sichtbar';
          telemetry('boat_confirmed','Transport im Spielzustand beobachtet',
            {actionId:boat.actionId??null,dest:boat.dest,resolvedDest:boat.resolvedDest??null,
              target:boat.target,ship:id,troops:boat.troops,
              eta:boat.eta??null});
          // An observed ship is not an observed landing. It must never
          // monopolize the land-war lock before a real bridgehead exists.
          telemetry('naval_target_provisional','Marine-Ziel vorgemerkt; Landkrieg bleibt unabhängig',{
            actionId:boat.actionId??null,target:boat.playerID??null,
            resolvedDest:boat.resolvedDest??null,
            warLock:warState.id??null,evidence:'ship-only-no-bridgehead'});

        }
      }
      const landingTile=Number.isInteger(boat.resolvedDest)?boat.resolvedDest:boat.dest;
      if(boat.seen && ownedTile(landingTile,me)){
        marineStats.transportArrived++;
        fleetStatus='Landung / Gebiet am Ziel bestätigt';
        telemetry('boat_arrived','Transportziel nach bestätigtem Schiff übernommen',
          {actionId:boat.actionId??null,dest:boat.dest,resolvedDest:landingTile,
            target:boat.target,shipIds:boat.shipIds,
            eta:boat.eta??null,status:'coast-owned-after-ship-observation',
            evidence:'ship-plus-destination-ownership-not-causal'});
        // Only confirmed own coastal territory may promote the provisional
        // marine objective. Never overwrite an independent active land war.
        if(boat.playerID&&coordinatedWar()&&warState.id===null){
          const target=game.playerViews?.().find(p=>safeID(p)===boat.playerID);
          if(target?.isAlive?.()&&!friendly(target,me)){
            warState={id:boat.playerID,name:nameOf(target),since:tick,
              blockedUntil:-Infinity,origin:'confirmed-bridgehead'};
            telemetry('naval_war_lock','Bestätigter Brückenkopf als Kriegsziel gebunden',{
              actionId:boat.actionId??null,target:boat.playerID,
              resolvedDest:landingTile,evidence:'ship-plus-own-coast'});
          }
        }
        landingAudits.push({actionId:boat.actionId??null,
          shipIds:[...boat.shipIds],eta:boat.eta??null,
          tile:landingTile,target:boat.target,key:boat.key,tick,
          checkpoints:[]});
        navalCooldown.set(boat.key,tick+140);
        landingFailures.delete(boat.key);
        navalSiteNegative.delete(landingTile);
        pendingBoat=null;
      }else if(boat.seen && tick-boat.tick>40 &&
        !ships.some(u=>boat.shipIds.includes(u.id?.()))){
        if(boat.observationLostTick==null){
          boat.observationLostTick=tick;
          fleetStatus='Transport nicht sichtbar – Küste wird nachbeobachtet';
          telemetry('boat_observation_lost',fleetStatus,{
            actionId:boat.actionId??null,dest:boat.dest,resolvedDest:landingTile,
            target:boat.playerID??null,shipIds:boat.shipIds,
            lastShipTile:boat.lastShipTile??null,
            lastProgressTick:boat.lastProgressTick,
            coastOwner:safeID(game.owner?.(landingTile)),
            eta:boat.eta??null,evidence:'ship-absent-not-proven-destroyed'});
        }
        // Watch briefly after disappearance. MotionPlan ETA is a moving
        // estimate, not proof of arrival; cap the watch to avoid starvation.
        const grace=marineObservationGraceKernel(
          boat.eta?.arrivalTick,boat.observationLostTick);
        if(tick-boat.observationLostTick>=grace){
          marineStats.transportUnresolved++;
          fleetStatus='Transport weiterhin ungeklärt; Küste nicht übernommen';
          telemetry('boat_unresolved',fleetStatus,{
            actionId:boat.actionId??null,dest:boat.dest,resolvedDest:landingTile,
            target:boat.playerID??null,shipIds:boat.shipIds,
            lastShipTile:boat.lastShipTile??null,
            lastProgressTick:boat.lastProgressTick,
            observationLostTick:boat.observationLostTick,
            coastOwner:safeID(game.owner?.(landingTile)),
            eta:boat.eta??null,grace,
            reason:boat.cancelIntent?'ship-disappeared-after-cancel-intent':
              'ship-disappeared-no-observed-bridgehead',
            cancelIntent:boat.cancelIntent??null,
            status:'unresolved-not-proven-destroyed'});
          if(boat.cancelIntent){
            // We requested cancellation because the destination became friendly.
            // Disappearance alone cannot prove cancellation, arrival or loss.
            navalCooldown.set(boat.key,tick+600);
          }else{
            // The immediate grace window prevents a stuck pendingBoat from
            // blocking new legal operations. A separate bounded watcher
            // preserves evidence until the visible MotionPlan ETA.
            marineUnresolvedWatches.push({
              actionId:boat.actionId??null,shipIds:[...boat.shipIds],
              tile:landingTile,lostTick:boat.observationLostTick,
              eta:boat.eta??null,watchUntil:Math.min(tick+7200,
                Math.max(tick+120,(boat.eta?.arrivalTick??tick)+120))
            });
            if(marineUnresolvedWatches.length>24)
              marineUnresolvedWatches.splice(0,
                marineUnresolvedWatches.length-24);
            landingFailure(boat,tick,landingTile,'ship-disappeared-unresolved');
          }
          pendingBoat=null;
        }
      }else if(boat.seen && tick-boat.tick>650 && !boat.delayed){
        boat.delayed=true;fleetStatus='Transport noch unterwegs / Landung ungeklärt';
        telemetry('boat_delayed',fleetStatus,{
          actionId:boat.actionId??null,dest:boat.dest,resolvedDest:landingTile,
          shipIds:boat.shipIds,eta:boat.eta??null,
          lastProgressTick:boat.lastProgressTick,
          status:'in-transit-arrival-unknown'});
      }else if(tick-boat.tick>(boat.seen?
        Math.max(1350,Number.isFinite(boat.eta?.arrivalTick)?
          Math.min(7200,boat.eta.arrivalTick-boat.tick+120):1350):90) &&
        (!boat.seen||boat.observationLostTick==null)&&
        (!boat.seen||tick-boat.lastProgressTick>260)){
        if(boat.seen)marineStats.transportUnresolved++;
        else marineStats.transportUnconfirmed++;
        fleetStatus=boat.seen?'Transport lange ohne Landungsbestätigung':
          'Transport nach Intent nicht im Spiel beobachtet';
        telemetry(boat.seen?'boat_unresolved':'boat_unconfirmed',fleetStatus,
          {actionId:boat.actionId??null,dest:boat.dest,
            resolvedDest:landingTile,target:boat.target,
            shipIds:boat.shipIds,eta:boat.eta??null,troops:boat.troops,
            reason:boat.seen?'stalled-no-owned-coast':'ship-not-seen',
            status:'unresolved-not-proven-lost'});
        landingFailure(boat,tick,landingTile,
          boat.seen?'stalled-no-owned-coast':'ship-not-seen');pendingBoat=null;
      }
    }
    if(pendingWarship){
      const pending=pendingWarship,ships=own('Warship');
      const observed=ships.find(u=>!pending.beforeIds.includes(u.id?.()));
      if(observed){
        marineStats.warshipConfirmed++;
        fleetStatus='Kriegsschiff im Spiel bestätigt';
        telemetry('warship_confirmed','Kriegsschiff im Spielzustand sichtbar',
          {tile:observed.tile?.(),unitId:observed.id?.(),cost:pending.cost});
        pendingWarship=null;
      }else if(tick-pending.tick>110){
        marineStats.warshipUnconfirmed++;
        fleetStatus='Kriegsschiff-Befehl nicht bestätigt';
        telemetry('warship_unconfirmed',fleetStatus,
          {tile:pending.tile,cost:pending.cost});
        pendingWarship=null;
      }
    }
  }
  function sendMarineTransport(me,dest,troops,tick,label,targetKey,route=null){
    if(pendingBoat || (navalCooldown.get(targetKey)||0)>tick)return false;
    if(!Number.isInteger(dest)||!(troops>=1000))return false;
    const fresh=military(me,strategic.groups);
    if(fresh.incoming>0||troops>fresh.available||navalHomeRisk(me,number(()=>game.ticks(),tick)))return false;
    const beforeIds=(()=>{try{return (game.units?.()||[]).filter(u=>
      u.type?.()==='Transport'&&safeID(u.owner?.())===safeID(me))
      .map(u=>u.id?.());}catch(_){return [];}})();
    if(!send('boat',[dest,troops],label))return false;
    pendingBoat={dest,tick,troops,actionId:lastActionId,
      key:targetKey,target:label,
      playerID:targetKey.startsWith('player:')?targetKey.slice(7):null,
      resolvedDest:null,beforeIds,shipIds:[],seen:false,
      lastShipTile:null,lastProgressTick:tick,observationLostTick:null,
      delayed:false,
      route:route?{distance:route.distance,etaTicks:route.etaTicks,
        risk:route.risk,uncertaintyUntil:route.uncertaintyUntil}:null};
    marineStats.transportSent++;
    navalCooldown.set(targetKey,tick+160);
    fleetStatus='Transport angefordert · Bestätigung ausstehend';
    telemetry('boat_intent','Transport angefordert; wartet auf Spielzustand',
      {actionId:pendingBoat.actionId,dest,troops,target:targetKey,
        route:pendingBoat.route});
    return true;
  }
  // Protect real owned shores from visible incoming transports. BuildUnitIntentEvent
  // for Warship uses an actual WATER tile checked through the worker.
  async function fleetDefense(me,tick,serial){
    if(!opts.boats||tick-lastFleet<120||!game.units)return false;
    const all=game.units()||[],ourID=safeID(me);
    const ownWarships=all.filter(u=>u.type?.()==='Warship'&&
      safeID(u.owner?.())===ourID&&u.isActive?.());
    if(ctors.cancelBoat){
      const unsafe=all.find(u=>u.type?.()==='Transport'&&u.isActive?.() &&
        safeID(u.owner?.())===ourID&&Number.isInteger(u.targetTile?.())&&
        game.owner(u.targetTile())?.isPlayer?.() &&
        friendly(game.owner(u.targetTile()),me) &&
        !u.transportShipState?.().isRetreating);
      if(unsafe&&Number.isInteger(unsafe.id?.())&&send('cancelBoat',[unsafe.id()],
        'LANDUNG ABBRECHEN: Ziel jetzt verbündet',true)){
        const shipId=unsafe.id();
        if(pendingBoat?.shipIds?.includes(shipId)){
          pendingBoat.cancelIntent={actionId:lastActionId,shipId,tick,
            reason:'destination-became-friendly',effect:'unknown'};
          telemetry('boat_cancel_intent',
            'Stoppbefehl gesendet; Wirkung noch nicht bestätigt',
            {actionId:lastActionId,shipId,
              originalActionId:pendingBoat.actionId??null,
              destination:pendingBoat.resolvedDest??pendingBoat.dest,
              evidence:'intent-not-cancellation-proof'});
        }
        lastFleet=tick;fleetStatus='Landungsabbruch angefordert';return true;
      }
    }
    const targets=all.filter(u=>u.type?.()==='Transport'&&u.isActive?.() &&
      safeID(u.owner?.())!==ourID&&!friendly(u.owner?.(),me)&&
      Number.isInteger(u.targetTile?.())&&ownedTile(u.targetTile(),me));
    const active=targets.find(u=>!u.transportShipState?.().isRetreating);
    const water=active?.tile?.();
    if(active&&ctors.warship&&Number.isInteger(water)&&game.isWater?.(water)){
      const ship=ownWarships.find(u=>Number.isInteger(u.id?.()) &&
        game.euclideanDistSquared?.(u.tile(),water)<300*300);
      if(ship&&send('warship',[[ship.id()],water],
        'KRIEGSSCHIFF → feindlichen Transporter abfangen')){
        lastFleet=tick;fleetStatus='Transporter abfangen';return true;
      }
    }
    if(pendingWarship||!ctors.build ||
      game.config().isUnitDisabled?.('Warship')===true)return false;
    const ports=ownStructures(me).filter(u=>u.type?.()==='Port'&&
      !u.isUnderConstruction?.());
    if(!ports.length){
      if(active)fleetStatus='Küstenschutz: Hafen fehlt';
      return false;
    }
    // Build one escort before the silo fund, a second only after the first
    // has appeared in the game. More hulls require a real incoming landing.
    const desired=active?Math.min(3,ports.length+1):
      clamp((number(()=>me.numTilesOwned(),0)>=15000?2:1)+
        Math.round(neuralChannel('fleetPriority',me)*1.5),1,3);
    if(ownWarships.length>=desired)return false;
    const gold=goldAmount(me);
    if(!active && gold<450000 && !game.config().infiniteGold?.())return false;
    let probes=0,legalFound=0;
    for(const port of ports.slice(0,3)){
      const x=game.x(port.tile()),y=game.y(port.tile());
      for(const radius of [3,6,10,15,20]){
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],
          [1,1],[-1,1],[1,-1],[-1,-1]]){
          const xx=x+dx*radius,yy=y+dy*radius;
          if(!valid(xx,yy))continue;
          const tile=game.ref(xx,yy);
          if(!game.isWater?.(tile))continue;
          let response;
          try{response=await me.actions(tile,['Warship']);probes++;}
          catch(_){continue;}
          if(!live(serial))return false;
          const ship=response?.buildableUnits?.find(u=>u.type==='Warship'&&
            Number.isInteger(u.canBuild));
          if(!ship)continue;
          legalFound++;
          const cost=Number(ship.cost);
          if(!game.config().infiniteGold?.() &&
            (!Number.isFinite(cost)||gold<cost))continue;
          // canBuild is the launch PORT; the intent expects the queried WATER patrol tile.
          if(!spendBudget(me,cost,'Warship',!!active))continue;
          if(send('build',['Warship',tile],
            (active?'KÜSTENSCHUTZ':'FLOTTENAUFBAU')+' → Kriegsschiff')){
            commitGoldSpend(me,cost,'Warship');
            pendingWarship={tick,tile,spawnTile:ship.canBuild,cost,
              beforeIds:ownWarships.map(u=>u.id?.())};
            marineStats.warshipSent++;lastFleet=tick;
            fleetStatus='Kriegsschiff angefordert · Bestätigung ausstehend';
            telemetry('warship_intent','Kriegsschiff-Bau angefordert',
              {tile,spawnTile:ship.canBuild,cost,ports:ports.length,
                priorWarships:ownWarships.length,emergency:!!active});
            return true;
          }
        }
      }
    }
    if(probes){
      lastFleet=tick;
      fleetStatus=legalFound?'Kriegsschiff: Gold/Budget fehlt':
        'Kriegsschiff: kein legaler Wasser-Bauplatz';
      telemetry('warship_probe',fleetStatus,{probes,legalFound,
        ports:ports.length,gold,warships:ownWarships.length});
    }
    return false;
  }
  function tradeIntentPath(){
    if(typeof ctors.embargo==='function')return 'intent';
    const p=document.querySelector('player-panel');
    if(!p)return null;
    return p.g===game&&p.eventBus===bus&&
      typeof p.handleEmbargoClick==='function'&&
      typeof p.handleStopEmbargoClick==='function'?'player-panel':null;
  }
  function sendTradeToggle(me,target,action,label){
    if(!opts.enabled||!connected()||!permittedMatch(game)||
      !actionBudget()||Date.now()-lastEmission<410||me!==myPlayer())return false;
    if(!target?.isAlive?.()||safeID(target)===safeID(me)||
      !['start','stop'].includes(action))return false;
    if(action==='start'&&friendly(target,me))return false;
    if(typeof ctors.embargo==='function')
      return send('embargo',[target,action],label);
    const p=document.querySelector('player-panel');
    if(tradeIntentPath()!=='player-panel'||p?.g!==game||p?.eventBus!==bus)return false;
    try{
      const ev={stopPropagation(){}};
      (action==='start'?p.handleEmbargoClick:p.handleStopEmbargoClick)
        .call(p,ev,me,target);
      actions.push(Date.now());lastEmission=Date.now();totalSent++;
      log(label+' (offizielles Spielerpanel)');
      telemetry('trade_toggle',label,{target:safeID(target),action,path:'player-panel'});
      return true;
    }catch(e){totalFailed++;return false;}
  }
  function tradeAnchor(p){
    const id=safeID(p),front=(strategic.groups||[])
      .find(g=>g.id===id)?.tiles?.[0];
    if(Number.isInteger(front)&&safeID(game.owner(front))===id)return front;
    const spawn=p?.state?.spawnTile;
    return Number.isInteger(spawn)&&safeID(game.owner(spawn))===id?spawn:null;
  }
  function tradeImpactAssessment(me,p,tick){
    const ownPorts=ownStructures(me).filter(u=>u.type?.()==='Port'&&
      !u.isUnderConstruction?.()).length;
    const enemyPorts=(p.units?.()||[]).filter(u=>u.type?.()==='Port'&&
      !u.isUnderConstruction?.()).length;
    const id=safeID(p),front=(strategic.groups||[]).find(g=>g.id===id);
    const outgoing=(me.outgoingAttacks?.()||[]).filter(a=>
      !a.retreating&&attackTargets(a.targetID,p)).length;
    const incoming=(me.incomingAttacks?.()||[]).filter(a=>
      !a.retreating&&attackTargetID(a.attackerID)===id).length;
    const conflict=outgoing+incoming;
    // OpenFront does not expose per-counterparty trade income here. Keep the
    // estimate explicit and symmetric instead of inventing exact gold values.
    const estimatedEnemyCost=enemyPorts*14+conflict*24+(front?.tiles?.length||0)*.4;
    const estimatedOwnCost=ownPorts*14;
    const score=estimatedEnemyCost-estimatedOwnCost;
    return {target:id,tick,ownPorts,enemyPorts,outgoing,incoming,
      borderTiles:front?.tiles?.length||0,estimatedEnemyCost,
      estimatedOwnCost,score,worthwhile:conflict>0&&score>=0,
      evidence:'port-count/front/conflict proxy; counterparty income unavailable'};
  }
  async function tradePolicy(me,tick){
    if(!opts.economy||tick-lastTradeTick<80||!actionBudget())return false;
    const serial=generation,tradeGame=game;
    const current=()=>live(serial)&&game===tradeGame&&me===myPlayer()&&opts.economy;
    if(!current())return false;
    if(!tradeIntentPath()){
      tradeStatus='Handel automatisch · Embargo-Intent noch nicht erkannt';
      tradeStats.skipped++;return false;
    }
    const players=(game.playerViews?.()||[]).filter(p=>p?.isPlayer?.()&&
      p.isAlive?.()&&safeID(p)!==safeID(me));
    const open=players.filter(p=>actualFriendly(p,me)&&me.hasEmbargoAgainst?.(p));
    for(const p of open){
      const tile=tradeAnchor(p);if(!Number.isInteger(tile))continue;
      lastTradeTick=tick;try{
        await me.actions(tile,null);
        if(!current())return false;
        if(actualFriendly(p,me)&&safeID(game.owner(tile))===safeID(p)&&me.hasEmbargoAgainst?.(p)&&
          sendTradeToggle(me,p,'stop','HANDEL ÖFFNEN → '+nameOf(p))){
          botEmbargoes.delete(safeID(p));tradeStats.opened++;
          tradeStatus='Handel geöffnet mit '+nameOf(p);return true;
        }
      }catch(_){tradeStats.skipped++;}
    }
    // An intended target is not yet a proven trade adversary.
    // Embargo costs our own port income too; require observed fighting.
    const hostile=players.filter(p=>{
      const id=safeID(p);
      if(friendly(p,me)||me.hasEmbargoAgainst?.(p))return false;
      return (me.outgoingAttacks?.()||[]).some(a=>
        !a.retreating&&attackTargets(a.targetID,p))||
        (me.incomingAttacks?.()||[]).some(a=>
          !a.retreating&&attackTargetID(a.attackerID)===id);
    });
    if(hostile.length){
      const assessed=hostile.map(p=>({p,a:tradeImpactAssessment(me,p,tick)}))
        .sort((a,b)=>b.a.score-a.a.score||
          number(()=>b.p.troops?.(),0)-number(()=>a.p.troops?.(),0));
      tradeAssessments=assessed.map(x=>x.a).slice(0,8);
      const selected=assessed.find(x=>x.a.worthwhile),p=selected?.p,
        tile=p?tradeAnchor(p):null;
      if(Number.isInteger(tile)){lastTradeTick=tick;try{
        const a=await me.actions(tile,null);
        if(!current())return false;
        if(a?.interaction?.canEmbargo===true&&!friendly(p,me)&&
          tradeImpactAssessment(me,p,number(()=>game.ticks(),tick)).worthwhile&&
          safeID(game.owner(tile))===safeID(p)&&!me.hasEmbargoAgainst?.(p)&&
          sendTradeToggle(me,p,'start','HANDEL STOPPEN → '+nameOf(p))){
          botEmbargoes.add(safeID(p));tradeStats.embargoed++;
           tradeStatus='Embargo gegen aktiven Gegner: '+nameOf(p)+
             ' · Wirkungsscore '+Math.round(selected.a.score);return true;
        }
      }catch(_){tradeStats.skipped++;}}
    }
    for(const id of [...botEmbargoes]){
      const p=players.find(x=>safeID(x)===id);
      if(!p){botEmbargoes.delete(id);continue;}
      const active=(me.outgoingAttacks?.()||[]).some(a=>
        !a.retreating&&attackTargets(a.targetID,p))||
        (me.incomingAttacks?.()||[]).some(a=>
          !a.retreating&&attackTargetID(a.attackerID)===id);
      if(active||!me.hasEmbargoAgainst?.(p))continue;
      const tile=tradeAnchor(p);if(!Number.isInteger(tile))continue;
      lastTradeTick=tick;try{
        await me.actions(tile,null);
        if(!current())return false;
        const fresh=tradeImpactAssessment(me,p,number(()=>game.ticks(),tick));
        if(fresh.incoming===0&&fresh.outgoing===0&&
          safeID(game.owner(tile))===id&&me.hasEmbargoAgainst?.(p)&&sendTradeToggle(me,p,'stop',
          'HANDEL WIEDER ÖFFNEN → '+nameOf(p))){
          botEmbargoes.delete(id);tradeStats.opened++;
          tradeStatus='Handel wieder geöffnet mit '+nameOf(p);return true;
        }
      }catch(_){tradeStats.skipped++;}
    }
    const ports=ownStructures(me).filter(u=>u.type?.()==='Port'&&
      !u.isUnderConstruction?.()).length;
    tradeStatus=ports?'Handel offen · '+ports+' Hafen/Häfen · Schiffe automatisch':
      'Noch kein fertiger Hafen · Handelsausbau wird bewertet';
    return false;
  }
  async function tradeTick(){
    if(tradeBusy||!opts.enabled||!connected())return;
    const me=myPlayer(),tick=number(()=>game?.ticks?.(),-1);
    if(!me?.hasSpawned?.()||!me?.isAlive?.()||tick<0)return;
    tradeBusy=true;
    try{await tradePolicy(me,tick);}
    catch(e){tradeStatus='Handel: '+String(e?.message||e).slice(0,75);}
    finally{tradeBusy=false;}
  }
  // Team aid is guarded by same-team identity, real incoming threats,
  // available HOME troops, and the silo fund. No speculative allied donations.
  function teamSupport(me,tick,s){
    const peer=duoTrustedPeer();
    const local=peer&&actualFriendly(peer.player,me)?peer:null;
    const warning=Math.max(local?.state?.warning||0,
      local?.state?.earlyCrisis?1:0);
    const donationCooldown=local?(warning>=2?90:warning>=1?160:240):300;
    if((winStatus.mode!=='Team'&&!local)||tick-lastDonation<donationCooldown||
      !actionBudget())return false;
    const team=me.team?.();
    if((team===null||team===undefined)&&!local)return false;
    const partners=(game.playerViews?.()||[]).filter(p=>
      p!==me&&p.isAlive?.()&&p.team?.()===team&&me.isOnSameTeam?.(p));
    if(!partners.length&&!local)return false;
    const duo=rankedDuo(me)||(local?
      {partner:local.player,partnerID:local.id}:null);
    if(duo){
      const partner=duo.partner;
      const inbound=(partner.incomingAttacks?.()||[]).filter(a=>!a.retreating)
        .reduce((n,a)=>n+Math.max(0,number(()=>a.troops,0)),0);
      const partnerHome=Math.max(1,number(()=>partner.troops(),1));
      const ownDanger=duoWarningLevel(s,tick)>0;
      // Donating from two symmetric bots must not form a back-and-forth
      // loop. Only donate on observed pressure and concrete troop shortage.
      const critical=warning>=2||inbound>partnerHome*.12;
      const recoveryNeed=warning>=1&&inbound===0&&s.home>partnerHome*1.35&&
        number(()=>partner.numTilesOwned(),0)<
          number(()=>me.numTilesOwned(),0)*(warning>=2?.85:.65)?
        Math.min(partnerHome*.20,s.home*.07):0;
      const shortage=Math.max(0,inbound*1.55-partnerHome,
        inbound>partnerHome*.06?inbound*.18:0,recoveryNeed);
      const floor=Math.max(s.reserve,s.incoming*1.7,
        s.strongest*(critical?.72:.60),s.home*(critical?.42:.35));
      const safe=Math.max(0,Math.floor(s.home-floor));
      const amount=Math.floor(Math.min(shortage,
        s.available*(critical?.32:.22),s.home*(critical?.14:.10),safe));
      if(!ownDanger&&(inbound>partnerHome*.025||recoveryNeed>=1000)&&
        amount>=1000&&
        ctors.donateTroops&&(!me.canDonateTroops||me.canDonateTroops(partner))&&
        send('donateTroops',[partner,amount],
          'DUO · TEAMHILFE → '+nameOf(partner))){
        lastDonation=tick;
        const requestId=local?.state?.needHelp?
          local.state.helpRequestId??null:null;
        if(requestId){
          diagnosticAid={requestId,partnerId:duo.partnerID,
            actionId:lastActionId,amount,tick,
            partnerHomeAtEmission:partnerHome};
          telemetry('duo_help_accepted','Sichere Truppenhilfe angefordert',{
            requestId,partnerId:duo.partnerID,actionId:lastActionId,
            acceptedTroops:amount,status:'accepted-for-emitted-intent',
            supportObserved:'unknown'});
          telemetry('duo_help_action_sent','Truppenspende als Intent gesendet',{
            requestId,partnerId:duo.partnerID,actionId:lastActionId,
            sentTroops:amount,status:'action-sent-not-confirmed',
            supportObserved:'unknown'});
        }
        telemetry('duo_donation','Notfallhilfe gegen beobachtete Partnerfront',
          {requestId,actionId:lastActionId,
            planId:duoPlan?.planId??null,partner:duo.partnerID,partnerIncoming:inbound,warning,
            partnerHome,amount,ownHome:s.home,remaining:s.home-amount,floor,
            displayAmount:Math.round(amount/10)});
        return true;
      }
      // One-way economic assistance: only a clearly richer teammate with a
      // funded own construction reserve may help a cash-starved partner.
      // Independent instances cannot ping-pong gold when the wealth gap
      // criterion and one-match cooldown are enforced.
      const cfg=game?.config?.().gameConfig?.()||{};
      const ownGold=goldAmount(me);
      const partnerGold=number(()=>Number(partner.gold?.()),Infinity);
      if(!ownDanger&&cfg.donateGold!==false&&ctors.donateGold&&
        (!me.canDonateGold||me.canDonateGold(partner))&&
        Number.isFinite(partnerGold)&&
        ownGold>Math.max(1400000,partnerGold+850000)&&
        (inbound>0||number(()=>partner.numTilesOwned(),0)<
          number(()=>me.numTilesOwned(),0)*.65)){
        const needs=economicNeeds(me,ownStructures(me),[]);
        const richAid=ownGold>=8000000&&partnerGold<1200000&&
          partnerGold<ownGold*.30&&!needs.capStalled&&
          s.incoming===0&&s.ratio>=.70&&s.committed<s.home*.30&&
          s.strongest<s.home*.75;
        if(!richAid&&partnerGold>=400000)return false;
        // The replay shows multi-million late-game transfers; scale aid only
        // for a verifiably struggling teammate, without spending our own
        // production, SAM or military reserves.
        const cashFloor=Math.max(needs.savingsTarget,richAid?3000000:1000000);
        const amountGold=Math.floor(richAid?
          Math.min(2000000,(ownGold-cashFloor)*.30,2000000-partnerGold):
          Math.min(200000,(ownGold-cashFloor)*.20,400000-partnerGold));
        if(amountGold>=50000&&ownGold-amountGold>=cashFloor&&
          spendBudget(me,amountGold,'donateGold')&&
          send('donateGold',[partner,BigInt(amountGold)],
            'DUO · AUFBAUHILFE → '+nameOf(partner))){
          commitGoldSpend(me,amountGold,'donateGold');
          lastDonation=tick;
          telemetry('duo_gold','Goldhilfe bei eindeutigem Wirtschaftsrückstand',
            {planId:duoPlan?.planId??null,partner:duo.partnerID,partnerGold,ownGold,
              amount:amountGold,cashFloor,partnerIncoming:inbound});
          return true;
        }
      }
      // No speculative equal-wealth donations or legacy absolute-incoming
      // selection; both bots keep their own reserve and economy.
      return false;
    }
    const needy=partners.map(p=>({p,incoming:(p.incomingAttacks?.()||[])
      .filter(a=>!a.retreating).reduce((n,a)=>n+number(()=>a.troops,0),0)}))
      .sort((a,b)=>b.incoming-a.incoming)[0];
    if(!needy || needy.incoming<number(()=>needy.p.troops(),1)*.35 ||
      s.incoming>0 || s.strongest>=s.home*.85)return false;
    const amount=Math.floor(Math.min(s.available*.18,s.home*.08));
    if(ctors.donateTroops && amount>=1000 &&
      s.home-amount>Math.max(s.home*.35,s.strongest*.6) &&
      send('donateTroops',[needy.p,amount],'TEAMHILFE → '+nameOf(needy.p))){
      lastDonation=tick;return true;
    }
    const gold=goldAmount(me);
    const reserve=economicNeeds(me,ownStructures(me),[]).savingsTarget;
    const amountGold=Math.floor(Math.min(gold*.06,250000));
    if(ctors.donateGold && gold>1200000 && amountGold>=50000 &&
      gold-amountGold>=Math.max(reserve,750000) &&
      spendBudget(me,amountGold,'donateGold')&&
      send('donateGold',[needy.p,BigInt(amountGold)],'TEAMGOLD → '+nameOf(needy.p))){
      commitGoldSpend(me,amountGold,'donateGold');
      lastDonation=tick;return true;
    }
    return false;
  }
  function renewAlliances(me,tick){
    if(!opts.diplomacy||!ctors.extend)return false;
    for(const a of me.alliances?.()||[]){
      if(!a.hasExtensionRequest||a.expiresAt-tick>250||a.expiresAt<=tick ||
        (diplomacyHandled.get('extend:'+a.id)||0)>tick)continue;
      const partner=game.playerViews().find(p=>safeID(p)===a.other);
      if(partner&&friendly(partner,me)&&send('extend',[partner],
        'ALLIANZ VERLÄNGERN → '+nameOf(partner),true)){
        diplomacyHandled.set('extend:'+a.id,tick+125);return true;
      }
    }
    return false;
  }
  // Bounded rotating grid: seek actual unowned LAND shore tiles on islands.
  // The worker validates water access and the real Transport deployment.
  // A sample may miss a tiny island this pass; successive calls rotate phase.
  // Bounded island-size estimate from the client-visible terrain. Never infer
  // a large beachhead merely from one reachable coastal tile.
  function neutralIslandEstimate(tile,limit=1800){
    if(typeof game?.neighbors4!=='function')return null;
    const pending=[tile],seen=new Set([tile]);let counted=0,hadNeighbors=false;
    while(pending.length&&counted<limit){
      const cur=pending.pop();
      if(!game.isLand(cur)||game.isImpassable?.(cur)||
        game.hasFallout?.(cur)||safeID(game.owner(cur))!==null)continue;
      counted++;
      const adjacent=[];
      const n=game.neighbors4(cur,adjacent)||0;
      if(n>0)hadNeighbors=true;
      for(let i=0;i<n;i++){
        const next=adjacent[i];
        if(!Number.isInteger(next)||seen.has(next))continue;
        seen.add(next);
        if(game.isLand(next)&&!game.isImpassable?.(next)&&
          !game.hasFallout?.(next)&&safeID(game.owner(next))===null)
          pending.push(next);
      }
    }
    return hadNeighbors?counted:null;
  }
  function neutralNavalCandidates(me,limit=12){
    if(!game.isShore||!game.width||!game.height)return [];
    const w=game.width(),h=game.height();
    if(!(w>0&&h>0))return [];
    const dx=Math.max(1,Math.ceil(w/40)),dy=Math.max(1,Math.ceil(h/40));
    const phase=navalSweep++%16;
    const ox=Math.floor((phase%4)*dx/4),oy=Math.floor(Math.floor(phase/4)*dy/4);
    const own=number(()=>me.state?.spawnTile,NaN);
    const result=[];
    for(let y=Math.floor(dy/2)+oy;y<h;y+=dy){
      for(let x=Math.floor(dx/2)+ox;x<w;x+=dx){
        try{
          const tile=game.ref(x,y);
          if(!game.isLand(tile)||game.isImpassable?.(tile)||
            !game.isShore(tile)||game.hasFallout?.(tile))continue;
          const owner=game.owner(tile);
          if(owner?.isPlayer?.()||safeID(owner)!==null)continue;
          const distance=Number.isInteger(own)?
            Math.hypot(x-game.x(own),y-game.y(own)):0;
          const neighbors=[];
          let nearbyNeutral=0,nearbyHostile=0;
          try{
            const n=game.neighbors4?.(tile,neighbors)||0;
            for(let i=0;i<n;i++){
              const other=game.owner(neighbors[i]);
              if(safeID(other)===null&&game.isLand(neighbors[i]))nearbyNeutral++;
              else if(other?.isPlayer?.()&&!friendly(other,me))nearbyHostile++;
            }
          }catch(_){}
          const score=nearbyNeutral*22-nearbyHostile*34-distance*.008;
          result.push({tile,distance,score});
        }catch(_){}
      }
    }
    for(const site of result){
      site.baseScore=site.score;
      site.neuralDelta=neuralActionDelta('naval',site.score,me,troopSnapshot,{
        opportunity:clamp(site.score/150,0,1),
        cost:clamp(site.distance/Math.max(1,game.width()+game.height()),0,1),
        risk:clamp((site.score<0?-site.score:0)/150,0,1)
      });
      site.score+=site.neuralDelta;
    }
    result.sort((a,b)=>b.score-a.score||a.distance-b.distance);
    return result.slice(0,limit).map(x=>x.tile);
  }
  function navalCommitmentRatio(me,enemy,tick){
    const trend=opponentTrend(enemy,tick),window=adversaryWindow(me,enemy);
    // Never ease naval thresholds based on a momentary third-party attack.
    const baseline=trend.valid&&trend.sustained&&trend.falling&&window.exposed?1.35:1.9;
    return baseline*(1-neuralChannel('navalThreshold',me)*.16);
  }
  function navalHomeRisk(me,tick){
    const samples=troopSamples.filter(s=>tick-s.tick<=300);
    const land=number(()=>me.numTilesOwned(),0);
    const peak=Math.max(land,...samples.map(s=>s.tiles));
    const assets=new Set(ownStructures(me)
      .filter(u=>['City','Factory','Port','Missile Silo'].includes(u.type?.()))
      .map(u=>u.id?.()??u.type()+':'+u.tile?.()));
    const lostAssets=samples.some(s=>(s.assets||[]).some(id=>!assets.has(id)));
    // Inspect visible missiles afresh, including changes during worker awaits.
    const nukes=(game.units?.()||[]).some(u=>u.isActive?.()&&
      ['Atom Bomb','Hydrogen Bomb','MIRV','MIRV Warhead'].includes(u.type?.())&&
      !friendly(u.owner?.(),me)&&Number.isInteger(u.targetTile?.())&&
      (ownedTile(u.targetTile(),me)||ownStructures(me).some(a=>
        Math.hypot(game.x(a.tile())-game.x(u.targetTile()),
          game.y(a.tile())-game.y(u.targetTile()))<115)));
    return nukes?'incoming-nuke':lostAssets?'recent-asset-loss':
      peak-land>=Math.max(200,peak*.05)?'recent-territory-loss':null;
  }
  // Recent unconfirmed arrivals are local observations, not permanent proof
  // that every future sea route requires an escort. Historical counters stay
  // cumulative for diagnostics; only these bounded records affect planning.
  function recentLandingRisk(tick,source,dest){
    const observations=[...landingFailures.values()].filter(v=>
      Number.isInteger(v.tile)&&Number.isInteger(v.tick)&&
      tick>=v.tick&&tick-v.tick<=900);
    const near=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&
      Math.hypot(game.x(a)-game.x(b),game.y(a)-game.y(b))<115;
    return observations.some(v=>near(v.tile,source)||near(v.tile,dest));
  }
  // Bounded water-only route probe; destination itself is land.
  // TransportShipExecution at official pinned bb8af015 has ticksPerMove=1.
  // A movement step costs one engine tick; actual WaterPathFinder may follow
  // a different or delayed path, so this cannot promise arrival at one tick.
  function navalRouteEstimate(source,dest,maxVisited=1800){
    if(!Number.isInteger(source)||!Number.isInteger(dest)||
      !game?.isWater?.(source))return null;
    const adjacent=[];
    try{const n=game.neighbors4(dest,adjacent);
      if(!Number.isInteger(n)||n<1)return null;
      const targets=new Set(adjacent.slice(0,n).filter(t=>game.isWater(t)));
      if(!targets.size)return null;
      const queue=[source],previous=new Map([[source,null]]);
      for(let head=0;head<queue.length&&head<maxVisited;head++){
        const tile=queue[head];
        if(targets.has(tile)){
          const path=[];let cursor=tile;
          while(cursor!==null){path.push(cursor);cursor=previous.get(cursor);}
          path.reverse();
          const waterSteps=path.length-1;
          return {waterSteps,etaTicksEstimate:waterSteps+1,
            ticksPerMove:1,etaExact:false,
            etaMethod:'official-transport-one-tick-per-move-bfs-route-approximation',path};
        }
        const next=[];const n=game.neighbors4(tile,next);
        for(const neighbor of next.slice(0,n))if(!previous.has(neighbor)&&
          game.isWater(neighbor)){
          previous.set(neighbor,tile);queue.push(neighbor);
        }
      }
    }catch(_){}
    return null;
  }
  function navalRouteAssessment(me,source,dest,tick=number(()=>game.ticks(),0)){
    if(!Number.isInteger(source)||!Number.isInteger(dest))return {
      risk:'unknown-departure',distance:null,etaTicks:null,threats:0,
      escorts:0,uncertaintyUntil:null,method:'visible-time-screen'};
    const distance=(a,b)=>Math.hypot(game.x(a)-game.x(b),game.y(a)-game.y(b));
    const routeDistance=distance(source,dest);
    // This is deliberately a conservative ETA estimate, not pathfinding. The
    // engine remains authoritative about the real water route and destination.
    const estimatedSpeed=Math.max(.5,number(()=>game.config().boatSpeed?.('Transport'),2));
    const estimate=navalRouteEstimate(source,dest);
    const etaTicks=estimate?.etaTicksEstimate??
      Math.max(1,Math.ceil(routeDistance/estimatedSpeed));
    const ships=(game.units?.()||[]).filter(u=>u.isActive?.()&&
      !u.isUnderConstruction?.()&&u.type?.()==='Warship'&&Number.isInteger(u.tile?.()));
    const escorts=ships.filter(u=>safeID(u.owner?.())===safeID(me));
    // Prefer real connected water tiles when the bounded search resolves a
    // path; unknown routes retain the old conservative straight-line proxy.
    const route=estimate?.path;
    const ax=game.x(source),ay=game.y(source),dx=game.x(dest)-ax,dy=game.y(dest)-ay;
    const length2=dx*dx+dy*dy;
    const nearRoute=u=>{
      const x=game.x(u.tile()),y=game.y(u.tile());
      if(route)return route.some(tile=>Math.hypot(x-game.x(tile),
        y-game.y(tile))<70);
      const t=length2?clamp(((x-ax)*dx+(y-ay)*dy)/length2,0,1):0;
      return Math.hypot(x-ax-t*dx,y-ay-t*dy)<70;
    };
    const threats=ships.filter(u=>safeID(u.owner?.())!==safeID(me)&&
      !friendly(u.owner?.(),me)&&nearRoute(u));
    const localEscorts=escorts.filter(u=>nearRoute(u)||
      distance(u.tile(),source)<100||distance(u.tile(),dest)<100);
    const exposed=threats.filter(u=>!localEscorts.some(e=>
      distance(e.tile(),u.tile())<90));
    // Failed transports create uncertainty only around the observed route and
    // only while the evidence is recent. They never globally poison the navy.
    const uncertain=[...landingFailures.values()].filter(v=>
      Number.isInteger(v.tile)&&Number.isInteger(v.tick)&&tick>=v.tick&&tick-v.tick<=900&&
      (distance(v.tile,source)<150||distance(v.tile,dest)<150));
    const uncertaintyUntil=uncertain.length?Math.max(...uncertain.map(v=>v.tick+900)):null;
    const arrivalThreat=exposed.some(u=>distance(u.tile(),dest)<=
      Math.max(70,Math.min(220,etaTicks*estimatedSpeed*.8)));
    const risk=exposed.length?(arrivalThreat?'visible-warship-at-arrival':'unescorted-visible-warship'):
      uncertain.length&&!localEscorts.length?
        'no-local-escort-after-unresolved-landing':null;
    return {risk,distance:Math.round(routeDistance),etaTicks,
      threats:threats.length,unescortedThreats:exposed.length,
      escorts:localEscorts.length,uncertaintyUntil,
      method:estimate?.etaMethod||
        'straight-corridor-time-screen; engine path remains authoritative'};
  }
  function navalRouteRisk(me,source,dest,tick){
    return navalRouteAssessment(me,source,dest,tick).risk;
  }
  // A remote landing can empty the homeland even when no opposing land
  // border is currently visible. Account for other *visible live nations*,
  // excluding the selected victim and actual allies. This is not an estimate
  // of fog-of-war or a guarantee of a future attack.
  function globalNavalHomeGuard(me,target,s,requested,groups=strategic.groups){
    const major=requested>=Math.max(1000,Math.min(200000,s.home*.20));
    const targetID=safeID(target);
    const landContact=groups.some(g=>g.id===targetID&&(g.tiles||[]).length>0);
    // Keep existing Impossible policy stable until this stricter global
    // reserve wins on paired seeds; the optional AI Test can evaluate it.
    if(!major||landContact||(hardMode()&&!opts.impossibleExperiment))
      return {amount:requested,remote:!landContact,
        other:0,reason:hardMode()&&!opts.impossibleExperiment?
          'impossible-experiment-off':'small-or-land-connected'};
    const ownSpawn=me.state?.spawnTile,diag=Math.hypot(game.width(),game.height());
    const visible=(game.playerViews?.()||[]).filter(p=>{
      if(!p?.isAlive?.()||safeID(p)===safeID(me)||safeID(p)===targetID||friendly(p,me))return false;
      const id=safeID(p),contact=(groups||[]).some(g=>g.id===id&&g.tiles?.length);
      const active=(p.outgoingAttacks?.()||[]).some(a=>!a.retreating&&
        attackTargetID(a.targetID)===safeID(me));
      const spawn=p.state?.spawnTile,near=Number.isInteger(ownSpawn)&&Number.isInteger(spawn)&&
        Math.hypot(game.x(ownSpawn)-game.x(spawn),game.y(ownSpawn)-game.y(spawn))<=diag*.55;
      const naval=(game.units?.()||[]).some(u=>u.isActive?.()&&
        safeID(u.owner?.())===id&&['Transport','Warship'].includes(u.type?.())&&
        Number.isInteger(u.targetTile?.())&&ownedTile(u.targetTile(),me));
      return contact||active||near||naval;
    });
    const other=visible.reduce((best,p)=>Math.max(best,
      Math.max(0,number(()=>p.troops?.(),0))),0);
    if(other<=0)return {amount:requested,remote:true,other:0,
      reason:'no-other-visible-nations'};
    const floor=Math.max(s.reserve,s.incoming*1.7,
      Math.min(s.home*.92,other*(hardMode()?.80:.72)));
    const possible=Math.max(0,Math.floor(s.home-floor));
    const amount=Math.min(requested,possible);
    return {amount,remote:true,other,floor,requested,
      reason:amount<requested?'visible-nation-home-reserve':'protected'};
  }
  function landingThirdPartyRisk(me,dest,target,amount){
    try{
      const neighbors=[],count=game.neighbors4(dest,neighbors);
      for(let i=0;i<count;i++){
        const owner=game.owner(neighbors[i]);
        if(!owner?.isPlayer?.()||safeID(owner)===safeID(target)||
          safeID(owner)===safeID(me)||friendly(owner,me))continue;
        if(number(()=>owner.troops(),Infinity)>amount*.85)return true;
      }
    }catch(_){return true;}
    return false;
  }
  async function naval(me,tick,serial) {
    if(!opts.boats||!ctors.boat||tick-lastBoat<100||tick<navalBackoffUntil||pendingAttack||pendingBoat)return false;
    lastBoat=tick;
    const homeRisk=navalHomeRisk(me,tick);
    if(homeRisk){
      decisionNote('marine-pause','Neue Landungen pausiert: '+homeRisk,
        ['Heimat stabilisieren, dann neu bewerten'],tick);
      return false;
    }
    // Use the SAME complete threat snapshot as ground combat. Using military(me)
    // without front groups underestimates the reserve near stronger neighbors.
    for(const [tile,until] of navalSiteNegative)if(tick>=until)navalSiteNegative.delete(tile);
    const navyState=military(me,strategic.groups),spare=navyState.available;
    // Historical transport failures are observations, not proof of why a
    // ship vanished. Pause repeated attempts, then demand a local escort.
    const recentFailures=[...landingFailures.values()].filter(v=>tick-v.tick<1200);
    if(recentFailures.length>=3 &&
      !(game.units?.()||[]).some(u=>u.type?.()==='Warship'&&u.isActive?.()&&
        safeID(u.owner?.())===safeID(me))){
      decisionNote('marine-pause','Wiederholte Landungen ohne Zielbestätigung',
        ['Kriegsschiff bauen und Route erneut prüfen'],tick);
      return false;
    }
    // A cumulative unresolved counter must never veto all future beaches.
    // Repeated recent losses still impose the bounded cooldown above;
    // navalRouteRisk evaluates an escort near each prospective route.
    if(spare<1300 || navyState.incoming>0 || navyState.activeEnemy>0 ||
      recentHostilePressure(tick,260))return false;
    const foes=game.playerViews().filter(p=>safeID(p)!==safeID(me)&&p.isAlive?.()&&
      !friendly(p,me)&&Number.isInteger(p.state?.spawnTile)&&
      // The naval planner must obey the single-front war director as well.
      (!coordinatedWar() || !isWar() || safeID(p)===warState.id));
    foes.sort((a,b)=>{
      const baseA=-Math.min(150,number(()=>a.troops())/Math.max(1,navyState.home)*40);
      const baseB=-Math.min(150,number(()=>b.troops())/Math.max(1,navyState.home)*40);
      return (baseB+neuralActionDelta('naval',baseB,me,navyState,{
          magnitude:clamp(number(()=>b.troops())/Math.max(1,navyState.home)/3,0,1),
          opportunity:clamp(number(()=>b.numTilesOwned())/20000,0,1),
          risk:clamp(number(()=>b.troops())/Math.max(1,navyState.home)/3,0,1)
        }))-
        (baseA+neuralActionDelta('naval',baseA,me,navyState,{
          magnitude:clamp(number(()=>a.troops())/Math.max(1,navyState.home)/3,0,1),
          opportunity:clamp(number(()=>a.numTilesOwned())/20000,0,1),
          risk:clamp(number(()=>a.troops())/Math.max(1,navyState.home)/3,0,1)
        }));
    });
    for(const foe of foes.slice(0,6)){
      if(navyState.strongest>=navyState.home*.85)break;
      if((navalCooldown.get('player:'+safeID(foe))||0)>tick)continue;
      const failures=landingFailures.get('player:'+safeID(foe));
      if(failures?.count>=2&&tick-failures.tick<1800)
        decisionNote('marine-pause','Landungsziel '+nameOf(foe)+
          ': '+failures.count+' unbestätigte Ankünfte',
          ['Andere Küste oder lokale Eskorte erforderlich'],tick);
      const navyRatio=navalCommitmentRatio(me,foe,tick);
      if(spare<number(()=>foe.troops(),Infinity)*navyRatio ||
        number(()=>me.troops())<number(()=>game.config().maxTroops(me),1)*.47)continue;
      let points=[];
      // Prefer the opponent's actual coastal border. An inland spawn is legal
      // as a query, but the engine silently redirects it to another shore and
      // makes both confirmation and strategic targeting unnecessarily vague.
      try{
        const border=await foe.borderTiles?.();
        if(!live(serial))return false;
        const coast=[...(border?.borderTiles||[])].filter(t=>
          game.isLand(t)&&game.isShore?.(t)&&safeID(game.owner(t))===safeID(foe));
        const stride=Math.max(1,Math.floor(coast.length/8));
        for(let i=navalSweep%stride;i<coast.length&&points.length<8;i+=stride)
          points.push(coast[i]);
      }catch(_){}
      if(!points.length)points=[foe.state.spawnTile];
      // Units remain a fallback for clients without borderTiles support.
      for(const u of foe.units?.()||[]){
        const t=u.tile?.();
        if(Number.isInteger(t)&&!points.includes(t)&&points.length<7)points.push(t);
      }
      for(const dest of points){
        if((navalSiteNegative.get(dest)||0)>tick)continue;
        if(!game.isLand(dest)||safeID(game.owner(dest))!==safeID(foe))continue;
        let legal;
        try {legal=await me.actions(dest,['Transport']);}catch(_){continue;}
        if(!live(serial))return false;
        // Alliance, ownership and available troops can all change while the
        // worker is checking a destination. Revalidate the *current* foe.
        const current=game.playerViews?.().find(p=>safeID(p)===safeID(foe));
        if(!current?.isAlive?.() || friendly(current,me) ||
          safeID(game.owner(dest))!==safeID(current) ||
          (coordinatedWar() && isWar() && safeID(current)!==warState.id)){
          telemetry('naval_allied_skip','Landung nach Allianz-/Front-/Eigentümerwechsel verhindert',
            {target:safeID(foe),dest});
          continue;
        }
        const fresh=military(me,strategic.groups);
        if(fresh.incoming>0 || fresh.activeEnemy>0 ||
          fresh.available<number(()=>current.troops(),Infinity)*
           navalCommitmentRatio(me,current,tick) ||
          fresh.ratio<.47)continue;
        const ship=legal?.buildableUnits?.find(x=>x.type==='Transport'&&Number.isInteger(x.canBuild));
        if(!ship || (goldAmount(me)<Number(ship.cost)&&!game.config().infiniteGold?.()))continue;
        const route=navalRouteAssessment(me,ship.canBuild,dest,tick),routeRisk=route.risk;
        if(route.etaTicks!==null)telemetry('marine_eta_proxy',
          'Wasserroute als Näherung berechnet',{target:safeID(current),dest,
            etaTicksEstimate:route.etaTicks,etaExact:false,etaMethod:route.method});
        if(routeRisk||navalHomeRisk(me,number(()=>game.ticks(),tick))){
          decisionNote('marine-pause','Landung nach Sicherheitsprüfung zurückgestellt',
            [routeRisk||'Heimatlage hat sich verändert'],tick);
          continue;
        }
        const history=opponentHistory.get(safeID(current)),previous=history?.previous,
          interval=previous?Math.max(1,history.tick-previous.tick):null,
          growthPerTick=interval?Math.max(0,(history.troops-previous.troops)/interval):0,
          currentEnemy=number(()=>current.troops(),Infinity),
          arrivalEnemy=Math.min(currentEnemy*1.5,currentEnemy+growthPerTick*route.etaTicks);
        const committedWar=isWar()&&warState.id===safeID(current);
        const exposedNavy=opponentTrend(current,tick).sustained&&
          opponentTrend(current,tick).falling&&adversaryWindow(me,current).exposed;
        let amount=Math.floor(Math.min(fresh.available*(committedWar ? .60 : exposedNavy?.66:.36),
          fresh.home*(committedWar ? .58 : exposedNavy?.55:.30)));
        const protectedLanding=offensiveCommitment(strategic.groups,fresh,
          {id:safeID(current),opponent:current},amount);
        amount=protectedLanding.amount;
        const globalGuard=globalNavalHomeGuard(me,current,fresh,amount);
        if(globalGuard.amount<amount){
          telemetry('naval_global_guard','Seeoffensive: Heimatarmee gegen sichtbare Nationen geschützt',
            {target:safeID(current),requested:amount,allowed:globalGuard.amount,
              other:globalGuard.other,floor:globalGuard.floor,
              reason:globalGuard.reason});
          if(globalGuard.amount<number(()=>current.troops(),Infinity)*
            (hardMode()?1.05:.85)){
            navalCooldown.set('player:'+safeID(current),tick+100);
            continue;
          }
        }
        amount=globalGuard.amount;
        // Having a large spare army is not sufficient: the ACTUAL landing
        // contingent must plausibly beat the enemy's fresh home force.
        if(amount<1000||amount<arrivalEnemy*
          (hardMode()?1.05:.85) || fresh.home-amount<fresh.reserve ||
          landingThirdPartyRisk(me,dest,current,amount))continue;
        if(sendMarineTransport(me,dest,amount,
          tick,'LANDUNG → '+nameOf(current),'player:'+safeID(current),route)){
          telemetry('naval_commitment','Landung gegen geschätzte Zielstärke bei Ankunft',
            {target:safeID(current),amount,currentEnemy,arrivalEnemy,route});
          if(exposedNavy)telemetry('naval_window','Anhaltende Drittfront bestätigt',
            {target:safeID(current),amount,trend:opponentTrend(current,tick)});
          return true;
        }
      }
    }
    // No separate war: transport a safe neutral-expansion force to verified
    // unowned coasts only after easy land borders are exhausted. Never use
    // this branch to bypass the single-front director or homeland reserve.
    if(!isWar() && !strategic.groups.some(g=>g.id===null&&!g.fallout) &&
      navyState.activeNeutral===0 && navyState.ratio>=.52 &&
      navyState.strongest<navyState.home*1.20 &&
      spare>=Math.max(1400,navyState.home*.06)){
      for(const dest of neutralNavalCandidates(me)){
        if(!live(serial))return false;
        if((navalSiteNegative.get(dest)||0)>tick)continue;
        let legal;
        try{legal=await me.actions(dest,['Transport']);}catch(_){continue;}
        if(!live(serial))return false;
        const ship=legal?.buildableUnits?.find(x=>
          x.type==='Transport'&&Number.isInteger(x.canBuild));
        if(!ship||!game.isLand(dest)||game.hasFallout?.(dest)||
          game.owner(dest)?.isPlayer?.()||
          safeID(game.owner(dest))!==null){
          if(navalSiteNegative.size>300)navalSiteNegative.clear();
          navalSiteNegative.set(dest,tick+240);
          continue;
        }
        if(!game.config().infiniteGold?.() &&
          goldAmount(me)<Number(ship.cost))continue;
        const route=navalRouteAssessment(me,ship.canBuild,dest,tick);
        if(navalHomeRisk(me,number(()=>game.ticks(),tick))||route.risk)continue;
        const area=neutralIslandEstimate(dest);
        if(area!==null&&area<24){
          navalSiteNegative.set(dest,tick+480);
          continue;
        }
        // Small islands need scouting-size contingents, not six-figure stacks.
        const areaBudget=area===null?navyState.home*.10:
          Math.max(1300,area*35);
        const amount=Math.floor(Math.min(spare*.22,navyState.home*.075,areaBudget));
        // A new neutral beachhead may be worth taking beside a near-peer,
        // but the actual landing must leave a viable army at the home border.
        if(amount<1000 || navyState.home-amount<
          Math.max(navyState.reserve,navyState.strongest*.78))continue;
        if(sendMarineTransport(me,dest,amount,tick,
          'INSEL-EXPANSION → neutrales Küstenland','neutral:'+dest,route)){
          strategicTelemetry.neutralLandings++;
          fleetStatus='Neutrale Insellandung angefordert · Bestätigung ausstehend';
          return true;
        }
      }
    }
    return false;
  }
  // P1 diagnostic observation: a frozen, cycle-specific snapshot of raw state.
  // It never grants additional attack/build permissions.
  function decisionFrame(me,groups,s,tick=number(()=>game?.ticks?.(),-1),requestedTick=tick){
    // The worker border is from requestedTick; resources/armies are read at tick.
    // Preserve both timestamps so delayed worker data is never labelled fresh.
    const opponents=(groups||[]).filter(g=>g.id!==null&&
      g.opponent?.isAlive?.()).slice(0,16).map(g=>Object.freeze({
        id:g.id,front:g.tiles?.length||0,
        troops:number(()=>g.opponent.troops(),0),
        land:number(()=>g.opponent.numTilesOwned(),0),
        friendly:friendly(g.opponent,me),
        history:opponentWindows(g.opponent,tick)
      }));
    return Object.freeze({
      tick,requestedTick,borderAgeTicks:Math.max(0,tick-requestedTick),
      player:safeID(me),gameID:String(game?.gameID?.()??'unknown'),
      home:s.home,reserve:s.reserve,available:s.available,
      committed:s.committed,incoming:s.incoming,
      maxTroops:s.max,gold:goldAmount(me),
      land:number(()=>me.numTilesOwned(),0),
      duoPartner:duoTrustedPeer()?.id||null,
      opponents:Object.freeze(opponents)
    });
  }
  function decisionFrameFresh(frame,tick=number(()=>game?.ticks?.(),-1)){
    return !!frame&&Number.isInteger(tick)&&
      tick>=frame.tick&&tick-frame.tick<=20&&
      frame.player===safeID(myPlayer());
  }
  // §7/§9/§13: schema-7 actionable-branch extraction + Approach-A ranking.
  // It sits AFTER hard safety (strategicDirector + the planners already
  // validated every candidate) and BEFORE send(): it ranks the concrete
  // branches the rule basis would emit and, when actionControlEnabled, the
  // argmax branch steers the existing emitters. Hard legality stays
  // authoritative downstream — the model can only reorder or pick among
  // already-legal branches, never make an illegal action legal.
  //
  // The state object mirrors the 16 runtime-reliable fields documented in
  // trainer/v7-features.cjs so the on-policy dataset builder can replay the
  // exact inference features from the captured planning frame.
  function branchState(s,me,groups,tick){
    const home=Math.max(1,s.home);
    const land=number(()=>me?.numTilesOwned?.(),0)||0;
    const maxLand=number(()=>me?.maxLand?.(),null);
    const observedIncome=Math.max(0,
      (incomeStatus.train||0)+(incomeStatus.trade||0));
    const enemyGroups=(groups||[]).filter(g=>g.id!==null&&g.opponent);
    const samples=(typeof troopSamples!=='undefined'?troopSamples:[])
      .filter(x=>tick-x.tick<=110);
    let troopTrend=0;
    if(samples.length>1){
      const first=samples[0];
      const base=first?.home||first?.troops||0;
      if(base>0)troopTrend=Math.max(-1,Math.min(1,(home-base)/base));
    }
    return {
      gamePhase:Math.min(20,Math.max(0,tick/200)),
      home,troops:s.home,reserve:s.reserve||0,gold:goldAmount(me),
      income:Math.max(0,Math.min(2,observedIncome/100000)),
      enemyPressure:Math.max(0,Math.min(1,(s.strongest||0)/home)),
      activeWars:enemyGroups.length,frontCount:(groups||[]).length||0,
      allyPressure:0,
      homeThreat:Math.max(0,Math.min(1,(s.incoming||0)/home)),
      nukeThreat:0,recentLandTrend:0,recentTroopTrend:troopTrend,
      maxLand:Number.isFinite(maxLand)&&maxLand>0?maxLand:Math.max(1,land),
      land};
  }
  const b01=x=>Math.max(0,Math.min(1,Number.isFinite(x)?x:0));
  // Map one rule-sorted candidate to its actionable-branch contract (§6).
  // The 16 contract subclasses collapse to the 9 model kinds; the finer
  // distinction (neutral vs enemy target, finisher, build type) rides on
  // subtype/flags/targetId, not the one-hot.
  function candidateToBranch(cand,home){
    const kindMap={hold:'wait',invest:'build_economy',expand:'expand',
      attack:'attack',naval:'boat',support:'donate'};
    const kind=kindMap[cand.kind]||'wait';
    const isLand=cand.kind==='attack'||cand.kind==='expand';
    const cost=Math.max(0,Number(cand.cost)||0);
    const v5=cand.v5||{};
    const finisher=cand.kind==='attack'&&cand.forecast&&
      Number.isFinite(cand.forecast.loss)&&cost>0&&
      cand.forecast.loss/cost<0.35;
    return {
      id:String(cand.id),kind,
      subtype:cand.kind==='attack'?(finisher?'finisher':'enemy'):
        cand.kind==='expand'?'neutral':cand.kind==='naval'?'boat':
        cand.kind==='support'?'donate':
        cand.kind==='invest'?'build':'strategic',
      targetId:cand.target??null,tile:null,
      legal:true,safetyApproved:true,
      executableNow:isLand?cost>0:true,
      ruleUtility:Number(cand.utility)||0,
      cost:isLand?cost:0,troopCommitment:isLand?cost:0,
      reserveAfter:Math.max(0,home-(isLand?cost:0)),
      targetStrength:b01(v5.siteRisk),
      targetLand:b01((v5.expectedLand||0)/Math.max(1,home)),
      expectedBuildValue:kind==='build_economy'?b01(v5.incomeValue):0,
      expectedDefenseValue:kind==='wait'?b01(1-(Number(cand.risk)||0)):0,
      cooldownReady:true,alreadyActiveOperation:false,
      targetReachable:isLand,isEmergency:false,
      isFinisher:finisher,isExpansion:cand.kind==='expand',
      sourceId:String(cand.id),channel:cand.channel||null};
  }
  // Build the branch decision for one combat frame. Returns:
  //   basis: 'no-model' (identical to rule basis, funnel noModelFrames)
  //          | 'rule' (model scored but control off / fail-closed)
  //          | 'model' (argmax drives steering when controlActive)
  //   ruleTop: the branch of the rule-selected candidate (candidates[0])
  //   modelTop: argmax branchScore over actionable branches (null if none)
  //   controlActive: model present + actionRank + actionControl enabled
  function chooseActionBranch(planning,s,me,groups,tick){
    const home=Math.max(1,s.home);
    const cands=(planning?.candidates||[]).filter(c=>c&&c.kind);
    if(!cands.length)return {basis:'no-model',tick,ruleTop:null,modelTop:null,
      branches:[],actionableCount:0,scores:null,controlActive:false,state:null};
    const branches=cands.map(c=>candidateToBranch(c,home));
    const actionable=branches.filter(b=>b.legal&&b.safetyApproved&&b.executableNow);
    const ruleTop=branches.find(b=>b.id===String(cands[0].id))||branches[0];
    const rankEnabled=!!(opts.actionRankEnabled&&shadowV7Model) && actionable.every(b=>['wait','expand','attack'].includes(b.kind));
    const controlActive=!!(rankEnabled&&opts.actionControlEnabled);
    if(!rankEnabled)return {basis:'no-model',tick,ruleTop,modelTop:null,
      branches,actionableCount:actionable.length,scores:null,
      controlActive:false,state:branchState(s,me,groups,tick)};
    const state=branchState(s,me,groups,tick);
    const ruleTop1=Number(cands[0].utility)||0;
    let scores={};
    try{
      for(const b of branches){
        const feat=shadowV7.features(state,b,
          {ownRu:b.ruleUtility,ruleTop1});
        scores[b.id]=shadowV7.predict(shadowV7Model,feat).branchScore;
      }
    }catch(e){
      branchFunnel.rankErrors++;
      return {basis:'rule',tick,ruleTop,modelTop:ruleTop,branches,
        actionableCount:actionable.length,scores:null,controlActive,
        state,error:String(e?.message||e)};
    }
    let modelTop=null,best=-Infinity;
    for(const b of actionable){
      const sc=scores[b.id];
      if(sc>best){best=sc;modelTop=b;}
    }
    if(!modelTop)modelTop=ruleTop;
    return {basis:'model',tick,ruleTop,modelTop,branches,
      actionableCount:actionable.length,scores,controlActive,state};
  }
  // Steer emission for a model-driven branch. Returns {order,ranked,wait}:
  //   wait:  true when the model chose WAIT → the caller idles this decision
  //   order: the re-ordered channel list (model channel first)
  //   ranked: the re-ordered target list (model target first for land)
  // The existing attack()/naval() emitters still run their full hard-safety
  // checks; this only reorders what they consider, so legality is preserved.
  function steerForBranch(branch,order,ranked){
    if(!branch)return {order,ranked,wait:false};
    const channel=branch.channel||
      (branch.kind==='boat'||branch.kind==='warship'||
        branch.kind==='build_warship'||branch.kind==='nuclear'
        ?'naval':branch.kind==='wait'||branch.kind==='build_economy'
        ?'hold':'land');
    if(branch.kind==='wait')return {order,ranked,wait:true};
    const rest=order.filter(ch=>ch!==channel);
    const next=[...new Set([channel,...rest])];
    if(channel==='land'&&branch.targetId!==null&&Array.isArray(ranked)){
      const idx=ranked.findIndex(r=>r.id===branch.targetId);
      if(idx>0)return {order:next,
        ranked:[ranked[idx],...ranked.filter((_,i)=>i!==idx)],wait:false};
    }
    return {order:next,ranked,wait:false};
  }
  async function step() {
    const found=discover();
    if(!found){if(game){generation++;game=null;bus=null;opts.enabled=false;persist();status='Warte auf Spiel';}paint();return;}
    if(found.g!==game)reset(found.g,found.b);
    else if(found.b && found.b!==bus){
      // Rebinding listeners on the SAME match is not a new match.
      // reset() deliberately disables the bot, so never call it here.
      bus=found.b;ctors=recognize(bus);lastIntentProbe=-Infinity;
      bindWinnerCapture(bus,ctors);
      reportIntents();
      if(opts.enabled && game.inSpawnPhase?.())
        telemetry('spawn_bus_rebind','Spawnphase: EventBus gewechselt, Bot bleibt aktiv',
          {intents:intentHealth()});
    }
    if(!permittedMatch(game)){
      if(opts.enabled){opts.enabled=false;generation++;persist();}
      status=game?.config?.().isReplay?.()?'Replay: BOT GESPERRT':
        'Unbekannter Spieltyp: BOT GESPERRT';
      paint();return;
    }
    diagnosticDonationUpdates();
    if(game?.gameOver?.()){
      if(opts.enabled||gameEnd?.teamOutcomePending){
        diagnosticCloseHelp('match-end',number(()=>game.ticks(),-1));
        gameEnd=gameOutcome(game,myPlayer());
        learnFinish(gameEnd.outcome);
        telemetry('game_over','Partie beendet · Bot automatisch gestoppt',{gameEnd});
        void exportDiagnosticPackage(true);
        if(opts.enabled){opts.enabled=false;generation++;persist();}
      }
      status='Partie beendet · Bot AUS';paint();return;
    }
    // A player can be eliminated before the whole FFA/Team match ends.
    // Do not treat an already spawned dead player as awaiting spawn.
    const eliminated=myPlayer();
    if(eliminated?.hasSpawned?.()&&eliminated.isAlive?.()===false){
      if(!gameEnd){
        diagnosticCloseHelp('player-elimination',
          number(()=>game.ticks(),-1));
        const team=game?.config?.().gameConfig?.().gameMode==='Team';
        gameEnd={outcome:team?'unknown':'defeat',source:'player-elimination',
          tick:number(()=>game.ticks(),-1),land:0,personalEliminated:true,
          teamOutcomePending:team};
        if(!team)learnFinish('defeat');
        telemetry('game_over',team?'Eigener Spieler eliminiert · Teamergebnis offen':
          'Eigener Spieler eliminiert · Niederlage',{gameEnd});
        void exportDiagnosticPackage(true);
      }
      if(opts.enabled){opts.enabled=false;generation++;persist();}
      status='Spieler eliminiert · Bot AUS';paint();return;
    }
    if(!bus&&found.b){bus=found.b;ctors=recognize(bus);bindWinnerCapture(bus,ctors);reportIntents();}
    // EventBus listeners may register after initial discovery. Retry at a
    // bounded interval while a core intent is missing; never emit probe events.
    if(bus && (intentHealth().critical.length ||
      (opts.enabled&&opts.diplomacy&&opts.offerAlliances&&!ctors.alliance)||
      (opts.enabled&&opts.autoSpawn&&game.inSpawnPhase?.()&&!ctors.spawn))){
      const probeTick=number(()=>game.ticks(),-1);
      const interval=game.inSpawnPhase?.()?6:
        opts.enabled&&opts.diplomacy&&opts.offerAlliances&&!ctors.alliance?80:120;
      if(probeTick>=0 && probeTick-lastIntentProbe>=interval){
        lastIntentProbe=probeTick;ctors=recognize(bus);bindWinnerCapture(bus,ctors);reportIntents();
      }
    }
    if(conflicts()){opts.enabled=false;status='Andere AggroBot-Version aktiv – alte Skripte deaktivieren';paint();return;}
    if(advisorConflict()){opts.enabled=false;status='Spawn Advisor: Auto-Spawn/Smart Attack/Auto-Accept ausschalten';paint();return;}
    maybeAutoStart();
    if(opts.enabled&&game.inSpawnPhase?.()&&opts.autoSpawn){
      if(!bus?.emit)spawnBlock('EventBus noch nicht verfügbar');
      else if(!ctors.spawn)spawnBlock('Spawn-Intent nicht erkannt');
    }
    if(!opts.enabled||busy||!connected()){paint();return;}
    // Keep observing confirmations and refreshing strategy even when the
    // combat-specific action budget is exhausted. send() enforces the cap.
    const tick=number(()=>game.ticks(),-1);
    if(tick<0||tick===lastTick){paint();return;}
    lastTick=tick;busy=true;const serial=generation,t0=performance.now();
    try {
      const spawnMe=myPlayer();
      if(spawnState.lastSent && spawnMe?.hasSpawned?.() &&
        spawnState.phase!=='Bestätigt'){
        spawnState.phase='Bestätigt';
        const actual=spawnMe.state?.spawnTile;
        telemetry('spawn_confirmed','Spawn im Spielzustand bestätigt',
          {spawn:{...spawnState.lastSent,actualTile:Number.isInteger(actual)?actual:null,
            moved:Number.isInteger(actual)&&actual!==spawnState.lastSent.tile}});
      }
      if(game.inSpawnPhase?.()){
        status=game.config().isRandomSpawn?.()?'Zufallsspawn durch Spielserver':
          'Auto-Spawn · '+spawnState.phase;
        doSpawn(tick);return;
      }
      const me=myPlayer();
      if(!me?.isAlive?.()||!me.hasSpawned?.()){status='Warte auf Spawn';return;}
      learnObserve(tick,me,troopSnapshot,autoTuning.mode);
      sampleTroops(tick,me);sampleIncome(me,tick);inspectMarine(me,tick);victoryPlan(me);confirmAttack(me,tick);observeAttackOrigins(me,tick);evaluateLastBattle(tick,me);
      let immediateState=military(me,strategic.groups);
      rememberHostilePressure(immediateState,tick);
      // Tune immediately even if emergencyRetreat returns before the normal
      // strategy pass: a dangerous invasion must override ASSAULT right now.
      if(opts.fullAuto && immediateState.incoming>Math.max(1,immediateState.home)*.18)
        immediateState=tuneAutonomously(me,strategic.groups,immediateState,tick,
          {wanted:'DEFEND',rebuilding:true});
      // Save committed troops BEFORE any asynchronous worker border request.
      if(emergencyRetreat(me,tick,immediateState))return;
      const tiles=await borders(me,tick);
      if(!live(serial))return;
      // Refuse a slow worker result from an older decision window.
      const observedTick=number(()=>game?.ticks?.(),-1);
      if(observedTick<tick||observedTick-tick>20||
        safeID(myPlayer())!==safeID(me)){
        telemetry('decision_snapshot_expired',
          'Worker-Ergebnis veraltet; neue Entscheidungsrunde abwarten',
          {requestedTick:tick,observedTick,player:safeID(me),
            currentPlayer:safeID(myPlayer())});
        return;
      }
      const groups=targetsFromBorder(me,tiles);
      observeFronts(me,groups,tick);
      observeOpponents(me,tick);
      observeHumanProfiles(me,tick);
      observeVictoryThreat(me,tick);
      let s=military(me,groups);rememberHostilePressure(s,tick);troopSnapshot=s;
      lastDecisionFrame=decisionFrame(me,groups,s,observedTick,tick);
      strategic.groups=groups;
      coordinateDuo(me,s,tick);
      manageWar(me,groups,s,tick);
      const context=strategy(me,groups,s);
      s=tuneAutonomously(me,groups,s,tick,context);
      troopSnapshot=s;
      coordinateDuo(me,s,tick);
      diagnosticHelpObservation(me,tick);
      planOperation(me,groups,s,tick);
      if(tick-lastDiagnosticTick>=80){lastDiagnosticTick=tick;
        telemetry('snapshot','Spielzustand',{difficulty:game.config().gameConfig().difficulty,
          gameType:game.config().gameConfig().gameType,matchContext:matchContext(me),
          decisionFrame:lastDecisionFrame,
          defenseEvidence:{
            incomingAttacks:(me.incomingAttacks?.()||[]).filter(a=>!a.retreating)
              .map(a=>({
                attackerId:attackTargetID(a.attackerID)??null,
                troops:number(()=>a.troops,null),
                ...diagnosticArrival([a])})).slice(0,40),
            incomingTotal:s.incoming,home:s.home,reserve:s.reserve,
            available:s.available,committed:s.committed,
            outgoingRecallCandidates:(me.outgoingAttacks?.()||[])
              .filter(a=>!a.retreating).map(a=>({
                stackId:a.id,targetId:attackTargetID(a.targetID),
                troops:number(()=>a.troops,null)})).slice(0,40),
            warningLevel:duoWarningLevel(s,tick),
            helpRequestId:diagnosticHelpId,
            estimatedSupportDeficit:Math.max(0,Math.ceil(s.incoming*1.3-s.home)),
            evidence:'gameview-state-not-predicted-survival'},
          investment:investmentStatus,
          cities:ownStructures(me).filter(u=>u.type?.()==='City').length,
          factories:ownStructures(me).filter(u=>u.type?.()==='Factory').length,
          borders:tiles.length,tuning:{...autoTuning,enabled:!!opts.fullAuto},defense:{status:defenseStatus,incoming:s.incoming,
            committed:s.committed,pendingRetreats:retreatRequests.size},enemies:groups.filter(g=>g.id!==null&&!me.isOnSameTeam?.(g.opponent)).map(g=>({name:nameOf(g.opponent),troops:number(()=>g.opponent.troops()),land:number(()=>g.opponent.numTilesOwned())})),
          readiness:context.readiness?.reason,ratio:s.ratio,maxTroops:s.max,growthPotential:s.growthPotential,
          victory:winStatus,victoryThreat,operation,duoPlan,
          opponentProfiles:[...opponentProfiles.values()],
          decisions:decisionTimeline.slice(-8),income:incomeStatus,
          trade:{status:tradeStatus,stats:{...tradeStats},
            botEmbargoes:[...botEmbargoes],assessments:tradeAssessments},strategicTelemetry,
          attackBlockReport,crisisTrend,neuralEvidence:{...neuralEvidence,model:neuralModelInfo()},
          neuralDecisionEvidence,coreFunding,economyProbe:lastEconomyProbeReport,
          economyBudgetEvidence,shadowDecisionEvidence,
           director:lastDirectorDecision,economyPosture:lastEconomyPosture,
          forecastAudit:lastForecastAudit,
          recentIncomeSamples:incomeAttribution.slice(-4).map(v=>({...v})),
          fleet:fleetStatus,
          economicEvidence:{
            gold:goldAmount(me),trainGold:incomeStatus.train??null,
            tradeGold:incomeStatus.trade??null,
            pending:economicPending?{actionId:economicPending.actionId??null,
              type:economicPending.type,kind:economicPending.kind,
              tile:economicPending.tile,quotedCost:economicPending.cost,
              status:'requested-not-confirmed'}:null,
            lastWorkerProbe:lastEconomyProbeReport,
            unknownActualSpend:true},
          marine:{stats:{...marineStats},pendingBoat:pendingBoat?{...pendingBoat}:null,
            pendingWarship:pendingWarship?{...pendingWarship}:null,
            ports:ownStructures(me).filter(u=>u.type?.()==='Port').length,
            warships:(game.units?.()||[]).filter(u=>u.type?.()==='Warship'&&
              safeID(u.owner?.())===safeID(me)&&u.isActive?.()).length,
            portProbeFailures},
          nuclear:{enemySilos:nuclearIntel(me).enemySilos.length,
            incomingNukes:nuclearIntel(me).incomingNukes.length,
            uncovered:nuclearIntel(me).uncovered.length,
            alliedUncovered:nuclearIntel(me).allyUncovered.length,
            ownSAM:nuclearIntel(me).sams.filter(u=>safeID(u.owner?.())===safeID(me)).length}});}

      if(plan&&tick>=plan.until)plan=null;
      status='Strategie: '+context.wanted+' · Heim '+Math.round(s.home/10)+
        ' · Reserve '+Math.round(s.reserve/10)+' · Front '+Math.round(s.committed/10);
      const ranked=rankedTargets(groups,me,tick,s,context);
      const planning=strategicCandidatePlan(me,groups,s,context,ranked,tick);
      // P0: preserve pending frames until receipt/horizon resolution.
      // resolveDecisionFrames() compacts ONLY resolved history in finally.
      decisionFrames.push(planning);
      reportAttackBlocks(me,groups,s,context,ranked,tick);
      // Do not open a new front while the homeland is under heavy assault.
      const dangerNow=defenseAssessment(me,s,tick);
      if(dangerNow.severe){planning.blockReasons=['heavy-assault-hold'];
        await fleetDefense(me,tick,serial);
        status='NOTVERTEIDIGUNG · Heimtruppen halten / Angriffe zurückrufen';return;}
      if(await defense(me,tick,serial,groups,s))return;
      if(await fleetDefense(me,tick,serial))return;
      if(teamSupport(me,tick,s))return;
      // Economy has its own scheduler and cannot block the combat planner.
      const directive=strategicDirector(me,s,context,ranked,tick,planning);
      if(!lastDirectorDecision||lastDirectorDecision.order[0]!==directive.order[0]||
        lastDirectorDecision.economy!==directive.economy){
        telemetry('director_decision',directive.reason,{order:directive.order,
          economy:directive.economy,landCandidates:directive.landCandidates,
          enemyCandidates:directive.enemyCandidates,threatened:directive.threatened,
          planning:directive.planning});
      }
      lastDirectorDecision=directive;
      if(directive.order[0]==='hold') {
        planning.blockReasons=[directive.reason||'hold'];
        decisionNote('warte',directive.reason,[
          'Nächster Schritt: Reserve regenerieren oder Frontlage ändern'],tick);
        status='AUFBAU · Truppen regenerieren / Verteidigung halten';
        return;
      }
      // §26/§28: schema-7 branch decision. The hard-safety hold gate above
      // (recovering/defending) is preserved — the model only reorders or
      // picks among already-legal branches in the channel loop below.
      // With no bundled model, chooseActionBranch returns basis 'no-model'
      // and steer is the identity, so emission is identical to the rule basis.
      const branchDecision=chooseActionBranch(planning,s,me,groups,tick);
      const steer=branchDecision.controlActive&&
        branchDecision.modelTop&&
        branchDecision.modelTop.id!==branchDecision.ruleTop.id?
        steerForBranch(branchDecision.modelTop,directive.order,ranked):
        {order:directive.order,ranked,wait:false};
      if(steer.wait){
        planning.blockReasons=['schema7-wait'];
        recordBranchDecision(branchDecision,null);
        return;
      }
      let emittedChannel=null;
      for(const channel of steer.order) {
        if(channel==='land' && await attack(me,tick,serial,steer.ranked,s)){
          emittedChannel='land';consecutiveIdle=0;
          recordBranchDecision(branchDecision,emittedChannel);
          return;
        }
        if(channel==='naval' && !context.underAttack &&
          await naval(me,tick,serial)){
          emittedChannel='naval';consecutiveIdle=0;
          recordBranchDecision(branchDecision,emittedChannel);
          return;
        }
      }
      recordBranchDecision(branchDecision,null);
      consecutiveIdle++;
      planning.blockReasons=[directive.reason||'hold','no-channel-action'];
      if(consecutiveIdle>4){status='WARTEN · '+directive.reason;
        decisionNote('warte',directive.reason,[
          ranked.length?'Ziel verworfen: Worker, Reserve oder Frontlage':'Kein sicherer Angriffskandidat',
          'Nächster Schritt: Verteidigung / Wirtschaft / Marine prüfen'],tick);
      }
    } catch(e){errors++;status='Fehler: '+String(e?.message||e).slice(0,105);
      console.warn(PREFIX,e);
      if((opts.stopOnError||opts.safeMode)&&errors>=5){
        opts.enabled=false;generation++;persist();status='Not-Aus: 5 Laufzeitfehler';
      }} finally {runtime.combatMs=Math.round(performance.now()-t0);busy=false;
      resolveDecisionFrames(tick);paint();}
  }
  async function economyStep() {
    if(economyBusy || !opts.enabled || !opts.economy || !connected())return;
    const me=myPlayer(),tick=number(()=>game.ticks(),-1);
    if(!me?.isAlive?.() || !me.hasSpawned?.() || game.inSpawnPhase?.() || tick<0)return;
    // Always poll pending construction on the fast path: the game exposes a
    // newly built unit immediately, long before its build animation completes.
    if(economicPending && pendingEconomy(tick,ownStructures(me)))return;
    if(!actionBudget() || tick-lastEconomy<35 || tick-lastEconomyProbe<18)return;
    economyBusy=true;const serial=generation,t0=performance.now();
    try {
      const tiles=await borders(me,tick);
      if(!live(serial))return;
      await economy(me,tick,serial,tiles);
    }catch(e){console.warn(PREFIX,'Economy',e);economicStatus='Fehler: '+String(e?.message||e).slice(0,55);}
    finally {runtime.economyMs=Math.round(performance.now()-t0);economyBusy=false;paint();}
  }
  function mount() {
    if(panel||!document.body)return;
    panel=document.createElement('section');panel.id='of-solo-aggrobot';
    panel.style.cssText='position:fixed;left:12px;bottom:12px;width:302px;max-width:calc(100vw - 24px);max-height:55vh;overflow:auto;z-index:2147483644;padding:10px;background:rgba(9,18,32,.96);border:1px solid #42a5d9;border-radius:10px;color:#f0f4fa;font:12px/1.4 system-ui,Arial,sans-serif;box-shadow:0 5px 25px #000a';
    panel.addEventListener('click',e=>{
      const key=e.target.closest('button[data-key]')?.dataset.key;if(!key)return;
      if(key==='export'){exportDiagnostics();return;}
      if(key==='enabled'){
        if(!connected())status=conflicts()?'Disable the older bot version':
          advisorConflict()?'Disable Spawn Advisor auto/smart/auto-accept':
          'Only available in an active single-player, public or private match with EventBus';
        else {opts.enabled=!opts.enabled;autoStartGame=game;generation++;log(opts.enabled?'BOT START':'BOT PAUSE');
          if(opts.enabled)reportIntents(true);}
      }else if(key==='autoStart'){
        opts.autoStart=!opts.autoStart;
        if(opts.autoStart&&!opts.enabled)autoStartGame=null;
      }else if(key==='fullAuto'){
        opts.fullAuto=!opts.fullAuto;
        if(opts.fullAuto){opts.autoStrategy=true;autoTuning.tick=-Infinity;}
      }else if(key==='autoStrategy'&&opts.fullAuto){opts.fullAuto=false;opts.autoStrategy=false;}
      else if(['economy','boats','autoSpawn','defense','stopOnError','upgrades','safeMode','autoStrategy','diplomacy','offerAlliances','nukes','antiNuke','lateOffense','impossibleMode','impossibleExperiment','learningEnabled','neuralEnabled','duoEnabled','evidenceMode','shadowRankEnabled'].includes(key)){
        opts[key]=!opts[key];
        if(key==='duoEnabled'){
          duoLocal.peer=null;duoLocal.lastAt=0;duoLocal.match=null;
          duoLocal.status=opts.duoEnabled?'Connecting to local relay':'AUS';
        }
      }
      else if(key==='plan'){opts.fullAuto=false;opts.autoStrategy=false;opts.plan=opts.plan==='Blitz'?'Adaptiv':opts.plan==='Adaptiv'?'Ökonomie':'Blitz';}
      else if(key==='buildStyle'){opts.fullAuto=false;opts.autoStrategy=false;opts.buildStyle=opts.buildStyle==='Ausgewogen'?'Wirtschaft':opts.buildStyle==='Wirtschaft'?'Defensiv':'Ausgewogen';}
      persist();lastPaint=0;paint();
    });
    panel.addEventListener('change',e=>{
      const key=e.target.dataset?.option;
      if(key==='aggressive')opts.aggressive=clamp(e.target.value,40,100);
      if(key==='reserve')opts.reserve=clamp(e.target.value,5,65);
      if(key==='actionsPerMinute')opts.actionsPerMinute=clamp(e.target.value,15,120);
      if(key==='maxTargets')opts.maxTargets=clamp(e.target.value,4,25);
      if(key==='duoRoom'||key==='duoPartnerName'){
        opts[key]=String(e.target.value||'').trim();
        duoLocal.peer=null;duoLocal.lastAt=0;duoLocal.match=null;
        duoLocal.status='Partner details changed · reconnecting';
      }
      persist();lastPaint=0;paint();
    });
    document.body.appendChild(panel);
  }
  // Presentation-only readout. No planner or intent consumes this state.
  function evidencePanelState(plan,s,frame,currentTick,ledger,budget){
    const age=frame&&Number.isFinite(currentTick)&&Number.isFinite(frame.requestedTick)?
      Math.max(0,currentTick-frame.requestedTick):null;
    const latest=ledger?.at(-1)||null;
    const budgetAge=budget&&Number.isFinite(currentTick)&&Number.isFinite(budget.tick)?
      Math.max(0,currentTick-budget.tick):null;
    return {alternative:plan?.rejected??null,reserveReason:s?.reserveReason??'unbekannt',
      reserveFloors:s?.reserveFloors??null,workerAge:age,
      workerStale:age===null||age>20,
      actionId:latest?.actionId??null,decisionId:latest?.decisionId??null,
      effect:latest?.effect??'unconfirmed',
      budget:budgetAge!==null&&budgetAge<=300?budget:null,budgetAge};
  }
  // Presentation-only translation: stored strategy enum values remain unchanged.
  const MENU_STATUS_TRANSLATIONS=[["Warte auf Spiel","Waiting for a match"],["Singleplayer erkannt","Single-player detected"],["Multiplayer erkannt","Multiplayer detected"],["Autostart wartet auf EventBus","auto-start waiting for EventBus"],["Bot bereit","Bot ready"],["Replay · BOT GESPERRT","Replay · BOT DISABLED"],["Verteidigung vor Investitionen","Defense before investing"],["Erste Stadt/Fabrik","First City/Factory"],["SAM-Schutz vor Raketenfonds","SAM defense before missile savings"],["Truppenlimit: Stadt/City-Upgrade oder Landgewinn priorisiert","Troop cap: prioritize City upgrades or territory"],["Hafen vor Silo","Port before silo"],["Zwei Städte und zwei Fabriken","Two Cities and two Factories"],["Wirtschaft & Offensive","Economy & offense"],["Keine legalen Bauoptionen im geprüften Gebiet","No legal building options in inspected area"],["Baukandidaten durch Priorität oder Reserve gesperrt","Build choices blocked by priority or reserve"],["Gold für Bauoption fehlt; Standort noch ungeprüft","Not enough gold for construction; site not yet verified"],["Spare auf ersten Kernbau:","Saving for first core building:"],["Spare auf SAM:","Saving for SAM:"],["Warte auf","Waiting for"],["Keine","No"],["keine","none"],["Verteidigung","Defense"],["Wirtschaft","Economy"],["Hafen","Port"],["Stadt","City"],["Truppen","Troops"],["Angriff","Attack"],["Gegner","Opponent"],["Bündnis","Alliance"],["bestätigt","confirmed"],["unbestätigt","unconfirmed"],["ausstehend","pending"],["unbekannt","unknown"],["bereit","ready"],["aktiv","active"],["Defensiv","Defensive"],["Ausgewogen","Balanced"],["Adaptiv","Adaptive"],["Ökonomie","Economy"]];
  function translateMenuText(value) {
    let text=String(value??'');
    for(const [from,to] of MENU_STATUS_TRANSLATIONS)text=text.replaceAll(from,to);
    return text;
  }
  function paint() {
    const enHTML=value=>escapeHTML(translateMenuText(value));
    if(!document.body)return;if(!panel)mount();
    if(!panel||Date.now()-lastPaint<900)return;
    // Keep the user's slider interaction from being interrupted by a redraw.
    if(panel.contains(document.activeElement)&&document.activeElement?.matches('input'))return;
    lastPaint=Date.now();actionBudget();
    // Rebuilding innerHTML must not collapse sections the player opened.
    const expanded={};
    for(const detail of panel.querySelectorAll('details[data-section]'))expanded[detail.dataset.section]=detail.open;
    const openFor=key=>expanded[key]?' open':'';
    const sectionStyle='border:1px solid #354d66;border-radius:6px;margin-top:6px;padding:5px 7px';
    const b=(key,label)=>`<button data-key="${key}" style="border:1px solid #779;border-radius:5px;color:#fff;background:${opts[key]?'#167247':'#344157'};padding:5px 7px;margin:2px;cursor:pointer">${label}</button>`;
    panel.innerHTML=`<b style="font-size:14px;color:#83dcff">AggroBot ${VERSION}</b> ${permittedMatch(game)?'🟢':'🔒'}
      <div style="color:#bed5e8;margin:6px 0">${enHTML(status)}</div>
      ${game?.inSpawnPhase?.()?'<div style="color:#9bd0e4">Strategic spawn: '+
        enHTML(spawnState.phase)+' · checked '+spawnState.scanned+
        ' · attempts '+spawnState.attempts+' · remaining '+
        spawnRemaining(game)+' Ticks</div>':''}
      <div>${b('enabled',opts.enabled?'⏸ PAUSE':'▶ START')} ${b('autoStart',opts.autoStart?'⚡ Auto-start ON':'⚡ Auto-start OFF')}</div>
      <div style="color:#a9efc9">${enHTML(strategic.mode)} · ${enHTML(strategic.reason)} · ${enHTML(economicStatus)}</div>
      <details data-section="features"${openFor('features')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Modules &amp; settings</summary>
      <div>${b('autoSpawn','Spawn')} ${b('defense','Counterattack')} ${b('economy','Economy')} ${b('boats','Navy')}</div>
      <div>${b('upgrades','Upgrades')} ${b('safeMode','Emergency stop')} ${b('autoStrategy','Auto-strategy '+(opts.autoStrategy?'AN':'AUS'))} ${b('fullAuto','Fully autonomous '+(opts.fullAuto?'AN':'AUS'))}</div>
      <div>${b('diplomacy','Diplomacy')} ${b('offerAlliances','Offer alliances')}</div>
      <div>${b('nukes','Auto-Nukes')} ${b('antiNuke','Smart SAMs')} ${b('lateOffense','Late-game offense')}</div>
      <div>${b('impossibleExperiment','Impossible AI Test')} ${b('learningEnabled','Learning')} ${b('neuralEnabled','Neural network')} ${b('impossibleMode','Impossible strategy')}</div>
      </details>
      <details data-section="localduo"${openFor('localduo')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">🤝 Duo mode (2 browsers, 1 PC)</summary>
      <div>${b('duoEnabled','Local Duo '+(opts.duoEnabled?'AN':'AUS'))}</div>
      <div style="color:#9bd0e4">My player ID: <b>${enHTML(safeID(myPlayer())??'not in a match yet')}</b></div>
      <label>Partner name (display only)<input type="text" data-option="duoPartnerName" maxlength="80" value="${enHTML(opts.duoPartnerName||'')}" placeholder="z. B. ExamplePartner" style="box-sizing:border-box;width:100%"></label>
      <div>Partner ID (automatic): ${enHTML(duoTrustedPeer()?.id??"Waiting for partner")}</div>
      <label>Duo room code (same in both browsers)<input type="text" data-option="duoRoom" maxlength="64" value="${enHTML(opts.duoRoom)}" placeholder="z. B. EXAMPLE_DUO_01" style="box-sizing:border-box;width:100%"></label>
      <div>Status: ${enHTML(duoLocal.status)} · ${duoTrustedPeer()?'Partner verified in current match':'Partner disconnected'}</div>
      <div style="color:#9bd0e4">Duo state: ${enHTML(duoStatusView(opts.duoEnabled,duoTrustedPeer(),duoPlan,number(()=>game?.ticks?.(),-1),duoLocal).phase)} · Relay-Drops ${duoLocal.relayDrops} · Relay-Timeouts ${duoLocal.relayTimeouts} · ACK-Timeouts ${duoLocal.ackTimeouts}</div>
      <div style="color:#9bd0e4;font-size:10px">Match ID: ${enHTML(duoMatchKey())}</div>
      <div>In-game name: ${enHTML(duoTrustedPeer()?nameOf(duoTrustedPeer().player):'—')}${duoTrustedPeer()&&opts.duoPartnerName&&nameOf(duoTrustedPeer().player)!==opts.duoPartnerName?' · Display name mismatch (player ID takes precedence)':''}</div>
      <div>Partner's other allies (attack protection): ${enHTML((duoTrustedPeer()?.state?.allies||[]).map(id=>nameOf((game?.playerViews?.()||[]).find(p=>safeID(p)===id)||{id:()=>id})).join(', ')||'—')}</div>
      <div>Partner: target ${enHTML(duoTrustedPeer()?.state?.target??'—')} · available ${Math.round(duoTrustedPeer()?.state?.available||0)} · Reserve ${Math.round(duoTrustedPeer()?.state?.reserve||0)} · needs help ${duoTrustedPeer()?.state?.needHelp?'YES':'no'}</div>
      <div>Joint plan: ${enHTML(duoPlan?duoPlan.role+' → '+duoPlan.targetName+(duoPlan.strikeTick!==null?' · attack from tick '+duoPlan.strikeTick:''):'Start together → confirm alliance → divide the front')}</div>
      <div>Joint attack budget: ${duoPlan?.joint?enHTML(Math.round(duoPlan.joint.own/10)+' own + '+Math.round(duoPlan.joint.ally/10)+' partner troops · required '+Math.round(duoPlan.joint.needed/10)):'No jointly safe front yet'}</div>
      <div>Attack coordination: ${enHTML(duoPlan?.strikeStatus||'none')} · partner warnings ${duoPlan?.partnerWarning||0}/2 · displayed troops = engine value / 10</div>
      <div style="margin-top:4px"><b>Duo-Timeline</b>${decisionTimeline.filter(d=>d.kind==='2v2').slice(-4).reverse().map(d=>'<div style="border-top:1px solid #354d66;padding:2px 0">'+enHTML('Tick '+d.tick+' · '+d.why)+'</div>').join('')}</div>
      <div style="color:#a9efc9">Run Start_Live_Duo.bat · port 8767 · use the same room code in both browsers · alliances require in-game confirmation · on relay loss, both bots continue independently.</div>
      </details>
      <details data-section="neural"${openFor('neural')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Neural model</summary>
      <div>${b('shadowRankEnabled',opts.shadowRankEnabled?'Shadow ranking ON':'Shadow ranking OFF')}</div>
      <div style="color:#9bd0e4">Shadow: ${shadowV6Model||shadowV5Model?((shadowV6Model?'Schema 6':'Schema 5')+(opts.shadowRankEnabled&&opts.candidateControlEnabled?' CONTROL ACTIVE (gain '+enHTML(shadowModelInfo().controlGain)+')':', loaded, comparison only')):'no shadow candidate loaded'} · ${enHTML(shadowDecisionEvidence?.wouldPrefer??'—')} ${(shadowV6Model||shadowV5Model)&&opts.shadowRankEnabled&&opts.candidateControlEnabled?(shadowDecisionEvidence?.failClosed?'(rule-based fallback: '+enHTML(shadowDecisionEvidence.failClosed)+')':shadowDecisionEvidence?.changedIntent?'(model changed the selected action)':'(control configured; last choice unchanged)'):'(no action effect)'}</div>
      <div style="color:#9bd0e4">Inference: ${enHTML(neuralModelInfo().fingerprint||'kein Modell')} · signals ${neuralEvidence.nonzero}/${neuralEvidence.calls} · Ranking ${neuralEvidence.actionNonzero}/${neuralEvidence.actionCalls}</div>
      <div style="color:#9bd0e4">Deployment: Modell ${enHTML(deploymentInfo().model.champion.fingerprint||'—')} · Kandidat ${enHTML(deploymentInfo().model.candidate.fingerprint||'—')} · Skript ${enHTML(deploymentInfo().script.version)} · Engine ${enHTML(deploymentInfo().engine.commit||'—')}</div>
      <div style="color:#9bd0e4">Neural model: ${neuralModel?.schema===4?'Strategic policy v4 (24 signals)':neuralModel?.schema===3?'Strategic policy v3 (16 signals)':neuralModel?.schema===2?'Action ranking (max ±14 points)':neuralModel?.schema===1?'Slider (max ±8 points)':'not loaded'} · only in a permitted match</div>
      </details>
      <details data-section="situation"${openFor('situation')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Situation &amp; diplomacy</summary>
      <div style="color:#a9efc9">Main front: ${enHTML(warState.name)} · war ${isWar()?'aktiv':'frei'} · ${enHTML(lastRecoveryReason||'bereit')}</div>
      <div>${b('plan','Manual: '+opts.plan)}<br>${b('buildStyle','Manual building focus: '+opts.buildStyle)}</div>
      <div style="color:#a9efc9">AI strategy: ${enHTML(strategic.mode)} · ${enHTML(strategic.reason)} · Construction: ${enHTML(effectiveBuildStyle())}</div>
      <div style="color:#9bd0e4">Defense: ${enHTML(defenseStatus)} · retreats ${defenseStats.retreatsOrdered}/${defenseStats.retreatsObserved} observed · unknown ${defenseStats.unknown} · unconfirmed ${defenseStats.unconfirmed}</div>
      <div style="color:#9bd0e4">Game mode: ${enHTML(winStatus.mode)} · victory progress: ${winStatus.progress===null?'unknown':(winStatus.progress*100).toFixed(1)+'%'} · victory threshold: ${winStatus.threshold===null?'unknown':winStatus.threshold+'%'} · time: ${winStatus.remaining===null?'no timer':Math.round(winStatus.remaining)+'s'} · Doomsday: ${winStatus.doomsday?'YES':'NO'}</div>
      <div style="color:#9bd0e4">Trade per 60s: rail ${incomeStatus.train===null?'unknown':Math.round(incomeStatus.train)} · ship ${incomeStatus.trade===null?'unknown':Math.round(incomeStatus.trade)} · ${enHTML(tradeStatus)} · opened ${tradeStats.opened} / Embargos ${tradeStats.embargoed}</div>
      <div style="color:#9bd0e4">Navy: ${enHTML(fleetStatus)}</div>
      <div style="color:#9bd0e4">Nukes: ${enHTML(nukeStatus)} · bestätigt ${nukeShots} / Versuche ${nukeAttempts} / unbestätigt ${nukeUnconfirmed} · SAM coverage ${nuclearCache?.assets?.length - nuclearCache?.uncovered?.length||0}/${nuclearCache?.assets?.length||0}</div>
      <div style="color:#9bd0e4">Alliances: ${enHTML(diplomacyStatus)} · confirmed: ${diplomacyStats.accepted} accepted, ${diplomacyStats.rejected} rejected · ${diplomacyPending.size} pending · ${diplomacyStats.offered} offered</div>
      </details>
      <details data-section="humanplan"${openFor('humanplan')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Opponent analysis &amp; operations</summary>
      <div>Operation: ${operation?enHTML(operation.type+' → '+operation.targetName+' · '+operation.spent+'/'+operation.budget+' Tr. · abort: '+operation.abort):'No safe operation'}</div>
      <div>Duo: ${duoPlan?enHTML(duoPlan.role+' · target '+duoPlan.targetName+' · partner commitment '+duoPlan.partnerCommitted+' · needs help '+(duoPlan.needHelp?'YES':'no')):'No verified team/Duo partner'}</div>
      <div>Opponent victory: ${victoryThreat?enHTML(victoryThreat.name+' · '+victoryThreat.progress.toFixed(1)+'% / '+victoryThreat.threshold+'%'+(victoryThreat.urgent?' · WARNING':'')):'No verifiable threshold / no opponent'}</div>
      ${[...opponentProfiles.values()].slice(0,8).map(p=>'<div>'+enHTML(p.name+' · '+p.profile+' · '+Math.round(p.confidence*100)+'% observation confidence')+'</div>').join('')}
      <div style="margin-top:5px"><b>Decision timeline</b>${decisionTimeline.slice(-8).reverse().map(d=>'<div style="padding:3px 0;border-top:1px solid #354d66">'+enHTML('Tick '+d.tick+' · '+d.why)+(d.alternatives.length?'<br><span style="color:#9bd0e4">'+enHTML(d.alternatives.join(' | '))+'</span>':'')+'</div>').join('')}</div>
      </details>
      <details data-section="tuning"${openFor('tuning')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Fine-tuning</summary>
      <div style="color:#a9efc9">Parameters: ${opts.fullAuto?'AUTONOM '+enHTML(autoTuning.mode)+' · '+enHTML(autoTuning.reason):'MANUELL'}</div>
      <label>Aggressiveness: ${setting('aggressive')}%${opts.fullAuto?' (Auto)':''}<input type="range" data-option="aggressive" min="40" max="100" value="${setting('aggressive')}" ${opts.fullAuto?'disabled':''} style="display:block;width:100%"></label>
      <label>Reserve: ${setting('reserve')}%${opts.fullAuto?' (Auto)':''}<input type="range" data-option="reserve" min="5" max="65" value="${setting('reserve')}" ${opts.fullAuto?'disabled':''} style="display:block;width:100%"></label>
      <label>Actions/min: ${setting('actionsPerMinute')}${opts.fullAuto?' (Auto)':''}<input type="range" data-option="actionsPerMinute" min="15" max="120" value="${setting('actionsPerMinute')}" ${opts.fullAuto?'disabled':''} style="display:block;width:100%"></label>
      <label>Target checks: ${setting('maxTargets')}${opts.fullAuto?' (Auto)':''}<input type="range" data-option="maxTargets" min="4" max="25" value="${setting('maxTargets')}" ${opts.fullAuto?'disabled':''} style="display:block;width:100%"></label>
      </details>
      <details data-section="diagnostics"${openFor('diagnostics')} style="${sectionStyle}"><summary style="cursor:pointer;font-weight:bold;color:#83dcff">Diagnostics &amp; log</summary>
      <div>${b('evidenceMode',opts.evidenceMode?'🔎 Evidence ON':'🔎 Evidence OFF')}</div>
      ${opts.evidenceMode?(()=>{
        const e=evidencePanelState(planningState,troopSnapshot,lastDecisionFrame,
          number(()=>game?.ticks?.(),-1),actionLedger,economyBudgetEvidence);
        const a=e.alternative;
        return '<div style="color:#a9efc9">Rejected alternative: '+
          enHTML(a?a.id+' · utility '+a.utility+' · '+a.reason:'noch none Rangliste')+'</div>'+
          '<div style="color:#9bd0e4">Reserve reason: '+enHTML(e.reserveReason)+
          ' · worker age: '+(e.workerAge===null?'unknown':e.workerAge+' Ticks')+
          (e.workerStale?' (stale/uncertain)':'')+'</div>'+
          '<div style="color:#9bd0e4">Last action: '+enHTML(e.actionId??'—')+
          ' · decision: '+enHTML(e.decisionId??'—')+
          ' · effect: '+enHTML(e.effect)+' (cannot infer from intent)</div>'+
          '<div style="color:#9bd0e4;font-size:10px">Ranking and observation only; no additional authorization to act.</div>';
      })():''}
      ${(()=>{const e=evidencePanelState(planningState,troopSnapshot,lastDecisionFrame,
        number(()=>game?.ticks?.(),-1),actionLedger,economyBudgetEvidence),q=e.budget;
        return '<div style="color:#9bd0e4">Budget breakdown: '+(q?
          enHTML('Cap '+(q.capUse===null?'?':(q.capUse*100).toFixed(0)+'%')+
            ' · City desired '+(q.cityWanted?'YES':'no')+' ('+q.cityCount+')'+
            ' · SAM '+(q.wantedSAM||0)+(q.nuclearThreat?' (threat)':'')+
            ' · Port milestone '+(q.portMilestone?'YES':'no')+
            ' · Gold-Floor '+q.goldFloor+' (baseline, depends on construction)'+
            ' · SAM quote '+(q.samQuote??'?')+' · Port quote '+(q.portQuote??'?')):
            'no recent economy snapshot')+'</div>';
      })()}
      
      <div style="color:#9bd0e4">Construction: ${enHTML(economicStatus)} · savings target: ${enHTML(investmentStatus)} · priorities: ${enHTML(economicLastPlan)}</div>
      <div style="color:#9bd0e4">Runtime: front ${runtime.borderMs}ms · combat ${runtime.combatMs}ms · construction ${runtime.economyMs}ms · worker checks ${runtime.attackProbes}/${runtime.buildProbes}</div>
      <div style="color:${intentHealth().critical.length?'#ff8181':intentHealth().missing.length?'#ffd480':'#a9efc9'}">Intents: ${intentHealth().eventBus?intentHealth().found+'/'+intentHealth().total:'EventBus pending'} · ${intentHealth().missing.length?'Missing: '+enHTML(intentHealth().missing.join(', ')):'all detected'}${intentHealth().critical.length?' · CORE FUNCTION DEGRADED':''}</div>
      <div style="color:#9bd0e4">Action budget: ${actions.length}/${setting('actionsPerMinute')} · sent: ${totalSent} · failed: ${totalFailed} · errors: ${errors}</div>
      <div style="color:#9bd0e4">Home: ${Math.floor(troopSnapshot.home/10)} · Reserve: ${Math.floor(troopSnapshot.reserve/10)} · ongoing attacks: ${Math.floor(troopSnapshot.committed/10)} · income/reserve: ${(troopSnapshot.ratio*100).toFixed(0)}% capacity</div>
      <div style="color:#9bd0e4">Incoming: ${Math.floor(troopSnapshot.incoming/10)} · strongest border neighbor: ${Math.floor(troopSnapshot.strongest/10)} · Ziel: ${enHTML(lastSelection||plan?.name||'Searching')} · ${borderCache?.length||0} border tiles</div>
      <div style="border-top:1px solid #527;margin-top:7px;padding-top:5px"><b>Recent decisions</b>${recent.map(s=>`<div>• ${enHTML(s)}</div>`).join('')}</div>
      <button data-key="export" style="border:1px solid #73acdd;border-radius:5px;background:#235078;color:white;padding:5px 7px;cursor:pointer">📄 Export diagnostic JSON</button>
      </details>
      <div style="color:#97a8be;font-size:10px;margin-top:8px">Single-player, public and private matches supported · replays disabled · one auto-start per match · pause until match change · Alt+Shift+P start/pause · Alt+Shift+X emergency stop (auto-start OFF).<br>When running Spawn Advisor, disable its auto-spawn, smart attack and auto-accept alliances.</div>`;
  }
  document.addEventListener('keydown',e=>{
    if(!e.altKey||!e.shiftKey||!['p','x'].includes(e.key.toLowerCase())||e.repeat||e.target?.isContentEditable||
      /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||''))return;
    e.preventDefault();
    if(e.key.toLowerCase()==='x'){
      opts.enabled=false;opts.autoStart=false;autoStartGame=game;generation++;log('Emergency stop by hotkey · auto-start OFF');
    }else if(connected()){
      opts.enabled=!opts.enabled;autoStartGame=game;generation++;log(opts.enabled?'BOT START':'BOT PAUSE');
      if(opts.enabled)reportIntents(true);
    } else status='Bot available only in an active single-player, public or private match';
    persist();lastPaint=0;paint();
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint,{once:true});
  const interval=setInterval(step,400);
  // DonateEvent exists only in the current GameView update. Sample frequently
  // instead of relying exclusively on the 400 ms planner cycle (which can
  // skip a donation update). Background-tab throttling can still miss one.
  const donationInterval=setInterval(()=>{
    if(opts.enabled&&game&&permittedMatch(game))diagnosticDonationUpdates();
  },90);
  const economyInterval=setInterval(economyStep,750);
  const diplomacyInterval=setInterval(diplomacyTick,950);
  const tradeInterval=setInterval(()=>{tradeTick().catch(e=>{
    tradeStatus='Trade: '+String(e?.message||e).slice(0,75);
  });},1250);
  const nukeInterval=setInterval(nukeStep,1100);
  const duoInterval=setInterval(()=>{duoPublish().catch(e=>{
    duoLocal.status='Relay error: '+String(e?.message||e).slice(0,55);
  });},950);
  window.addEventListener('beforeunload',()=>{clearInterval(interval);clearInterval(economyInterval);clearInterval(diplomacyInterval);clearInterval(tradeInterval);clearInterval(nukeInterval);clearInterval(duoInterval);clearInterval(donationInterval);});
  if(benchmark){
    window.__OF_BENCHMARK__=Object.freeze({
      snapshot:diagnosticSnapshot,
      status:()=>({version:VERSION,connected:!!connected(),enabled:opts.enabled,
        gameType:gameType(game),tick:number(()=>game.ticks(),-1),
        spawned:!!myPlayer()?.hasSpawned?.(),alive:myPlayer()?.isAlive?.()??null,
        gameOver:!!game?.gameOver?.(),status}),
      start:(settings={})=>{
        if(!connected()||!permittedMatch(game))
          throw new Error('Benchmark requires a local permitted match');
        const allowed={aggressive:[40,100],reserve:[5,65],actionsPerMinute:[15,120],maxTargets:[4,25]};
        for(const [key,value] of Object.entries(settings)){
          if(key==='fullAuto'&&typeof value==='boolean')continue;
          if(key==='duoEnabled'&&typeof value==='boolean')continue;
          if(key==='duoRoom'&&typeof value==='string'&&
            /^[a-zA-Z0-9_-]{6,64}$/.test(value))continue;
          if(key==='archetype'&&typeof value==='string'&&
            Object.prototype.hasOwnProperty.call(ARCHETYPES,value))continue;
          if(!allowed[key]||typeof value!=='number'||!Number.isFinite(value)||value<allowed[key][0]||value>allowed[key][1])
            throw new Error('Invalid benchmark setting: '+key);
        }
        Object.assign(opts,settings);if(opts.fullAuto)opts.autoStrategy=true;
        applyArchetypeOptions();
        autoTuning.tick=-Infinity;opts.enabled=true;autoStartGame=game;generation++;
        telemetry('benchmark_start','Local benchmark started',{settings});
        reportIntents(true);
      },
      stop:()=>{telemetry('benchmark_stop','Local benchmark stopped');opts.enabled=false;autoStartGame=game;generation++;},
      // Step 3: benchmark-only per-decision frame for real training capture.
      planningFrame:()=>planningFrame(),
      // §28 schema-7 branch funnel (aggregate + last decision) for the
      // pre-gate and dev/holdout reconciliation from the benchmark report.
      branchFunnel:()=>({...branchFunnel,
        lastDecision:branchFunnel.lastDecision?
          {...branchFunnel.lastDecision}:null}),
      // Engine harness awaits every cycle; ordinary browser timers stay unchanged.
      pump:async()=>{await step();await economyStep();await diplomacyTick();
        await nukeStep();if(opts.duoEnabled)await duoPublish();}
    });
  }
  console.info(PREFIX,'v'+VERSION,'ready; Singleplayer/Public/Private, auto-start after match discovery');
})();