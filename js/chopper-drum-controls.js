"use strict";

// Branch-only Chopper composition: keep the existing control IDs/handlers, but
// place each action next to the surface it actually controls.
(() => {
  const root=document.getElementById("chopper");
  const screen=root?.querySelector(".samplerScreenModule");
  const controls=root?.querySelector(".samplerControlModule");
  const waveTitle=screen?.querySelector(":scope > .stableTitle");
  const padsTitle=root?.querySelector(".samplerPadsModule .samplerSectionTitle");
  const sequenceHead=root?.querySelector(".samplerSequenceHead");
  if(!root || !screen || !controls || !waveTitle || !padsTitle || !sequenceHead)return;

  // Waveform actions: loading and automatic chopping belong where the sample is edited.
  const waveActions=document.createElement("span");
  waveActions.className="waveHeaderActions";
  waveActions.setAttribute("role","group");
  waveActions.setAttribute("aria-label","Sample waveform actions");
  for(const id of ["loadSampleBtn","autoMarkers"]){
    const button=document.getElementById(id);
    if(button)waveActions.appendChild(button);
  }
  waveTitle.querySelector("span:not(.titleMeta)")?.remove();
  waveTitle.insertBefore(waveActions,waveTitle.firstChild);

  // Performance transport: PLAY = sequence + drums, DRUMS = drums only for pad
  // audition, STOP = global stop. Keep all three directly above the pads.
  const padTransport=document.createElement("span");
  padTransport.className="padTransport";
  padTransport.setAttribute("role","group");
  padTransport.setAttribute("aria-label","Pad performance transport");
  for(const id of ["previewFlip","playDrumsOnly","stopFlip"]){
    const button=document.getElementById(id);
    if(button)padTransport.appendChild(button);
  }
  padsTitle.appendChild(padTransport);

  // SAVE belongs to the sequence it renders; CLEAR already lived here.
  const sequenceActions=document.createElement("div");
  sequenceActions.className="sequenceActions";
  sequenceActions.setAttribute("role","group");
  sequenceActions.setAttribute("aria-label","Sequence actions");
  for(const id of ["addFlipLibrary","clearGrid"]){
    const button=document.getElementById(id);
    if(button)sequenceActions.appendChild(button);
  }
  sequenceHead.appendChild(sequenceActions);

  const fineSettings=controls.querySelector(".advancedBox");
  const chopStatus=document.getElementById("chopStatus");
  const saveStatus=document.getElementById("beatSaveStatus");
  const statusStrip=document.createElement("div");
  statusStrip.className="chopperStatusStrip";

  const wireStatus=(node,{clearInitial=false}={})=>{
    if(!node)return;
    if(clearInitial)node.textContent="";
    const sync=()=>{
      const text=node.textContent.trim();
      node.hidden=!text || text==="READY";
    };
    sync();
    new MutationObserver(sync).observe(node,{childList:true,subtree:true,characterData:true});
    statusStrip.appendChild(node);
  };

  // Keep real action feedback, but remove permanent idle READY labels.
  wireStatus(chopStatus,{clearInitial:chopStatus?.textContent.trim()==="READY"});
  if(saveStatus?.textContent.includes("SAVE rend"))saveStatus.textContent="";
  wireStatus(saveStatus);

  if(fineSettings)screen.insertBefore(fineSettings,waveTitle);
  screen.appendChild(statusStrip);

  // One hardware row owns resolution, snare reverb, regeneration and clear.
  const drumQuickActions=root.querySelector(".drumQuickActions");
  const drumEditView=document.getElementById("drumEditView");
  const clearDrums=document.getElementById("clearDrumEdits");
  if(drumQuickActions){
    if(drumEditView)drumQuickActions.insertBefore(drumEditView,drumQuickActions.firstChild);
    if(clearDrums)drumQuickActions.appendChild(clearDrums);
    drumQuickActions.setAttribute("aria-label","Résolution, snare reverb et actions de batterie");
  }

  // Hidden inputs remain available to their existing handlers after the old
  // control frame is removed.
  for(const id of ["sampleFile","waveZoom"]){
    const input=document.getElementById(id);
    if(input)root.appendChild(input);
  }

  root.querySelector(".samplerTopRail")?.remove();
  root.querySelector(".sampleConditionHelp")?.remove();
  root.querySelectorAll(".samplerModuleHint,.spaceHint,.samplerControlLegend,.drumEditHead .help,.titleMeta").forEach(node=>node.remove());
  root.querySelector(".samplerDisplayActions")?.remove();
  controls.remove();
})();
