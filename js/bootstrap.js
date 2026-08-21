"use strict";

window.__SP={version:"200826-ui-pixel",ready:false,errors:[]};
window.__SP.report=(scope,error)=>{
  const message=error?.message||String(error||"Unknown error");
  const item={scope,message,time:new Date().toISOString()};
  window.__SP.errors.push(item);
  const el=document.getElementById("appBootError");
  if(el){el.textContent=`${scope}: ${message}`;el.classList.add("visible");}
};
window.addEventListener("error",event=>window.__SP.report("RUNTIME",event.error||event.message));
window.addEventListener("unhandledrejection",event=>window.__SP.report("PROMISE",event.reason));

// Practice remains in the runtime, but its desktop/mobile shortcuts are retired.
// Keep the button in the layout so existing event wiring and responsive header
// geometry stay stable, while removing it from sight, pointer input and tab order.
(()=>{
  const practiceShortcut=document.getElementById("practiceOverlayOpen");
  if(practiceShortcut){
    practiceShortcut.style.visibility="hidden";
    practiceShortcut.style.pointerEvents="none";
    practiceShortcut.tabIndex=-1;
    practiceShortcut.disabled=true;
    practiceShortcut.setAttribute("aria-hidden","true");
  }

  const looperPracticeLabel=document.querySelector('.mainModeTabs .tab[data-tab="looper"] .tabCopy small');
  if(looperPracticeLabel)looperPracticeLabel.textContent="PLAY / BEATS";
})();

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
