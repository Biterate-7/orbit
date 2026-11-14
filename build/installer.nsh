; Extra NSIS pages for the Lost Orbit installer (picked up via nsis.include in electron-builder.yml).

; electron-builder's assisted installer has no Welcome page by default; add the standard one
; so players get the usual "Welcome to the Lost Orbit Setup Wizard" first screen.
; It is skipped when the installer is run as an update over an existing install.
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend
