const fs=require('fs');
const vm=require('vm');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const DRUMS=fs.readFileSync(path.join(ROOT,'js','drums.js'),'utf8');

global.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
global.dbToGain=db=>Math.pow(10,db/20);
global.analyzeSampleCondition=()=>({rmsDb:-20,trimDb:0});
vm.runInThisContext(DRUMS,{filename:'js/drums.js'});

function fakeBuffer(channels,sampleRate=44100){
  const arrays=channels.map(values=>Float32Array.from(values));
  return {
    length:arrays[0].length,
    numberOfChannels:arrays.length,
    sampleRate,
    getChannelData:index=>arrays[index]
  };
}

function peak(buffer){
  let out=0;
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    for(const value of buffer.getChannelData(ch))out=Math.max(out,Math.abs(value));
  }
  return out;
}

const shape=Array.from({length:8192},(_,i)=>
  i%2048<80 ? Math.sin(i*.07)*.8 : Math.sin(i*.01)*.04
);
const loud=fakeBuffer([shape,shape.map(v=>-v)]);
const quiet=fakeBuffer([shape.map(v=>v*.1),shape.map(v=>-v*.1)]);

const loudDensity=sampleDensity(loud);
const quietDensity=sampleDensity(quiet);
if(Math.abs(loudDensity-quietDensity)>1e-9){
  throw new Error(`AUTO density must be level-independent: ${loudDensity} vs ${quietDensity}`);
}

const loudKickGain=drumAutoGain('kick',loud);
const quietKickGain=drumAutoGain('kick',quiet);
if(!(quietKickGain>loudKickGain))throw new Error('Quiet drum must receive more compensation than loud drum');
if(quietKickGain>dbToGain(6)+1e-9)throw new Error('Drum auto gain exceeded +6 dB safety cap');
if(sampleAutoMixGain(loud)>dbToGain(4)+1e-9)throw new Error('Sample auto gain exceeded +4 dB safety cap');

const hot=fakeBuffer([[0,1.4,-1.2,.4],[0,-1.3,1.1,-.5]]);
applyFinalPeakGuard(hot);
const ceiling=dbToGain(-1);
if(peak(hot)>ceiling+1e-6)throw new Error(`Final peak guard failed: ${peak(hot)} > ${ceiling}`);

for(const invariant of [
  'const norm=1/Math.sqrt(1+fx.mix*fx.mix)',
  'edge.gain.linearRampToValueAtTime(1,startTime+edgeFade)',
  'edge.gain.linearRampToValueAtTime(0,stopTime)',
  'if(generation!==previewRenderGeneration)return false',
  'previewRenderGeneration++;'
]){
  if(!DRUMS.includes(invariant))throw new Error(`Missing AUTO MIX invariant: ${invariant}`);
}

console.log('OK: AUTO MIX uses level-independent density, bounded source compensation, chop micro-fades, stale-render rejection and -1 dBFS final peak guard');
