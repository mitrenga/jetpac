<?php
  $appName = 'JET PAC';
  $appDescription = 'Play JETPAC online for free in your browser. Faithful remake of the 1983 Ultimate Play The Game ZX Spectrum classic, no download required.';
  $appPrefix = 'jp';
  $appNoscript =
    '<h1>JETPAC</h1>'.
    '<p>Jetpac is the 1983 ZX Spectrum game by Ultimate Play The Game, their first, written for the '.
    '16K machine. Jetman has to build his rocket out of the pieces that drop onto the platforms, '.
    'fuel it, and fly on to the next planet — while the wildlife of that planet tries to fly '.
    'through him. He has a jetpack, a laser and no way of standing still for long.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Jetpac and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Shooter',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Jetpac',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Ultimate Play The Game'],
      ],
      'datePublished' => '1983',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
