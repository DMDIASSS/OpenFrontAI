// From Solo AggroBot 1.21.6, MIT. See third_party/NOTICE.md.
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

module.exports=shadowV7;
