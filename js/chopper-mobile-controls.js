"use strict";

// Mobile Chopper navigation and parameter interaction. Workspaces move the
// maintained controls instead of cloning waveform, transport or parameter state.
(() => {
  const root=document.getElementById("chopper");
  if(!root || globalThis.ChopperMobileControls)return;

  const mobileMedia=window.matchMedia("(max-width:760px)");
  const deck=root.querySelector(".samplerDeck");
  const upper=root.querySelector(".samplerUpperDeck");
  const screen=root.querySelector(".samplerScreenModule");
  const performance=root.querySelector(".samplerPerformanceDeck");
  const pads=root.querySelector(".samplerPadsModule");
  const padGrid=document.getElementById("pads");
  const sequence=root.querySelector(".samplerSequenceModule");
  const drums=root.querySelector(".samplerDrumSection");
  const waveWrap=root.querySelector(".wavewrap.largeWave");
  const waveActions=root.querySelector(".waveHeaderActions");
  const padTransport=root.querySelector(".padTransport");
  const sequenceActions=root.querySelector(".sequenceActions");
  const screenTitle=screen?.querySelector(":scope > .stableTitle");
  const advanced=screen?.querySelector(":scope > .advancedBox");
  if(!deck || !upper || !screen || !performance || !pads || !padGrid || !sequence || !drums || !waveWrap || !waveActions || !padTransport || !sequenceActions)return;

  const waveHome=waveWrap.parentNode;
  const waveNext=waveWrap.nextSibling;
  const HIDDEN_CLASS="mobileWorkspaceHidden";
  const workspaceNames=["chopper","sequence","pads","drums"];
  const accessibilitySyncers=[];
  const homes=new Map();
  let workspace="chopper";

  function rememberHome(element){
    if(!element || homes.has(element))return;
    homes.set(element,{parent:element.parentNode,next:element.nextSibling});
  }

  function restoreHome(element){
    const home=homes.get(element);
    if(!element || !home?.parent || element.parentNode===home.parent)return;
    if(home.next && home.next.parentNode===home.parent)home.parent.insertBefore(element,home.next);
    else home.parent.appendChild(element);
  }

  const tabBar=document.createElement("div");
  tabBar.className="chopperMobileTabs";
  tabBar.setAttribute("role","tablist");
  tabBar.setAttribute("aria-label","Vues du Chopper mobile");
  const tabLabels={chopper:"CHOPPER",sequence:"SEQ",pads:"PADS",drums:"DRUMS"};
  const tabAria={
    chopper:"Waveform et paramètres du Chopper",
    sequence:"Séquenceur",
    pads:"Pads et waveform",
    drums:"Batterie"
  };
  const tabs=new Map();
  for(const name of workspaceNames){
    const button=document.createElement("button");
    button.type="button";
    button.className="btn chopperMobileTab";
    button.dataset.mobileWorkspace=name;
    button.textContent=tabLabels[name];
    button.setAttribute("role","tab");
    button.setAttribute("aria-label",tabAria[name]);
    button.addEventListener("click",()=>setWorkspace(name));
    tabBar.appendChild(button);
    tabs.set(name,button);
  }
  deck.prepend(tabBar);

  const chopperActionRow=document.createElement("div");
  chopperActionRow.id="mobileChopperActionRow";
  chopperActionRow.className="mobileChopperRow mobileChopperActionRow";
  chopperActionRow.style.cssText="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;grid-column:1/-1;min-width:0;width:100%";

  const spCell=document.createElement("div");
  spCell.id="mobileChopperSpCell";
  spCell.className="mobileChopperSpCell";
  spCell.style.cssText="display:flex;gap:3px;min-width:0";
  chopperActionRow.appendChild(spCell);

  const chopperBankRow=document.createElement("div");
  chopperBankRow.id="mobileChopperBankRow";
  chopperBankRow.className="mobileChopperRow mobileChopperBankRow";
  chopperBankRow.style.cssText="display:flex;align-items:center;gap:5px;grid-column:1/-1;min-width:0;width:100%";

  const chopperParamRow=document.createElement("div");
  chopperParamRow.id="mobileChopperParamRow";
  chopperParamRow.className="mobileChopperRow mobileChopperParamRow";
  chopperParamRow.style.cssText="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:start;gap:5px;grid-column:1/-1;min-width:0;width:100%";

  screen.prepend(chopperParamRow);
  screen.prepend(chopperBankRow);
  screen.prepend(chopperActionRow);

  const sequenceFooter=document.createElement("div");
  sequenceFooter.id="mobileSequenceFooter";
  sequenceFooter.className="mobileSequenceFooter";
  sequenceFooter.hidden=true;
  sequenceFooter.style.cssText="display:flex;flex-direction:column;align-items:stretch;gap:7px;margin-top:10px";

  const sequenceTransport=document.createElement("div");
  sequenceTransport.id="mobileSequenceTransport";
  sequenceTransport.className="padTransport mobileSequenceTransport";
  sequenceTransport.setAttribute("role","group");
  sequenceTransport.setAttribute("aria-label","Transport du séquenceur");
  sequenceTransport.style.setProperty("grid-template-columns","repeat(2,76px)","important");
  sequenceTransport.style.setProperty("width","100%","important");
  sequenceTransport.style.setProperty("margin","0","important");
  sequenceTransport.style.setProperty("justify-content","center","important");
  sequenceFooter.appendChild(sequenceTransport);
  sequence.appendChild(sequenceFooter);

  const loadButton=document.getElementById("loadSampleBtn");
  const autoButton=document.getElementById("autoMarkers");
  const previewButton=document.getElementById("previewFlip");
  const stopButton=document.getElementById("stopFlip");
  const saveButton=document.getElementById("addFlipLibrary");
  const pitchControl=root.querySelector(".samplePitchKnob");
  const tempoControl=root.querySelector(".sampleTempoControl");
  const volumeControl=root.querySelector(".sampleVolumeKnob");
  const punchControl=root.querySelector(".punchKnob");
  const modeButton=document.getElementById("sliceEditModeBtn");

  for(const element of [loadButton,autoButton,previewButton,stopButton,saveButton,pitchControl,tempoControl,volumeControl,punchControl,modeButton])rememberHome(element);

  const bpmInput=document.getElementById("sampleBpm");
  const tempoBody=root.querySelector(".sampleTempoControl > div");
  const tempoKnob=document.createElement("div");
  tempoKnob.id="mobileTempoKnob";
  tempoKnob.className="sampleKnobControl mobileTempoKnobControl";
  tempoKnob.innerHTML='<span class="sampleKnobFace" aria-hidden="true"></span>';
  const bpmReadout=document.createElement("span");
  bpmReadout.id="sampleBpmReadout";
  bpmReadout.className="sampleKnobReadout mobileTempoReadout";
  if(tempoBody && bpmInput)tempoBody.append(tempoKnob,bpmReadout);

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

  function syncKnob(input,target,owner,readout,format){
    const min=numeric(input.min,0);
    const max=numeric(input.max,min+1);
    const value=clampInputValue(input,numeric(input.value,min));
    const pct=max===min?0:(value-min)/(max-min)*100;
    owner?.style.setProperty("--knob-pct",String(pct));
    if(mobileMedia.matches){
      target.setAttribute("aria-valuenow",String(value));
      target.setAttribute("aria-valuetext",format(value));
    }
    if(readout)readout.textContent=format(value);
  }

  function bindRotary({inputId,target,owner,readout=null,pixelsPerStep,step,format}){
    const input=document.getElementById(inputId);
    if(!input || !target)return;

    const syncAccessibility=()=>{
      if(mobileMedia.matches){
        target.tabIndex=0;
        target.setAttribute("role","slider");
        target.setAttribute("aria-label",input.getAttribute("aria-label") || inputId);
        target.setAttribute("aria-valuemin",input.min);
        target.setAttribute("aria-valuemax",input.max);
        target.title="Glisser verticalement pour régler";
        input.tabIndex=-1;
      }else{
        target.removeAttribute("tabindex");
        target.removeAttribute("role");
        target.removeAttribute("aria-label");
        target.removeAttribute("aria-valuemin");
        target.removeAttribute("aria-valuemax");
        target.removeAttribute("aria-valuenow");
        target.removeAttribute("aria-valuetext");
        target.removeAttribute("title");
        input.removeAttribute("tabindex");
      }
    };
    accessibilitySyncers.push(syncAccessibility);

    let activeSource=null;
    let startY=0;
    let startValue=0;
    let changed=false;
    let moved=false;

    const sync=()=>syncKnob(input,target,owner,readout,format);
    const startGesture=(y,source)=>{
      if(!mobileMedia.matches)return false;
      if(activeSource)return activeSource===source;
      activeSource=source;
      startY=y;
      startValue=numeric(input.value);
      changed=false;
      moved=false;
      return true;
    };
    const moveGesture=(y,source)=>{
      if(activeSource!==source)return false;
      const delta=startY-y;
      if(!moved && Math.abs(delta)<5)return false;
      moved=true;
      const steps=Math.round(delta/Math.max(1,pixelsPerStep));
      if(setInputValue(input,startValue+steps*step))changed=true;
      sync();
      return true;
    };
    const finishGesture=source=>{
      if(activeSource!==source)return;
      if(changed)input.dispatchEvent(new Event("change",{bubbles:true}));
      activeSource=null;
      changed=false;
      moved=false;
    };

    target.addEventListener("touchstart",event=>{
      if(event.touches.length===1)startGesture(event.touches[0].clientY,"touch");
    },{passive:true});
    target.addEventListener("touchmove",event=>{
      if(event.touches.length!==1)return;
      if(moveGesture(event.touches[0].clientY,"touch") && event.cancelable)event.preventDefault();
    },{passive:false});
    target.addEventListener("touchend",()=>finishGesture("touch"));
    target.addEventListener("touchcancel",()=>finishGesture("touch"));

    target.addEventListener("pointerdown",event=>{
      if(event.isPrimary===false || event.pointerType==="touch" || (event.pointerType==="mouse" && event.button!==0))return;
      if(!startGesture(event.clientY,"pointer"))return;
      try{target.setPointerCapture(event.pointerId);}catch{}
    });
    target.addEventListener("pointermove",event=>{
      if(moveGesture(event.clientY,"pointer") && event.cancelable)event.preventDefault();
    });
    target.addEventListener("pointerup",()=>finishGesture("pointer"));
    target.addEventListener("pointercancel",()=>finishGesture("pointer"));

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
      sync();
    });

    input.addEventListener("input",sync);
    syncAccessibility();
    sync();
  }

  bindRotary({inputId:"samplePitch",target:root.querySelector(".samplePitchKnob .sampleKnobControl"),owner:pitchControl,readout:document.getElementById("samplePitchReadout"),pixelsPerStep:18,step:1,format:value=>`${value>0?"+":""}${Math.round(value)} st`});
  bindRotary({inputId:"sampleBpm",target:tempoKnob,owner:tempoBody,readout:bpmReadout,pixelsPerStep:3,step:1,format:value=>`${Math.round(value)} BPM`});
  bindRotary({inputId:"sampleVolume",target:root.querySelector(".sampleVolumeKnob .sampleKnobControl"),owner:volumeControl,readout:document.getElementById("sampleVolumeReadout"),pixelsPerStep:2,step:1,format:value=>`${Math.round(value)}%`});

  const punchInput=document.getElementById("punchMode");
  const punchTarget=document.getElementById("punchDesc");
  const punchLabels=["OFF","WARM","KNOCK","HARD"];
  if(punchInput && punchTarget){
    const syncPunchAccessibility=()=>{
      if(mobileMedia.matches){
        punchTarget.tabIndex=0;
        punchTarget.setAttribute("role","button");
        punchTarget.setAttribute("aria-label","Changer le mode PUNCH");
        punchInput.tabIndex=-1;
      }else{
        punchTarget.removeAttribute("tabindex");
        punchTarget.removeAttribute("role");
        punchTarget.removeAttribute("aria-label");
        punchInput.removeAttribute("tabindex");
      }
    };
    accessibilitySyncers.push(syncPunchAccessibility);
    syncPunchAccessibility();

    const cyclePunch=()=>{
      if(!mobileMedia.matches)return;
      const min=numeric(punchInput.min,0);
      const max=numeric(punchInput.max,3);
      const current=numeric(punchInput.value,min);
      const next=current>=max?min:current+1;
      punchInput.value=String(next);
      punchInput.dispatchEvent(new Event("input",{bubbles:true}));
      punchInput.dispatchEvent(new Event("change",{bubbles:true}));
      punchTarget.textContent=punchLabels[next]||String(next);
    };
    punchTarget.addEventListener("click",cyclePunch);
    punchTarget.addEventListener("keydown",event=>{
      if(event.key!=="Enter" && event.key!==" ")return;
      event.preventDefault();
      cyclePunch();
    });
  }

  function hide(node,value){node?.classList.toggle(HIDDEN_CLASS,Boolean(value));}

  function restoreWave(){
    if(waveWrap.parentNode===waveHome)return;
    if(waveNext?.parentNode===waveHome)waveHome.insertBefore(waveWrap,waveNext);
    else waveHome.appendChild(waveWrap);
  }

  function moveWaveToPads(){if(waveWrap.parentNode!==pads)pads.insertBefore(waveWrap,padGrid);}

  function setControlItemStyle(element,active){
    if(!element)return;
    if(active){
      element.style.setProperty("grid-area","auto","important");
      element.style.minWidth="0";
    }else{
      element.style.removeProperty("grid-area");
      element.style.removeProperty("min-width");
    }
  }

  function syncChopperRows(){
    if(!mobileMedia.matches)return;
    if(loadButton){chopperActionRow.insertBefore(loadButton,spCell);loadButton.style.width="100%";loadButton.style.minWidth="0";}
    if(autoButton){chopperActionRow.insertBefore(autoButton,spCell);autoButton.style.width="100%";autoButton.style.minWidth="0";}

    const spButton=document.getElementById("sp1200Toggle");
    const filterButton=document.getElementById("sp1200FilterToggle");
    if(spButton){spCell.appendChild(spButton);spButton.style.flex="1 1 auto";spButton.style.minWidth="0";}
    if(filterButton){spCell.appendChild(filterButton);filterButton.style.flex="0 0 auto";}

    const bankTabs=document.getElementById("chopperBankTabs");
    if(bankTabs){chopperBankRow.appendChild(bankTabs);bankTabs.style.flex="1 1 auto";bankTabs.style.minWidth="0";}
    if(modeButton){chopperBankRow.appendChild(modeButton);modeButton.style.flex="0 0 auto";}

    for(const control of [tempoControl,pitchControl,volumeControl,punchControl]){
      if(!control)continue;
      chopperParamRow.appendChild(control);
      setControlItemStyle(control,true);
    }
  }

  function resetMovedStyles(){
    for(const element of [loadButton,autoButton]){element?.style.removeProperty("width");element?.style.removeProperty("min-width");}
    for(const control of [tempoControl,pitchControl,volumeControl,punchControl])setControlItemStyle(control,false);
    modeButton?.style.removeProperty("flex");
    const bankTabs=document.getElementById("chopperBankTabs");
    if(bankTabs){bankTabs.style.removeProperty("flex");bankTabs.style.removeProperty("min-width");}
    for(const button of [document.getElementById("sp1200Toggle"),document.getElementById("sp1200FilterToggle")]){button?.style.removeProperty("flex");button?.style.removeProperty("min-width");}
  }

  function restoreDesktopLayout(){
    restoreWave();
    for(const element of [loadButton,autoButton,pitchControl,tempoControl,volumeControl,punchControl,modeButton,previewButton,stopButton,saveButton])restoreHome(element);
    resetMovedStyles();

    const bankTabs=document.getElementById("chopperBankTabs");
    const spButton=document.getElementById("sp1200Toggle");
    const filterButton=document.getElementById("sp1200FilterToggle");
    if(bankTabs && waveActions)waveActions.insertBefore(bankTabs,spButton||filterButton||null);
    if(spButton && waveActions)waveActions.appendChild(spButton);
    if(filterButton && waveActions)waveActions.appendChild(filterButton);

    screen.style.removeProperty("grid-template-columns");
    screen.style.removeProperty("grid-template-areas");
    waveWrap.style.removeProperty("grid-area");
    waveWrap.style.removeProperty("grid-column");
    hide(screenTitle,false);
    hide(advanced,false);
  }

  function syncSequenceFooter(){
    const active=mobileMedia.matches && workspace==="sequence";
    sequenceFooter.hidden=!active;
    if(active){
      if(previewButton)sequenceTransport.appendChild(previewButton);
      if(stopButton)sequenceTransport.appendChild(stopButton);
      if(saveButton){sequenceFooter.appendChild(saveButton);saveButton.style.width="100%";saveButton.style.margin="0";}
    }else{
      restoreHome(previewButton);restoreHome(stopButton);restoreHome(saveButton);
      saveButton?.style.removeProperty("width");saveButton?.style.removeProperty("margin");
    }
  }

  function applyWorkspace(){
    const mobile=mobileMedia.matches;
    tabBar.hidden=!mobile;
    if(mobile)tabBar.style.setProperty("display","grid","important");
    else tabBar.style.removeProperty("display");
    chopperActionRow.hidden=!mobile;
    chopperBankRow.hidden=!mobile;
    chopperParamRow.hidden=!mobile;
    tempoKnob.hidden=!mobile;
    bpmReadout.hidden=!mobile;
    if(bpmInput)bpmInput.style.display=mobile?"none":"";
    accessibilitySyncers.forEach(sync=>sync());

    if(!mobile){
      root.removeAttribute("data-mobile-workspace");
      for(const node of [upper,performance,pads,sequence,drums])hide(node,false);
      syncSequenceFooter();
      restoreDesktopLayout();
      return;
    }

    root.dataset.mobileWorkspace=workspace;
    for(const [name,button] of tabs){
      const selected=name===workspace;
      button.setAttribute("aria-selected",selected?"true":"false");
      button.classList.toggle("active",selected);
    }

    screen.style.setProperty("grid-template-columns","minmax(0,1fr)","important");
    screen.style.setProperty("grid-template-areas","none","important");
    hide(screenTitle,true);
    hide(advanced,true);

    if(workspace==="pads"){
      waveWrap.style.removeProperty("grid-area");
      waveWrap.style.removeProperty("grid-column");
      moveWaveToPads();
    }else{
      restoreWave();
      waveWrap.style.setProperty("grid-area","auto","important");
      waveWrap.style.setProperty("grid-column","1 / -1","important");
    }

    syncChopperRows();
    syncSequenceFooter();
    hide(upper,workspace!=="chopper");
    hide(performance,workspace!=="pads" && workspace!=="sequence");
    hide(drums,workspace!=="drums");
    hide(pads,workspace!=="pads");
    hide(sequence,workspace!=="sequence");

    requestAnimationFrame(()=>{
      if((workspace==="chopper" || workspace==="pads") && typeof drawWave==="function")drawWave();
      if(workspace==="sequence" && typeof renderSampleTimeline==="function")renderSampleTimeline();
    });
  }

  function setWorkspace(name){
    workspace=workspaceNames.includes(name)?name:"chopper";
    applyWorkspace();
    return workspace;
  }

  const lateControls=new MutationObserver(()=>{
    if(!document.getElementById("sp1200Toggle") || !document.getElementById("sp1200FilterToggle"))return;
    if(mobileMedia.matches)syncChopperRows();
    else restoreDesktopLayout();
    lateControls.disconnect();
  });
  lateControls.observe(root,{childList:true,subtree:true});

  if(typeof mobileMedia.addEventListener==="function")mobileMedia.addEventListener("change",applyWorkspace);
  else mobileMedia.addListener(applyWorkspace);
  applyWorkspace();

  globalThis.ChopperMobileControls=Object.freeze({
    get active(){return mobileMedia.matches;},
    get workspace(){return workspace;},
    setWorkspace,
    refresh:applyWorkspace
  });
})();
