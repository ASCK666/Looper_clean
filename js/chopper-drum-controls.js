"use strict";

// Branch-only Chopper composition: keep the existing control IDs/handlers, but
// present them as one compact hardware strip instead of two framed panels.
(() => {
  const root=document.getElementById("chopper");
  const screen=root?.querySelector(".samplerScreenModule");
  const controls=root?.querySelector(".samplerControlModule");
  if(!root || !screen || !controls)return;

  const actionStrip=document.createElement("div");
  actionStrip.className="chopperActionStrip";
  actionStrip.setAttribute("role","group");
  actionStrip.setAttribute("aria-label","Actions du Chopper");

  // Left -> right exactly as requested.
  for(const id of ["loadSampleBtn","autoMarkers","playDrumsOnly","previewFlip","stopFlip","addFlipLibrary"]){
    const button=document.getElementById(id);
    if(button)actionStrip.appendChild(button);
  }

  const fineSettings=controls.querySelector(".advancedBox");
  const chopStatus=document.getElementById("chopStatus");
  const saveStatus=document.getElementById("beatSaveStatus");
  const statusStrip=document.createElement("div");
  statusStrip.className="chopperStatusStrip";
  if(chopStatus)statusStrip.appendChild(chopStatus);
  if(saveStatus){
    // Keep save feedback available when something happens, but do not show a
    // permanent explanatory sentence / duplicate READY state.
    if(saveStatus.textContent.includes("SAVE rend"))saveStatus.textContent="";
    const syncSaveStatus=()=>{
      const text=saveStatus.textContent.trim();
      saveStatus.hidden=!text || text==="READY";
    };
    syncSaveStatus();
    new MutationObserver(syncSaveStatus).observe(saveStatus,{childList:true,subtree:true,characterData:true});
    statusStrip.appendChild(saveStatus);
  }

  screen.insertBefore(actionStrip,screen.firstChild);
  if(fineSettings)screen.insertBefore(fineSettings,actionStrip.nextSibling);
  screen.appendChild(statusStrip);

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
