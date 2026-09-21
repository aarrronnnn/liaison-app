; ============================================================
;  Ce que l'installateur Windows fait AVANT de poser les fichiers.
;
;  Cout de l'oubli, mesure sur le premier acheteur : « pour
;  installer la nouvelle version j'ai du desinstaller l'ancienne et
;  redemarrer le PC car il m'en ouvrait 5 ».
;
;  Ce qui s'etait passe : l'installateur a un jeu par defaut pour
;  demander a l'application en cours de se fermer — il cherche une
;  fenetre normale et lui envoie WM_CLOSE. Liaison n'a pas de
;  fenetre normale : c'est un widget sans cadre, toujours au
;  premier plan, et parfois seulement une icone dans la barre.
;  La demande n'a donc trouve personne, l'installateur a ecrase les
;  fichiers d'un programme en train de tourner, et Windows s'est
;  retrouve avec un Liaison a moitie ancien, a moitie neuf.
;
;  On ne demande plus poliment : on ferme, pour de bon, avant de
;  toucher au moindre fichier. Un widget n'a rien en cours qu'on
;  puisse perdre — la configuration et le journal de set sont
;  ecrits au fil de l'eau, jamais a la fermeture.
; ============================================================

!macro customInit
  DetailPrint "Fermeture de Liaison si elle tourne..."
  ; taskkill existe sur tout Windows encore supporte. /F : sans
  ; demander. /T : et les processus fils — les rendus Electron et
  ; les ouvriers d'analyse, qui tiennent eux aussi des fichiers.
  nsExec::Exec 'taskkill /F /T /IM "Liaison.exe"'
  Pop $0
  ; On laisse Windows relacher les verrous de fichiers. Sans cette
  ; pause, l'ecriture suivante peut encore echouer sur un .exe que
  ; le noyau n'a pas fini de liberer.
  Sleep 1200
!macroend

!macro customUnInit
  DetailPrint "Fermeture de Liaison si elle tourne..."
  nsExec::Exec 'taskkill /F /T /IM "Liaison.exe"'
  Pop $0
  Sleep 1200
!macroend

; ============================================================
;  Et ce qu'on efface en partant.
;
;  La desinstallation d'electron-builder retire le dossier du
;  programme et les raccourcis. Elle ne retire pas ce qu'une
;  version d'avant aurait pu laisser ailleurs : un raccourci de
;  demarrage automatique pose a la main, un reste de 0.x. On les
;  enleve, et seulement eux — les reglages du DJ et son journal de
;  soirees restent, pour qu'une reinstallation le retrouve chez
;  lui.
; ============================================================
!macro customUnInstall
  Delete "$SMSTARTUP\Liaison.lnk"
  Delete "$DESKTOP\Liaison.lnk"
!macroend
