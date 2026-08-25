"use strict";

// ----------------------------
// Core audio + utilities
// ----------------------------
const $ = id => document.getElementById(id);
let ctx = null;
let liveBus = null;
const MASTER_OUTPUT_GAIN = .85;

let sampleBuffer = null;
let sampleName = "";
let markers = [];
let transients = [];
let draggingMarker = -1;
let renderedFlip = null;
let flipSource = null;
let drumDirectoryHandles = {kick:null,snare:null,hat:null};
let drumDirectoryEntries = {kick:[],snare:[],hat:[]};
let drumFolderFiles = {kick:[],snare:[],hat:[]};
let drumDecodeCache = new Map();
let currentDrumSelection = null;
let lastPreviewMode = null; // "full" | "drums"
let isLoopPlaying = false;
let drumGenerationNumber = 0;
let selectedMarker = 0;
let chopAuditionSource = null;
let chopAuditionPad = -1;
let chopAuditionStartedAt = 0;
let chopAuditionOffset = 0;
let chopPlayheadRAF = 0;
let loopPlayheadStartedAt = 0;
let loopPlayheadState = null;
let samplePitchSemitones = 0;
let sampleVolumePercent = 80;
let sampleConditionProfile = {
  label:"NONE",
  trimDb:0,
  highPassHz:30,
  bodyCutDb:0,
  rmsDb:-120,
  crestDb:99,
  peakDb:-120,
  clippingRatio:0,
  lowMidRatio:0
};
let chopAuditionGain = null;
let loopGridEvents = [];
const audioExt = /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i;

// Defensive local-file limits. These are deliberately generous: the goal is
// to prevent accidental multi-gigabyte decodes / browser freezes, not to block
// normal music files.
const MAX_BEAT_FILE_BYTES = 512 * 1024 * 1024;
const MAX_SAMPLE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_DRUM_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DRUM_FOLDER_FILES = 5000;
const MAX_BEAT_CACHE_BYTES = 384 * 1024 * 1024;
const MAX_BEAT_CACHE_FILES = 200;

function isAudioFile(file){
  return !!file && ((file.type && file.type.startsWith("audio/")) || audioExt.test(file.name||""));
}

function assertLocalFileSize(file,maxBytes,label="audio"){
  if(!file)throw new Error(`Aucun fichier ${label}`);
  if(Number.isFinite(file.size) && file.size>maxBytes){
    const mb=Math.ceil(file.size/(1024*1024));
    const limit=Math.round(maxBytes/(1024*1024));
    throw new Error(`${label} trop volumineux (${mb} MB, limite ${limit} MB)`);
  }
  return file;
}

function localId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues){
    const n=new Uint32Array(4);
    crypto.getRandomValues(n);
    return [...n].map(x=>x.toString(16).padStart(8,"0")).join("-");
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeErrorMessage(error,fallback="Erreur"){
  const raw=error?.message||String(error||fallback);
  return raw.replace(/[\x00-\x1F\x7F]/g," ").trim().slice(0,180)||fallback;
}

function initializeAudioContext(){
  if(ctx)return ctx;

  ctx=new AudioContext({latencyHint:"interactive"});
  liveBus=ctx.createGain();
  liveBus.gain.value=MASTER_OUTPUT_GAIN;
  liveBus.connect(ctx.destination);
  return ctx;
}

async function ensureAudio(){
  initializeAudioContext();
  if(ctx.state==="suspended")await ctx.resume();
  return ctx;
}

function connectLive(node){
  if(liveBus)node.connect(liveBus);
  else node.connect(ctx.destination);
}

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function shortName(s,n=42){ return s.length>n ? s.slice(0,n-1)+"…" : s; }

function bufferToBlob(buffer){
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const length = buffer.length;
  const bytes = new ArrayBuffer(44 + length * channels * 2);
  const view = new DataView(bytes);
  const write = (off,str)=>{ for(let i=0;i<str.length;i++) view.setUint8(off+i,str.charCodeAt(i)); };
  write(0,"RIFF"); view.setUint32(4,36+length*channels*2,true); write(8,"WAVE");
  write(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true);
  view.setUint16(22,channels,true); view.setUint32(24,rate,true);
  view.setUint32(28,rate*channels*2,true); view.setUint16(32,channels*2,true);
  view.setUint16(34,16,true); write(36,"data"); view.setUint32(40,length*channels*2,true);
  let o=44;
  for(let i=0;i<length;i++){
    for(let ch=0;ch<channels;ch++){
      const x=clamp(buffer.getChannelData(ch)[i],-1,1);
      view.setInt16(o,x<0?x*0x8000:x*0x7fff,true); o+=2;
    }
  }
  return new Blob([bytes],{type:"audio/wav"});
}

async function decodeFile(file){
  initializeAudioContext();
  const ab = await file.arrayBuffer();
  return await ctx.decodeAudioData(ab.slice(0));
}

function detectTransients(buffer){
  const data=buffer.getChannelData(0), sr=buffer.sampleRate;
  const hop=512, win=1024, env=[];
  for(let i=0;i+win<data.length;i+=hop){
    let s=0;
    for(let j=0;j<win;j++){const v=data[i+j];s+=v*v;}
    env.push(Math.sqrt(s/win));
  }
  const nov=[];
  for(let i=1;i<env.length;i++) nov.push(Math.max(0,env[i]-env[i-1]));
  const sorted=[...nov].sort((a,b)=>a-b);
  const threshold=sorted[Math.floor(sorted.length*0.82)]||0;
  const out=[];
  let last=-9999;
  for(let i=1;i<nov.length-1;i++){
    if(nov[i]>=threshold && nov[i]>=nov[i-1] && nov[i]>=nov[i+1]){
      const t=(i+1)*hop/sr;
      if(t-last>0.055){out.push(t);last=t;}
    }
  }
  return out;
}
