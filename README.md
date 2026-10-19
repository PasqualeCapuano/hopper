<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="Hopper icon">
</p>

<h1 align="center">Hopper</h1>

<p align="center">
  Copy any text. Press a hotkey. Get an AI assistant right where you are.
</p>

<p align="center">
  <a href="https://github.com/PasqualeCapuano/hopper/releases/latest">Download</a> ·
  <a href="#install">Install</a> ·
  <a href="#first-run">First run</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#faq">FAQ</a>
</p>

---

Hopper lives in your menu bar (or system tray on Windows). Whenever you copy a piece of text, in any app, press the hotkey and a small window appears over everything else with that text and a row of quick actions. Pick one, watch the answer stream in, then copy it, paste it straight back into the app you came from, or keep the conversation going.

No browser tab, no switching windows, no pasting into a chat box.

## What it does

- **Translate, summarize, reply, fix, explain** the text you just copied, with one key press each.
- **Free prompt**: type what you want done with the text instead of picking an action.
- **Chat**: turn any answer into a conversation without losing the original text as context.
- **Paste back**: send the result straight into the app you were in, no clipboard juggling.
- **Your own actions**: write custom prompts, choose what happens after the answer, give each a shortcut.
- **Your own AI**: Claude, OpenAI, Gemini, Mistral, Groq, DeepSeek, OpenRouter, or any OpenAI-compatible endpoint. You bring the key, you choose the model.
- **Fully local, if you want**: point it at Ollama or LM Studio and nothing ever leaves your computer. No key, no cost.
- **Follows your system**: light and dark appearance, system font, a translucent window that sits over your desktop.

## Install

### macOS (Apple Silicon and Intel)

Download the `.dmg` from the [latest release](https://github.com/PasqualeCapuano/hopper/releases/latest), open it and drag Hopper to Applications.

Or paste this in Terminal, which downloads the latest version and installs it for you:

```sh
curl -fsSL https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.sh | sh
```

### Windows 10 / 11

Download the `-setup.exe` from the [latest release](https://github.com/PasqualeCapuano/hopper/releases/latest) and run it.

Or paste this in PowerShell:

```powershell
irm https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.ps1 | iex
```

> **About the security warnings.** Hopper is not code-signed yet, so macOS may say it comes from an "unidentified developer" and Windows may show a SmartScreen notice. On macOS, right-click the app and choose Open, or use the Terminal command above, which handles it. On Windows, click "More info" then "Run anyway". The source code is right here if you want to check what it does.

## First run

1. Click the red Hopper icon in the menu bar and open **Settings**.
2. Choose a provider and paste an API key. Each card links to the page where you create one:
   - **Claude** ([console.anthropic.com](https://console.anthropic.com/settings/keys)), **OpenAI** ([platform.openai.com](https://platform.openai.com/api-keys)), **Gemini**, **Mistral**, **Groq**, **DeepSeek**, **OpenRouter** (one key for hundreds of models), or **Custom** for any OpenAI-compatible server.
   - **Ollama** or **LM Studio**: no key. Install the app, download a model (`ollama pull llama3.2`), pick it in Hopper. Everything runs on your machine.
3. Press **Test and save**. The key is stored on your computer, in a file only your user account can read. Use "Load the list from the provider" to pick a model from what your account or local server offers.
4. Copy some text anywhere and press **⌥ Space** (macOS) or **Ctrl+Shift+Space** (Windows).

### What it costs

Hopper itself is free. With Ollama or LM Studio the replies are free too. With a cloud provider they are billed per request on the key you added. A typical request, a few hundred words in and a short answer out, costs about one cent with Claude Opus. Three hundred requests a month is roughly four dollars.

If you have a **Claude Max** subscription, it includes a monthly API credit (100 $ on Max 5x, 200 $ on Max 20x) that covers this kind of use entirely. Claim it from your Anthropic Console account. Claude Pro/Max and ChatGPT Plus logins themselves cannot be used by third-party apps, which is why Hopper asks for a key.

## Using Hopper

| Keys | What happens |
|---|---|
| ⌥ Space / Ctrl+Shift+Space | Open the popup with whatever is in the clipboard |
| 1 – 6 | Run a quick action |
| ↵ | Send a free prompt, or copy the answer |
| ⌘ ↵ / Ctrl ↵ | Paste the answer into the app you came from |
| Esc | Close (also closes when you click elsewhere) |

Drag the popup by its header to move it. It opens centred on the screen you are working on.

**Quick actions** live in Settings → Quick actions. Each one is a prompt where `{{text}}` stands for the copied text (`{{testo}}` works too). You can choose what happens after the answer: show it, copy it right away, or paste it right away. The first six appear in the popup.

**Your assistant** (Settings → Your assistant) shapes every reply with a few choices instead of a prompt to write: your name and what you do, the language of the answers (same as the text, or a fixed one), tone (direct, warm, formal, casual), length, and the signature for messages written on your behalf. A free field is there for anything else it should know.

**No need to copy first.** With the Accessibility permission, Hopper reads whatever is selected when you press the hotkey (it presses ⌘C for you and puts your clipboard back). Without a selection it uses the clipboard, as before. You can switch this off in Settings → General.

**Screenshots.** Press ⌥⇧Space (Ctrl+Alt+Space on Windows), draw a rectangle, and the popup opens on the capture with the actions that work on images: extract the text, translate what's written, explain, reply, describe, or ask anything in chat. Copying an image and pressing the normal hotkey works the same way. On macOS this needs the Screen Recording permission: turn Hopper on when asked, then relaunch it. Because the builds are not yet signed with an Apple Developer ID, macOS may ask again after an update. Your model must accept images: Claude, GPT, Gemini and Mistral do; with Ollama pick a vision model such as `llava` or `qwen2.5-vl`.

**Dictation.** Hold ⌥⇧D (Ctrl+Alt+D on Windows), talk, let go: what you said is typed where your cursor is, in any app. A small pill shows the level while you speak. Transcription runs on Groq (Whisper, free tier) or OpenAI with the key you saved in Account & model; your chat model then adds punctuation, drops the "uh"s and understands "new line", "new paragraph" and "scratch that" (switchable off). Settings → Dictation sets the hotkey, hold or press-to-toggle, the spoken language and words it should know. macOS asks for the Microphone permission once.

**Language**: the interface is in English by default. Switch to Italian in Settings → General; the built-in quick actions and the library follow. Other languages are one JSON file away, see `src/locales`.

**Paste back** on macOS needs the Accessibility permission, because Hopper has to press ⌘V on your behalf. macOS asks once, the first time you use it. Everything else works without it.

## Privacy

- Hopper has no server and no account. There is nothing to sign up for.
- The only network traffic is the request to the provider you chose, sent directly from your computer to Anthropic or OpenAI, plus a check for new versions on GitHub at launch.
- The clipboard is read only when you press the hotkey, never in the background.
- API keys are stored in a file readable only by your user account, inside Hopper's data folder (the same approach as `git`, `gh` or the AWS CLI). Keychain storage will come with signed builds. Conversation history (last 30 threads) stays next to it; delete the folder at any time.
- The code is open source under the MIT license, so all of the above can be verified.

## Updates

Hopper checks for a new version when it starts. If there is one, the popup shows "vX.Y.Z available · Install". One click downloads it, verifies its signature and restarts. You can also check from Settings → General.

## FAQ

**The hotkey does nothing.**
Another app probably owns that combination. Claude Desktop, for instance, also uses ⌥ Space on macOS. Change Hopper's hotkey in Settings → Shortcuts.

**"API key not valid".**
The provider rejected the key. Open Settings → Account, paste it again and press Test and save. Keys from the Anthropic Console start with `sk-ant-`.

**Can I use it with my ChatGPT Plus or Claude Pro login?**
No. Those logins are reserved for the official apps. Hopper uses API keys, which are a separate, pay-per-use service from the same companies. Claude Max subscribers get monthly API credit, see above.

**Does it work offline?**
The app opens, but replies need the provider. If you are offline Hopper keeps the request and offers a Retry.

**Where is my data?**
macOS: `~/Library/Application Support/com.pasqualecapuano.hopper/`. Windows: `%APPDATA%\com.pasqualecapuano.hopper\`. Delete the folder to reset everything, keys included.

## For developers

Build instructions, architecture and the release process are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Built with [Tauri](https://tauri.app), Rust and React.

## License

MIT © Pasquale Capuano
