"use strict";

// Mobile Chopper parameter interaction. Keep the existing inputs as the only
// product state owners; compact readouts only translate touch/pen scrubs into
// their existing input/change events.
(() => {
  const root=document.getElementById("chopper");
  if(!root || globalThis.ChopperMobileControls)return;

  const mobileMedia=window.matchMedia("(max-width:760px)");
  const bindings=[
    {inputId:"samplePitch",targetId:"samplePitchReadout",pixelsPerStep:20,step:1},
    {inputId:"sampleBpm",targetId:"sampleBpm",pixelsPerStep:3,step:1},
    {inputId:"sampleVolume",targetId:"sampleVolumeReadout",pixelsPerStep:2,step:1},
    {inputId:"punchMode",targetId:"punchDesc",pixelsPerStep:28,step:1,cycleTap:true}
  ];

  function numeric(value,fallback=0){
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
  }

  function clampInputValue(input,value){
    const min=numeric(input.min,-Infinity);
    const max=numeric(input.max,Infinity);
    return Math.max(min,Math.min(max,value));
  }

  function setInputValue(input,value){
    const next=clampInputValue(input,value);
    if(numeric(input.value)===next)return false;
    input.value=String(next);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  }

  function syncAccessibleValue(input,target){
    if(target===input)return;
    target.setAttribute("aria-valuenow",input.value);
    target.setAttribute("aria-valuetext",target.textContent.trim());
  }

  function bindScrub({inputId,targetId,pixelsPerStep,step,cycleTap=false}){
    const input=document.getElementById(inputId);
    const target=document.getElementById(targetId);
    if(!input || !target)return;

    if(target!==input){
      target.tabIndex=0;
      target.setAttribute("role","slider");
      target.setAttribute("aria-label",input.getAttribute("aria-label") || target.previousElementSibling?.textContent?.trim() || inputId);
      target.setAttribute("aria-valuemin",input.min);
      target.setAttribute("aria-valuemax",input.max);
    }
    target.title=cycleTap
      ? "Glisser verticalement pour régler • toucher pour changer"
      : "Glisser verticalement pour régler";
    syncAccessibleValue(input,target);
    input.addEventListener("input",()=>syncAccessibleValue(input,target));

    let pointerId=null;
    let startY=0;
    let startValue=0;
    let changed=false;
    let scrubbed=false;
    let suppressClick=false;

    const applyStep=value=>{
      if(setInputValue(input,value))changed=true;
      syncAccessibleValue(input,target);
    };

    const finish=event=>{
      if(pointerId===null || (event?.pointerId!=null && event.pointerId!==pointerId))return;
      if(cycleTap && !scrubbed){
        const min=numeric(input.min,0);
        const max=numeric(input.max,min);
        const current=numeric(input.value,min);
        applyStep(current>=max?min:current+step);
      }
      if(changed)input.dispatchEvent(new Event("change",{bubbles:true}));
      suppressClick=scrubbed;
      pointerId=null;
      changed=false;
      scrubbed=false;
    };

    target.addEventListener("pointerdown",event=>{
      if(!mobileMedia.matches || !event.isPrimary || event.button!==0)return;
      pointerId=event.pointerId;
      startY=event.clientY;
      startValue=numeric(input.value);
      changed=false;
      scrubbed=false;
      try{target.setPointerCapture(pointerId);}catch{}
    });

    target.addEventListener("pointermove",event=>{
      if(pointerId===null || event.pointerId!==pointerId)return;
      const delta=startY-event.clientY;
      if(!scrubbed && Math.abs(delta)<6)return;
      scrubbed=true;
      const steps=Math.round(delta/Math.max(1,pixelsPerStep));
      applyStep(startValue+steps*step);
      if(event.cancelable)event.preventDefault();
    });

    target.addEventListener("pointerup",finish);
    target.addEventListener("pointercancel",finish);
    target.addEventListener("click",event=>{
      if(!suppressClick)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick=false;
    },true);

    if(target!==input){
      target.addEventListener("keydown",event=>{
        if(!mobileMedia.matches)return;
        const current=numeric(input.value);
        let next=null;
        if(event.key==="ArrowUp" || event.key==="ArrowRight")next=current+step;
        else if(event.key==="ArrowDown" || event.key==="ArrowLeft")next=current-step;
        else if(event.key==="Home")next=numeric(input.min,current);
        else if(event.key==="End")next=numeric(input.max,current);
        else return;
        event.preventDefault();
        if(setInputValue(input,next))input.dispatchEvent(new Event("change",{bubbles:true}));
        syncAccessibleValue(input,target);
      });
    }
  }

  bindings.forEach(bindScrub);

  globalThis.ChopperMobileControls=Object.freeze({
    get active(){return mobileMedia.matches;}
  });
})();
