<?php

class DataCommand {

  // Co se posílá při startu aplikace. Jetpac má jednu statickou obrazovku,
  // takže tu nejsou žádné místnosti ani kulisy – stačí grafika a výchozí stav:
  //
  // - `sprites`  – všechno, co se kreslí: 34 předloh spritů, tabulka
  //                předsunutých kopií ($76FA), tabulka předmětů ($67C3),
  //                zdroje pro předsunutí, čtyři plošiny s dlaždicemi a rozvržení
  //                panelu (tools/dumpsprites.py)
  // - `global`   – výchozí záznamy entit, které si hra kopíruje do $5D00
  //                a $5D30, počet životů a konstanta zrychlení (tools/mkglobal.py)
  // - `loading`  – loading screen z kazety pro variantu spuštění LOAD TAPE
  //                (tools/mkscreen.py)
  //
  // - `sounds`   – pět zvukových rutin originálu a jejich konstanty
  //                (tools/dumpsound.py); hudba tu není, protože ji hra nemá
  // - `physics`  – konstanty fyziky Jetmana, přečtené jako operandy instrukcí
  //                (tools/dumpphysics.py)
  //
  // Dohromady necelých 100 kB a všechno je to vytažené z originálu.
  var $files = ['global', 'sprites', 'loading', 'sounds', 'physics', 'cadence'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        // optional data files (those a later milestone adds) arrive as null
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $data = $mysqli->query('SELECT `score` FROM `rg_jp_hallOfFame` ORDER BY `score` DESC LIMIT 1');
    $mysqli->close();
    $result['hiScore'] = 0;
    if ($row = $data->fetch_object()) {
      $result['hiScore'] = $row->score;
    }

    return $result;
  } // execute

} // class DataCommand
