@echo off
rem ─────────────────────────────────────────────────────────────
rem  Double-clique ce fichier pour demarrer le serveur Smacpub.
rem  Il doit rester dans le meme dossier que smacpub-sync.mjs.
rem  Laisse la fenetre ouverte tant que tu veux lire a deux
rem  machines ; l'appli marche sans lui, mais seule.
rem ─────────────────────────────────────────────────────────────
setlocal
title smacpub-sync
rem  UTF-8 : sans ca les accents de l'affichage sortent en charabia
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur ce PC.
  echo.
  echo   Installe-le depuis https://nodejs.org ^(version LTS^),
  echo   puis double-clique de nouveau sur ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "smacpub-sync.mjs" (
  echo.
  echo   smacpub-sync.mjs est introuvable dans ce dossier :
  echo     %cd%
  echo.
  echo   Mets demarrer-smacpub.cmd, smacpub-sync.mjs, index.html
  echo   et les dossiers css, js et icons dans le meme dossier.
  echo.
  pause
  exit /b 1
)

if not exist "index.html" (
  echo.
  echo   Attention : index.html n'est pas dans ce dossier.
  echo   Le serveur gardera les donnees, mais il ne pourra pas
  echo   servir l'application.
  echo.
)

node smacpub-sync.mjs

echo.
echo   Le serveur est arrete. Ta bibliotheque est intacte :
echo   elle est dans smacpub-donnees.json et smacpub-livres.
echo.
pause
