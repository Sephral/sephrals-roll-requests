import {MODULE_ID, t} from "./config.mjs";
import {openRequestWindow} from "./request-app.mjs";
import {countFeature} from "./usage.mjs";

/**
 * The tokens a click on the HUD asks: all selected ones when the clicked token is one of several, else only it.
 * @param {Token|TokenDocument} clicked
 * @returns {TokenDocument[]}
 */
export function hudTargets(clicked) {
  const document = clicked?.document ?? clicked;
  const selected = (canvas?.tokens?.controlled ?? []).map(token => token.document);
  const list = (selected.length > 1) && selected.some(doc => doc.id === document?.id) ? selected : [document];
  return list.filter(doc => doc?.actor);
}

/**
 * Hook "renderTokenHUD": a button that opens the request window for this token or the selected ones (GM).
 * @param {foundry.applications.hud.TokenHUD} hud
 * @param {HTMLElement} element
 */
export function onRenderTokenHUD(hud, element) {
  if ( !game.user?.isGM ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const column = root?.querySelector(".col.left") ?? root?.querySelector(".col.right");
  if ( !column || column.querySelector(".srr-hud-button") || !hud.document?.actor ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon srr-hud-button";
  button.dataset.tooltip = t("SRR.Hud.button");
  button.setAttribute("aria-label", t("SRR.Hud.button"));
  button.innerHTML = '<i class="fa-solid fa-dice-d20" inert></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const tokens = hudTargets(hud.document);
    if ( !tokens.length ) return;
    countFeature(MODULE_ID, "requestFromHud");
    hud.close?.();
    openRequestWindow({actors: tokens});
  });
  column.append(button);
}

/**
 * Hook "getActorContextOptions": an entry in the context menu of the actor directory (GM).
 * @param {ApplicationV2} app
 * @param {object[]} entries
 */
export function onActorContextOptions(app, entries) {
  const actorOf = li => game.actors.get(li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.data?.("documentId"));
  const visible = li => !!game.user?.isGM && !!actorOf(li);
  const open = li => {
    const actor = actorOf(li);
    if ( !actor ) return;
    countFeature(MODULE_ID, "requestFromDirectory");
    openRequestWindow({actors: [actor]});
  };
  // Both key sets: Foundry 13 only reads the old names, Foundry 14 warns on them until it drops them in 16
  entries.push({
    name: "SRR.Hud.entry",
    label: "SRR.Hud.entry",
    icon: '<i class="fa-solid fa-dice-d20"></i>',
    condition: visible,
    visible,
    callback: open,
    onClick: (event, li) => open(li)
  });
}
