; bun-rdp NSIS Installer
; Requires NSIS >= 3.09 and the following in dist/:
;   bun-rdp-server.exe
;   web-ui\**\*
;
; Build: makensis installer/bun-rdp.nsi

!define APP_NAME      "bun-rdp"
!define APP_VERSION   "1.0.0"
!define APP_PUBLISHER "involvex"
!define APP_URL       "https://github.com/involvex/bun-rdp"
!define EXE_NAME      "bun-rdp-server.exe"
!define SERVICE_NAME  "bun-rdp"
!define INSTALL_DIR   "$PROGRAMFILES64\bun-rdp"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\bun-rdp"

Name          "${APP_NAME} ${APP_VERSION}"
OutFile       "..\dist\bun-rdp-${APP_VERSION}-setup.exe"
InstallDir    "${INSTALL_DIR}"
InstallDirRegKey HKLM "Software\bun-rdp" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

;── Pages ──────────────────────────────────────────────────────────────────────
!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
Page custom ServicePage ServicePageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

;── Service page ───────────────────────────────────────────────────────────────
Var InstallService
Function ServicePage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 20u 100% 12u "Install as Windows Service (auto-start on boot)"
  Pop $1
  ${NSD_SetState} $1 ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd

Function ServicePageLeave
  ${NSD_GetState} $1 $InstallService
FunctionEnd

;── Install ────────────────────────────────────────────────────────────────────
Section "Main" SEC_MAIN
  SetOutPath "$INSTDIR"
  File "..\dist\${EXE_NAME}"
  SetOutPath "$INSTDIR\web-ui"
  File /r "..\dist\web-ui\*"

  ; Write .env if it doesn't exist
  IfFileExists "$INSTDIR\.env" done_env
  File /oname=.env "..\\.env.example"
  done_env:

  ; Generate initial secret
  DetailPrint "Generating BUN_RDP_SECRET…"
  nsExec::ExecToStack '"$INSTDIR\${EXE_NAME}" --gen-secret'
  Pop $0

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\bun-rdp"
  CreateShortcut  "$SMPROGRAMS\bun-rdp\bun-rdp.lnk" "$INSTDIR\${EXE_NAME}"
  CreateShortcut  "$SMPROGRAMS\bun-rdp\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Windows Firewall rule
  DetailPrint "Adding firewall rule…"
  nsExec::Exec 'netsh advfirewall firewall add rule name="bun-rdp" dir=in action=allow protocol=TCP localport=9001'

  ; Install Windows service (optional)
  StrCmp $InstallService ${BST_CHECKED} 0 skip_service
    DetailPrint "Installing Windows service…"
    nsExec::Exec 'sc create "${SERVICE_NAME}" binPath= "\"$INSTDIR\${EXE_NAME}\"" start= auto DisplayName= "bun-rdp Remote Desktop"'
    nsExec::Exec 'sc description "${SERVICE_NAME}" "bun-rdp — Bun-based remote desktop server"'
    nsExec::Exec 'sc start "${SERVICE_NAME}"'
  skip_service:

  ; Registry
  WriteRegStr   HKLM "Software\bun-rdp" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"       "${APP_VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"            "${APP_PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "URLInfoAbout"         "${APP_URL}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString"      "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"             1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"             1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

;── Uninstall ─────────────────────────────────────────────────────────────────
Section "Uninstall"
  nsExec::Exec 'sc stop "${SERVICE_NAME}"'
  nsExec::Exec 'sc delete "${SERVICE_NAME}"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="bun-rdp"'
  RMDir /r "$INSTDIR"
  RMDir /r "$SMPROGRAMS\bun-rdp"
  DeleteRegKey HKLM "Software\bun-rdp"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
SectionEnd
