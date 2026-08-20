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

  // Left -> right. LOAD SAMPLE is intentionally the rightmost action.
  for(const id of ["addFlipLibrary","stopFlip","previewFlip","playDrumsOnly","autoMarkers","loadSampleBtn"]){
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
    if(saveStatus.textContent.includes("SAVE rend"))saveStatus.textContent="READY";
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
  root.querySelectorAll(".samplerModuleHint,.spaceHint,.samplerControlLegend,.drumEditHead .help").forEach(node=>node.remove());
  root.querySelector(".samplerDisplayActions")?.remove();
  controls.remove();
})();