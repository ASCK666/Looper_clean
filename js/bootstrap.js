"use strict";

window.__SP={version:"120927-ui-migration",ready:false,errors:[]};
window.__SP.report=(scope,error)=>{
  const message=error?.message||String(error||"Unknown error");
  const item={scope,message,time:new Date().toISOString()};
  window.__SP.errors.push(item);
  const el=document.getElementById("appBootError");
  if(el){el.textContent=`${scope}: ${message}`;el.classList.add("visible");}
};
window.addEventListener("error",event=>window.__SP.report("RUNTIME",event.error||event.message));
window.addEventListener("unhandledrejection",event=>window.__SP.report("PROMISE",event.reason));

// Branch 120927 is a visual migration over the maintained Looper engine.
// Start loading both assets immediately; the adapter itself waits for
// DOMContentLoaded before touching the Looper globals defined by defer scripts.
if(!document.querySelector('link[data-looper-120927="1"]')){
  const link=document.createElement("link");
  link.rel="stylesheet";
  link.href="./css/looper-120927.css";
  link.dataset.looper120927="1";
  link.onload=()=>{ window.__SP.ui120927CssReady=true; };
  link.onerror=()=>window.__SP.report("LOOPER 120927 CSS",new Error("120927 stylesheet failed to load"));
  document.head.appendChild(link);
}
if(location.protocol!=="about:" && location.protocol!=="data:" && !document.querySelector('script[data-looper-120927="1"]')){
  const script=document.createElement("script");
  script.src="./js/looper-120927.js";
  script.async=false;
  script.dataset.looper120927="1";
  script.onerror=()=>window.__SP.report("LOOPER 120927",new Error("120927 migration layer failed to load"));
  document.body.appendChild(script);
}

document.querySelectorAll("[data-range-knob]").forEach(knob=>{
  const input=document.getElementById(knob.dataset.rangeKnob);
  if(!input)return;
  const valueDescriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  const sync=()=>{
    const min=Number(input.min)||0;
    const max=Number(input.max)||100;
    const value=Number(input.value)||0;
    const pct=max===min?0:(value-min)/(max-min)*100;
    knob.style.setProperty("--knob-pct",String(Math.max(0,Math.min(100,pct))));
  };
  input.addEventListener("input",sync);
  if(valueDescriptor?.get&&valueDescriptor?.set){
    Object.defineProperty(input,"value",{
      configurable:true,
      get(){return valueDescriptor.get.call(this);},
      set(value){valueDescriptor.set.call(this,value);sync();}
    });
  }
  sync();
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations()
    .then(registrations=>Promise.all(registrations.map(registration=>registration.unregister())))
    .catch(error=>console.warn("Scratch Practice SW cleanup failed:",error));
}
if("caches" in window){
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith("scratch-practice-")).map(key=>caches.delete(key))))
    .catch(error=>console.warn("Scratch Practice cache cleanup failed:",error));
}

// looper-next feature modules load after the maintained defer scripts so they
// can extend the existing Chopper engine without changing its base files.
window.addEventListener("DOMContentLoaded",()=>{
  if(location.protocol==="about:" || location.protocol==="data:")return;
  if(window.ChopperWaveSlices || document.querySelector('script[data-chopper-wave-slices="1"]'))return;
  const script=document.createElement("script");
  script.src="./js/chopper-wave-slices.js";
  script.dataset.chopperWaveSlices="1";
  script.onerror=()=>window.__SP.report("CHOPPER WAVE SLICES",new Error("Slice editor failed to load"));
  document.body.appendChild(script);
},{once:true});

// Keep the user's persisted KICK / SNARE / HAT folders authoritative. The
// embedded boom-bap kit is installed only as the engine fallback once all defer
// scripts (including the IndexedDB drum-library restore wrapper) are ready.
window.addEventListener("DOMContentLoaded",()=>{
  if(location.protocol==="about:" || location.protocol==="data:")return;
  if(globalThis.LooperDefaultDrumKit?.installed || document.querySelector('script[data-default-drum-kit="1"]'))return;
  const script=document.createElement("script");
  script.src="./js/default-drum-kit.js";
  script.dataset.defaultDrumKit="1";
  script.onerror=()=>window.__SP.report("DEFAULT DRUM KIT",new Error("Default drum kit failed to load"));
  document.body.appendChild(script);
},{once:true});
