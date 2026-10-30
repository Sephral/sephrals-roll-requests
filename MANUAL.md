# Sephral’s Roll Requests: Manual

Roll Requests lets the GM ask a group of characters for the same roll. Each request is a card in the chat that collects the results while the players roll.

## For the GM

### Making a request

Open the request window with the d20 in the token controls, with Alt+R, or from a macro. The window starts with the values of your last request.

| Field | Does |
| --- | --- |
| Who rolls | Starts with the selected tokens, otherwise with all player characters. *Selected tokens* and *Player characters* fill the list again, *None* clears the checks. Drag actors from the sidebar or tokens onto the window to add them. A token that is not linked to its actor rolls as itself. |
| Roll | The saving throws, ability checks, skills and tools of the game system, or *Own formula*. |
| Formula, Name | Only for an own formula, for example `1d20 + @abilities.dex.mod`. The name is shown on the card. |
| DC | Optional. In Savage Worlds it is the target number, 4 when you leave it empty. |
| Players see the DC | Off keeps the DC on your side. Players then see no pass or fail either. |
| Hint | Advantage or disadvantage in D&D 5e, fortune or misfortune in Pathfinder 2e. The roll starts with it, players can still change it in the roll dialog. |
| Results | *Public*: everyone sees the rolls and the card. *GM only*: players see their own rolls, the other results are yours. *Blind*: nobody but the GM sees the results, not even the player who rolled. |
| Note | Optional text on the card, such as “The bridge sways”. |
| Group check | The card tells whether the group succeeds: at least half of the characters must succeed. |
| Roll for characters without a player at once | NPCs and other characters no player owns roll right away, without a dialog. |

### The card

The card lists every character with its result. As the GM you see every total, pass or fail and the summary, whatever the request hides from the players.

* **Roll** next to a character rolls for it. Your rolls skip the system's roll dialog (setting *Your rolls skip the dialog*), Shift turns that around for one roll.
* **Roll the rest** rolls for every character that has not rolled yet.
* **Roll again** (the arrow next to a result) takes the result back, so the character can roll once more.
* A reroll with a hero point (Pathfinder 2e) or a benny (Savage Worlds) replaces the result of that character, when it comes from the same player or a GM. The reroll keeps the visibility of the request.
* When two requests wait for the same character, each roll goes to the request that asked for that kind of roll.

A natural 20 and a natural 1 are marked in d20 systems. Pathfinder 2e shows the four degrees of success, Savage Worlds counts raises, Crucible judges like the system: above the DC is a success, by more than 6 a critical one (or the margin the check itself carries).

## For players

When the GM asks one of your characters to roll, a small window with a roll button opens and the card in the chat shows the same button. The roll is your game system's normal roll with its dialog, so you can add a situational bonus as usual. The window closes when everything is rolled. If you closed it, *Open my roll window* (a key you can set in Foundry's controls) or the button on the card brings it back.

What you see on the card depends on the request: in public requests every total, in GM-only requests your own totals, in blind requests only that a character has rolled. Pass and fail show only when the GM shares the DC.

## Game systems

| System | Rolls |
| --- | --- |
| D&D 5e (5.x and 6.x) | Saving throws, ability checks, skills, tools |
| Pathfinder 2e | Perception, saving throws, skills (lore skills with an own formula such as `1d20 + @actor.skills.warfare-lore.mod`) |
| Savage Worlds (SWADE) | Attributes, skills (the core skills and the skills of the characters). A character without the skill makes an unskilled attempt |
| Crucible | Skills |
| Any other system | Own formulas with the character's roll data |

With a hidden DC, D&D 5e and Pathfinder 2e roll without it, so their own chat cards show no success. Crucible then judges its card against its default DC, the Roll Requests card judges against yours.

## Keys

| Key | Does |
| --- | --- |
| Alt+R | Opens the request window (GM) |
| none | *Open my roll window* (players) |

Both can be changed in Foundry's *Configure Controls*.

## Settings

| Setting | Who | Does |
| --- | --- | --- |
| Module language | everyone | German or English for this module, or like Foundry |
| Look | everyone | *Signature* (warm and light) or *Foundry* (dark) for the windows and cards |
| Open a roll window | everyone | Opens the small roll window when a request for your characters arrives |
| Sound with a request | everyone | Plays Foundry's notification sound with a new request |
| Your rolls skip the dialog | GM | GM rolls from the card skip the system's roll dialog |
| Button in the token controls | GM | Shows the d20 in the token controls |
| Run self test | GM | Checks what the module needs from Foundry and the system and reports in the chat |
| Save debug file | GM | See below |

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Roll Requests it holds:

* on how many of the last 30 days the module was used
* how often the GM makes requests, group checks and requests with an own formula, and how often the GM rolls for a character
* the settings *Look*, *Open a roll window*, *Sound with a request* and *Your rolls skip the dialog* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, formulas, notes, results or other content of the world are sent, and nothing the players do is counted.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. It holds the versions of Foundry, the system and the active modules, the settings of the modules and what they recorded, for Roll Requests the open requests with their results and the recent steps: requests made, rolls marked as answers, results written or refused. Macros call `game.modules.get("sephrals-roll-requests").api.saveDebugFile()`.

The file contains chat text and whispers. Check it before you share it.

## Storage

Each request lives in its chat message. Deleting the card deletes the request. The card holds the DC and all results, also when players do not see them on the card: the hiding happens in each player's browser, someone who reads the chat data in the browser console can find them.

## Compatibility

* Foundry VTT 13 and 14.
* The rolls are the game system's own, so Dice So Nice, Roll Breakdown, Midi-QOL and other modules that watch rolls see them as usual.
* Results reach the card while a GM is online. Rolls made while no GM is there are written into their cards when the next GM joins, and when the active GM leaves another GM takes over.

## API

`game.modules.get("sephrals-roll-requests").api`:

| Function | Does |
| --- | --- |
| `request(options)` | Makes a request (GM) and returns its chat message. `options`: `actors` (actors, tokens or their UUIDs), `type` and `key` (see `rollTypes()`), or `type: "formula"` with `formula` and `label`, plus optional `dc`, `showDc`, `mode` (`"public"`, `"gm"`, `"blind"`), `advantage` (`"normal"`, `"advantage"`, `"disadvantage"`), `group`, `autoRollNpcs`, `note` |
| `openDialog(defaults)` | Opens the request window (GM), optionally with values and `actors` to start with |
| `openPrompt()` | Opens the roll window of this player |
| `rollTypes()` | The rolls of the running system: `[{type, options: [{key, label}]}]` |
| `getRequest(messageOrId)` | A request and its results, or `null` |
| `openRequests()` | The requests in the chat that are not finished |
| `roll(messageId, actorUuid, options)` | Rolls for one character of a request (the GM for anyone, a player for own characters) |
| `rollRemaining(messageId)` | Rolls for every character that has not rolled (GM) |
| `reset(messageId, actorUuid)` | Takes a result back (GM) |
| `runSelfTest()` | The self test (GM) |
| `saveDebugFile()` | Saves the debug file of Sephral’s modules (GM) |

Example:

```js
const api = game.modules.get("sephrals-roll-requests").api;
await api.request({actors: canvas.tokens.controlled, type: "save", key: "dex", dc: 15, group: true});
```

### Hooks

Every client calls these hooks, so a module that changes documents should run its part on one client only, for example `game.user.isActiveGM`. Each hook receives the request in the form of `getRequest`: `id`, `messageId`, `type`, `key`, `formula`, `label`, `dc`, `mode`, `complete`, `passed`, `failed`, `group` and `entries` (each with `actorUuid`, `tokenUuid`, `name` and `result`: `total`, `success`, `degree`, `natural`, `messageId` of the roll, `userId`).

| Hook | When |
| --- | --- |
| `sephrals-roll-requests.requested` | A request was made (only on the GM's client that made it) |
| `sephrals-roll-requests.result` | A character's result arrived or changed (a reroll). Second argument: that entry |
| `sephrals-roll-requests.completed` | Every character has rolled. Again when a result the GM took back was rolled once more |
