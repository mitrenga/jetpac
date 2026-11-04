# Protokol mezi `gameModel.js` a `gameWorker.js`

Worker drží herní stav a tiká; model do něj posílá jen vstupy a kreslí to,
co dostane zpátky.

## ★ Tik je 50 Hz, a je to vědomá odchylka

Originál **na snímek nečeká** a má **dvě kola**
(`sources/docs/disasm_notes.md` §3b):

| kolo | co obchází | jak často |
|---|---|---|
| krátké | Jetman, čtyři střely, zvuk | **jednou za snímek** |
| dlouhé | raketa, předměty, nepřátelé | **jednou za 28 až 57 ms** podle počtu nepřátel |

Remake pouští krátké kolo **jednou za tik** (50 Hz = 19,97 ms — na Jetmanovi
je tedy přesný) a dlouhé **jednou za 55 ms** (`LONG_ROUND_MS`; jde přebít
klíčem `longRoundMs` v `data/cadence.json`, který chodí v `initData.cadence`).
★ **Celý násobek tiku se tam dávat nesmí** — hra se ptá počítadla `$5DCC`
na zbytky a při periodě tří tiků přestane padat palivo (`ZADANI.md` §10).
Ve zprávě `frame` posílá zpátky `longRounds`, takže se perioda dá
zkontrolovat zvenku (`tools/runworker.js` to dělá).

★ **Je to jedna perioda záměrně.** Originál se při náloži zadrhne (57 ms) a na
prázdné obrazovce zrychlí (28 ms); remake má běžet plynule, a tak drží jedno
číslo, zaokrouhlené z toho, co vychází při hře (`ZADANI.md` §10).

## ★ Stav je stav originálu

**Sedmnáct záznamů po osmi bajtech**, `$5D00`–`$5D87`, obcházené v pořadí slotů
a rozeskakované tabulkou osmnácti obsluh podle `typ & $3F` (`$6374`). Sloty
nejsou zaměnitelné:

| slot | adresa | co to je |
|---|---|---|
| 0 | `$5D00` | **Jetman** |
| 1–4 | `$5D08`–`$5D20` | **čtyři laserové střely** |
| 5 | `$5D28` | **zvuk** (typ 12 nebo 13) |
| 6 | `$5D30` | **raketa** |
| 7, 8 | `$5D38`, `$5D40` | **dva předměty** (díl rakety, palivo, poklad) |
| 9–16 | `$5D48`–`$5D80` | **nepřátelé** |

Záznam: `+0` typ (bit 6 = kouká doleva, bit 7 příznak), `+1` x, `+2` y,
`+3` atribut, `+4` příznaky, `+5` a `+6` rychlost a zlomek, `+7` výška pro
kolizi.

**Souřadnice jsou souřadnice stroje**: `x` je levý okraj spritu, `y` jeho
**spodní** pixelová řádka. ★ Že je `y` spodní řádka, plyne z kreslení originálu
(`$72EE` dělá `DEC H`, jde tedy vzhůru) a ověřuje to `tools/matchscreen.js`.

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, players, lives, lives2, hiScore, level, global}` | start nové hry. `headless: true` tiká jen na vyžádání zprávou `tick` (pro `tools/runworker.js`). |
| `controls` | `left`, `right`, `thrust`, `fire` (boolean) | úplný stav ovládání; posílá se při každé změně a **celý**, protože let doleva se zapnutou tryskou není konflikt. |
| `pause` | – | zastaví tikání. |
| `continue` | – | pokračuje. |
| `tick` | – | jeden průchod v režimu `headless`. |
| `reset` | – | zahodí stav (volá se při opuštění herní obrazovky). |

### `initData`

| klíč | obsah |
|---|---|
| `players` | 1 nebo 2 — volba z menu, v originálu bit 0 bajtu `$5CF3`. |
| `lives` | zásoba životů. ★ **Čtyři**: `$6316` zapíše `4` do `$5DF1` a přesně to ukazuje panel (`data/global.json`). |
| `lives2` | ★ **Pět** pro druhého hráče (`$6324`). |
| `hiScore` | nejvyšší skóre. ★ Originál žádnou vlastní síň slávy nemá, takže začíná na nule — na rozdíl od Sabre Wulfa, který si nese 102275. |
| `level` | číslo kola (`$5DF0`, počítá se od nuly). Rozhoduje, který nepřítel přiletí (`$6A64`), jak vypadá raketa a jaké jsou grafiky dílů. |
| `global` | `data/global.json` — **šablony záznamů entit**, které si hra kopíruje na začátku života (`$6010` Jetman, `$6018` raketa a dva díly), a konstanty (`tools/mkglobal.py`). |

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `pass`, `level`, `startDelay`, `entities[]`, `panel`, `controls`, `sounds[]` | jeden průchod. Posílá se po každém tiku. |
| `gameOver` | `score` | konec hry (M4/M5). |
| `error` | `message` | chybějící data nebo rozbitý stav. |

### `frame`

| klíč | obsah |
|---|---|
| `pass` | počítadlo průchodů (v originálu `$5DCC`). |
| `startDelay` | ★ odpočet na začátku života: **`$80` průchodů** pro jednoho hráče, **`$FF`** pro dva (`$619A`). Dokud běží, **Jetman se nekreslí** a nápis hráče, který je na tahu, **bliká** (`$61BD` nastaví bit 7 třem buňkám atributů, `$61D3` ho zase shodí). Composer to bere přímo z tohohle čísla. |
| `entities[]` | `{slot, type, left, x, y, attr, flags, raw}` pro všech sedmnáct slotů; `raw` je těch osm bajtů, jak leží v originálu. |
| `panel` | `{score, score2, hiScore, lives, lives2, player}`. |
| `controls` | stav ovládání, jak ho worker vidí — v dev režimu ho model vypisuje do rohu, takže je vidět, že klávesnice, gamepad i dotyk dorazily. |
| `sounds[]` | co se má přehrát (M6). |

## ★ Na pořadí kreslení záleží

Originál kreslí **přírůstkově** (`$726A`: smaž na staré pozici, nakresli na
nové) a atributy **nemaže nikdy**, takže kdo kreslí později, ten přebarví
buňky pod sebou. A krátké kolo se do dlouhého **vklíňuje uprostřed**:
`$6351` se ptá před každou entitou, jestli se překlopil snímek. Jetman se
tedy v originálu kreslí mezi zvířaty, a klidně **dvakrát za jedno dlouhé
kolo**.

Remake to má jednodušší: za jeden tik pustí **jedno krátké kolo a pak
případně jedno dlouhé**, a právě v tomhle pořadí to kreslí i
`ScreenComposer.stepInto()`, když mu zpráva `frame` neřekne jinak. Pole
`shortRounds` a `shortStates` proto worker **neposlílá** — plní je jen
`tools/matchtrail.js` ze záznamu originálu, aby se dalo porovnávat i to
prokládání. Podrobně `sources/docs/disasm_notes.md` §14.

## Stav

**M1: worker tiká, drží stav a nic nehýbe.** Fyzika Jetmana je M3, raketa
a předměty M4, nepřátelé M5, zvuk M6 — a každý z nich dorazí s vlastním
`match*` nástrojem, který ho porovná s originálem. To, že tabulka entit má
tvar originálu, je právě proto, aby porovnání mělo co s čím srovnávat.

Hlídá to `tools/runworker.js`: projde celý protokol bez prohlížeče a kontroluje
mimo jiné, že na začátku života stojí Jetman i raketa tam, kde je má originál,
a že odpočet je `$80`, respektive `$FF`.
