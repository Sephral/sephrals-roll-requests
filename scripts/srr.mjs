import {getAdapter, rollGroups} from "./adapters/index.mjs";
import {HOOKS, MODULE_ID, TESTED_VERSIONS, isShown, setting, t} from "./config.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {registerHubModule} from "./hub.mjs";
import {renderCard} from "./card.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {openPrompt, refreshPrompt} from "./prompt-app.mjs";
import {openRequestWindow} from "./request-app.mjs";
import {publicResult} from "./request-model.mjs";
import {createRequest, onCreateChatMessage, onUpdateAnswer, onUpdateChatMessage, openCards, rememberCard, requestOf,
  resetEntry, scheduleCatchUp} from "./requests.mjs";
import {onDeleteChatMessage, onPreCreateChatMessage, rollEntry, rollRemaining} from "./rolling.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {changeLanguage, registerGmSettings, registerSettings} from "./settings.mjs";
import {registerUsage} from "./usage.mjs";

/** The name of the tool in the token controls. */
const TOOL = "srrRequest";

Hooks.once("init", () => {
  registerHubModule({moduleId: MODULE_ID, tested: TESTED_VERSIONS});
  registerSettings({
    language: value => changeLanguage(value, redraw),
    redraw,
    controls: () => ui.controls?.render?.({reset: true})
  });
  // Counted only on the active GM's client, like every Sephral module
  registerUsage(MODULE_ID, {
    features: ["request", "groupCheck", "formula", "gmRoll"],
    settings: ["theme", "promptWindow", "promptSound", "gmFastForward"]
  });
  game.keybindings.register(MODULE_ID, "openRequest", {
    name: "SRR.Keys.openRequest",
    hint: "SRR.Keys.openRequestHint",
    editable: [{key: "KeyR", modifiers: ["Alt"]}],
    restricted: true,
    onDown: () => {
      openRequestWindow();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "openPrompt", {
    name: "SRR.Keys.openPrompt",
    editable: [],
    onDown: () => {
      openPrompt();
      return true;
    }
  });
  registerDebug({adapter: () => getAdapter(), requestOf, openCards});
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderChatMessageHTML", renderCard);
  Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
  Hooks.on("createChatMessage", onCreate);
  Hooks.on("updateChatMessage", onUpdate);
  // A GM who becomes the active GM (the one before left) writes the answers that came meanwhile
  Hooks.on("userConnected", () => scheduleCatchUp());
  Hooks.on("deleteChatMessage", (message, options, userId) => {
    onDeleteChatMessage(message, options, userId);
    if ( requestOf(message) ) refreshPrompt();
  });
  game.modules.get(MODULE_ID).api = {
    /** Ask for rolls (GM): {actors, type, key, formula, label, dc, showDc, mode, advantage, group, autoRollNpcs, note}. */
    request: createRequest,
    /** Open the request window (GM), optionally with values and actors to start with. */
    openDialog: openRequestWindow,
    /** Open the roll window of this player. */
    openPrompt,
    /** The roll choices of the running system. */
    rollTypes: rollGroups,
    /** The request of a card, in the form the hooks hand out, or null. */
    getRequest: messageOrId => {
      const message = typeof messageOrId === "string" ? game.messages.get(messageOrId) : messageOrId;
      const request = requestOf(message);
      return request ? publicResult(request, message.id) : null;
    },
    /** The open requests of the chat log. */
    openRequests: () => openCards().map(m => publicResult(requestOf(m), m.id)),
    /** Roll for one character of a card: the GM for anyone, a player for own characters. */
    roll: (messageId, actorUuid, options={}) => {
      const card = game.messages.get(messageId);
      const entry = requestOf(card)?.entries.find(e => (e.actorUuid === actorUuid) || (e.tokenUuid === actorUuid));
      return entry ? rollEntry(card, entry, options) : Promise.resolve(false);
    },
    /** Roll every open entry of a card (GM). */
    rollRemaining: (messageId, options) => rollRemaining(game.messages.get(messageId), options),
    /** Take a result back so it can be rolled again (GM). */
    reset: (messageId, actorUuid) => {
      const card = game.messages.get(messageId);
      const entry = requestOf(card)?.entries.find(e => (e.actorUuid === actorUuid) || (e.tokenUuid === actorUuid));
      return entry ? resetEntry(card, entry.id) : Promise.resolve();
    },
    /** The names of the hooks this module calls. */
    hooks: {...HOOKS},
    /** Check the module (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM): about one chat message, or without an id the recent state. */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(setting("uiLanguage"));
});

Hooks.once("setup", () => registerGmSettings());

Hooks.once("ready", async () => {
  await languageReady;
  for ( const message of game.messages ) rememberCard(message);
  // The chat log was drawn before "ready" and before the module strings were final
  redraw();
  refreshPrompt();
  noticeNewVersions();
  scheduleCatchUp();
});

/**
 * Hook "createChatMessage": cards reach the players, answers reach the active GM.
 * @param {ChatMessage} message
 */
function onCreate(message) {
  onCreateChatMessage(message);
  if ( !requestOf(message) ) return;
  rememberCard(message);
  refreshPrompt({sound: true});
}

/**
 * Hook "updateChatMessage": results came in, or a roll that answers a card changed.
 * @param {ChatMessage} message
 */
function onUpdate(message) {
  onUpdateAnswer(message);
  if ( !requestOf(message) ) return;
  onUpdateChatMessage(message);
  refreshPrompt({sound: true});
}

/** Draw the cards and the windows again (language or look changed). */
function redraw() {
  for ( const element of document.querySelectorAll(".chat-message[data-message-id]") ) {
    const message = game.messages.get(element.dataset.messageId);
    if ( requestOf(message) ) renderCard(message, element);
  }
  for ( const id of ["srr-request", "srr-prompt"] ) {
    const app = foundry.applications.instances.get(id);
    if ( isShown(app) ) app.render();
  }
}

/**
 * Hook "getSceneControlButtons": the request window in the token controls (GM).
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  if ( !game.user?.isGM ) return;
  try {
    if ( !setting("sceneControl") ) return;
  } catch {}
  const tokens = controls?.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if ( !tokens ) return;
  const tool = {
    name: TOOL,
    title: t("SRR.Request.title"),
    icon: "fa-solid fa-dice-d20",
    button: true,
    visible: true,
    onChange: () => openRequestWindow()
  };
  if ( Array.isArray(tokens.tools) ) tokens.tools.push({...tool, onClick: tool.onChange});
  else {
    tool.order = Object.keys(tokens.tools ?? {}).length;
    tokens.tools[TOOL] = tool;
  }
}
