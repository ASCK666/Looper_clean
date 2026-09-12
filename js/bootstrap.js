"use strict";

window.__SP={version:"120927-mockup-deck",ready:false,errors:[],ui120927CssReady:true};
window.__SP.report=(scope,error)=>{
  const message=error?.message||String(error||"Unknown error");
  const item={scope,message,time:new Date().toISOString()};
  window.__SP.errors.push(item);
  const el=document.getElementById("appBootError");
  if(el){el.textContent=`${scope}: ${message}`;el.classList.add("visible");}
};
window.addEventListener("error",event=>window.__SP.report("RUNTIME",event.error||event.message));
window.addEventListener("unhandledrejection",event=>window.__SP.report("PROMISE",event.reason));

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

window.addEventListener("DOMContentLoaded",()=>{
  if(location.protocol==="about:" || location.protocol==="data:")return;
  if(window.ChopperWaveSlices || document.querySelector('script[data-chopper-wave-slices="1"]'))return;
  const script=document.createElement("script");
  script.src="./js/chopper-wave-slices.js";
  script.dataset.chopperWaveSlices="1";
  script.onerror=()=>window.__SP.report("CHOPPER WAVE SLICES",new Error("Slice editor failed to load"));
  document.body.appendChild(script);
},{once:true});

window.addEventListener("DOMContentLoaded",()=>{
  if(location.protocol==="about:" || location.protocol==="data:")return;
  if(globalThis.LooperDefaultDrumKit?.installed || document.querySelector('script[data-default-drum-kit="1"]'))return;
  const script=document.createElement("script");
  script.src="./js/default-drum-kit.js";
  script.dataset.defaultDrumKit="1";
  script.onerror=()=>window.__SP.report("DEFAULT DRUM KIT",new Error("Default drum kit failed to load"));
  document.body.appendChild(script);
},{once:true});
