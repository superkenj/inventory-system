; NSIS hooks for electron-builder — confirm before install; confirm before uninstall (assisted installer only).

!macro customHeader
  ; Use REGIS for %LOCALAPPDATA%\Programs\... instead of package.json "name".
  !define /redef APP_FILENAME "REGIS"
!macroend

!macro customInit
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "Do you want to install REGIS - Registrar Inventory System on this computer?" IDOK +2
  Quit
!macroend

; One-click uninstall already shows $(areYouSureToUninstall) in un.onInit. This adds an explicit prompt for assisted (non–one-click) uninstallers only.
!macro customUnInit
  !ifndef ONE_CLICK
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "Are you sure you want to uninstall REGIS - Registrar Inventory System?$\r$\n$\r$\nThis will remove the application from your computer." IDOK +2
    Quit
  !endif
!macroend
