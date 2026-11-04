<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Jetpac and of this remake.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1983)',
          'html' =>
            '<p>Jetpac was released by Ultimate Play The Game in 1983 for the 16K ZX Spectrum. It was '.
            'the first game of the studio founded by Tim and Chris Stamper, and the first of the Jetman '.
            'series. Jetman has landed on an alien planet with his rocket in three pieces: the base stands '.
            'on the ground, the other two lie on the ledges above. He has to fly them over and stack them, '.
            'then fill the tank with six loads of fuel that drop from the sky, climb aboard and take off for '.
            'the next planet.</p>'.
            '<p>All the while waves of aliens drift in from both sides of the screen, and every planet '.
            'brings a different kind, with a behaviour of its own. Jetman flies with inertia, his laser '.
            'wraps round the screen, and gems and other treasure that fall now and then are worth extra '.
            'points. Every fourth planet the rocket comes apart and has to be built again.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated. Its graphics '.
            'and the way the game plays are those of the original ZX Spectrum game, with one exception: the '.
            'sprites. The colour clash between them, the Spectrum\'s familiar side effect, does not happen '.
            'here. The high scores are kept in a hall of fame on the server.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard '.
            '(the arrow keys and space, or keys of your own), touch controls and gamepads are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Jetpac on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Jetpac'],
        ['label' => 'Jetpac at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/entry/9362'],
        ['label' => 'Jetpac at World of Spectrum', 'url' => 'https://worldofspectrum.org/software?id=0009362'],
        ['label' => 'Tim and Chris Stamper on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Stamper_brothers'],
        ['label' => 'Tim Stamper — his games at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/list?label_id=14605'],
        ['label' => 'Chris Stamper — his games at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/list?label_id=2480'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Ultimate Play The Game, today Rare/Microsoft). '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
