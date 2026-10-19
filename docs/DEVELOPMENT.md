# Hopper · guida per sviluppatori

App da barra dei menu per macOS e Windows. Copi un testo, premi la hotkey (default **⌥ Space**) e si apre un popup sopra qualsiasi finestra con il testo copiato e le azioni rapide (traduci, riassumi, rispondi, correggi, spiega, chat libera). La risposta arriva in streaming; poi la copi, la incolli nell'app sotto o continui in chat.

Flussi e bozzetti: https://claude.ai/artifact/BP8eFVt2fJ1AL3metXU6kj

## Look

Liquid glass: finestra trasparente con vibrancy nativa (crate `window-vibrancy`, materiale Popover su macOS, acrylic su Windows) e superfici traslucide in CSS sopra la sfocatura. Un solo accento, rosso (`--accent`), tema chiaro e scuro seguono il sistema. Font di sistema.

## Stack

- **Tauri v2** (Rust) + **React 19** + TypeScript + Vite
- Plugin Tauri: `global-shortcut`, `clipboard-manager`, `autostart`, `store`, `opener`
- API key in `secrets.json` (0600) nella cartella dati dell'app; il Keychain tornerà con i build firmati (i build non firmati cambiano identità a ogni versione e macOS chiede la password)
- `enigo` → simula ⌘V / Ctrl+V per "Incolla nell'app" (su macOS serve il permesso Accessibilità)
- SDK ufficiali `@anthropic-ai/sdk` e `openai`, chiamati dalla webview con streaming. Tutti i provider tranne Anthropic passano dall'SDK OpenAI con `baseURL` del provider (catalogo in `src/lib/providers.ts`): OpenAI, Ollama, LM Studio, OpenRouter, Gemini, Mistral, Groq, DeepSeek, endpoint personalizzato

## Selezione, immagini e screenshot

- **Selezione senza copiare**: alla hotkey `grab_selection` (Rust) aspetta che i modificatori siano rilasciati (`CGEventSourceFlagsState` su macOS, `GetAsyncKeyState` su Windows), simula ⌘C/Ctrl+C con enigo, legge la clipboard e la ripristina (testo o immagine). Se la clipboard non cambia, si usa il suo contenuto. Si disattiva con `set_prefs` (switch in Generale).
- **Immagini**: il payload `popup-open` porta `image` (PNG base64) quando la clipboard contiene un'immagine e nessun testo, o dopo uno screenshot. `ChatMessage.image` viaggia come blocco immagine (Anthropic) o `image_url` data URL (OpenAI-compatibili). Le immagini non finiscono nella cronologia.
- **Screenshot**: hotkey `shot` (default ⌥⇧Space / Ctrl+Alt+Space) → `take_screenshot`. macOS: `screencapture -i -x` su file temporaneo, con controllo `CGPreflightScreenCaptureAccess` e prompt `CGRequestScreenCaptureAccess`. Windows: `explorer.exe ms-screenclip:` e polling della clipboard finché compare l'immagine (fino a 90 s).
- Le azioni rapide hanno `input: any | text | image`; il popup mostra solo quelle compatibili con ciò che contiene.

## Lingue

Interfaccia in inglese di default, italiano selezionabile in Impostazioni › Generale. Stringhe con **i18next** (`react-i18next` nei componenti, `t()` di `src/lib/i18n.ts` nel codice non React): un file JSON per lingua in `src/locales/`, chiavi piatte (`popup.copy`). Per aggiungere una lingua: copia `en.json`, traducilo, registralo in `src/lib/i18n.ts` (`resources` e `LOCALES`). Seguono la lingua anche le azioni rapide di default (`src/lib/settings.ts`), la libreria (`src/lib/templates.ts`), il system prompt (`src/lib/profile.ts`) e il menu della tray (`set_tray_labels` in Rust).

## Build locali e permessi macOS

I permessi TCC (Accessibilità, Registrazione schermo) sono legati alla firma dell'app: un build non firmato cambia identità a ogni compilazione e macOS ignora il permesso già concesso. Per i build locali firma con l'identità Apple Development presente nel portachiavi:

```sh
APPLE_SIGNING_IDENTITY="Apple Development: Pasquale Capuano (2X35448Z65)" npm run tauri build -- --bundles app
```

Registrazione schermo vale solo dopo il riavvio dell'app. Se un permesso resta "attivo" ma inefficace: `tccutil reset ScreenCapture com.pasqualecapuano.hopper` e riconcedilo.

## Vincolo di prodotto

Niente OAuth degli abbonamenti Claude Pro/Max o ChatGPT Plus: non è permesso alle app di terze parti. Si usa una API key a consumo, salvata in locale. Con Claude Max hai crediti API mensili inclusi (100 $ su Max 5x, 200 $ su Max 20x), richiedibili da console.anthropic.com.

## Installazione

**macOS** (Apple Silicon e Intel): scarica il `.dmg` dall'[ultima release](https://github.com/PasqualeCapuano/hopper/releases/latest) e trascina Hopper in Applicazioni. Oppure da terminale:

```sh
curl -fsSL https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.sh | sh
```

**Windows**: scarica il `-setup.exe` dall'ultima release. Oppure da PowerShell:

```powershell
irm https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.ps1 | iex
```

I build non sono ancora firmati: macOS mostra "sviluppatore non identificato" (lo script di installazione lo risolve), Windows mostra l'avviso SmartScreen (Ulteriori informazioni → Esegui comunque). Gli aggiornamenti successivi arrivano dall'app stessa.

Hotkey di default: ⌥ Space su macOS, Ctrl+Shift+Space su Windows. Si cambia nelle impostazioni.

## Sviluppo

```bash
npm install
npm run tauri dev      # sviluppo (prima compilazione: alcuni minuti)
npm run tauri build    # bundle .app/.dmg (macOS) o .msi (Windows)
```

Prerequisiti: Node 20+, Rust (rustup), Xcode Command Line Tools su macOS.

## Struttura

```
src-tauri/src/lib.rs        tray, hotkey globale, posizionamento popup, Keychain, incolla
src-tauri/tauri.conf.json   finestra popup (senza bordi, always-on-top), CSP
src-tauri/capabilities/     permessi IPC
src/popup/Popup.tsx         popup: idle → risultato → chat, errori, scorciatoie da tastiera
src/settings/Settings.tsx   account/modello, hotkey, azioni rapide, generale
src/lib/ai.ts               streaming Anthropic e OpenAI-compatibile, elenco modelli, mappatura errori
src/lib/providers.ts        catalogo provider: base URL, chiave, modello di default
src/lib/settings.ts         impostazioni (plugin store) e azioni di default
src/lib/secrets.ts          API key via Keychain (comandi Rust)
src/lib/history.ts          ultimi 30 thread in locale
```

## Da fare

- Rifinire l'icona (generata da `python3 scripts/make-icon.py`, poi `npm run tauri icon src-tauri/icons/hopper-source.png`)
- Firma e notarizzazione macOS, firma Windows
- Homebrew tap e winget

## Release

Ogni tag `vX.Y.Z` fa partire `.github/workflows/release.yml`, che compila su macOS (universal) e Windows, pubblica gli installer nella Release e il `latest.json` letto dall'updater. Prima di taggare, aggiorna `version` in `src-tauri/tauri.conf.json` e `package.json`. La chiave che firma gli aggiornamenti è in `~/.tauri/hopper.key` (non perderla) e nel secret `TAURI_SIGNING_PRIVATE_KEY` della repo.
- Cronologia thread visibile nel popup (oggi è solo salvata)
- Rilevare l'app di origine del testo copiato
