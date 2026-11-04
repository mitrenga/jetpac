# Data vytažená z originálu

Commituje se. Každý soubor má nástroj, který ho vyrobí — jinak by to nebyl
podklad, ale ruční práce.

| soubor | co v něm je | vyrábí |
|---|---|---|
| `loading.json` | loading screen z kazety (blok SCREEN$ `JPSP`), celá videopaměť `$4000–$5AFF` tak, jak leží v paměti stroje | `tools/mkscreen.py` |
| `sprites.json` | všechny předlohy spritů (`[dx][šířka B][výška][data]`, **data zdola nahoru**), tabulka předsunutých kopií `$76FA`, tabulka předmětů `$67C3`, zdroje pro předsunutí, výbuchy, čtyři plošiny s dlaždicemi a rozvržení panelu | `tools/dumpsprites.py` |
| `sounds.json` | pět zvukových rutin originálu a jejich konstanty (půlvlna, počet vln, sweep laseru); hudba tu není, protože ji hra nemá | `tools/dumpsound.py` |
| `physics.json` | konstanty fyziky Jetmana přečtené **jako operandy instrukcí** (strop rychlostí, strop plochy, spodek, počítadlo chůze); `--check` ověří, že je port drží | `tools/dumpphysics.py` |
| `global.json` | výchozí stav: šablony záznamů entit, které si hra kopíruje na začátku života (`$6010`, `$6018`), čtyři životy a konstanta zrychlení | `tools/mkglobal.py` |
