# Nástroje projektu

Prefixy podle `../../METHODOLOGY.md`: `dump*` (data z originálu),
`trace*` (záznam z běhu), `match*` (porovnání), `mk*` (artefakty),
`*lib` (sdílené).

Spouští se z kořene projektu. SkoolKit 10.1 je **sdílený** ve
`app/svision/sources/skoolkit` (R-008), ne v projektu.

| nástroj | co dělá |
|---|---|
| `jetpaclib.py` | **jedno místo, kde je napsané, co je na kazetě** a jak se z ní skládá obraz paměti (`memory_image()`, `code_image()`, `loading_screen()`) |
| `asmlib.py` | rozebrání kódu: rekurzivní sestup od `$61E5` + mapa pokrytí |
| `tapinfo.py` | vypíše kazetu blok po bloku a zavaděč v BASICu → `sources/docs/tape_layout.md` |
| `mksnapshot.sh` | kazeta → `build/jetpac.z80` + `build/jetpac.bin`; ověří, že kód souhlasí s `jetpaclib.py` |
| `playtrace.py` | běh v simulátoru se skriptovanými klávesami → snímky (PNG + SCR) a mapa pokrytí |
| `mkasm.py` | disassembly → `sources/asm/jetpac.asm` (commituje se) |
| `mkscreen.py` | `.scr` → `data/loading.json` pro variantu spuštění LOAD TAPE |
| `dumpsprites.py` | grafika z originálu → `data/sprites.json` + přehledový PNG |
| `mkglobal.py` | výchozí stav hry (šablony entit, životy, zrychlení) → `data/global.json` |
| `traceframes.py` | referenční snímky z běhu: videopaměť + stav entit ze stejného okamžiku |
| `matchscreen.js` | **obrazovka složená kódem, který jde do prohlížeče, proti videopaměti originálu** — všech 6912 bajtů |
| `matchloading.py` | loading screen: kazeta = `.scr` = `data/loading.json` = paměť simulátoru |
| `matchsnapshot.py` | **snapshot proti kazetě**: je to bajt po bajtu týž program? (umí i obraz sejmutý před přesunem `$6004→$6000`) |
| `runworker.js` | celá smyčka workeru bez prohlížeče (protokol, entity, odpočet startu, cesta ovládání k fyzice) |
| `runplanets.js` | **všech osm planet workerem a composerem**: plošiny musí zůstat celé a ve své barvě (`$766D` má jediného volajícího, takže co se z nich odmaže, je pryč), a na každé planetě se musí objevit ten nepřítel, který jí podle `$6A64` patří |
| `tracephysics.py` | záznam Jetmanova letu z originálu, krok po kroku (11 scénářů + náhodné) |
| `matchphysics.js` | **fyzika kódem, který jde do prohlížeče, proti záznamu** — 10 bajtů na krok |
| `tracewalk.py` | záznam toho, co Jetman dělá na plošině **bez držené klávesy** — každá souřadnice každé plošiny, oba směry pohledu |
| `matchwalk.js` | **šourání po kraji plošiny** (`$7597`) proti tomu záznamu — celý záznam entity po každém kroku |
| `runflame.js` | **oheň z trysek celou animaci** (`ZADANI.md` §10/6): podlaha nedotčená, žádná stopa, plamen hoří, kde má |
| `dumpphysics.py` | konstanty fyziky jako operandy instrukcí → `data/physics.json`, `--check` hlídá port |
| `dumpsound.py` | pět zvukových rutin a jejich konstanty → `data/sounds.json` |
| `traceentities.py` | záznam **celé tabulky entit** z originálu, průchod po průchodu; s `--screens` i **videopaměť ke každému průchodu** |
| `matchentities.js` | svět kódem, který jde do prohlížeče, proti tomu záznamu |
| `matchtrail.js` | **přírůstkové kreslení proti originálu**: videopaměť se přehraje průchod po průchodu (`ScreenComposer.stepInto`) a po každém se porovná všech 6912 bajtů — tím se měří i **barevná stopa**, kterou hra za sebou nechává |
| `cadence.js` | kolik kol originál stihne za snímek (měření, ne porovnání) |
| `tracecadence.py` | **kadence dlouhého kola podle počtu nepřátel** → `data/cadence.json`; tohle číslo používá worker |
| `tracevideo.py` | **měření z videa skutečné hry**: blikání `1UP` (hodiny ULA), chůze Jetmana (krátké kolo), let nepřítele (dlouhé kolo) |
| `tracesound.py` | zvukové rutiny **volané přímo** v simulátoru → časy hran |
| `matchsound.js` | **beeper pulz po pulzu** proti originálu |

Sdílené s ostatními projekty (v `app/svision/tools/retro/`): `skoolkit/`,
`scr2png.py`, `pngread.py`, `png.mjs`.
